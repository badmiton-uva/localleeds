"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, ChevronDown, CircleHelp, ExternalLink, Lightbulb, MinusCircle, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { confirmFindingAction } from "@/app/(app)/companies/actions";
import type { FindingRow } from "@/lib/data/audits";
import { CONFIDENCE_LABEL, FINDING_KINDS, categoryLabel, serviceLabel, type FindingKind } from "@/lib/domain";
import { cn, formatDate } from "@/lib/utils";

const KIND_STYLE: Record<FindingKind, { tone: "danger" | "accent" | "warning" | "outline" | "success"; icon: React.ComponentType<{ className?: string }>; hint: string }> = {
  verified_issue: { tone: "danger", icon: ShieldAlert, hint: "Comprobado técnicamente en la página analizada." },
  opportunity: { tone: "accent", icon: Lightbulb, hint: "Mejora posible según lo observado; su valor depende del negocio." },
  hypothesis: { tone: "warning", icon: CircleHelp, hint: "Suposición que requiere confirmación humana. No es un hecho." },
  unavailable: { tone: "outline", icon: MinusCircle, hint: "No se puede determinar desde el exterior." },
  check_passed: { tone: "success", icon: CheckCircle2, hint: "Comprobación superada." },
};

const ORDER: FindingKind[] = ["verified_issue", "opportunity", "hypothesis", "unavailable", "check_passed"];

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "sí" : "no";
  if (Array.isArray(v)) return v.length ? v.map(formatValue).join(", ") : "ninguno";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function Evidence({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (!entries.length) return null;
  return (
    <details className="group mt-2">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-accent hover:underline">
        <ChevronDown className="size-3 transition-transform group-open:rotate-180" /> Ver evidencia técnica
      </summary>
      <dl className="mt-2 grid gap-x-4 gap-y-1 rounded-md bg-surface p-3 text-xs sm:grid-cols-[max-content_1fr]">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-mono text-muted">{k}</dt>
            <dd className="break-words">{formatValue(v)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function FindingCard({ f }: { f: FindingRow }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const style = KIND_STYLE[f.kind];
  const Icon = style.icon;
  const kindLabel = FINDING_KINDS.find((k) => k.key === f.kind)!.label;

  return (
    <li className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={style.tone} title={style.hint}><Icon /> {kindLabel}</Badge>
        <Badge tone="outline">{CONFIDENCE_LABEL[f.confidence]}</Badge>
        <Badge tone="outline">{categoryLabel(f.category)}</Badge>
        {f.human_confirmed && <Badge tone="success">Confirmada por una persona</Badge>}
      </div>
      <h4 className="mt-2 text-sm font-medium">{f.title}</h4>
      <p className="mt-1 text-[13px] leading-relaxed text-foreground/85">{f.description}</p>
      {f.impact && (
        <p className="mt-2 text-[13px]"><span className="font-medium">Posible impacto: </span><span className="text-foreground/85">{f.impact}</span></p>
      )}
      {f.limitations && (
        <p className="mt-1 text-[13px]"><span className="font-medium">Limitaciones: </span><span className="text-muted">{f.limitations}</span></p>
      )}
      {f.service_keys.length > 0 && f.kind !== "check_passed" && (
        <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted">
          Servicios relacionados: {f.service_keys.map((s) => <Badge key={s} tone="neutral">{serviceLabel(s)}</Badge>)}
        </p>
      )}
      <Evidence data={f.evidence} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          Comprobado el {formatDate(f.checked_at, true)}
          {f.source_url && (
            <>
              {" · "}
              <a href={f.source_url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-accent hover:underline">
                URL analizada <ExternalLink className="size-3" />
              </a>
            </>
          )}
        </span>
        {f.kind === "hypothesis" && (
          <Button
            size="sm"
            variant="outline"
            loading={pending}
            onClick={() =>
              start(async () => {
                const res = await confirmFindingAction(f.id, !f.human_confirmed);
                if (!res.ok) toast.error(res.error ?? "No se pudo actualizar.");
                else toast.success(f.human_confirmed ? "Confirmación retirada." : "Hipótesis marcada como confirmada y puntuación recalculada.");
              })
            }
          >
            {f.human_confirmed ? "Retirar confirmación" : "Marcar como confirmada"}
          </Button>
        )}
      </div>
    </li>
  );
}

export function FindingsList({ findings }: { findings: FindingRow[] }) {
  const [filter, setFilter] = useState<FindingKind | "all">("all");
  const counts = Object.fromEntries(ORDER.map((k) => [k, findings.filter((f) => f.kind === k).length])) as Record<FindingKind, number>;
  const shown = ORDER.filter((k) => filter === "all" || filter === k);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar hallazgos">
        <button
          role="tab"
          aria-selected={filter === "all"}
          onClick={() => setFilter("all")}
          className={cn("rounded-md border px-2.5 py-1 text-xs", filter === "all" ? "border-accent bg-accent-soft text-accent" : "hover:bg-surface-2")}
        >
          Todos ({findings.length})
        </button>
        {ORDER.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={filter === k}
            onClick={() => setFilter(k)}
            disabled={counts[k] === 0}
            className={cn("rounded-md border px-2.5 py-1 text-xs disabled:opacity-40", filter === k ? "border-accent bg-accent-soft text-accent" : "hover:bg-surface-2")}
          >
            {FINDING_KINDS.find((x) => x.key === k)!.label} ({counts[k]})
          </button>
        ))}
      </div>
      <div className="space-y-6">
        {shown.map((k) =>
          counts[k] === 0 ? null : (
            <section key={k} aria-label={FINDING_KINDS.find((x) => x.key === k)!.label}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                {FINDING_KINDS.find((x) => x.key === k)!.label} · {counts[k]}
              </h3>
              <ul className="space-y-2.5">
                {findings.filter((f) => f.kind === k).map((f) => <FindingCard key={f.id} f={f} />)}
              </ul>
            </section>
          ),
        )}
      </div>
    </div>
  );
}
