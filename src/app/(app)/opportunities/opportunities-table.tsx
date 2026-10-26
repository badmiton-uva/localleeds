"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ScoreBadge } from "@/components/companies/badges";
import type { OpportunityRow } from "@/lib/data/opportunities";
import { serviceLabel, stageLabel } from "@/lib/domain";

export function OpportunitiesTable({ rows }: { rows: OpportunityRow[] }) {
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState("all");
  const [sector, setSector] = useState("all");
  const [saved, setSaved] = useState("all");

  const sectors = useMemo(() => [...new Map(rows.filter((r) => r.sector_key).map((r) => [r.sector_key!, r.sector_label ?? r.sector_key!])).entries()], [rows]);
  const visible = rows.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (priority !== "all" && r.score_priority !== priority) return false;
    if (sector !== "all" && r.sector_key !== sector) return false;
    if (saved === "saved" && !r.saved) return false;
    if (saved === "unsaved" && r.saved) return false;
    return true;
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
          <Input aria-label="Buscar por nombre" placeholder="Buscar por nombre…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select aria-label="Prioridad" className="w-auto" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="all">Toda prioridad</option>
          <option value="alta">Alta</option>
          <option value="media">Media</option>
          <option value="baja">Baja</option>
          <option value="sin_evaluar">Sin evaluar</option>
        </Select>
        <Select aria-label="Sector" className="w-auto" value={sector} onChange={(e) => setSector(e.target.value)}>
          <option value="all">Todos los sectores</option>
          {sectors.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Select aria-label="Guardadas" className="w-auto" value={saved} onChange={(e) => setSaved(e.target.value)}>
          <option value="all">Guardadas y no guardadas</option>
          <option value="saved">Solo guardadas</option>
          <option value="unsaved">Solo no guardadas</option>
        </Select>
        <span className="ml-auto text-xs text-muted">{visible.length} de {rows.length}</span>
      </div>
      <Table>
        <THead>
          <tr><TH>Empresa</TH><TH>Puntuación</TH><TH>Hallazgos clave</TH><TH>Servicios con evidencia</TH><TH>Fase CRM</TH></tr>
        </THead>
        <TBody>
          {visible.map((r) => (
            <TR key={r.id}>
              <TD className="max-w-60">
                <Link href={`/companies/${r.id}`} className="font-medium hover:text-accent hover:underline">{r.name}</Link>
                <p className="text-xs text-muted">{[r.sector_label, r.city].filter(Boolean).join(" · ")}</p>
                {r.has_analysis && <Badge tone="accent" className="mt-1"><Sparkles /> Con análisis IA</Badge>}
              </TD>
              <TD>
                <ScoreBadge total={r.score_total} priority={r.score_priority} />
                {r.score_total === null && r.score_reason && <p className="mt-1 max-w-48 text-xs text-muted">{r.score_reason}</p>}
              </TD>
              <TD className="max-w-80 text-[13px]">
                {r.key_findings.length ? (
                  <ul className="list-disc space-y-0.5 pl-4">{r.key_findings.map((f) => <li key={f.title}>{f.title}</li>)}</ul>
                ) : <span className="text-muted">Sin mejoras accionables</span>}
              </TD>
              <TD className="max-w-60">
                <span className="flex flex-wrap gap-1">{r.services.map((s) => <Badge key={s} tone="neutral">{serviceLabel(s)}</Badge>)}</span>
              </TD>
              <TD className="text-[13px]">{stageLabel(r.crm_stage)}</TD>
            </TR>
          ))}
          {visible.length === 0 && <tr><td colSpan={5}><EmptyState title="Ningún resultado con estos filtros" /></td></tr>}
        </TBody>
      </Table>
    </div>
  );
}
