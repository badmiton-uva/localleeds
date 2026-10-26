import { IMPACT_WEIGHT } from "@/lib/audit/checks";
import { serviceLabel, type Priority, type ScoringWeights, type ServiceKey } from "@/lib/domain";

export type ScoreFinding = {
  code: string;
  kind: "verified_issue" | "check_passed" | "opportunity" | "hypothesis" | "unavailable";
  confidence: "high" | "medium" | "low";
  service_keys: string[];
  human_confirmed: boolean;
  evidence: Record<string, unknown>;
};

export type ScoreInput = {
  company: { phone: string | null; address: string | null; hasSourceUrl: boolean };
  audit: { status: string; psiMeasured: boolean } | null;
  findings: ScoreFinding[];
  weights: ScoringWeights;
  thresholds: { high: number; medium: number };
  enabledServices: ServiceKey[];
};

export type ScoreComponent = {
  key: keyof ScoringWeights;
  label: string;
  weight: number;
  /** 0-100 */
  value: number;
  /** Aportación al total (weight × value / 100) */
  points: number;
  explanation: string;
  findingCodes: string[];
};

export type ScoreResult = {
  total: number | null;
  priority: Priority;
  components: ScoreComponent[];
  reason: string | null;
};

export const MIN_OBSERVED_FINDINGS = 5;
const CONFIDENCE_FACTOR = { high: 1, medium: 0.75, low: 0.4 } as const;
/** Suma ponderada de impacto a partir de la cual la oportunidad digital se considera máxima. */
export const DIGITAL_SATURATION = 15;
/** Puntos de encaje por cada servicio activado que respaldan las evidencias (7 servicios = 100). */
export const FIT_POINTS_PER_SERVICE = 15;

/** Un hallazgo cuenta como oportunidad si es un problema verificado, una oportunidad, o una hipótesis confirmada por una persona. */
function effectiveKind(f: ScoreFinding): "verified_issue" | "opportunity" | null {
  if (f.kind === "verified_issue" || f.kind === "opportunity") return f.kind;
  if (f.kind === "hypothesis" && f.human_confirmed) return "opportunity";
  return null;
}

export function computeScore(input: ScoreInput): ScoreResult {
  const { audit, findings, weights, thresholds, enabledServices, company } = input;

  if (!audit || audit.status !== "completed") {
    return { total: null, priority: "sin_evaluar", components: [], reason: "No hay una auditoría web completada: sin evidencias no se calcula puntuación." };
  }
  const observed = findings.filter((f) => f.kind === "verified_issue" || f.kind === "check_passed" || f.kind === "opportunity" || (f.kind === "hypothesis" && f.human_confirmed));
  if (observed.length < MIN_OBSERVED_FINDINGS) {
    return {
      total: null, priority: "sin_evaluar", components: [],
      reason: `Evidencias insuficientes (${observed.length} comprobaciones observadas; se requieren al menos ${MIN_OBSERVED_FINDINGS}).`,
    };
  }

  const actionable = findings.filter((f) => effectiveKind(f) !== null);

  // 1) Oportunidad de mejora digital
  let sum = 0;
  for (const f of actionable) {
    const kindFactor = effectiveKind(f) === "verified_issue" ? 1 : 0.8;
    sum += (IMPACT_WEIGHT[f.code] ?? 1) * CONFIDENCE_FACTOR[f.confidence] * kindFactor;
  }
  const digital = Math.min(100, Math.round((sum / DIGITAL_SATURATION) * 100));

  // 2) Encaje con los servicios activados
  const supported = new Set<string>();
  for (const f of actionable) for (const s of f.service_keys) if (enabledServices.includes(s as ServiceKey)) supported.add(s);
  const fit = Math.min(100, supported.size * FIT_POINTS_PER_SERVICE);

  // 3) Accesibilidad comercial (¿se puede llegar al negocio y por qué canales?)
  const passed = new Map(findings.filter((f) => f.kind === "check_passed").map((f) => [f.code, f]));
  const hasIssue = (code: string) => findings.some((f) => f.code === code && effectiveKind(f) !== null);
  const contactInfo = passed.get("contact_info")?.evidence ?? {};
  const reach: { label: string; points: number; ok: boolean }[] = [
    { label: "web accesible y analizada", points: 20, ok: true },
    { label: "teléfono publicado", points: 25, ok: Boolean(company.phone) || contactInfo.phone === true },
    { label: "formulario o reserva online", points: 20, ok: passed.has("contact_form") || passed.has("online_booking") },
    { label: "email o WhatsApp visibles", points: 15, ok: contactInfo.email === true || contactInfo.whatsapp === true },
    { label: "dirección publicada", points: 10, ok: Boolean(company.address) },
    { label: "presencia en redes sociales", points: 10, ok: !hasIssue("no_social_links") },
  ];
  const accessibility = reach.filter((r) => r.ok).reduce((s, r) => s + r.points, 0);

  // 4) Calidad de las evidencias
  const classified = findings.filter((f) => f.kind !== "unavailable");
  const solid = classified.filter((f) => (f.kind !== "hypothesis" && f.confidence !== "low") || f.human_confirmed);
  const solidShare = classified.length ? solid.length / classified.length : 0;
  const evidence = Math.round(40 + solidShare * 30 + (audit.psiMeasured ? 15 : 0) + (company.hasSourceUrl ? 15 : 0));

  const wsum = weights.digital + weights.fit + weights.accessibility + weights.evidence || 100;
  const mk = (key: keyof ScoringWeights, label: string, value: number, explanation: string, findingCodes: string[]): ScoreComponent => ({
    key, label, weight: weights[key], value, points: Math.round(((weights[key] / wsum) * value) * 10) / 10, explanation, findingCodes,
  });

  const components: ScoreComponent[] = [
    mk("digital", "Oportunidad de mejora digital", digital,
      actionable.length ? `${actionable.length} hallazgo(s) accionables (problemas verificados u oportunidades) pesados por impacto y confianza.` : "No se han detectado mejoras accionables.",
      actionable.map((f) => f.code)),
    mk("fit", "Encaje con nuestros servicios", fit,
      supported.size ? `Las evidencias respaldan ${supported.size} servicio(s): ${[...supported].map(serviceLabel).join(", ")}.` : "Ninguna evidencia respalda los servicios activados.",
      actionable.filter((f) => f.service_keys.some((s) => supported.has(s))).map((f) => f.code)),
    mk("accessibility", "Accesibilidad comercial", accessibility,
      reach.map((r) => `${r.ok ? "✓" : "✗"} ${r.label}`).join(" · "), []),
    mk("evidence", "Calidad de las evidencias", evidence,
      `Auditoría completada, ${Math.round(solidShare * 100)} % de hallazgos con confianza media/alta${audit.psiMeasured ? ", medición Lighthouse incluida" : ", sin medición Lighthouse"}${company.hasSourceUrl ? ", fuente original enlazada" : ""}.`, []),
  ];

  const total = Math.max(0, Math.min(100, Math.round(components.reduce((s, c) => s + (c.weight / wsum) * c.value, 0))));
  const priority: Priority = total >= thresholds.high ? "alta" : total >= thresholds.medium ? "media" : "baja";
  return { total, priority, components, reason: null };
}
