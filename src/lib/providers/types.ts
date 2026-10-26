export type ProviderKey = "osm" | "google_places";

export type ProviderMeta = {
  key: ProviderKey;
  name: string;
  license: string;
  attribution: string;
  termsUrl: string;
  /** 'persistent': el contenido puede conservarse. 'expiring': solo el ID es permanente; el contenido caduca. */
  storagePolicy: "persistent" | "expiring";
  retentionDays: number | null;
};

export type SearchParams = {
  country: string;
  region?: string;
  city: string;
  sectorKey?: string;
  keywords?: string;
  radiusM?: number;
  maxResults: number;
};

export type ProviderCompany = {
  providerId: string;
  name: string;
  sectorKey?: string;
  sectorLabel?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  website?: string;
  phone?: string;
  description?: string;
  lat?: number;
  lng?: number;
  /** Enlace a la ficha original en el proveedor. */
  sourceUrl: string;
  /** Datos originales (solo se persisten si la política del proveedor lo permite). */
  raw?: Record<string, unknown>;
};

export type ProviderResult = {
  companies: ProviderCompany[];
  /** Avisos legibles para el usuario (zona resuelta, resultados truncados…). */
  notes: string[];
};

export interface DiscoveryProvider {
  meta: ProviderMeta;
  isConfigured(): boolean;
  search(params: SearchParams, opts?: { signal?: AbortSignal }): Promise<ProviderResult>;
}

/** Error con mensaje apto para mostrar al usuario. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: "not_configured" | "not_found" | "rate_limited" | "unavailable" | "bad_response",
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
