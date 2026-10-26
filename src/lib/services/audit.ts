import { userAgent } from "@/lib/env";
import { withUser, type Tx } from "@/lib/db";
import type { Ctx } from "@/lib/auth/session";
import { AppError } from "@/lib/api";
import { getCompany } from "@/lib/data/companies";
import { getSettings, type Settings } from "@/lib/data/settings";
import { autoAdvance } from "@/lib/data/crm";
import { getFindings, getLatestCompletedAudit, type FindingRow } from "@/lib/data/audits";
import { runChecks, type FindingDraft } from "@/lib/audit/checks";
import { extractFacts } from "@/lib/audit/extract";
import { runPageSpeed, type PsiResult } from "@/lib/audit/pagespeed";
import { BOT_TOKEN, fetchRobots, isAllowed, type RobotsInfo } from "@/lib/audit/robots";
import { assertPublicUrl, safeGet, SafeFetchError, type SafeResponse } from "@/lib/audit/safe-fetch";
import { computeScore, type ScoreFinding, type ScoreResult } from "@/lib/scoring";
import type { Priority } from "@/lib/domain";

export type AuditOutcome = {
  auditId: string;
  status: "completed" | "failed" | "blocked";
  message?: string;
  score: { total: number | null; priority: Priority };
};

export type AuditDeps = {
  safeGet?: typeof safeGet;
  fetchRobots?: typeof fetchRobots;
  runPageSpeed?: typeof runPageSpeed;
};

const MS_NOTE = "Se consultó la página principal una sola vez, respetando robots.txt.";

function unavailableFinding(code: string, title: string, description: string, evidence: Record<string, unknown>): FindingDraft {
  return {
    code, category: "presence", kind: "unavailable", title, description, evidence, confidence: "high", impact: null,
    limitations: "No se generan oportunidades a partir de una auditoría que no pudo completarse.", serviceKeys: [],
  };
}

function toScoreFindings(rows: { code: string; kind: FindingDraft["kind"]; confidence: FindingDraft["confidence"]; service_keys: string[]; human_confirmed: boolean; evidence: Record<string, unknown> }[]): ScoreFinding[] {
  return rows.map((r) => ({ code: r.code, kind: r.kind, confidence: r.confidence, service_keys: r.service_keys, human_confirmed: r.human_confirmed, evidence: r.evidence }));
}

/** Calcula y guarda la puntuación de una empresa a partir de una auditoría y la configuración actual. */
export async function scoreCompany(
  tx: Tx, o: { workspaceId: string; companyId: string; auditId: string; settings: Settings; findings: ScoreFinding[]; psiMeasured: boolean; company: { phone: string | null; address: string | null; hasSourceUrl: boolean } },
): Promise<ScoreResult> {
  const result = computeScore({
    company: o.company, audit: { status: "completed", psiMeasured: o.psiMeasured }, findings: o.findings,
    weights: o.settings.weights, thresholds: o.settings.thresholds, enabledServices: o.settings.enabledServices,
  });
  await tx`insert into scores (workspace_id, company_id, audit_id, total, priority, components, weights, reason)
           values (${o.workspaceId}, ${o.companyId}, ${o.auditId}, ${result.total}, ${result.priority},
                   ${tx.json(JSON.parse(JSON.stringify(result.components)))}, ${tx.json(o.settings.weights)}, ${result.reason})`;
  return result;
}

export async function runAudit(ctx: Ctx, companyId: string, deps: AuditDeps = {}): Promise<AuditOutcome> {
  const get = deps.safeGet ?? safeGet;
  const getRobots = deps.fetchRobots ?? fetchRobots;
  const pagespeed = deps.runPageSpeed ?? runPageSpeed;
  const ua = userAgent().replace(/^LocalLead\//, "LocalLeadBot/");

  const { company, settings } = await withUser(ctx.user.id, async (tx) => ({
    company: await getCompany(tx, ctx.workspaceId, companyId),
    settings: await getSettings(tx, ctx.workspaceId),
  }));
  if (!company) throw new AppError("Empresa no encontrada.", 404, "not_found");
  if (company.data_expired) throw new AppError("Los datos de esta empresa caducaron según la licencia del proveedor. Vuelve a buscarla para actualizarlos.", 409, "expired");
  if (!company.website) throw new AppError("La fuente no indica una página web para esta empresa; no hay nada que analizar.", 422, "no_website");

  let target: URL;
  try {
    target = assertPublicUrl(company.website);
  } catch {
    throw new AppError("La web registrada no es una URL pública válida.", 422, "invalid_url");
  }

  const [audit] = await withUser(ctx.user.id, (tx) =>
    tx<{ id: string }[]>`insert into audits (workspace_id, company_id, url, status) values (${ctx.workspaceId}, ${companyId}, ${target.toString()}, 'running') returning id`,
  );
  const auditId = audit!.id;
  const checkedAt = new Date();

  type Final = { status: "completed" | "failed" | "blocked"; fields: Record<string, string | number | boolean | null>; metrics?: unknown; drafts: FindingDraft[]; psi: PsiResult | null; message?: string };

  const finish = async (f: Final): Promise<AuditOutcome> => {
    return withUser(ctx.user.id, async (tx) => {
      await tx`update audits set ${tx({
        status: f.status, finished_at: new Date(), ...f.fields,
        metrics: tx.json(JSON.parse(JSON.stringify(f.metrics ?? {}))),
        psi: f.psi ? tx.json(JSON.parse(JSON.stringify(f.psi))) : null,
      } as never)} where id = ${auditId}`;

      const rows = f.drafts.map((d) => ({
        workspace_id: ctx.workspaceId, company_id: companyId, audit_id: auditId, code: d.code, category: d.category, kind: d.kind,
        title: d.title, description: d.description, evidence: tx.json(JSON.parse(JSON.stringify(d.evidence))), source_url: target.toString(),
        checked_at: checkedAt, confidence: d.confidence, impact: d.impact, limitations: d.limitations, service_keys: d.serviceKeys as unknown as string[],
      }));
      if (rows.length) await tx`insert into findings ${tx(rows)}`;

      let score: AuditOutcome["score"] = { total: null, priority: "sin_evaluar" };
      if (f.status === "completed") {
        const r = await scoreCompany(tx, {
          workspaceId: ctx.workspaceId, companyId, auditId, settings, psiMeasured: Boolean(f.psi),
          company: { phone: company.phone, address: company.address, hasSourceUrl: company.sources.some((s) => Boolean(s.source_url)) },
          findings: toScoreFindings(f.drafts.map((d) => ({ code: d.code, kind: d.kind, confidence: d.confidence, service_keys: d.serviceKeys, human_confirmed: false, evidence: d.evidence }))),
        });
        score = { total: r.total, priority: r.priority };
        const actionable = f.drafts.filter((d) => d.kind === "verified_issue" || d.kind === "opportunity").length;
        await autoAdvance(tx, { workspaceId: ctx.workspaceId, userId: ctx.user.id, companyId, to: "researched", note: "Auditoría web completada" });
        if (actionable > 0 && r.total !== null) {
          await autoAdvance(tx, { workspaceId: ctx.workspaceId, userId: ctx.user.id, companyId, to: "opportunity_detected", note: `${actionable} hallazgos accionables` });
        }
      } else {
        // El resultado previo (si lo hubo) se conserva; un fallo no genera ni borra puntuaciones.
        const prev = await tx<{ total: number | null; priority: Priority }[]>`select total, priority from scores where company_id = ${companyId} order by created_at desc limit 1`;
        if (prev[0]) score = { total: prev[0].total, priority: prev[0].priority };
      }

      const issues = f.drafts.filter((d) => d.kind === "verified_issue").length;
      const opps = f.drafts.filter((d) => d.kind === "opportunity").length;
      const summary = f.status === "completed" ? `Auditoría web completada: ${issues} problemas verificados, ${opps} posibles oportunidades` : `Auditoría web no completada: ${f.message}`;
      await tx`insert into activities (workspace_id, company_id, user_id, type, summary, details)
               values (${ctx.workspaceId}, ${companyId}, ${ctx.user.id}, 'audit', ${summary}, ${tx.json({ auditId, status: f.status })})`;
      return { auditId, status: f.status, message: f.message, score };
    });
  };

  try {
    // 1) robots.txt
    let robots: RobotsInfo = await getRobots(target.origin, ua);
    const path = target.pathname + target.search;
    const blockedBy = (r: RobotsInfo, p: string) => r.state === "denied" || (r.state === "found" && !isAllowed(r.groups, p, BOT_TOKEN));
    if (blockedBy(robots, path || "/")) {
      const why = robots.state === "denied" ? "El servidor devolvió un error al leer robots.txt, por lo que se asume que no se permite el análisis." : "El sitio indica en robots.txt que no permite el análisis automatizado de esta página.";
      return await finish({
        status: "blocked", psi: null, message: why, drafts: [unavailableFinding("robots_blocked", "Análisis no permitido por el sitio", why, { robotsUrl: robots.url, state: robots.state })],
        fields: { robots_allowed: false, error_code: "robots_blocked", error_message: why },
      });
    }

    // 2) Página principal
    const page: SafeResponse = await get(target.toString(), { userAgent: ua, accept: /html|xml|text\/plain/i });
    const finalUrl = new URL(page.url);
    if (finalUrl.origin !== target.origin) {
      robots = await getRobots(finalUrl.origin, ua);
      if (blockedBy(robots, finalUrl.pathname || "/")) {
        const why = "El sitio al que redirige la web no permite el análisis automatizado (robots.txt).";
        return await finish({
          status: "blocked", psi: null, message: why, drafts: [unavailableFinding("robots_blocked", "Análisis no permitido por el sitio", why, { robotsUrl: robots.url })],
          fields: { robots_allowed: false, final_url: page.url, error_code: "robots_blocked", error_message: why },
        });
      }
    }

    if (page.status >= 400) {
      const antiBot = [401, 403, 429, 503].includes(page.status) && /cloudflare|sucuri|akamai|incapsula|datadome|perimeterx/i.test([...(page.headers as unknown as Headers).keys()].join(" ") + (page.headers.get("server") ?? "") + page.body.slice(0, 2000));
      const code = antiBot ? "blocked_by_site" : `http_${page.status}`;
      const msg = antiBot ? `La web usa protección anti-bots (HTTP ${page.status}) y no permite el análisis automatizado. No se intenta eludirla.` : `La web respondió con el error HTTP ${page.status}.`;
      return await finish({
        status: "failed", psi: null, message: msg,
        drafts: [unavailableFinding("website_unreachable", "No se pudo analizar la web", msg, { httpStatus: page.status, finalUrl: page.url })],
        fields: { robots_allowed: true, final_url: page.url, http_status: page.status, response_ms: page.ttfbMs, error_code: code, error_message: msg },
      });
    }

    // 3) Sitemap y Lighthouse en paralelo
    const sitemapUrl = new URL("/sitemap.xml", finalUrl.origin).toString();
    const [sitemap, psiRun] = await Promise.all([
      robots.sitemaps.length
        ? Promise.resolve({ exists: true as boolean | null, url: robots.sitemaps[0]! })
        : get(sitemapUrl, { userAgent: ua, timeoutMs: 8000, maxBytes: 100_000 })
            .then((r) => ({ exists: (r.status === 200 && /<urlset|<sitemapindex/i.test(r.body)) as boolean | null, url: sitemapUrl }))
            .catch((e) => ({ exists: (e instanceof SafeFetchError && e.code === "network" ? null : false) as boolean | null, url: sitemapUrl })),
      pagespeed(page.url),
    ]);

    const facts = extractFacts(page.body, page.url);
    const drafts = runChecks({
      facts, robots, sitemap, psi: psiRun.result, psiReason: psiRun.reason, sectorKey: company.sector_key, year: checkedAt.getFullYear(),
      page: { url: target.toString(), finalUrl: page.url, status: page.status, ttfbMs: page.ttfbMs, totalMs: page.totalMs, bytes: page.bytes, truncated: page.truncated, redirects: page.redirects },
    });
    return await finish({
      status: "completed", psi: psiRun.result, drafts, message: MS_NOTE,
      metrics: { facts, totalMs: page.totalMs, truncated: page.truncated, sitemap },
      fields: { robots_allowed: true, final_url: page.url, http_status: page.status, response_ms: page.ttfbMs, html_bytes: page.bytes },
    });
  } catch (err) {
    const known = err instanceof SafeFetchError;
    const msg = known ? err.message : "Error inesperado durante el análisis.";
    if (!known) console.error("[audit]", err);
    return await finish({
      status: "failed", psi: null, message: msg,
      drafts: [unavailableFinding("website_unreachable", "No se pudo analizar la web", msg, { errorCode: known ? err.code : "unexpected" })],
      fields: { error_code: known ? err.code : "unexpected", error_message: msg },
    });
  }
}

/** Recalcula la puntuación con la configuración actual usando la última auditoría completada. */
export async function rescoreCompany(ctx: Ctx, companyId: string): Promise<ScoreResult | null> {
  return withUser(ctx.user.id, async (tx) => {
    const company = await getCompany(tx, ctx.workspaceId, companyId);
    const audit = await getLatestCompletedAudit(tx, ctx.workspaceId, companyId);
    if (!company || !audit) return null;
    const findings: FindingRow[] = await getFindings(tx, ctx.workspaceId, audit.id);
    const settings = await getSettings(tx, ctx.workspaceId);
    return scoreCompany(tx, {
      workspaceId: ctx.workspaceId, companyId, auditId: audit.id, settings, psiMeasured: Boolean(audit.psi),
      company: { phone: company.phone, address: company.address, hasSourceUrl: company.sources.some((s) => Boolean(s.source_url)) },
      findings: toScoreFindings(findings),
    });
  });
}

/** Recalcula la puntuación de todas las empresas con auditoría completada (tras cambiar la configuración). */
export async function rescoreAll(ctx: Ctx): Promise<number> {
  const ids = await withUser(ctx.user.id, (tx) =>
    tx<{ company_id: string }[]>`select distinct company_id from audits where workspace_id = ${ctx.workspaceId} and status = 'completed'`,
  );
  let n = 0;
  for (const { company_id } of ids) {
    if (await rescoreCompany(ctx, company_id)) n++;
  }
  return n;
}
