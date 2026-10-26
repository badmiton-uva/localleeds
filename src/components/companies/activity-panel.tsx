"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { ActivityFeed } from "@/components/activity-feed";
import { addActivityAction, toggleReminderAction } from "@/app/(app)/companies/actions";
import type { ActivityRow } from "@/lib/data/crm";
import { SERVICES, activityLabel, type ServiceKey } from "@/lib/domain";
import { formatDate } from "@/lib/utils";

const TYPES = [
  { key: "note", label: "Nota" },
  { key: "contact", label: "Contacto realizado" },
  { key: "meeting", label: "Reunión" },
  { key: "reminder", label: "Recordatorio interno" },
  { key: "service_offered", label: "Servicio ofrecido" },
] as const;

const CHANNELS = [
  { key: "telefono", label: "Teléfono" }, { key: "email", label: "Email" }, { key: "presencial", label: "Presencial" },
  { key: "whatsapp", label: "WhatsApp" }, { key: "otro", label: "Otro" },
];

const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);

export function ActivityPanel({ companyId, activities }: { companyId: string; activities: ActivityRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [type, setType] = useState<(typeof TYPES)[number]["key"]>("note");
  const [services, setServices] = useState<ServiceKey[]>([]);
  const [error, setError] = useState<string | null>(null);

  function submit(form: HTMLFormElement) {
    const fd = new FormData(form);
    const minutes = String(fd.get("minutes") ?? "");
    const payload = {
      companyId,
      type,
      summary: String(fd.get("summary") ?? ""),
      occurredAt: type === "meeting" ? toIso(String(fd.get("when") ?? "")) : type === "contact" && fd.get("when") ? toIso(String(fd.get("when"))) : undefined,
      dueAt: type === "reminder" ? toIso(String(fd.get("when") ?? "")) : undefined,
      durationMinutes: minutes ? Number(minutes) : undefined,
      channel: type === "contact" ? String(fd.get("channel")) : undefined,
      services: type === "service_offered" ? services : undefined,
    };
    start(async () => {
      const res = await addActivityAction(payload);
      if (!res.ok) return setError(res.error ?? "No se pudo guardar.");
      setError(null);
      form.reset();
      setServices([]);
      toast.success("Registrado en el historial.");
      router.refresh();
    });
  }

  const needsDate = type === "meeting" || type === "reminder";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
        className="space-y-3 self-start rounded-lg border p-4"
      >
        <h3 className="text-sm font-semibold">Registrar actividad</h3>
        <div>
          <Label htmlFor="act-type">Tipo</Label>
          <Select id="act-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </Select>
        </div>
        {type === "contact" && (
          <div>
            <Label htmlFor="channel">Canal</Label>
            <Select id="channel" name="channel" defaultValue="telefono">{CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</Select>
          </div>
        )}
        {(needsDate || type === "contact") && (
          <div>
            <Label htmlFor="when">{type === "reminder" ? "Fecha y hora del recordatorio" : type === "meeting" ? "Fecha y hora de la reunión" : "Fecha del contacto (opcional)"}</Label>
            <Input id="when" name="when" type="datetime-local" required={needsDate} />
          </div>
        )}
        {type === "service_offered" && (
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Servicios ofrecidos</legend>
            <div className="grid max-h-44 gap-1.5 overflow-y-auto rounded-md border p-2">
              {SERVICES.map((s) => (
                <label key={s.key} className="flex items-center gap-2 text-[13px]">
                  <Checkbox checked={services.includes(s.key)} onChange={(e) => setServices((cur) => (e.target.checked ? [...cur, s.key] : cur.filter((k) => k !== s.key)))} />
                  {s.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div>
          <Label htmlFor="summary">{type === "reminder" ? "Qué hay que hacer" : "Detalle"}</Label>
          <Textarea id="summary" name="summary" required maxLength={2000} placeholder={type === "service_offered" ? "Contexto de la oferta (precio y condiciones aparte)" : "Escribe aquí…"} />
        </div>
        {(type === "contact" || type === "meeting") && (
          <div>
            <Label htmlFor="minutes">Tiempo dedicado (minutos, opcional)</Label>
            <Input id="minutes" name="minutes" type="number" min={0} max={10000} />
          </div>
        )}
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        <Button type="submit" loading={pending} disabled={type === "service_offered" && services.length === 0}>
          <Plus /> Añadir al historial
        </Button>
        <p className="text-xs text-muted">LocalLead no envía correos ni mensajes: este registro es solo para tu seguimiento.</p>
      </form>

      <div>
        <h3 className="mb-1 text-sm font-semibold">Historial</h3>
        {activities.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted">Aún no hay actividad registrada.</p>
        ) : (
          <ul className="divide-y">
            {activities.map((a) => (
              <li key={a.id} className="py-2.5">
                {a.type === "reminder" ? (
                  <label className="flex items-start gap-2.5 text-[13px]">
                    <Checkbox
                      className="mt-0.5"
                      checked={a.done}
                      onChange={(e) =>
                        start(async () => {
                          await toggleReminderAction(a.id, e.target.checked);
                          router.refresh();
                        })
                      }
                    />
                    <span>
                      <span className={a.done ? "text-muted line-through" : ""}>{a.summary}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted"><CalendarClock className="size-3" /> {formatDate(a.due_at, true)}</span>
                    </span>
                  </label>
                ) : (
                  <>
                    <ActivityFeed items={[{ ...a, company_id: companyId }]} showCompany={false} />
                    {(a.type === "meeting" || a.duration_minutes) && (
                      <p className="-mt-1.5 pl-10 text-xs text-muted">
                        {a.type === "meeting" && <>Fecha: {formatDate(a.occurred_at, true)}</>}
                        {a.duration_minutes ? ` · ${a.duration_minutes} min dedicados` : ""}
                      </p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">Tipos: {TYPES.map((t) => activityLabel(t.key)).join(", ")}.</p>
      </div>
    </div>
  );
}
