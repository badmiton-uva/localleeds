import type { Tx } from "@/lib/db";
import type { CrmStage, Priority } from "@/lib/domain";
import { PROVIDER_METAS, type ProviderCompany, type ProviderKey } from "@/lib/providers";
import { domainOf, normalizeName } from "@/lib/utils";

type Row = Record<string, unknown>;

export type CompanySource = {
  provider: string;
  provider_name: string;
  license: string;
  attribution: string;
  source_url: string | null;
  fetched_at: string;
  expires_at: string | null;
};

export type CompanyRow = {
  id: string;
  name: string;
  sector_key: string | null;
  sector_label: string | null;
  city: string | null;
  region: string | null;
  address: string | null;
  postal_code: string | null;
  website: string | null;
  phone: string | null;
  description: string | null;
  lat: number | null;
  lng: number | null;
  data_policy: "persistent" | "expiring";
  data_expires_at: string | null;
  data_expired: boolean;
  discovered_at: string;
  saved: boolean;
  crm_stage: CrmStage;
  crm_stage_changed_at: string;
  services_offered: string[];
  audit_status: "running" | "completed" | "failed" | "blocked" | null;
  audit_at: string | null;
  score_total: number | null;
  score_priority: Priority | null;
  sources: CompanySource[];
};

export type CompanyFilters = {
  ids?: string[];
  searchId?: string;
  saved?: boolean;
  limit?: number;
};

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

function toCompany(r: Row): CompanyRow {
  return {
    id: String(r.id),
    name: String(r.name),
    sector_key: (r.sector_key as string) ?? null,
    sector_label: (r.sector_label as string) ?? null,
    city: (r.city as string) ?? null,
    region: (r.region as string) ?? null,
    address: (r.address as string) ?? null,
    postal_code: (r.postal_code as string) ?? null,
    website: (r.website as string) ?? null,
    phone: (r.phone as string) ?? null,
    description: (r.description as string) ?? null,
    lat: (r.lat as number) ?? null,
    lng: (r.lng as number) ?? null,
    data_policy: r.data_policy as "persistent" | "expiring",
    data_expires_at: iso(r.data_expires_at),
    data_expired: Boolean(r.data_expired),
    discovered_at: iso(r.discovered_at)!,
    saved: Boolean(r.saved),
    crm_stage: r.crm_stage as CrmStage,
    crm_stage_changed_at: iso(r.crm_stage_changed_at)!,
    services_offered: (r.services_offered as string[]) ?? [],
    audit_status: (r.audit_status as CompanyRow["audit_status"]) ?? null,
    audit_at: iso(r.audit_at),
    score_total: r.score_total === null || r.score_total === undefined ? null : Number(r.score_total),
    score_priority: (r.score_priority as Priority) ?? null,
    sources: ((r.sources as CompanySource[]) ?? []).map((s) => ({ ...s, fetched_at: iso(s.fetched_at)!, expires_at: iso(s.expires_at) })),
  };
}

const SELECT = (tx: Tx) => tx`
  select c.*,
    la.status as audit_status, la.created_at as audit_at,
    ls.total as score_total, ls.priority as score_priority,
    coalesce((
      select json_agg(json_build_object(
        'provider', s.provider, 'provider_name', p.name, 'license', p.license, 'attribution', p.attribution,
        'source_url', s.source_url, 'fetched_at', s.fetched_at, 'expires_at', s.expires_at) order by s.fetched_at)
      from company_sources s join data_providers p on p.key = s.provider where s.company_id = c.id
    ), '[]'::json) as sources
  from companies c
  left join lateral (select status, created_at from audits where company_id = c.id order by created_at desc limit 1) la on true
  left join lateral (select total, priority from scores where company_id = c.id order by created_at desc limit 1) ls on true`;

export async function listCompanies(tx: Tx, workspaceId: string, f: CompanyFilters = {}): Promise<CompanyRow[]> {
  const rows = await tx<Row[]>`
    ${SELECT(tx)}
    ${f.searchId ? tx`join search_results sr on sr.company_id = c.id and sr.search_id = ${f.searchId}` : tx``}
    where c.workspace_id = ${workspaceId}
      ${f.ids ? tx`and c.id = any(${f.ids}::uuid[])` : tx``}
      ${f.saved !== undefined ? tx`and c.saved = ${f.saved}` : tx``}
    order by ${f.searchId ? tx`sr.rank` : f.saved ? tx`c.saved_at desc nulls last` : tx`c.discovered_at desc`}
    limit ${f.limit ?? 500}`;
  return rows.map(toCompany);
}

export async function getCompany(tx: Tx, workspaceId: string, id: string): Promise<CompanyRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await tx<Row[]>`${SELECT(tx)} where c.workspace_id = ${workspaceId} and c.id = ${id}`;
  return row ? toCompany(row) : null;
}

/** Borra el contenido caducado de proveedores con almacenamiento restringido. */
export async function purgeExpired(tx: Tx, workspaceId: string): Promise<number> {
  const [r] = await tx<{ n: number }[]>`select public.purge_expired_provider_data(${workspaceId}) as n`;
  return r?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Descubrimiento: inserción con deduplicación
// ---------------------------------------------------------------------------

export type UpsertContext = { workspaceId: string; provider: ProviderKey; region?: string; country: string };
export type UpsertResult = { companyId: string; isNew: boolean };

const CONTENT_FIELDS = ["address", "postal_code", "website", "phone", "description", "lat", "lng", "sector_label"] as const;

async function findExisting(tx: Tx, ctx: UpsertContext, pc: ProviderCompany): Promise<{ id: string; data_policy: string } | null> {
  // 1) Mismo identificador del proveedor.
  const [byId] = await tx<{ id: string; data_policy: string }[]>`
    select c.id, c.data_policy from company_provider_ids p
    join companies c on c.id = p.company_id and c.workspace_id = p.workspace_id
    where p.workspace_id = ${ctx.workspaceId} and p.provider = ${ctx.provider} and p.provider_id = ${pc.providerId}`;
  if (byId) return byId;

  // 2) Misma empresa en otro proveedor: mismo nombre normalizado y (mismo dominio, o misma
  //    localidad y coordenadas a <~150 m / sin coordenadas en alguno de los dos).
  const norm = normalizeName(pc.name);
  if (!norm) return null;
  const domain = domainOf(pc.website);
  const rows = await tx<{ id: string; data_policy: string; website: string | null; city: string | null; lat: number | null; lng: number | null }[]>`
    select id, data_policy, website, city, lat, lng from companies
    where workspace_id = ${ctx.workspaceId} and normalized_name = ${norm}`;
  for (const r of rows) {
    if (domain && domainOf(r.website) === domain) return r;
    if ((r.city ?? "").toLowerCase() !== (pc.city ?? "").toLowerCase()) continue;
    const near =
      r.lat === null || r.lng === null || pc.lat === undefined || pc.lng === undefined ||
      (Math.abs(r.lat - pc.lat) < 0.0015 && Math.abs(r.lng - pc.lng) < 0.002);
    if (near) return r;
  }
  return null;
}

/**
 * Guarda una empresa encontrada por un proveedor respetando su política de almacenamiento.
 * Regla: el contenido de una empresa procede de un único proveedor "propietario"; un
 * proveedor persistente prevalece sobre uno con retención limitada (nunca se copia
 * contenido restringido a un registro persistente).
 */
export async function upsertDiscovered(tx: Tx, ctx: UpsertContext, pc: ProviderCompany): Promise<UpsertResult> {
  const meta = PROVIDER_METAS[ctx.provider];
  const expiring = meta.storagePolicy === "expiring";
  const expiresAt = expiring ? new Date(Date.now() + (meta.retentionDays ?? 30) * 86400_000) : null;
  const content = {
    name: pc.name,
    normalized_name: normalizeName(pc.name),
    sector_key: pc.sectorKey ?? null,
    sector_label: pc.sectorLabel ?? null,
    city: pc.city ?? null,
    region: ctx.region ?? null,
    address: pc.address ?? null,
    postal_code: pc.postalCode ?? null,
    website: pc.website ?? null,
    phone: pc.phone ?? null,
    description: pc.description ?? null,
    lat: pc.lat ?? null,
    lng: pc.lng ?? null,
  };

  const existing = await findExisting(tx, ctx, pc);
  let companyId: string;
  let isNew = false;
  let storesContent = true;

  if (!existing) {
    isNew = true;
    const [row] = await tx<{ id: string }[]>`
      insert into companies ${tx({
        workspace_id: ctx.workspaceId,
        ...content,
        country: ctx.country,
        data_policy: meta.storagePolicy,
        data_expires_at: expiresAt,
      })} returning id`;
    companyId = row!.id;
  } else {
    companyId = existing.id;
    if (existing.data_policy === "persistent" && expiring) {
      storesContent = false; // solo se enlaza el identificador
    } else if (existing.data_policy === "expiring" && !expiring) {
      await tx`update companies set ${tx({ ...content, data_policy: "persistent", data_expires_at: null, data_expired: false })}
               where id = ${companyId}`;
    } else if (expiring) {
      await tx`update companies set ${tx({ ...content, data_expires_at: expiresAt, data_expired: false })} where id = ${companyId}`;
    } else {
      await tx`update companies set
        name = ${content.name}, normalized_name = ${content.normalized_name},
        sector_key = coalesce(${content.sector_key}, sector_key),
        sector_label = coalesce(${content.sector_label}, sector_label),
        city = coalesce(${content.city}, city),
        address = coalesce(${content.address}, address),
        postal_code = coalesce(${content.postal_code}, postal_code),
        website = coalesce(${content.website}, website),
        phone = coalesce(${content.phone}, phone),
        description = coalesce(${content.description}, description),
        lat = coalesce(${content.lat}, lat), lng = coalesce(${content.lng}, lng)
        where id = ${companyId}`;
    }
  }

  await tx`insert into company_provider_ids (workspace_id, company_id, provider, provider_id)
           values (${ctx.workspaceId}, ${companyId}, ${ctx.provider}, ${pc.providerId})
           on conflict (workspace_id, provider, provider_id) do nothing`;

  const provided = storesContent ? CONTENT_FIELDS.filter((k) => content[k] !== null) : [];
  const raw = storesContent && !expiring && pc.raw ? (pc.raw as never) : null;
  await tx`insert into company_sources (workspace_id, company_id, provider, provider_id, source_url, fetched_at, expires_at, fields_provided, raw)
           values (${ctx.workspaceId}, ${companyId}, ${ctx.provider}, ${pc.providerId}, ${pc.sourceUrl}, now(),
                   ${storesContent ? expiresAt : null}, ${provided as unknown as string[]}, ${raw === null ? null : tx.json(raw)})
           on conflict (company_id, provider) do update set
             provider_id = excluded.provider_id, source_url = excluded.source_url, fetched_at = now(),
             expires_at = excluded.expires_at, fields_provided = excluded.fields_provided, raw = excluded.raw`;

  return { companyId, isNew };
}

// ---------------------------------------------------------------------------
// Guardado y CRM
// ---------------------------------------------------------------------------

export async function setSaved(tx: Tx, workspaceId: string, userId: string, ids: string[], saved: boolean): Promise<number> {
  if (!ids.length) return 0;
  const rows = await tx<{ id: string }[]>`
    update companies set saved = ${saved}, saved_at = case when ${saved} then coalesce(saved_at, now()) else null end
    where workspace_id = ${workspaceId} and id = any(${ids}::uuid[]) and saved <> ${saved}
    returning id`;
  if (saved && rows.length) {
    await tx`insert into activities (workspace_id, company_id, user_id, type, summary)
             select ${workspaceId}, id, ${userId}, 'saved', 'Empresa guardada en Mis empresas'
             from unnest(${rows.map((r) => r.id)}::uuid[]) as id`;
  }
  return rows.length;
}
