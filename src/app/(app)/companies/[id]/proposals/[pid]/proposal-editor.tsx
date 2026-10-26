"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, Eye, Pencil, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Markdown } from "@/components/markdown";
import { deleteProposalAction, saveProposalAction } from "@/app/(app)/proposals/actions";
import { cn, formatDate } from "@/lib/utils";

export function ProposalEditor({
  id, companyId, initialTitle, initialContent, initialStatus, updatedAt,
}: {
  id: string; companyId: string; initialTitle: string; initialContent: string; initialStatus: "draft" | "final"; updatedAt: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState(initialStatus);
  const [saved, setSaved] = useState({ title: initialTitle, content: initialContent, status: initialStatus, at: updatedAt });
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const dirty = title !== saved.title || content !== saved.content || status !== saved.status;

  function save(nextStatus = status) {
    start(async () => {
      const res = await saveProposalAction({ id, title, content, status: nextStatus });
      if (!res.ok) return toast.error(res.error ?? "No se pudo guardar.");
      setStatus(nextStatus);
      setSaved({ title, content, status: nextStatus, at: res.updatedAt ?? new Date().toISOString() });
      toast.success("Propuesta guardada.");
      router.refresh();
    });
  }

  return (
    <div>
      <Notice tone="warning" className="mb-4">
        Borrador preparado con IA. Revísalo y edítalo antes de compartirlo: las secciones 3 a 7 son recomendaciones, no hechos. LocalLead no envía este documento a nadie; cualquier comunicación con la empresa debe hacerla una persona.
      </Notice>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input aria-label="Título de la propuesta" value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-64 flex-1 font-medium" maxLength={200} />
        <Badge tone={status === "final" ? "success" : "neutral"}>{status === "final" ? "Final" : "Borrador"}</Badge>
        <div className="inline-flex overflow-hidden rounded-lg border" role="tablist" aria-label="Modo">
          {([["edit", "Editar", Pencil], ["preview", "Vista previa", Eye]] as const).map(([key, label, Icon]) => (
            <button key={key} role="tab" aria-selected={mode === key} onClick={() => setMode(key)} className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px]", mode === key ? "bg-accent-soft text-accent" : "hover:bg-surface-2")}>
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "edit" ? (
        <Textarea aria-label="Contenido de la propuesta (Markdown)" value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[32rem] font-mono text-[13px]" spellCheck />
      ) : (
        <div className="min-h-[32rem] rounded-lg border bg-background p-6"><Markdown source={`# ${title}\n\n${content.replace(/^# .*\n+/, "")}`} /></div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={() => save()} loading={pending} disabled={!dirty}><Save /> Guardar cambios</Button>
        <Button variant="outline" onClick={() => save(status === "final" ? "draft" : "final")} disabled={pending}>
          <CheckCircle2 /> {status === "final" ? "Volver a borrador" : "Marcar como final"}
        </Button>
        <a
          href={dirty ? undefined : `/print/proposals/${id}`}
          target="_blank"
          rel="noopener"
          aria-disabled={dirty}
          title={dirty ? "Guarda los cambios antes de exportar" : undefined}
          className={cn("inline-flex h-9 items-center gap-2 rounded-lg border px-4 text-sm font-medium hover:bg-surface-2", dirty && "pointer-events-none opacity-50")}
        >
          <Download className="size-4" /> Exportar a PDF
        </a>
        <Button
          variant="ghost"
          className="ml-auto text-danger"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("¿Eliminar esta propuesta? No se puede deshacer.")) return;
            start(async () => {
              const res = await deleteProposalAction(id);
              if (!res.ok) return toast.error(res.error ?? "No se pudo eliminar.");
              toast.success("Propuesta eliminada.");
              router.push(`/companies/${companyId}?tab=proposals`);
            });
          }}
        >
          <Trash2 /> Eliminar
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">{dirty ? "Cambios sin guardar." : `Guardado el ${formatDate(saved.at, true)}.`} «Exportar a PDF» abre una vista limpia; elige «Guardar como PDF» en el diálogo de impresión.</p>
    </div>
  );
}
