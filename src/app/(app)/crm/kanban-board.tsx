"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GripVertical, Search } from "lucide-react";
import { Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { ScoreBadge } from "@/components/companies/badges";
import { setStageAction } from "@/app/(app)/companies/actions";
import type { CompanyRow } from "@/lib/data/companies";
import { CRM_STAGES, type CrmStage } from "@/lib/domain";
import { cn, formatDate } from "@/lib/utils";

export function KanbanBoard({ companies }: { companies: CompanyRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [, start] = useTransition();
  const [moves, setMoves] = useState<Record<string, CrmStage>>({});
  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState<"all" | CrmStage>("all");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<CrmStage | null>(null);

  const items = useMemo(
    () => companies.map((c) => ({ ...c, crm_stage: moves[c.id] ?? c.crm_stage })).filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase())),
    [companies, moves, q],
  );
  const columns = CRM_STAGES.filter((s) => stageFilter === "all" || s.key === stageFilter);

  function move(id: string, stage: CrmStage) {
    const current = items.find((c) => c.id === id)?.crm_stage;
    if (!current || current === stage) return;
    setMoves((m) => ({ ...m, [id]: stage }));
    start(async () => {
      const res = await setStageAction({ companyId: id, stage });
      if (!res.ok) {
        setMoves((m) => {
          const next = { ...m };
          delete next[id];
          return next;
        });
        toast.error(res.error ?? "No se pudo cambiar la fase.");
      } else {
        toast.success("Fase actualizada.");
        router.refresh();
      }
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
          <Input aria-label="Buscar empresa" placeholder="Buscar empresa…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select aria-label="Filtrar por fase" className="w-auto" value={stageFilter} onChange={(e) => setStageFilter(e.target.value as typeof stageFilter)}>
          <option value="all">Todas las fases</option>
          {CRM_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
        <span className="ml-auto text-xs text-muted">{items.length} empresa(s) · arrastra las tarjetas o usa «Mover a»</span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-3" role="list" aria-label="Pipeline comercial">
        {columns.map((col) => {
          const cards = items.filter((c) => c.crm_stage === col.key);
          return (
            <section
              key={col.key}
              role="listitem"
              aria-label={col.label}
              onDragOver={(e) => { e.preventDefault(); setOver(col.key); }}
              onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain") || dragging;
                setOver(null);
                setDragging(null);
                if (id) move(id, col.key);
              }}
              className={cn("w-72 shrink-0 rounded-xl border bg-surface p-2 transition-colors", over === col.key && "border-accent bg-accent-soft/40")}
            >
              <header className="flex items-center justify-between px-2 pb-2 pt-1">
                <h2 className="text-[13px] font-semibold">{col.label}</h2>
                <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs tabular-nums text-muted">{cards.length}</span>
              </header>
              <ul className="min-h-16 space-y-2">
                {cards.map((c) => (
                  <li
                    key={c.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; setDragging(c.id); }}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                    className={cn("cursor-grab rounded-lg border bg-background p-3 shadow-sm active:cursor-grabbing", dragging === c.id && "opacity-50")}
                  >
                    <div className="flex items-start gap-1.5">
                      <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <Link href={`/companies/${c.id}?tab=tracking`} className="block truncate text-sm font-medium hover:text-accent hover:underline">{c.name}</Link>
                        <p className="truncate text-xs text-muted">{[c.sector_label, c.city].filter(Boolean).join(" · ")}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <ScoreBadge total={c.score_total} priority={c.score_priority} />
                      <span className="text-[11px] text-muted">{formatDate(c.crm_stage_changed_at)}</span>
                    </div>
                    {c.services_offered.length > 0 && <p className="mt-1.5 text-[11px] text-muted">{c.services_offered.length} servicio(s) ofrecido(s)</p>}
                    <Select aria-label={`Mover ${c.name} a`} className="mt-2 h-7 text-xs" value={c.crm_stage} onChange={(e) => move(c.id, e.target.value as CrmStage)}>
                      {CRM_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </Select>
                  </li>
                ))}
                {cards.length === 0 && <li className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted">Sin empresas en esta fase</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
