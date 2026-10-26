import { withUser, type Tx } from "@/lib/db";
import type { Ctx } from "@/lib/auth/session";
import { AppError } from "@/lib/api";
import { getCompany } from "@/lib/data/companies";
import { getSettings } from "@/lib/data/settings";
import { getFindings, getLatestCompletedAudit } from "@/lib/data/audits";
import { autoAdvance } from "@/lib/data/crm";
import { countAiRunsToday, getLatestAnalysis, type AnalysisRow } from "@/lib/data/ai";
import { createOpenAIClient, type StructuredClient } from "@/lib/ai/openai";
import { AnalysisSchema, ProposalDraftSchema, stripFinancialSentences, validateAnalysis } from "@/lib/ai/schemas";
import {
  ANALYSIS_PROMPT_VERSION, ANALYSIS_SYSTEM, PROPOSAL_SYSTEM,
  buildAnalysisInput, buildProposalInput, renderObservedSituation, splitFindings,
} from "@/lib/ai/prompts";
import { formatDate } from "@/lib/utils";

type Deps = { client?: StructuredClient };

async function loadEvidence(tx: Tx, ctx: Ctx, companyId: string) {
  const company = await getCompany(tx, ctx.workspaceId, companyId);
  if (!company) throw new AppError("Empresa no encontrada.", 404, "not_found");
  const audit = await getLatestCompletedAudit(tx, ctx.workspaceId, companyId);
  if (!audit) throw new AppError("La IA solo trabaja con información contrastada: analiza primero la web de la empresa.", 409, "no_audit");
  const findings = await getFindings(tx, ctx.workspaceId, audit.id);
  const settings = await getSettings(tx, ctx.workspaceId);
  return { company, audit, findings, settings };
}

async function assertBudget(tx: Tx, ctx: Ctx, limit: number) {
  if ((await countAiRunsToday(tx, ctx.workspaceId)) >= limit) {
    throw new AppError(`Has alcanzado el límite diario de ${limit} peticiones a la IA (se puede cambiar en Configuración).`, 429, "ai_budget");
  }
}

async function logRun(ctx: Ctx, kind: "analysis" | "proposal", status: "completed" | "failed", usage: { model?: string; tokensIn?: number | null; tokensOut?: number | null }) {
  await withUser(ctx.user.id, (tx) =>
    tx`insert into ai_runs (workspace_id, user_id, kind, model, tokens_in, tokens_out, status)
       values (${ctx.workspaceId}, ${ctx.user.id}, ${kind}, ${usage.model ?? "desconocido"}, ${usage.tokensIn ?? null}, ${usage.tokensOut ?? null}, ${status})`,
  );
}

export async function analyzeCompany(ctx: Ctx, companyId: string, deps: Deps = {}): Promise<AnalysisRow> {
  const { company, audit, findings, settings } = await withUser(ctx.user.id, async (tx) => {
    const ev = await loadEvidence(tx, ctx, companyId);
    await assertBudget(tx, ctx, ev.settings.aiDailyLimit);
    return ev;
  });
  const client = deps.client ?? createOpenAIClient();

  let out;
  try {
    out = await client.call({
      name: "analisis_comercial", schema: AnalysisSchema, system: ANALYSIS_SYSTEM, maxOutputTokens: 3000,
      user: buildAnalysisInput(company, findings, settings.enabledServices, audit),
    });
  } catch (err) {
    await logRun(ctx, "analysis", "failed", {}).catch(() => {});
    throw err;
  }

  const { result, notes } = validateAnalysis(
    out.parsed,
    findings.map((f) => ({ code: f.code, kind: f.kind, human_confirmed: f.human_confirmed })),
    settings.enabledServices,
  );

  return withUser(ctx.user.id, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into ai_analyses (workspace_id, company_id, audit_id, model, prompt_version, result, validation_notes, tokens_in, tokens_out)
      values (${ctx.workspaceId}, ${companyId}, ${audit.id}, ${out.model}, ${ANALYSIS_PROMPT_VERSION}, ${tx.json(JSON.parse(JSON.stringify(result)))},
              ${tx.json(notes)}, ${out.tokensIn}, ${out.tokensOut}) returning id`;
    await tx`insert into ai_runs (workspace_id, user_id, kind, model, tokens_in, tokens_out, status)
             values (${ctx.workspaceId}, ${ctx.user.id}, 'analysis', ${out.model}, ${out.tokensIn}, ${out.tokensOut}, 'completed')`;
    const evidenced = result.opportunities.filter((o) => o.classification === "evidenced").length;
    await tx`insert into activities (workspace_id, company_id, user_id, type, summary, details)
             values (${ctx.workspaceId}, ${companyId}, ${ctx.user.id}, 'analysis',
                     ${`Análisis con IA generado: ${evidenced} oportunidades respaldadas por evidencias`}, ${tx.json({ analysisId: row!.id })})`;
    if (evidenced > 0) {
      await autoAdvance(tx, { workspaceId: ctx.workspaceId, userId: ctx.user.id, companyId, to: "opportunity_detected", note: "Oportunidades respaldadas por evidencias" });
    }
    const saved = await getLatestAnalysis(tx, ctx.workspaceId, companyId);
    return saved!;
  });
}

const FOOTER = `---
_Las secciones 1 y 2 recogen datos de fuentes públicas y hechos comprobados automáticamente. Las secciones 3 a 7 son **recomendaciones** preparadas con apoyo de IA y revisadas por una persona: no son hechos. Este documento no incluye precios, ahorros ni estimaciones de resultados._`;

export async function generateProposal(ctx: Ctx, companyId: string, deps: Deps = {}): Promise<{ proposalId: string }> {
  const { company, audit, findings, settings } = await withUser(ctx.user.id, async (tx) => {
    const ev = await loadEvidence(tx, ctx, companyId);
    await assertBudget(tx, ctx, ev.settings.aiDailyLimit);
    return ev;
  });

  let analysis = await withUser(ctx.user.id, (tx) => getLatestAnalysis(tx, ctx.workspaceId, companyId));
  if (!analysis || analysis.audit_id !== audit.id) analysis = await analyzeCompany(ctx, companyId, deps);

  // El análisis anterior puede haber consumido presupuesto: se vuelve a comprobar.
  await withUser(ctx.user.id, (tx) => assertBudget(tx, ctx, settings.aiDailyLimit));
  const client = deps.client ?? createOpenAIClient();
  let out;
  try {
    out = await client.call({
      name: "borrador_propuesta", schema: ProposalDraftSchema, system: PROPOSAL_SYSTEM, maxOutputTokens: 3500,
      user: buildProposalInput(company, analysis.result, findings, settings.enabledServices, { name: settings.senderName, pitch: settings.senderPitch }),
    });
  } catch (err) {
    await logRun(ctx, "proposal", "failed", {}).catch(() => {});
    throw err;
  }

  let removed = 0;
  const safe = (t: string) => {
    const r = stripFinancialSentences(t);
    removed += r.removed;
    return r.text;
  };
  const d = out.parsed;
  const source = company.sources[0];
  const content = [
    `# ${safe(d.title) || `Propuesta preliminar para ${company.name}`}`,
    `_Borrador preliminar · ${formatDate(new Date())}${settings.senderName ? ` · ${settings.senderName}` : ""} · Revisar y editar antes de compartir._`,
    "## 1. Presentación del negocio",
    safe(d.business_introduction),
    ...(source ? [`_Datos del negocio: ${source.provider_name}, consultados el ${formatDate(source.fetched_at)}._`] : []),
    "## 2. Situación digital observada (hechos comprobados)",
    renderObservedSituation(audit, findings),
    "## 3. Oportunidades detectadas (recomendación)",
    safe(d.detected_opportunities),
    "## 4. Propuesta de solución (recomendación)",
    safe(d.proposed_solution),
    "## 5. Beneficios potenciales (cualitativos, sin estimaciones)",
    safe(d.potential_benefits),
    "## 6. Preguntas que requieren confirmación",
    safe(d.questions_to_confirm),
    "## 7. Próximos pasos recomendados",
    safe(d.next_steps),
    FOOTER,
  ].join("\n\n");

  const title = `Propuesta · ${company.name}`;
  return withUser(ctx.user.id, async (tx) => {
    const [p] = await tx<{ id: string }[]>`
      insert into proposals (workspace_id, company_id, analysis_id, title, content, created_by)
      values (${ctx.workspaceId}, ${companyId}, ${analysis!.id}, ${title}, ${content}, ${ctx.user.id}) returning id`;
    await tx`insert into ai_runs (workspace_id, user_id, kind, model, tokens_in, tokens_out, status)
             values (${ctx.workspaceId}, ${ctx.user.id}, 'proposal', ${out.model}, ${out.tokensIn}, ${out.tokensOut}, 'completed')`;
    await tx`insert into activities (workspace_id, company_id, user_id, type, summary, details)
             values (${ctx.workspaceId}, ${companyId}, ${ctx.user.id}, 'proposal',
                     ${removed ? `Borrador de propuesta generado (se descartaron ${removed} frases con cifras económicas)` : "Borrador de propuesta generado"}, ${tx.json({ proposalId: p!.id })})`;
    return { proposalId: p!.id };
  });
}

export { splitFindings };
