import type { Tx } from "@/lib/db";
import { CRM_STAGES, STAGE_ORDER } from "@/lib/domain";

export type AnalyticsFilters = {
  from?: string; // YYYY-MM-DD
  to?: string;
  sector?: string; // sector_key
  city?: string;
};

export type Analytics = {
  kpis: {
    discovered: number;
    analyzed: number;
    opportunities: number;
    highPriority: number;
    saved: number;
    contacted: number;
    meetings: number;
    proposalsSent: number;
    won: number;
  };
  opportunitiesBySector: { label: string; value: number }[];
  companiesByCity: { label: string; value: number }[];
  citiesInvestigated: { label: string; discovered: number; analyzed: number }[];
  priorityDistribution: { key: "alta" | "media" | "baja" | "sin_evaluar"; value: number }[];
  analyzedEvolution: { day: string; value: number }[];
  funnel: { key: string; label: string; value: number }[];
  conversion: { key: string; label: string; reached: number; rateFromPrevious: number | null }[];
  contactedRate: number | null;
  timeSpent: { companyId: string; name: string; minutes: number }[];
  totalMinutes: number;
};

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

export async function getAnalytics(tx: Tx, workspaceId: string, f: AnalyticsFilters = {}): Promise<Analytics> {
  const where = tx`c.workspace_id = ${workspaceId}
    ${f.from ? tx`and c.discovered_at >= ${f.from}::date` : tx``}
    ${f.to ? tx`and c.discovered_at < (${f.to}::date + 1)` : tx``}
    ${f.sector ? tx`and c.sector_key = ${f.sector}` : tx``}
    ${f.city ? tx`and c.city = ${f.city}` : tx``}`;

  const [base] = await tx<Row[]>`
    with fc as (select c.* from companies c where ${where}),
    la as (
      select distinct on (a.company_id) a.company_id, a.id as audit_id
      from audits a join fc on fc.id = a.company_id
      where a.status = 'completed' order by a.company_id, a.created_at desc
    ),
    opp as (
      select distinct la.company_id from la
      join findings f on f.audit_id = la.audit_id and f.kind in ('verified_issue', 'opportunity')
    ),
    ls as (
      select distinct on (s.company_id) s.company_id, s.priority
      from scores s join fc on fc.id = s.company_id order by s.company_id, s.created_at desc
    ),
    ct as (
      select distinct fc.id from fc
      where fc.crm_stage in ('contacted', 'meeting_scheduled', 'proposal_sent', 'won')
         or exists (select 1 from activities x where x.company_id = fc.id and x.type = 'contact')
    )
    select
      (select count(*) from fc) as discovered,
      (select count(*) from la) as analyzed,
      (select count(*) from opp) as opportunities,
      (select count(*) from ls where priority = 'alta') as high_priority,
      (select count(*) from fc where saved) as saved,
      (select count(*) from ct) as contacted,
      (select count(*) from activities x join fc on fc.id = x.company_id where x.type = 'meeting') as meetings,
      (select count(*) from fc where crm_stage = 'proposal_sent'
         or exists (select 1 from activities x where x.company_id = fc.id and x.type = 'stage_change' and x.details->>'to' = 'proposal_sent')) as proposals_sent,
      (select count(*) from fc where crm_stage = 'won') as won`;

  const bySector = await tx<Row[]>`
    with fc as (select c.* from companies c where ${where}),
    la as (
      select distinct on (a.company_id) a.company_id, a.id as audit_id
      from audits a join fc on fc.id = a.company_id
      where a.status = 'completed' order by a.company_id, a.created_at desc
    )
    select coalesce(fc.sector_label, 'Sin sector') as label, count(distinct fc.id) as value
    from fc join la on la.company_id = fc.id
    join findings f on f.audit_id = la.audit_id and f.kind in ('verified_issue', 'opportunity')
    group by 1 order by 2 desc, 1 limit 10`;

  const byCity = await tx<Row[]>`
    with fc as (select c.* from companies c where ${where}),
    an as (select distinct a.company_id from audits a join fc on fc.id = a.company_id where a.status = 'completed')
    select coalesce(fc.city, 'Sin localidad') as label,
           count(*) as discovered,
           count(an.company_id) as analyzed
    from fc left join an on an.company_id = fc.id
    group by 1 order by 2 desc, 1 limit 12`;

  const priority = await tx<Row[]>`
    with fc as (select c.* from companies c where ${where}),
    ls as (
      select distinct on (s.company_id) s.company_id, s.priority
      from scores s join fc on fc.id = s.company_id order by s.company_id, s.created_at desc
    )
    select coalesce(ls.priority, 'sin_evaluar') as key, count(*) as value
    from fc left join ls on ls.company_id = fc.id group by 1`;

  const evolution = await tx<Row[]>`
    with fc as (select c.id from companies c where ${where}),
    first_audit as (
      select a.company_id, min(a.finished_at) as at from audits a
      join fc on fc.id = a.company_id where a.status = 'completed' group by 1
    )
    select to_char(date_trunc('day', at), 'YYYY-MM-DD') as day, count(*) as value
    from first_audit where at >= now() - interval '30 days' group by 1 order by 1`;

  const companies = await tx<Row[]>`
    select c.id, c.crm_stage,
      coalesce((select array_agg(distinct x.details->>'to') from activities x
                where x.company_id = c.id and x.type = 'stage_change'), '{}') as visited
    from companies c where ${where} and c.saved`;

  const time = await tx<Row[]>`
    select c.id as company_id, c.name, sum(x.duration_minutes) as minutes
    from activities x join companies c on c.id = x.company_id
    where ${where} and x.duration_minutes is not null
    group by c.id, c.name having sum(x.duration_minutes) > 0
    order by minutes desc limit 10`;

  // Embudo: estado actual de cada empresa guardada y alcance acumulado por fase.
  const stageCounts = new Map<string, number>();
  const reached = new Map<string, number>();
  for (const c of companies) {
    const stage = String(c.crm_stage);
    stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
    const visited = (c.visited as string[]).filter(Boolean);
    const maxOrder = Math.max(
      stage === "discarded" ? -1 : (STAGE_ORDER[stage] ?? -1),
      ...visited.map((s) => STAGE_ORDER[s] ?? -1),
    );
    for (const st of CRM_STAGES) {
      if (st.key === "discarded") continue;
      if ((STAGE_ORDER[st.key] ?? 99) <= maxOrder) reached.set(st.key, (reached.get(st.key) ?? 0) + 1);
    }
  }
  const funnel = CRM_STAGES.map((s) => ({ key: s.key, label: s.label, value: stageCounts.get(s.key) ?? 0 }));
  const flow = CRM_STAGES.filter((s) => s.key !== "discarded");
  const conversion = flow.map((s, i) => {
    const r = reached.get(s.key) ?? 0;
    const prev = i === 0 ? null : (reached.get(flow[i - 1]!.key) ?? 0);
    return { key: s.key, label: s.label, reached: r, rateFromPrevious: prev ? r / prev : null };
  });

  const b = base!;
  const kpis = {
    discovered: n(b.discovered),
    analyzed: n(b.analyzed),
    opportunities: n(b.opportunities),
    highPriority: n(b.high_priority),
    saved: n(b.saved),
    contacted: n(b.contacted),
    meetings: n(b.meetings),
    proposalsSent: n(b.proposals_sent),
    won: n(b.won),
  };
  const order = ["alta", "media", "baja", "sin_evaluar"] as const;
  const pmap = new Map(priority.map((r) => [String(r.key), n(r.value)]));

  return {
    kpis,
    opportunitiesBySector: bySector.map((r) => ({ label: String(r.label), value: n(r.value) })),
    companiesByCity: byCity.map((r) => ({ label: String(r.label), value: n(r.discovered) })),
    citiesInvestigated: byCity.map((r) => ({ label: String(r.label), discovered: n(r.discovered), analyzed: n(r.analyzed) })),
    priorityDistribution: order.map((key) => ({ key, value: pmap.get(key) ?? 0 })),
    analyzedEvolution: evolution.map((r) => ({ day: String(r.day), value: n(r.value) })),
    funnel,
    conversion,
    contactedRate: kpis.saved > 0 ? kpis.contacted / kpis.saved : null,
    timeSpent: time.map((r) => ({ companyId: String(r.company_id), name: String(r.name), minutes: n(r.minutes) })),
    totalMinutes: time.reduce((s, r) => s + n(r.minutes), 0),
  };
}

export type RecentActivity = {
  id: string;
  type: string;
  summary: string;
  details: Record<string, unknown>;
  occurred_at: string;
  company_id: string;
  company_name: string;
};

export async function getRecentActivity(tx: Tx, workspaceId: string, limit = 10): Promise<RecentActivity[]> {
  const rows = await tx<Row[]>`
    select x.id, x.type, x.summary, x.details, x.occurred_at, x.company_id, c.name as company_name
    from activities x join companies c on c.id = x.company_id
    where x.workspace_id = ${workspaceId}
    order by x.occurred_at desc limit ${limit}`;
  return rows.map((r) => ({
    id: String(r.id),
    type: String(r.type),
    summary: String(r.summary),
    details: (r.details as Record<string, unknown>) ?? {},
    occurred_at: new Date(r.occurred_at as string).toISOString(),
    company_id: String(r.company_id),
    company_name: String(r.company_name),
  }));
}
