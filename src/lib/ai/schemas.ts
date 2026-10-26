import { z } from "zod";
import { SERVICE_KEYS, type ServiceKey } from "@/lib/domain";

// ---------------------------------------------------------------------------
// Esquemas enviados a OpenAI (salida estructurada estricta: sin restricciones de
// longitud; las reglas reales se validan después en validateAnalysis()).
// ---------------------------------------------------------------------------

export const AnalysisSchema = z.object({
  summary: z.string(),
  opportunities: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      service_keys: z.array(z.enum(SERVICE_KEYS)),
      evidence_codes: z.array(z.string()),
      classification: z.enum(["evidenced", "hypothesis"]),
      priority: z.enum(["alta", "media", "baja"]),
    }),
  ),
  recommended_services: z.array(z.object({ service_key: z.enum(SERVICE_KEYS), rationale: z.string(), evidence_codes: z.array(z.string()) })),
  validation_points: z.array(z.string()),
  initial_proposal: z.string(),
  questions_for_business: z.array(z.string()),
});
export type RawAnalysis = z.infer<typeof AnalysisSchema>;

export const ProposalDraftSchema = z.object({
  title: z.string(),
  business_introduction: z.string(),
  detected_opportunities: z.string(),
  proposed_solution: z.string(),
  potential_benefits: z.string(),
  questions_to_confirm: z.string(),
  next_steps: z.string(),
});
export type ProposalDraft = z.infer<typeof ProposalDraftSchema>;

// ---------------------------------------------------------------------------
// Resultado validado (lo que se guarda en la base de datos)
// ---------------------------------------------------------------------------

export type ValidatedAnalysis = {
  summary: string;
  opportunities: {
    title: string;
    description: string;
    service_keys: ServiceKey[];
    evidence_codes: string[];
    classification: "evidenced" | "hypothesis";
    needs_validation: boolean;
    priority: "alta" | "media" | "baja";
  }[];
  recommended_services: { service_key: ServiceKey; rationale: string; evidence_codes: string[] }[];
  validation_points: string[];
  initial_proposal: string;
  questions_for_business: string[];
};

export type EvidenceRef = { code: string; kind: string; human_confirmed: boolean };

/** Detecta cifras económicas o promesas de resultado que la IA no puede conocer. */
const FINANCIAL = /(€|\$|£|\beuros?\b|\busd\b|\beur\b|\broi\b|retorno de (la )?inversi|\bahorr(o|a|ar|aría|ará|arás|arán)\b|\bfactur(a|ar|ación|aría)\b|\bingresos?\b|\bbeneficios? econ|\bprecio\b|\bcoste\b|\bpresupuesto de \d|\bcrecimiento (de|del) \d|\b(aument|increment|mejor)\w* (de |del |en )?(hasta )?\d+\s?%|\+\s?\d+\s?%)/i;

export function hasFinancialClaim(text: string): boolean {
  return FINANCIAL.test(text);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Valida y sanea la salida del modelo contra los hallazgos reales:
 *  - elimina referencias a evidencias inexistentes,
 *  - degrada a «hipótesis» lo que no tenga respaldo en un hallazgo comprobado,
 *  - descarta servicios no activados y cualquier cifra económica.
 */
export function validateAnalysis(
  raw: RawAnalysis,
  evidence: EvidenceRef[],
  enabledServices: ServiceKey[],
): { result: ValidatedAnalysis; notes: string[] } {
  const notes: string[] = [];
  const byCode = new Map(evidence.map((e) => [e.code, e]));
  const solid = (code: string) => {
    const e = byCode.get(code);
    return Boolean(e && (e.kind === "verified_issue" || e.kind === "opportunity" || e.human_confirmed));
  };
  const cleanCodes = (codes: string[], ctx: string) => {
    const known = [...new Set(codes)].filter((c) => byCode.has(c));
    if (known.length < new Set(codes).size) notes.push(`${ctx}: se eliminaron referencias a evidencias que no existen.`);
    return known;
  };
  const clean = (text: string, ctx: string): string | null => {
    if (hasFinancialClaim(text)) {
      notes.push(`${ctx}: se descartó un texto con cifras económicas o promesas de resultado, que la IA no puede conocer.`);
      return null;
    }
    return text.trim() || null;
  };
  const cleanList = (list: string[], ctx: string, max: number) => list.map((s) => clean(s, ctx)).filter((s): s is string => s !== null).slice(0, max).map((s) => clip(s, 400));

  const opportunities: ValidatedAnalysis["opportunities"] = [];
  for (const o of raw.opportunities.slice(0, 8)) {
    const title = clean(o.title, "Oportunidad");
    const description = clean(o.description, "Oportunidad");
    if (!title || !description) continue;
    const codes = cleanCodes(o.evidence_codes, `Oportunidad «${o.title}»`);
    const services = o.service_keys.filter((s) => enabledServices.includes(s));
    if (services.length < o.service_keys.length) notes.push(`Oportunidad «${o.title}»: se ignoraron servicios no activados en tu configuración.`);
    const backed = codes.some(solid);
    let classification = o.classification;
    if (classification === "evidenced" && !backed) {
      classification = "hypothesis";
      notes.push(`Oportunidad «${o.title}»: sin evidencia comprobada, se marcó como hipótesis.`);
    }
    opportunities.push({
      title: clip(title, 140), description: clip(description, 700), service_keys: services, evidence_codes: codes,
      classification, needs_validation: classification === "hypothesis" || !backed, priority: o.priority,
    });
  }

  const recommended_services: ValidatedAnalysis["recommended_services"] = [];
  for (const s of raw.recommended_services) {
    if (!enabledServices.includes(s.service_key)) continue;
    const rationale = clean(s.rationale, "Servicio recomendado");
    const codes = cleanCodes(s.evidence_codes, `Servicio ${s.service_key}`);
    if (!rationale) continue;
    if (!codes.some(solid)) {
      notes.push(`Servicio ${s.service_key}: se descartó por no citar ninguna evidencia comprobada.`);
      continue;
    }
    if (!recommended_services.some((r) => r.service_key === s.service_key)) {
      recommended_services.push({ service_key: s.service_key, rationale: clip(rationale, 500), evidence_codes: codes });
    }
  }

  const summary = clean(raw.summary, "Resumen") ?? "Resumen no disponible tras la validación.";
  const initial = clean(raw.initial_proposal, "Propuesta inicial") ?? "";

  return {
    result: {
      summary: clip(summary, 900),
      opportunities,
      recommended_services,
      validation_points: cleanList(raw.validation_points, "Punto de validación", 10),
      initial_proposal: clip(initial, 1200),
      questions_for_business: cleanList(raw.questions_for_business, "Pregunta", 10),
    },
    notes,
  };
}

/** Elimina de un texto libre las frases con cifras económicas (usado en propuestas). */
export function stripFinancialSentences(text: string): { text: string; removed: number } {
  let removed = 0;
  const lines = text.split("\n").map((line) => {
    const parts = line.split(/(?<=[.!?])\s+/);
    const kept = parts.filter((p) => {
      const bad = hasFinancialClaim(p);
      if (bad) removed++;
      return !bad;
    });
    return kept.join(" ");
  });
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}
