import type { Tx } from "@/lib/db";
import { IMPACT_WEIGHT } from "@/lib/audit/checks";
import type { CrmStage, Priority } from "@/lib/domain";

type Row = Record<string, unknown>;

export type OpportunityRow = {
  id: string;
  name: string;
  sector_key: string | null;
  sector_label: string | null;
  city: string | null;
  website: string | null;
  crm_stage: CrmStage;
  saved: boolean;
  score_total: number | null;
  score_priority: Priority;
  score_reason: string | null;
  scored_at: string | null;
  key_findings: { title: string; kind: string }[];
  services: string[];
  has_analysis: boolean;
};

/** Empresas con al menos una auditoría completada, con su última puntuación y los hallazgos clave. */
export async function listOpportunities(tx: Tx, workspaceId: string): Promise<OpportunityRow[]> {
  const rows = await tx<Row[]>`
    select c.id, c.name, c.sector_key, c.sector_label, c.city, c.website, c.crm_stage, c.saved,
           ls.total, ls.priority, ls.reason, ls.created_at as scored_at, la.id as audit_id,
           exists (select 1 from ai_analyses a where a.company_id = c.id) as has_analysis
    from companies c
    join lateral (select id from audits where company_id = c.id and status = 'completed' order by created_at desc limit 1) la on true
    left join lateral (select total, priority, reason, created_at from scores where company_id = c.id order by created_at desc limit 1) ls on true
    where c.workspace_id = ${workspaceId}`;
  if (!rows.length) return [];
  const auditIds = rows.map((r) => String(r.audit_id));
  const findings = await tx<Row[]>`
    select audit_id, code, kind, title, service_keys, human_confirmed from findings
    where audit_id = any(${auditIds}::uuid[]) and (kind in ('verified_issue', 'opportunity') or (kind = 'hypothesis' and human_confirmed))`;
  const byAudit = new Map<string, Row[]>();
  for (const f of findings) {
    const k = String(f.audit_id);
    byAudit.set(k, [...(byAudit.get(k) ?? []), f]);
  }
  return rows
    .map((r) => {
      const fs = (byAudit.get(String(r.audit_id)) ?? []).sort((a, b) => (IMPACT_WEIGHT[String(b.code)] ?? 1) - (IMPACT_WEIGHT[String(a.code)] ?? 1));
      const services = [...new Set(fs.flatMap((f) => f.service_keys as string[]))];
      return {
        id: String(r.id), name: String(r.name), sector_key: (r.sector_key as string) ?? null, sector_label: (r.sector_label as string) ?? null,
        city: (r.city as string) ?? null, website: (r.website as string) ?? null, crm_stage: r.crm_stage as CrmStage, saved: Boolean(r.saved),
        score_total: r.total === null || r.total === undefined ? null : Number(r.total), score_priority: ((r.priority as Priority) ?? "sin_evaluar"),
        score_reason: (r.reason as string) ?? null, scored_at: r.scored_at ? new Date(r.scored_at as string).toISOString() : null,
        key_findings: fs.slice(0, 3).map((f) => ({ title: String(f.title), kind: String(f.kind) })),
        services: services.slice(0, 4), has_analysis: Boolean(r.has_analysis),
      } satisfies OpportunityRow;
    })
    .sort((a, b) => (b.score_total ?? -1) - (a.score_total ?? -1) || a.name.localeCompare(b.name, "es"));
}

export async function getFilterOptions(tx: Tx, workspaceId: string) {
  const sectors = await tx<{ key: string; label: string }[]>`
    select distinct sector_key as key, coalesce(sector_label, sector_key) as label from companies
    where workspace_id = ${workspaceId} and sector_key is not null order by 2`;
  const cities = await tx<{ city: string }[]>`select distinct city from companies where workspace_id = ${workspaceId} and city is not null order by 1`;
  return { sectors, cities: cities.map((c) => c.city) };
}

export type ProposalListRow = { id: string; company_id: string; company_name: string; title: string; status: string; updated_at: string };

export async function listAllProposals(tx: Tx, workspaceId: string, limit = 20): Promise<ProposalListRow[]> {
  const rows = await tx<Row[]>`
    select p.id, p.company_id, c.name as company_name, p.title, p.status, p.updated_at
    from proposals p join companies c on c.id = p.company_id
    where p.workspace_id = ${workspaceId} order by p.updated_at desc limit ${limit}`;
  return rows.map((r) => ({ id: String(r.id), company_id: String(r.company_id), company_name: String(r.company_name), title: String(r.title), status: String(r.status), updated_at: new Date(r.updated_at as string).toISOString() }));
}
