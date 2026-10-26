import { env, userAgent } from "@/lib/env";
import { request, sleep, type FetchLike } from "./http";
import { ProviderError } from "./types";

export type GeoArea = {
  lat: number;
  lon: number;
  displayName: string;
  bbox?: [number, number, number, number]; // sur, oeste, norte, este
  /** Contorno del municipio (MultiPolygon: polígonos → anillos → [lon, lat]) para filtrar con precisión. */
  polygon?: number[][][][];
};

type GeoJson = { type: string; coordinates: unknown };

type NominatimItem = {
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  category?: string; // jsonv2
  class?: string; // json (v1)
  type?: string;
  boundingbox?: [string, string, string, string];
  geojson?: GeoJson;
};

// Política de Nominatim: máx. 1 petición/s, User-Agent identificable y caché de resultados.
const MIN_INTERVAL_MS = 1100;
const CACHE_TTL_MS = 24 * 3600 * 1000;
const cache = new Map<string, { at: number; value: GeoArea }>();
let lastCall = 0;
let queue: Promise<unknown> = Promise.resolve();

export function resetGeocodeCache() {
  cache.clear();
  lastCall = 0;
}

function toMultiPolygon(g?: GeoJson): number[][][][] | undefined {
  if (!g) return undefined;
  if (g.type === "Polygon") return [g.coordinates as number[][][]];
  if (g.type === "MultiPolygon") return g.coordinates as number[][][][];
  return undefined;
}

/** Punto en polígono (trazado de rayos) con soporte de huecos; coordenadas en [lon, lat]. */
export function pointInArea(lat: number, lon: number, polygon: number[][][][]): boolean {
  const inRing = (ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi! > lat !== yj! > lat && lon < ((xj! - xi!) * (lat - yi!)) / (yj! - yi!) + xi!) inside = !inside;
    }
    return inside;
  };
  return polygon.some(([outer, ...holes]) => outer && inRing(outer) && !holes.some(inRing));
}

export function pickArea(items: NominatimItem[]): GeoArea | null {
  if (!items.length) return null;
  const admin = items.find((i) => i.osm_type === "relation" && (i.category ?? i.class) === "boundary");
  const chosen = admin ?? items[0]!;
  const bb = chosen.boundingbox?.map(Number);
  return {
    lat: Number(chosen.lat),
    lon: Number(chosen.lon),
    displayName: chosen.display_name,
    polygon: toMultiPolygon(chosen.geojson),
    bbox: bb && bb.length === 4 && bb.every(Number.isFinite) ? [bb[0]!, bb[2]!, bb[1]!, bb[3]!] : undefined,
  };
}

export async function geocode(
  place: { city: string; region?: string; country: string },
  opts: { fetchImpl?: FetchLike; sleepImpl?: (ms: number) => Promise<void>; signal?: AbortSignal } = {},
): Promise<GeoArea> {
  const countryName = place.country === "ES" ? "España" : place.country;
  const q = [place.city, place.region, countryName].filter(Boolean).join(", ");
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const run = async () => {
    const wait = opts.sleepImpl ?? sleep;
    const gap = MIN_INTERVAL_MS - (Date.now() - lastCall);
    if (gap > 0) await wait(gap);
    lastCall = Date.now();
    const url = new URL("/search", env().NOMINATIM_URL);
    url.search = new URLSearchParams({
      q,
      format: "jsonv2",
      polygon_geojson: "1",
      polygon_threshold: "0.0005",
      limit: "5",
      countrycodes: place.country.toLowerCase(),
      "accept-language": "es",
    }).toString();
    const res = await request(url.toString(), { headers: { "User-Agent": userAgent(), Accept: "application/json" } }, {
      fetchImpl: opts.fetchImpl,
      sleep: opts.sleepImpl,
      signal: opts.signal,
      timeoutMs: 15_000,
      retries: 1,
    });
    if (!res.ok) throw new ProviderError("El servicio de localización (Nominatim) no está disponible ahora mismo.", "unavailable", true);
    const area = pickArea((await res.json()) as NominatimItem[]);
    if (!area) throw new ProviderError(`No se ha encontrado la localidad «${place.city}». Revisa el nombre o añade la provincia.`, "not_found");
    cache.set(key, { at: Date.now(), value: area });
    return area;
  };

  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}
