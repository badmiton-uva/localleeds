import { env, userAgent } from "@/lib/env";
import { SECTORS, sectorByKey, type OsmCond } from "@/lib/domain";
import { normalizeWebsite } from "@/lib/utils";
import { geocode, pointInArea, type GeoArea } from "./geocode";
import { request, type FetchLike } from "./http";
import { ProviderError, type DiscoveryProvider, type ProviderCompany, type ProviderMeta, type SearchParams } from "./types";

export const OSM_META: ProviderMeta = {
  key: "osm",
  name: "OpenStreetMap (Overpass API)",
  license: "ODbL 1.0",
  attribution: "© Colaboradores de OpenStreetMap",
  termsUrl: "https://www.openstreetmap.org/copyright",
  storagePolicy: "persistent",
  retentionDays: null,
};

const BUSINESS_KEYS = "^(shop|amenity|office|craft|tourism|healthcare|leisure)$";

type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

const esc = (v: string) => v.replace(/[\\"]/g, "\\$&");
const escRegex = (v: string) => esc(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

function condToFilter(c: OsmCond): string {
  if (!c.v?.length) return `["${esc(c.k)}"]`;
  if (c.v.length === 1) return `["${esc(c.k)}"="${esc(c.v[0]!)}"]`;
  return `["${esc(c.k)}"~"^(${c.v.map(escRegex).join("|")})$"]`;
}

export function buildOverpassQuery(p: SearchParams, area: GeoArea): string {
  // Se consulta por caja (rápida y válida en cualquier espejo); luego se filtra con el contorno exacto.
  const scope = p.radiusM
    ? `(around:${Math.round(p.radiusM)},${area.lat},${area.lon})`
    : area.bbox
      ? `(${area.bbox.join(",")})`
      : `(around:3000,${area.lat},${area.lon})`;
  const kw = p.keywords?.trim();
  const nameFilter = kw ? `["name"~"${escRegex(kw)}",i]` : "";
  const sector = sectorByKey(p.sectorKey);
  const parts: string[] = [];
  if (sector) {
    for (const c of sector.osm) parts.push(`nwr${condToFilter(c)}["name"]${nameFilter}${scope};`);
  } else {
    // Sin sector: cualquier negocio con nombre (obliga a indicar palabras clave en la validación).
    parts.push(`nwr[~"${BUSINESS_KEYS}"~"."]["name"]${nameFilter}${scope};`);
  }
  // Se piden más elementos de los necesarios: algunos se descartan (sin nombre válido, duplicados).
  const limit = Math.min(500, p.maxResults * 2);
  return `[out:json][timeout:25];\n(\n${parts.join("\n")}\n);\nout center tags ${limit};`;
}

export function inferSector(tags: Record<string, string>): { key?: string; label?: string } {
  for (const s of SECTORS) {
    for (const c of s.osm) {
      const val = tags[c.k];
      if (val !== undefined && (!c.v || c.v.includes(val))) return { key: s.key, label: s.label };
    }
  }
  return {};
}

const first = (v?: string) => v?.split(";")[0]?.trim() || undefined;

export function mapOsmElement(el: OsmElement, fallbackCity: string, sectorKey?: string): ProviderCompany | null {
  const tags = el.tags ?? {};
  const name = tags.name?.trim();
  if (!name) return null;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  const sector = sectorKey ? sectorByKey(sectorKey) : undefined;
  const inferred = inferSector(tags);
  const website = normalizeWebsite(tags.website ?? tags["contact:website"] ?? tags.url);
  return {
    providerId: `${el.type}/${el.id}`,
    name,
    sectorKey: sector?.key ?? inferred.key,
    sectorLabel: sector?.label ?? inferred.label ?? (tags.shop || tags.amenity || tags.office || tags.craft || tags.tourism || tags.healthcare || tags.leisure ? "Otros negocios" : undefined),
    address: street || undefined,
    postalCode: tags["addr:postcode"],
    city: tags["addr:city"] ?? fallbackCity,
    website: website ?? undefined,
    phone: first(tags.phone ?? tags["contact:phone"]),
    description: tags.description,
    lat,
    lng: lon,
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    raw: { tags },
  };
}

export function createOsmProvider(deps: { fetchImpl?: FetchLike; sleepImpl?: (ms: number) => Promise<void> } = {}): DiscoveryProvider {
  return {
    meta: OSM_META,
    isConfigured: () => true,
    async search(params, opts) {
      if (!params.sectorKey && !params.keywords?.trim()) {
        throw new ProviderError("Elige un sector o escribe palabras clave para buscar.", "bad_response");
      }
      const notes: string[] = [];
      const area = await geocode(
        { city: params.city, region: params.region, country: params.country },
        { fetchImpl: deps.fetchImpl, sleepImpl: deps.sleepImpl, signal: opts?.signal },
      );
      notes.push(`Zona resuelta: ${area.displayName}.`);
      const query = buildOverpassQuery(params, area);

      const endpoints = env().OVERPASS_URL.split(",").map((s) => s.trim()).filter(Boolean);
      let json: { elements?: OsmElement[]; remark?: string } | null = null;
      let rateLimited = false;
      for (const endpoint of endpoints) {
        try {
          const res = await request(
            endpoint,
            {
              method: "POST",
              headers: { "User-Agent": userAgent(), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
              body: new URLSearchParams({ data: query }).toString(),
            },
            { fetchImpl: deps.fetchImpl, sleep: deps.sleepImpl, signal: opts?.signal, timeoutMs: 35_000, retries: 0 },
          );
          if (res.status === 429) { rateLimited = true; console.warn(`[overpass] ${endpoint} → 429`); continue; }
          if (!res.ok) { console.warn(`[overpass] ${endpoint} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`); continue; }
          const body = (await res.json()) as { elements?: OsmElement[]; remark?: string };
          if (body.remark && /error|timed out|out of memory/i.test(body.remark) && !body.elements?.length) { console.warn(`[overpass] ${endpoint} remark: ${body.remark}`); continue; }
          json = body;
          break;
        } catch (err) {
          if (opts?.signal?.aborted) throw err;
          console.warn(`[overpass] ${endpoint} falló:`, err instanceof Error ? err.message : err);
        }
      }
      if (!json) {
        throw new ProviderError(
          rateLimited
            ? "Overpass está limitando las peticiones. Espera un minuto y reintenta."
            : "No se pudo consultar OpenStreetMap (Overpass). Reintenta en unos minutos.",
          rateLimited ? "rate_limited" : "unavailable",
          true,
        );
      }

      const seen = new Set<string>();
      const companies: ProviderCompany[] = [];
      const exactBoundary = !params.radiusM && area.polygon;
      for (const el of json.elements ?? []) {
        const c = mapOsmElement(el, params.city, params.sectorKey);
        if (!c || seen.has(c.providerId)) continue;
        if (exactBoundary && (c.lat === undefined || c.lng === undefined || !pointInArea(c.lat, c.lng, area.polygon!))) continue;
        seen.add(c.providerId);
        companies.push(c);
      }
      // Los que tienen web van primero: son los únicos auditables.
      companies.sort((a, b) => Number(Boolean(b.website)) - Number(Boolean(a.website)));
      const truncated = companies.length > params.maxResults;
      if (truncated) notes.push(`Se muestran ${params.maxResults} de ${companies.length} negocios encontrados; aumenta el máximo para ver más.`);
      if (companies.length === 0) notes.push("OpenStreetMap no devuelve negocios con ese criterio. Su cobertura depende de las aportaciones de la comunidad.");
      return { companies: companies.slice(0, params.maxResults), notes };
    },
  };
}
