import { Ban, CheckCircle2, Clock, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CompanyRow } from "@/lib/data/companies";
import { PRIORITY_LABEL, type Priority } from "@/lib/domain";

export function AuditStatusBadge({ company }: { company: Pick<CompanyRow, "audit_status" | "website"> }) {
  if (!company.website && !company.audit_status) {
    return (
      <Badge tone="outline" title="La fuente no indica página web; no se puede auditar">
        <Ban /> Sin web
      </Badge>
    );
  }
  switch (company.audit_status) {
    case "completed":
      return <Badge tone="success"><CheckCircle2 /> Analizada</Badge>;
    case "failed":
      return <Badge tone="danger" title="La web no pudo analizarse; puedes reintentar"><XCircle /> Fallida</Badge>;
    case "blocked":
      return <Badge tone="warning" title="El sitio no permite el análisis automatizado (robots.txt)"><ShieldAlert /> Bloqueada</Badge>;
    case "running":
      return <Badge tone="accent"><Loader2 className="animate-spin" /> Analizando</Badge>;
    default:
      return <Badge tone="neutral"><Clock /> Pendiente</Badge>;
  }
}

const PRIORITY_TONE: Record<Priority, "danger" | "warning" | "neutral" | "outline"> = {
  alta: "danger",
  media: "warning",
  baja: "neutral",
  sin_evaluar: "outline",
};

export function ScoreBadge({ total, priority }: { total: number | null; priority: Priority | null }) {
  if (total === null || !priority || priority === "sin_evaluar") {
    return <span className="text-xs text-muted">Sin evaluar</span>;
  }
  return (
    <span className="inline-flex items-center gap-2" title={PRIORITY_LABEL[priority]}>
      <span className="text-sm font-semibold tabular-nums">{total}</span>
      <Badge tone={PRIORITY_TONE[priority]}>{priority === "alta" ? "Alta" : priority === "media" ? "Media" : "Baja"}</Badge>
    </span>
  );
}

export function SourceBadge({ company }: { company: Pick<CompanyRow, "sources" | "data_policy" | "data_expired" | "data_expires_at"> }) {
  const names = company.sources.map((s) => (s.provider === "osm" ? "OpenStreetMap" : s.provider === "google_places" ? "Google Maps" : s.provider_name));
  if (!names.length) return <span className="text-xs text-muted">No disponible</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {names.map((n) => (
        <Badge key={n} tone="outline">{n}</Badge>
      ))}
      {company.data_policy === "expiring" && (
        <Badge tone="warning" title="Datos con retención limitada por la licencia del proveedor">
          {company.data_expired ? "Caducado" : "Temporal"}
        </Badge>
      )}
    </span>
  );
}
