"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, ExternalLink, ScanSearch, Search, Star, StarOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { AuditStatusBadge, ScoreBadge, SourceBadge } from "./badges";
import { saveCompaniesAction } from "@/app/(app)/companies/actions";
import type { CompanyRow } from "@/lib/data/companies";
import { NA, cn, domainOf } from "@/lib/utils";
import type { Priority } from "@/lib/domain";

type SortKey = "name" | "sector" | "city" | "status" | "score";
type Override = Partial<Pick<CompanyRow, "audit_status" | "score_total" | "score_priority" | "saved">>;

const STATUS_ORDER = { completed: 0, running: 1, blocked: 2, failed: 3, null: 4 } as const;

function compare(a: CompanyRow, b: CompanyRow, key: SortKey): number {
  switch (key) {
    case "name": return a.name.localeCompare(b.name, "es");
    case "sector": return (a.sector_label ?? "~").localeCompare(b.sector_label ?? "~", "es");
    case "city": return (a.city ?? "~").localeCompare(b.city ?? "~", "es");
    case "status": return STATUS_ORDER[(a.audit_status ?? "null") as keyof typeof STATUS_ORDER] - STATUS_ORDER[(b.audit_status ?? "null") as keyof typeof STATUS_ORDER];
    case "score": return (a.score_total ?? -1) - (b.score_total ?? -1);
  }
}

function SortHead({
  k, sort, onSort, children, className,
}: {
  k: SortKey; sort: { key: SortKey; dir: "asc" | "desc" }; onSort: (k: SortKey) => void; children: React.ReactNode; className?: string;
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TH className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
        {children}
        <Icon className="size-3" />
      </button>
    </TH>
  );
}

export function CompanyTable({
  rows,
  emptyTitle = "No hay empresas que mostrar",
  emptyDescription,
  exportScope,
}: {
  rows: CompanyRow[];
  emptyTitle?: string;
  emptyDescription?: string;
  exportScope: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const merged = useMemo(() => rows.map((r) => ({ ...r, ...overrides[r.id] })), [rows, overrides]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = merged.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (status === "pending" && !(r.website && !r.audit_status)) return false;
      if (status === "completed" && r.audit_status !== "completed") return false;
      if (status === "failed" && r.audit_status !== "failed" && r.audit_status !== "blocked") return false;
      if (status === "withweb" && !r.website) return false;
      if (status === "noweb" && r.website) return false;
      if (status === "saved" && !r.saved) return false;
      if (priority !== "all" && (r.score_priority ?? "sin_evaluar") !== priority) return false;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => compare(a, b, sort.key) * dir || a.name.localeCompare(b.name, "es"));
  }, [merged, query, status, priority, sort]);

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const selectedRows = merged.filter((r) => selected.has(r.id));
  const analyzable = selectedRows.filter((r) => r.website && !r.data_expired);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "score" ? "desc" : "asc" }));

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((r) => next.delete(r.id));
      else visible.forEach((r) => next.add(r.id));
      return next;
    });

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const save = (saved: boolean, ids = [...selected]) =>
    startTransition(async () => {
      const res = await saveCompaniesAction(ids, saved);
      if (!res.ok) return toast.error(res.error ?? "No se pudo guardar.");
      setOverrides((o) => Object.fromEntries([...Object.entries(o), ...ids.map((id) => [id, { ...o[id], saved }])]));
      toast.success(saved ? `${res.changed} empresa(s) guardada(s) en Mis empresas.` : `${res.changed} empresa(s) quitada(s) de Mis empresas.`);
      router.refresh();
    });

  async function analyzeSelected() {
    const targets = analyzable;
    if (!targets.length) return toast.error("Ninguna de las empresas seleccionadas tiene una web analizable.");
    setProgress({ done: 0, total: targets.length });
    let ok = 0;
    let failed = 0;
    const queue = [...targets];
    const worker = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        setOverrides((o) => ({ ...o, [c.id]: { ...o[c.id], audit_status: "running" } }));
        try {
          const res = await fetch(`/api/companies/${c.id}/audit`, { method: "POST" });
          const body = (await res.json()) as { status?: CompanyRow["audit_status"]; score?: { total: number | null; priority: Priority }; error?: string };
          if (!res.ok || !body.status) throw new Error(body.error ?? "Error al analizar");
          setOverrides((o) => ({ ...o, [c.id]: { ...o[c.id], audit_status: body.status, score_total: body.score?.total ?? null, score_priority: body.score?.priority ?? null } }));
          if (body.status === "completed") ok++;
          else failed++;
        } catch {
          failed++;
          setOverrides((o) => ({ ...o, [c.id]: { ...o[c.id], audit_status: "failed" } }));
        }
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
    };
    await Promise.all([worker(), worker()]);
    setProgress(null);
    if (failed) toast.error(`${ok} análisis completado(s); ${failed} no pudieron completarse (puedes reintentarlos).`);
    else toast.success(`${ok} empresa(s) analizada(s).`);
    router.refresh();
  }

  if (rows.length === 0) {
    return <EmptyState icon={Search} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
          <Input aria-label="Buscar por nombre" placeholder="Buscar por nombre…" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select aria-label="Filtrar por estado" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Todos los estados</option>
          <option value="pending">Pendientes de analizar</option>
          <option value="completed">Analizadas</option>
          <option value="failed">Fallidas o bloqueadas</option>
          <option value="withweb">Con web</option>
          <option value="noweb">Sin web</option>
          <option value="saved">Guardadas</option>
        </Select>
        <Select aria-label="Filtrar por prioridad" className="w-auto" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="all">Toda prioridad</option>
          <option value="alta">Prioridad alta</option>
          <option value="media">Prioridad media</option>
          <option value="baja">Prioridad baja</option>
          <option value="sin_evaluar">Sin evaluar</option>
        </Select>
        <span className="ml-auto text-xs text-muted">{visible.length} de {rows.length}</span>
      </div>

      {(selected.size > 0 || progress) && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-accent-soft px-3 py-2" role="region" aria-label="Acciones sobre la selección">
          <span className="text-[13px] font-medium">{progress ? `Analizando… ${progress.done}/${progress.total}` : `${selected.size} seleccionada(s)`}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => save(true)} disabled={pending || !!progress}>
              <Star /> Guardar
            </Button>
            <Button size="sm" variant="outline" onClick={() => save(false)} disabled={pending || !!progress}>
              <StarOff /> Quitar de guardadas
            </Button>
            <Button size="sm" variant="accent" onClick={analyzeSelected} loading={!!progress} disabled={!analyzable.length}>
              <ScanSearch /> Analizar ({analyzable.length})
            </Button>
            <form method="post" action="/api/export/companies">
              <input type="hidden" name="ids" value={[...selected].join(",")} />
              <input type="hidden" name="scope" value={exportScope} />
              <Button size="sm" variant="outline" type="submit">
                <Download /> Exportar CSV
              </Button>
            </form>
          </div>
        </div>
      )}

      <Table>
        <THead>
          <tr>
            <TH className="w-9"><Checkbox aria-label="Seleccionar todas" checked={allVisibleSelected} onChange={toggleAll} /></TH>
            <SortHead k="name" sort={sort} onSort={toggleSort}>Empresa</SortHead>
            <SortHead k="sector" sort={sort} onSort={toggleSort}>Sector</SortHead>
            <SortHead k="city" sort={sort} onSort={toggleSort}>Localidad</SortHead>
            <TH>Web</TH>
            <SortHead k="status" sort={sort} onSort={toggleSort}>Estado</SortHead>
            <SortHead k="score" sort={sort} onSort={toggleSort}>Oportunidad</SortHead>
            <TH>Fuente</TH>
          </tr>
        </THead>
        <TBody>
          {visible.map((r) => (
            <TR key={r.id} className={selected.has(r.id) ? "bg-accent-soft/50" : undefined}>
              <TD><Checkbox aria-label={`Seleccionar ${r.name}`} checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} /></TD>
              <TD className="max-w-64">
                <div className="flex items-center gap-1.5">
                  {r.saved && <Star className="size-3.5 shrink-0 fill-accent text-accent" aria-label="Guardada" />}
                  <Link href={`/companies/${r.id}`} className="truncate font-medium hover:text-accent hover:underline">{r.name}</Link>
                </div>
                {r.address && <p className="truncate text-xs text-muted">{r.address}</p>}
              </TD>
              <TD className="text-[13px]">{r.sector_label ?? NA}</TD>
              <TD className="text-[13px]">{r.city ?? NA}</TD>
              <TD className="max-w-44 text-[13px]">
                {r.website ? (
                  <a href={r.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 text-accent hover:underline">
                    <span className="truncate">{domainOf(r.website)}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                ) : (
                  <span className="text-muted">{r.data_expired ? "Datos caducados" : NA}</span>
                )}
              </TD>
              <TD><AuditStatusBadge company={r} /></TD>
              <TD><ScoreBadge total={r.score_total} priority={r.score_priority} /></TD>
              <TD><SourceBadge company={r} /></TD>
            </TR>
          ))}
          {visible.length === 0 && (
            <tr><td colSpan={8}><EmptyState title="Ningún resultado con estos filtros" description="Prueba a cambiar o limpiar los filtros." /></td></tr>
          )}
        </TBody>
      </Table>
    </div>
  );
}
