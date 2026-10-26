import { z } from "zod";

const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
  AUTH_MODE: z.enum(["supabase", "dev"]).default("supabase"),
  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  DEV_USER_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000001"),
  DEV_USER_EMAIL: z.string().default("dev@localhost"),
  OPENAI_API_KEY: optional,
  OPENAI_MODEL: optional,
  GOOGLE_PLACES_API_KEY: optional,
  PAGESPEED_API_KEY: optional,
  // Lista separada por comas: se prueban en orden como respaldo.
  OVERPASS_URL: z.string().default("https://overpass-api.de/api/interpreter,https://overpass.openstreetmap.fr/api/interpreter,https://overpass.private.coffee/api/interpreter"),
  NOMINATIM_URL: z.string().url().default("https://nominatim.openstreetmap.org"),
  CONTACT_EMAIL: optional,
  APP_URL: z.string().url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Variables de entorno validadas. Solo debe usarse en el servidor. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración de entorno inválida → ${detail}`);
  }
  if (parsed.data.AUTH_MODE === "dev" && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_MODE=dev está prohibido en producción.");
  }
  cached = parsed.data;
  return cached;
}

/** User-Agent identificable para peticiones salientes (exigido por OSM/Overpass/Nominatim). */
export function userAgent(): string {
  const e = env();
  return `LocalLead/0.1 (+${e.APP_URL}${e.CONTACT_EMAIL ? `; ${e.CONTACT_EMAIL}` : ""})`;
}

export const capabilities = {
  openai: () => Boolean(env().OPENAI_API_KEY && env().OPENAI_MODEL),
  googlePlaces: () => Boolean(env().GOOGLE_PLACES_API_KEY),
  pagespeed: () => Boolean(env().PAGESPEED_API_KEY),
};
