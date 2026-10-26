import type { Tx } from "@/lib/db";
import type { PageFacts } from "@/lib/audit/extract";
import type { PsiResult } from "@/lib/audit/pagespeed";
import type { ScoreComponent } from "@/lib/scoring";
import type { FindingCategory, FindingKind, Priority } from "@/lib/domain";

type Row = Record<string, unknown>;

export type AuditRow = {
  id: string;
  url: string;
  final_url: string | null;
  status: "running" | "completed" | "failed" | "blocked";
  http_status: number | null;
  response_ms: number | null;
  html_bytes: number | null;
  robots_allowed: boolean | null;
  error_code: string | null;
  error_message: string | null;
  metrics: { facts?: PageFacts; totalMs?: number; truncated?: boolean };
  psi: PsiResult | null;
  started_at: string;
  finished_at: string | null;
};

export type FindingRow = {
  id: string;
  audit_id: string | null;
  code: string;
  category: FindingCategory;
  kind: FindingKind;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  source_url: string | null;
  checked_at: string;
  confidence: "high" | "medium" | "low";
  impact: string | null;
  limitations: string | null;
  service_keys: string[];
  human_confirmed: boolean;
};

export type ScoreRow = {
  id: string;
  total: number | null;
  priority: Priority;
  components: ScoreComponent[];
  weights: Record<string, number>;
  reason: string | null;
  created_at: string;
};

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

const mapAudit = (r: Row): AuditRow => ({
  id: String(r.id), url: String(r.url), final_url: (r.final_url as string) ?? null, status: r.status as AuditRow["status"],
  http_status: (r.http_status as number) ?? null, response_ms: (r.response_ms as number) ?? null, html_bytes: (r.html_bytes as number) ?? null,
  robots_allowed: (r.robots_allowed as boolean) ?? null, error_code: (r.error_code as string) ?? null, error_message: (r.error_message as string) ?? null,
  metrics: (r.metrics as AuditRow["metrics"]) ?? {}, psi: (r.psi as PsiResult) ?? null, started_at: iso(r.started_at)!, finished_at: iso(r.finished_at),
});

const mapFinding = (r: Row): FindingRow => ({
  id: String(r.id), audit_id: (r.audit_id as string) ?? null, code: String(r.code), category: r.category as FindingCategory, kind: r.kind as FindingKind,
  title: String(r.title), description: String(r.description), evidence: (r.evidence as Record<string, unknown>) ?? {}, source_url: (r.source_url as string) ?? null,
  checked_at: iso(r.checked_at)!, confidence: r.confidence as FindingRow["confidence"], impact: (r.impact as string) ?? null, limitations: (r.limitations as string) ?? null,
  service_keys: (r.service_keys as string[]) ?? [], human_confirmed: Boolean(r.human_confirmed),
});

const mapScore = (r: Row): ScoreRow => ({
  id: String(r.id), total: r.total === null ? null : Number(r.total), priority: r.priority as Priority, components: (r.components as ScoreComponent[]) ?? [],
  weights: (r.weights as Record<string, number>) ?? {}, reason: (r.reason as string) ?? null, created_at: iso(r.created_at)!,
});

export async function getLatestAudit(tx: Tx, workspaceId: string, companyId: string): Promise<AuditRow | null> {
  const [r] = await tx<Row[]>`select * from audits where workspace_id = ${workspaceId} and company_id = ${companyId} order by created_at desc limit 1`;
  return r ? mapAudit(r) : null;
}

/** Última auditoría completada (puede ser anterior a un intento fallido posterior). */
export async function getLatestCompletedAudit(tx: Tx, workspaceId: string, companyId: string): Promise<AuditRow | null> {
  const [r] = await tx<Row[]>`select * from audits where workspace_id = ${workspaceId} and company_id = ${companyId} and status = 'completed' order by created_at desc limit 1`;
  return r ? mapAudit(r) : null;
}

export async function getFindings(tx: Tx, workspaceId: string, auditId: string): Promise<FindingRow[]> {
  const rows = await tx<Row[]>`select * from findings where workspace_id = ${workspaceId} and audit_id = ${auditId} order by created_at, code`;
  return rows.map(mapFinding);
}

export async function getLatestScore(tx: Tx, workspaceId: string, companyId: string): Promise<ScoreRow | null> {
  const [r] = await tx<Row[]>`select * from scores where workspace_id = ${workspaceId} and company_id = ${companyId} order by created_at desc limit 1`;
  return r ? mapScore(r) : null;
}

export async function confirmFinding(tx: Tx, workspaceId: string, findingId: string, confirmed: boolean) {
  const [r] = await tx<{ company_id: string }[]>`
    update findings set human_confirmed = ${confirmed} where id = ${findingId} and workspace_id = ${workspaceId} and kind = 'hypothesis'
    returning company_id`;
  return r?.company_id ?? null;
}
