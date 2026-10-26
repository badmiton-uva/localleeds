import { env } from "@/lib/env";
import { sectorByKey } from "@/lib/domain";
import { normalizeWebsite } from "@/lib/utils";
import { geocode } from "./geocode";
import { request, type FetchLike } from "./http";
import { ProviderError, type DiscoveryProvider, type ProviderCompany, type ProviderMeta } from "./types";

export const GOOGLE_META: ProviderMeta = {
  key: "google_places",
  name: "Google Places API (New)",
  license: "Términos de Google Maps Platform",
  attribution: "Datos de Google Maps",
  termsUrl: "https://cloud.google.com/maps-platform/terms",
  // Criterio conservador: solo el place_id se conserva; el resto caduca a los 30 días.
  storagePolicy: "expiring",
  retentionDays: 30,
};

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
// websiteUri y nationalPhoneNumber pertenecen a SKUs superiores: tienen coste (ver README).
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.primaryTypeDisplayName",
  "places.googleMapsUri",
  "places.businessStatus",
  "nextPageToken",
].join(",");

type GooglePlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
  nationalPhoneNumber?: string;
  primaryTypeDisplayName?: { text?: string };
  googleMapsUri?: string;
  businessStatus?: string;
};

export function mapGooglePlace(p: GooglePlace, city: string, sectorKey?: string): ProviderCompany | null {
  const name = p.displayName?.text?.trim();
  if (!p.id || !name) return null;
  if (p.businessStatus === "CLOSED_PERMANENTLY") return null;
  const sector = sectorByKey(sectorKey);
  const postal = p.formattedAddress?.match(/\b\d{5}\b/)?.[0];
  return {
    providerId: p.id,
    name,
    sectorKey: sector?.key,
    sectorLabel: sector?.label ?? p.primaryTypeDisplayName?.text,
    address: p.formattedAddress,
    postalCode: postal,
    city,
    website: normalizeWebsite(p.websiteUri) ?? undefined,
    phone: p.nationalPhoneNumber,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    sourceUrl: p.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${p.id}`,
  };
}

export function createGooglePlacesProvider(deps: { fetchImpl?: FetchLike; sleepImpl?: (ms: number) => Promise<void> } = {}): DiscoveryProvider {
  return {
    meta: GOOGLE_META,
    isConfigured: () => Boolean(env().GOOGLE_PLACES_API_KEY),
    async search(params, opts) {
      const key = env().GOOGLE_PLACES_API_KEY;
      if (!key) throw new ProviderError("Google Places no está configurado (falta GOOGLE_PLACES_API_KEY).", "not_configured");
      if (!params.sectorKey && !params.keywords?.trim()) {
        throw new ProviderError("Elige un sector o escribe palabras clave para buscar.", "bad_response");
      }
      const sector = sectorByKey(params.sectorKey);
      const where = [params.city, params.region, params.country === "ES" ? "España" : params.country].filter(Boolean).join(", ");
      const textQuery = [sector?.googleQuery, params.keywords?.trim(), "en", where].filter(Boolean).join(" ");
      const notes: string[] = [];

      let locationBias: Record<string, unknown> | undefined;
      if (params.radiusM) {
        const area = await geocode(
          { city: params.city, region: params.region, country: params.country },
          { fetchImpl: deps.fetchImpl, sleepImpl: deps.sleepImpl, signal: opts?.signal },
        );
        locationBias = { circle: { center: { latitude: area.lat, longitude: area.lon }, radius: params.radiusM } };
      }

      const companies: ProviderCompany[] = [];
      let pageToken: string | undefined;
      // Text Search (New) devuelve hasta 20 resultados por página y 60 en total.
      for (let page = 0; page < 3 && companies.length < params.maxResults; page++) {
        const res = await request(
          ENDPOINT,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELD_MASK },
            body: JSON.stringify({
              textQuery,
              languageCode: "es",
              regionCode: params.country,
              pageSize: Math.min(20, params.maxResults - companies.length),
              ...(locationBias ? { locationBias } : {}),
              ...(pageToken ? { pageToken } : {}),
            }),
          },
          { fetchImpl: deps.fetchImpl, sleep: deps.sleepImpl, signal: opts?.signal, retries: 2 },
        );
        if (res.status === 403 || res.status === 401) {
          throw new ProviderError("Google rechazó la clave de API. Comprueba que la Places API (New) está habilitada y la clave es válida.", "not_configured");
        }
        if (res.status === 429) throw new ProviderError("Google Places ha superado la cuota. Reintenta más tarde.", "rate_limited", true);
        if (!res.ok) throw new ProviderError("Google Places no está disponible ahora mismo.", "unavailable", true);
        const body = (await res.json()) as { places?: GooglePlace[]; nextPageToken?: string };
        for (const p of body.places ?? []) {
          const c = mapGooglePlace(p, params.city, params.sectorKey);
          if (c && !companies.some((x) => x.providerId === c.providerId)) companies.push(c);
        }
        pageToken = body.nextPageToken;
        if (!pageToken) break;
      }
      notes.push("Los datos de Google Places solo se conservan 30 días (identificador permanente); no se incluyen en las exportaciones.");
      if (!companies.length) notes.push("Google Places no devolvió resultados para esa búsqueda.");
      return { companies: companies.slice(0, params.maxResults), notes };
    },
  };
}
