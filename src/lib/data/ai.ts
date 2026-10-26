import type { Tx } from "@/lib/db";
import type { ValidatedAnalysis } from "@/lib/ai/schemas";

type Row = Record<string, unknown>;
const iso = (v: unknown) => new Date(v as string).toISOString();

export type AnalysisRow = {
  id: string;
  audit_id: string | null;
  model: string;
  prompt_version: string;
  result: ValidatedAnalysis;
  validation_notes: string[];
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
};

export type ProposalRow = {
  id: string;
  company_id: string;
  analysis_id: string | null;
  title: string;
  content: string;
  status: "draft" | "final";
  created_at: string;
  updated_at: string;
};

const mapAnalysis = (r: Row): AnalysisRow => ({
  id: String(r.id), audit_id: (r.audit_id as string) ?? null, model: String(r.model), prompt_version: String(r.prompt_version),
  result: r.result as ValidatedAnalysis, validation_notes: (r.validation_notes as string[]) ?? [],
  tokens_in: (r.tokens_in as number) ?? null, tokens_out: (r.tokens_out as number) ?? null, created_at: iso(r.created_at),
});

const mapProposal = (r: Row): ProposalRow => ({
  id: String(r.id), company_id: String(r.company_id), analysis_id: (r.analysis_id as string) ?? null, title: String(r.title),
  content: String(r.content), status: r.status as ProposalRow["status"], created_at: iso(r.created_at), updated_at: iso(r.updated_at),
});

export async function getLatestAnalysis(tx: Tx, workspaceId: string, companyId: string): Promise<AnalysisRow | null> {
  const [r] = await tx<Row[]>`select * from ai_analyses where workspace_id = ${workspaceId} and company_id = ${companyId} order by created_at desc limit 1`;
  return r ? mapAnalysis(r) : null;
}

export async function listProposals(tx: Tx, workspaceId: string, companyId: string): Promise<ProposalRow[]> {
  const rows = await tx<Row[]>`select * from proposals where workspace_id = ${workspaceId} and company_id = ${companyId} order by created_at desc`;
  return rows.map(mapProposal);
}

export async function getProposal(tx: Tx, workspaceId: string, id: string): Promise<ProposalRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await tx<Row[]>`select * from proposals where workspace_id = ${workspaceId} and id = ${id}`;
  return r ? mapProposal(r) : null;
}

export async function updateProposal(tx: Tx, workspaceId: string, id: string, v: { title: string; content: string; status: "draft" | "final" }) {
  const [r] = await tx<Row[]>`
    update proposals set title = ${v.title}, content = ${v.content}, status = ${v.status}
    where workspace_id = ${workspaceId} and id = ${id} returning *`;
  return r ? mapProposal(r) : null;
}

export async function deleteProposal(tx: Tx, workspaceId: string, id: string) {
  await tx`delete from proposals where workspace_id = ${workspaceId} and id = ${id}`;
}

/** Peticiones a la IA en las últimas 24 h (para el límite diario de costes). */
export async function countAiRunsToday(tx: Tx, workspaceId: string): Promise<number> {
  const [r] = await tx<{ n: number }[]>`select count(*)::int as n from ai_runs where workspace_id = ${workspaceId} and created_at > now() - interval '24 hours'`;
  return r?.n ?? 0;
}
