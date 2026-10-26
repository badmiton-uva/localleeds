import { createGooglePlacesProvider, GOOGLE_META } from "./google-places";
import { createOsmProvider, OSM_META } from "./osm";
import type { DiscoveryProvider, ProviderKey, ProviderMeta } from "./types";

export const PROVIDER_METAS: Record<ProviderKey, ProviderMeta> = {
  osm: OSM_META,
  google_places: GOOGLE_META,
};

/** Registro de adaptadores. Añadir una fuente nueva = implementar DiscoveryProvider y registrarla aquí. */
export function getProvider(key: ProviderKey): DiscoveryProvider {
  switch (key) {
    case "osm":
      return createOsmProvider();
    case "google_places":
      return createGooglePlacesProvider();
  }
}

export function providerStatus() {
  return (Object.keys(PROVIDER_METAS) as ProviderKey[]).map((key) => ({
    meta: PROVIDER_METAS[key],
    configured: getProvider(key).isConfigured(),
  }));
}

export * from "./types";
