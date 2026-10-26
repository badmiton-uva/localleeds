// Constantes de dominio compartidas por servidor y cliente.

export const CRM_STAGES = [
  { key: "pending_research", label: "Pendiente de investigar" },
  { key: "researched", label: "Investigado" },
  { key: "opportunity_detected", label: "Oportunidad detectada" },
  { key: "contacted", label: "Contactado" },
  { key: "meeting_scheduled", label: "Reunión programada" },
  { key: "proposal_sent", label: "Propuesta enviada" },
  { key: "won", label: "Cliente conseguido" },
  { key: "discarded", label: "Descartado" },
] as const;
export type CrmStage = (typeof CRM_STAGES)[number]["key"];
export const CRM_STAGE_KEYS = CRM_STAGES.map((s) => s.key) as [CrmStage, ...CrmStage[]];
export const stageLabel = (k: string) => CRM_STAGES.find((s) => s.key === k)?.label ?? k;
/** Posición en el embudo (para calcular conversión); descartado queda fuera. */
export const STAGE_ORDER: Record<string, number> = Object.fromEntries(
  CRM_STAGES.filter((s) => s.key !== "discarded").map((s, i) => [s.key, i]),
);

export const SERVICES = [
  { key: "web_design", label: "Diseño y desarrollo web" },
  { key: "seo", label: "Optimización SEO" },
  { key: "digital_marketing", label: "Estrategia de marketing digital" },
  { key: "market_research", label: "Investigación de mercados" },
  { key: "lead_capture_improvement", label: "Mejora de procesos de captación" },
  { key: "forms", label: "Implementación de formularios" },
  { key: "booking_systems", label: "Sistemas de reservas" },
  { key: "sales_automation", label: "Automatización de gestión comercial" },
  { key: "request_classification", label: "Clasificación de solicitudes" },
  { key: "admin_automation", label: "Automatización de tareas administrativas" },
  { key: "crm_integration", label: "Integraciones con CRM" },
  { key: "conversational_assistants", label: "Asistentes conversacionales" },
] as const;
export type ServiceKey = (typeof SERVICES)[number]["key"];
export const SERVICE_KEYS = SERVICES.map((s) => s.key) as [ServiceKey, ...ServiceKey[]];
export const serviceLabel = (k: string) => SERVICES.find((s) => s.key === k)?.label ?? k;

export const FINDING_KINDS = [
  { key: "verified_issue", label: "Problema verificado" },
  { key: "opportunity", label: "Posible oportunidad" },
  { key: "hypothesis", label: "Hipótesis por confirmar" },
  { key: "unavailable", label: "Información no disponible" },
  { key: "check_passed", label: "Comprobación correcta" },
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number]["key"];
export const kindLabel = (k: string) => FINDING_KINDS.find((x) => x.key === k)?.label ?? k;

export const FINDING_CATEGORIES = [
  { key: "web_experience", label: "Experiencia web" },
  { key: "performance", label: "Velocidad" },
  { key: "accessibility", label: "Accesibilidad" },
  { key: "lead_capture", label: "Captación comercial" },
  { key: "contact_info", label: "Información de contacto" },
  { key: "seo", label: "SEO técnico" },
  { key: "automation", label: "Automatización" },
  { key: "presence", label: "Presencia digital" },
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number]["key"];
export const categoryLabel = (k: string) => FINDING_CATEGORIES.find((x) => x.key === k)?.label ?? k;

export const CONFIDENCE_LABEL = { high: "Confianza alta", medium: "Confianza media", low: "Confianza baja" } as const;

export type Priority = "alta" | "media" | "baja" | "sin_evaluar";
export const PRIORITY_LABEL: Record<Priority, string> = {
  alta: "Prioridad alta",
  media: "Prioridad media",
  baja: "Prioridad baja",
  sin_evaluar: "Sin evaluar",
};

export const ACTIVITY_TYPES = [
  { key: "note", label: "Nota" },
  { key: "contact", label: "Contacto realizado" },
  { key: "meeting", label: "Reunión" },
  { key: "reminder", label: "Recordatorio" },
  { key: "service_offered", label: "Servicio ofrecido" },
  { key: "stage_change", label: "Cambio de estado" },
  { key: "saved", label: "Empresa guardada" },
  { key: "search", label: "Búsqueda" },
  { key: "audit", label: "Auditoría web" },
  { key: "analysis", label: "Análisis con IA" },
  { key: "proposal", label: "Propuesta" },
] as const;
export const activityLabel = (k: string) => ACTIVITY_TYPES.find((x) => x.key === k)?.label ?? k;

export type ScoringWeights = { digital: number; fit: number; accessibility: number; evidence: number };
export const DEFAULT_WEIGHTS: ScoringWeights = { digital: 35, fit: 30, accessibility: 20, evidence: 15 };
export const DEFAULT_THRESHOLDS = { high: 75, medium: 50 };

/**
 * Sectores de búsqueda. `osm` son condiciones sobre etiquetas de OpenStreetMap
 * (cualquiera de ellas basta); `googleQuery` es el texto para Places Text Search.
 */
export type OsmCond = { k: string; v?: string[] }; // v ausente = la etiqueta existe
export type SectorDef = { key: string; label: string; osm: OsmCond[]; googleQuery: string };
export const SECTORS: SectorDef[] = [
  { key: "dentistas", label: "Dentistas", googleQuery: "dentista", osm: [{ k: "amenity", v: ["dentist"] }, { k: "healthcare", v: ["dentist"] }] },
  { key: "clinicas", label: "Clínicas y salud", googleQuery: "clínica", osm: [{ k: "amenity", v: ["clinic", "doctors", "hospital"] }, { k: "healthcare", v: ["clinic", "doctor", "centre", "hospital", "psychotherapist", "optometrist", "audiologist"] }] },
  { key: "fisioterapia", label: "Fisioterapia y bienestar", googleQuery: "fisioterapeuta", osm: [{ k: "healthcare", v: ["physiotherapist", "alternative"] }, { k: "shop", v: ["massage"] }] },
  { key: "veterinarias", label: "Veterinarias", googleQuery: "veterinario", osm: [{ k: "amenity", v: ["veterinary"] }] },
  { key: "restaurantes", label: "Restaurantes y bares", googleQuery: "restaurante", osm: [{ k: "amenity", v: ["restaurant", "bar", "cafe", "pub", "fast_food"] }] },
  { key: "hoteles", label: "Hoteles y alojamientos", googleQuery: "hotel", osm: [{ k: "tourism", v: ["hotel", "hostel", "guest_house", "apartment", "motel"] }] },
  { key: "peluquerias", label: "Peluquería y estética", googleQuery: "peluquería", osm: [{ k: "shop", v: ["hairdresser", "beauty"] }] },
  { key: "gimnasios", label: "Gimnasios y deporte", googleQuery: "gimnasio", osm: [{ k: "leisure", v: ["fitness_centre", "sports_centre"] }] },
  { key: "abogados", label: "Abogados y asesorías", googleQuery: "abogado", osm: [{ k: "office", v: ["lawyer", "accountant", "tax_advisor", "consulting", "notary"] }] },
  { key: "inmobiliarias", label: "Inmobiliarias y seguros", googleQuery: "inmobiliaria", osm: [{ k: "office", v: ["estate_agent", "insurance"] }, { k: "shop", v: ["estate_agent"] }] },
  { key: "talleres", label: "Talleres y concesionarios", googleQuery: "taller mecánico", osm: [{ k: "shop", v: ["car_repair", "car"] }, { k: "craft", v: ["car_repair"] }] },
  { key: "comercios", label: "Comercios y tiendas", googleQuery: "tienda", osm: [{ k: "shop", v: ["clothes", "shoes", "gift", "furniture", "electronics", "florist", "jewelry", "bakery", "butcher", "supermarket", "convenience", "hardware", "books", "optician", "pet"] }] },
  { key: "construccion", label: "Construcción y reformas", googleQuery: "reformas construcción", osm: [{ k: "craft", v: ["carpenter", "electrician", "plumber", "builder", "painter", "hvac", "roofer", "window_construction"] }, { k: "office", v: ["construction_company"] }] },
  { key: "educacion", label: "Academias y formación", googleQuery: "academia", osm: [{ k: "amenity", v: ["language_school", "driving_school", "music_school", "training", "prep_school"] }] },
];
export const sectorByKey = (k?: string | null) => SECTORS.find((s) => s.key === k);

export const COUNTRIES = [{ code: "ES", label: "España" }];
