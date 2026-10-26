import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ScoreRow } from "@/lib/data/audits";
import { PRIORITY_LABEL } from "@/lib/domain";
import { formatDate } from "@/lib/utils";

export function ScoreCard({ score }: { score: ScoreRow | null }) {
  const hasScore = score && score.total !== null;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Puntuación comercial</CardTitle>
          <CardDescription>
            {score ? `Calculada el ${formatDate(score.created_at, true)} con las ponderaciones de tu configuración.` : "Aún no se ha calculado."}
          </CardDescription>
        </div>
        {score && (
          <Badge tone={score.priority === "alta" ? "danger" : score.priority === "media" ? "warning" : "outline"}>{PRIORITY_LABEL[score.priority]}</Badge>
        )}
      </CardHeader>
      <CardContent>
        {!score && <p className="text-[13px] text-muted">Analiza la web de la empresa para obtener evidencias. Sin ellas, la puntuación figura como «Sin evaluar».</p>}
        {score && !hasScore && (
          <div>
            <p className="text-2xl font-semibold">Sin evaluar</p>
            <p className="mt-1 text-[13px] text-muted">{score.reason}</p>
          </div>
        )}
        {hasScore && (
          <>
            <div className="mb-4 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tabular-nums tracking-tight">{score.total}</span>
              <span className="text-sm text-muted">/ 100</span>
            </div>
            <ul className="space-y-3.5">
              {score.components.map((c) => (
                <li key={c.key}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="font-medium">{c.label} <span className="font-normal text-muted">· peso {c.weight} %</span></span>
                    <span className="tabular-nums"><span className="font-medium">{c.value}</span>/100 <span className="text-muted">→ {c.points} pts</span></span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <div className="h-full rounded-full" style={{ width: `${c.value}%`, background: "var(--series-1)" }} />
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">{c.explanation}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted">
              La puntuación se calcula con reglas deterministas a partir de hallazgos comprobados; la IA no la modifica. Ninguna variable personal o sensible interviene.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
