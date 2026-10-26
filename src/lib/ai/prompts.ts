import type { CompanyRow } from "@/lib/data/companies";
import type { AuditRow, FindingRow } from "@/lib/data/audits";
import type { ValidatedAnalysis } from "./schemas";
import { serviceLabel, type ServiceKey } from "@/lib/domain";
import { domainOf, formatDate } from "@/lib/utils";

export const ANALYSIS_PROMPT_VERSION = "analysis-v1";
export const PROPOSAL_PROMPT_VERSION = "proposal-v1";

export const ANALYSIS_SYSTEM = `Eres un analista comercial B2B de una agencia española de marketing digital, desarrollo web y automatización con IA. Analizas la presencia digital de UN negocio local usando exclusivamente datos ya comprobados.

REGLAS ESTRICTAS
1. Usa únicamente la información del mensaje del usuario (bloques "company", "verified_findings" y "unverified_signals"). No tienes acceso a internet ni a otras fuentes.
2. Cada oportunidad y cada servicio recomendado debe citar en "evidence_codes" los "code" exactos de los hallazgos que lo respaldan. No inventes códigos.
3. Usa classification="evidenced" solo si al menos un código citado pertenece a un hallazgo con kind "verified_issue" u "opportunity" (o una hipótesis con human_confirmed=true). Si solo hay señales no confirmadas, usa "hypothesis".
4. El bloque "unverified_signals" contiene hipótesis y aspectos no observables. NUNCA los presentes como hechos: úsalos solo en "validation_points" y "questions_for_business".
5. No afirmes nada sobre procesos internos del negocio (CRM, automatizaciones, facturación, organización, personal): no son observables desde fuera.
6. PROHIBIDO inventar o estimar importes, precios, ahorros, facturación, ROI, porcentajes de mejora, plazos o resultados cuantificados. No escribas cifras que no estén en los datos.
7. Recomienda únicamente servicios incluidos en "enabled_services" (usa su "key").
8. Escribe en español, con tono profesional y prudente; usa condicional para lo no comprobado.
9. No incluyas datos personales. Máximo 6 oportunidades, ordenadas por relevancia.
10. "initial_proposal": 2-4 frases con el enfoque inicial razonable. "questions_for_business": preguntas útiles para una primera conversación.`;

export const PROPOSAL_SYSTEM = `Eres un consultor comercial B2B que redacta el BORRADOR de una propuesta preliminar para un negocio local español. Una persona la revisará y editará antes de usarla.

REGLAS ESTRICTAS
1. Usa únicamente los datos del mensaje del usuario. No inventes hechos, clientes, casos de éxito ni cifras.
2. PROHIBIDO incluir precios, tarifas, presupuestos, importes, ahorros, porcentajes de crecimiento, ROI, plazos de resultados o facturación.
3. Los beneficios deben ser cualitativos y en condicional ("podría", "permitiría"), nunca cuantificados.
4. No afirmes nada sobre procesos internos del negocio; formula esos puntos como preguntas.
5. Distingue lo comprobado de lo recomendado: lo comprobado ya figura en otra sección generada automáticamente, así que no lo repitas como lista; refiérete a ello brevemente cuando sea necesario.
6. Las acciones propuestas deben ser realizables por personas (p. ej. «proponer una breve llamada»); no prometas envíos automáticos de mensajes.
7. Español profesional, cercano y conciso. Usa Markdown simple: párrafos cortos y listas con guiones. No uses títulos de nivel 1 ni 2.
8. Solo propón servicios de "enabled_services".`;

const short = (v: unknown, n = 200): unknown => {
  if (typeof v === "string") return v.length > n ? `${v.slice(0, n)}…` : v;
  if (Array.isArray(v)) return v.slice(0, 8).map((x) => short(x, n));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 12).map(([k, x]) => [k, short(x, n)]));
  return v;
};

export function splitFindings(findings: FindingRow[]) {
  const verified = findings.filter((f) => f.kind === "verified_issue" || f.kind === "opportunity" || f.kind === "check_passed" || (f.kind === "hypothesis" && f.human_confirmed));
  const unverified = findings.filter((f) => !verified.includes(f));
  return { verified, unverified };
}

export function buildAnalysisInput(company: CompanyRow, findings: FindingRow[], enabled: ServiceKey[], audit: AuditRow): string {
  const { verified, unverified } = splitFindings(findings);
  return JSON.stringify(
    {
      company: {
        name: company.name,
        sector: company.sector_label,
        city: company.city,
        website_domain: domainOf(company.website),
        has_published_phone: Boolean(company.phone),
        has_published_address: Boolean(company.address),
        data_source: company.sources.map((s) => s.provider_name),
      },
      audit: { checked_at: audit.finished_at, scope: "Solo la página principal, una vez" },
      enabled_services: enabled.map((key) => ({ key, name: serviceLabel(key) })),
      verified_findings: verified.map((f) => ({
        code: f.code, kind: f.kind, human_confirmed: f.human_confirmed, confidence: f.confidence, category: f.category,
        title: f.title, description: f.description, impact: f.impact, limitations: f.limitations, evidence: short(f.evidence),
      })),
      unverified_signals: unverified.map((f) => ({ code: f.code, kind: f.kind, title: f.title, description: f.description, limitations: f.limitations })),
    },
    null,
    1,
  );
}

export function buildProposalInput(
  company: CompanyRow, analysis: ValidatedAnalysis, findings: FindingRow[], enabled: ServiceKey[], sender: { name: string | null; pitch: string | null },
): string {
  const { verified } = splitFindings(findings);
  return JSON.stringify(
    {
      company: { name: company.name, sector: company.sector_label, city: company.city, website_domain: domainOf(company.website) },
      sender: { name: sender.name, description: sender.pitch },
      enabled_services: enabled.map((key) => ({ key, name: serviceLabel(key) })),
      verified_findings: verified.filter((f) => f.kind !== "check_passed").map((f) => ({ code: f.code, kind: f.kind, title: f.title, description: f.description, impact: f.impact })),
      validated_analysis: analysis,
    },
    null,
    1,
  );
}

/** Sección «Situación digital observada»: generada por código a partir de hallazgos, nunca por la IA. */
export function renderObservedSituation(audit: AuditRow, findings: FindingRow[]): string {
  const when = formatDate(audit.finished_at ?? audit.started_at, true);
  const lines: string[] = [
    `> **Hechos comprobados** mediante una auditoría automática de la página principal (${audit.final_url ?? audit.url}) realizada el ${when}. Solo se analizó esa página; no se conoce el funcionamiento interno del negocio.`,
    "",
  ];
  const confirmedHyp = findings.filter((f) => f.kind === "hypothesis" && f.human_confirmed);
  const issues = findings.filter((f) => f.kind === "verified_issue");
  lines.push("**Problemas verificados**");
  lines.push(...(issues.length ? issues.map((f) => `- ${f.title}. ${f.description}`) : ["- No se verificaron problemas relevantes."]), "");
  const opps = [...findings.filter((f) => f.kind === "opportunity"), ...confirmedHyp];
  if (opps.length) {
    lines.push("**Posibles mejoras observadas** (indicios, no certezas)");
    lines.push(...opps.map((f) => `- ${f.title}. ${f.limitations ? `_${f.limitations}_` : ""}`.trim()), "");
  }
  const ok = findings.filter((f) => f.kind === "check_passed");
  if (ok.length) lines.push("**Aspectos que ya funcionan bien**", ...ok.map((f) => `- ${f.title}`), "");
  const pending = findings.filter((f) => (f.kind === "hypothesis" && !f.human_confirmed) || f.kind === "unavailable");
  if (pending.length) lines.push("**Pendiente de confirmar con el negocio** (no verificable desde fuera)", ...pending.map((f) => `- ${f.title}`), "");
  return lines.join("\n").trim();
}
