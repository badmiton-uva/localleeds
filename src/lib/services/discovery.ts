import { z } from "zod";
import { withUser } from "@/lib/db";
import { SECTORS } from "@/lib/domain";
import { upsertDiscovered } from "@/lib/data/companies";
import { getProvider, ProviderError, type ProviderKey } from "@/lib/providers";
import { AppError } from "@/lib/api";
import type { Ctx } from "@/lib/auth/session";

export const searchInput = z
  .object({
    provider: z.enum(["osm", "google_places"]).default("osm"),
    country: z.string().length(2).default("ES"),
    region: z.string().trim().max(80).optional().transform((v) => v || undefined),
    city: z.string().trim().min(2, "Indica la ciudad o municipio.").max(80),
    sectorKey: z
      .string()
      .optional()
      .transform((v) => v || undefined)
      .refine((v) => !v || SECTORS.some((s) => s.key === v), "Sector no válido."),
    keywords: z.string().trim().max(80).optional().transform((v) => v || undefined),
    radiusM: z.number().int().min(100).max(50_000).optional(),
    maxResults: z.number().int().min(1).max(100).default(30),
  })
  .refine((v) => v.sectorKey || v.keywords, { message: "Elige un sector o escribe palabras clave.", path: ["sectorKey"] });

export type SearchInput = z.infer<typeof searchInput>;
export type SearchOutcome = { searchId: string; count: number; newCount: number; notes: string[] };

export async function runSearch(ctx: Ctx, input: SearchInput, deps: { getProvider?: typeof getProvider } = {}): Promise<SearchOutcome> {
  const provider = (deps.getProvider ?? getProvider)(input.provider as ProviderKey);
  if (!provider.isConfigured()) {
    throw new AppError("Esta fuente de datos no está configurada. Consulta la sección Configuración.", 503, "not_configured");
  }

  const [search] = await withUser(ctx.user.id, (tx) =>
    tx<{ id: string }[]>`
      insert into searches (workspace_id, user_id, provider, country, region, city, sector_key, keywords, radius_m, max_results)
      values (${ctx.workspaceId}, ${ctx.user.id}, ${input.provider}, ${input.country}, ${input.region ?? null}, ${input.city},
              ${input.sectorKey ?? null}, ${input.keywords ?? null}, ${input.radiusM ?? null}, ${input.maxResults})
      returning id`,
  );
  const searchId = search!.id;
  const started = Date.now();

  let result;
  try {
    result = await provider.search({
      country: input.country,
      region: input.region,
      city: input.city,
      sectorKey: input.sectorKey,
      keywords: input.keywords,
      radiusM: input.radiusM,
      maxResults: input.maxResults,
    });
  } catch (err) {
    const message = err instanceof ProviderError ? err.message : "Error inesperado al consultar la fuente.";
    await withUser(ctx.user.id, (tx) =>
      tx`update searches set status = 'failed', error = ${message}, duration_ms = ${Date.now() - started} where id = ${searchId}`,
    );
    throw err;
  }

  const newCount = await withUser(ctx.user.id, async (tx) => {
    let created = 0;
    let rank = 0;
    for (const pc of result.companies) {
      const { companyId, isNew } = await upsertDiscovered(
        tx,
        { workspaceId: ctx.workspaceId, provider: input.provider as ProviderKey, region: input.region, country: input.country },
        pc,
      );
      if (isNew) created++;
      await tx`insert into search_results (search_id, workspace_id, company_id, rank)
               values (${searchId}, ${ctx.workspaceId}, ${companyId}, ${rank++})
               on conflict (search_id, company_id) do nothing`;
    }
    await tx`update searches set status = 'completed', result_count = ${result.companies.length}, new_count = ${created},
             duration_ms = ${Date.now() - started}, notes = ${result.notes} where id = ${searchId}`;
    return created;
  });

  return { searchId, count: result.companies.length, newCount, notes: result.notes };
}
