import { handler, AppError } from "@/lib/api";
import { withUser } from "@/lib/db";
import { listCompanies, type CompanyRow } from "@/lib/data/companies";
import { toCsv } from "@/lib/csv";
import { stageLabel } from "@/lib/domain";

const HEADERS = [
  "Empresa", "Sector", "Localidad", "Dirección", "Web", "Teléfono", "Estado de análisis", "Puntuación", "Prioridad",
  "Estado CRM", "Fuente", "Licencia", "URL de la fuente", "Fecha de consulta", "Nota",
];

const AUDIT_LABEL: Record<string, string> = { completed: "Analizada", failed: "Fallida", blocked: "Bloqueada", running: "Analizando" };

/** Los datos de proveedores con almacenamiento restringido no se exportan (condiciones de uso). */
export function exportRow(c: CompanyRow): unknown[] {
  const restricted = c.data_policy === "expiring";
  const src = c.sources[0];
  return [
    restricted ? "(datos del proveedor no exportables)" : c.name,
    restricted ? "" : c.sector_label,
    c.city,
    restricted ? "" : c.address,
    restricted ? "" : c.website,
    restricted ? "" : c.phone,
    c.audit_status ? (AUDIT_LABEL[c.audit_status] ?? c.audit_status) : "Pendiente",
    c.score_total ?? "Sin evaluar",
    c.score_priority ?? "sin_evaluar",
    stageLabel(c.crm_stage),
    src?.provider_name ?? "",
    src?.license ?? "",
    restricted ? "" : (src?.source_url ?? ""),
    src?.fetched_at ?? "",
    restricted ? "Contenido de Google Maps excluido por sus condiciones de uso; consulta la ficha original con el ID del lugar." : src?.attribution ?? "",
  ];
}

export const POST = handler(
  async (ctx, req) => {
    const fd = await req.formData();
    const ids = String(fd.get("ids") ?? "").split(",").filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 500);
    const scope = String(fd.get("scope") ?? "");
    const rows = await withUser(ctx.user.id, async (tx) => {
      if (ids.length) return listCompanies(tx, ctx.workspaceId, { ids });
      if (scope === "saved") return listCompanies(tx, ctx.workspaceId, { saved: true });
      const m = /^search:([0-9a-f-]{36})$/i.exec(scope);
      if (m) return listCompanies(tx, ctx.workspaceId, { searchId: m[1] });
      throw new AppError("No hay nada que exportar.");
    });
    const csv = toCsv(HEADERS, rows.map(exportRow));
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="localleads-empresas-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  },
  { limit: { bucket: "export", max: 20, windowMs: 60_000 } },
);
