import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/states";
import type { AnalysisRow } from "@/lib/data/ai";
import type { FindingRow } from "@/lib/data/audits";
import { serviceLabel } from "@/lib/domain";
import { formatDate } from "@/lib/utils";

export function AnalysisView({ analysis, findings }: { analysis: AnalysisRow; findings: FindingRow[] }) {
  const r = analysis.result;
  const title = (code: string) => findings.find((f) => f.code === code)?.title ?? code;
  return (
    <div className="space-y-6">
      <Notice tone="warning">
        Análisis generado con IA a partir de los hallazgos comprobados el {formatDate(analysis.created_at, true)} (modelo {analysis.model}). Es un borrador de trabajo: las recomendaciones requieren validación humana y no constituyen hechos.
      </Notice>

      <section>
        <h3 className="mb-1.5 text-sm font-semibold">Resumen</h3>
        <p className="text-sm leading-relaxed text-foreground/90">{r.summary}</p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Oportunidades comerciales</h3>
        {r.opportunities.length === 0 && <p className="text-[13px] text-muted">La IA no identificó oportunidades respaldadas por las evidencias.</p>}
        <ul className="space-y-2.5">
          {r.opportunities.map((o) => (
            <li key={o.title} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={o.classification === "evidenced" ? "accent" : "warning"}>
                  {o.classification === "evidenced" ? "Respaldada por evidencias" : "Hipótesis"}
                </Badge>
                <Badge tone="outline">Prioridad {o.priority}</Badge>
                {o.needs_validation && <Badge tone="warning">Requiere validación humana</Badge>}
              </div>
              <h4 className="mt-2 text-sm font-medium">{o.title}</h4>
              <p className="mt-1 text-[13px] leading-relaxed text-foreground/85">{o.description}</p>
              {o.service_keys.length > 0 && (
                <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted">
                  Servicios: {o.service_keys.map((s) => <Badge key={s} tone="neutral">{serviceLabel(s)}</Badge>)}
                </p>
              )}
              <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted">
                Evidencias: {o.evidence_codes.length ? o.evidence_codes.map((c) => <Badge key={c} tone="outline" title={c}>{title(c)}</Badge>) : "ninguna citada"}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {r.recommended_services.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Servicios relevantes</h3>
          <ul className="space-y-2">
            {r.recommended_services.map((s) => (
              <li key={s.service_key} className="text-[13px]">
                <span className="font-medium">{serviceLabel(s.service_key)}.</span> <span className="text-foreground/85">{s.rationale}</span>
                <span className="ml-1 text-xs text-muted">({s.evidence_codes.map(title).join("; ")})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Aspectos a validar</h3>
          <ul className="list-disc space-y-1 pl-5 text-[13px]">{r.validation_points.map((v) => <li key={v}>{v}</li>)}</ul>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Preguntas para el negocio</h3>
          <ul className="list-disc space-y-1 pl-5 text-[13px]">{r.questions_for_business.map((v) => <li key={v}>{v}</li>)}</ul>
        </section>
      </div>

      <section>
        <h3 className="mb-1.5 text-sm font-semibold">Propuesta inicial sugerida</h3>
        <p className="text-sm leading-relaxed text-foreground/90">{r.initial_proposal}</p>
      </section>

      {analysis.validation_notes.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Controles de validación aplicados ({analysis.validation_notes.length})</summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">{analysis.validation_notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
