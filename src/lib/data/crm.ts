import { z } from "zod";
import type { Tx } from "@/lib/db";
import { CRM_STAGE_KEYS, SERVICE_KEYS, STAGE_ORDER, type CrmStage } from "@/lib/domain";

type Row = Record<string, unknown>;

export type ActivityRow = {
  id: string;
  company_id: string;
  type: string;
  summary: string;
  details: Record<string, unknown>;
  occurred_at: string;
  due_at: string | null;
  done: boolean;
  duration_minutes: number | null;
};

const mapActivity = (r: Row): ActivityRow => ({
  id: String(r.id),
  company_id: String(r.company_id),
  type: String(r.type),
  summary: String(r.summary),
  details: (r.details as Record<string, unknown>) ?? {},
  occurred_at: new Date(r.occurred_at as string).toISOString(),
  due_at: r.due_at ? new Date(r.due_at as string).toISOString() : null,
  done: Boolean(r.done),
  duration_minutes: (r.duration_minutes as number) ?? null,
});

export async function listActivities(tx: Tx, workspaceId: string, companyId: string, limit = 100): Promise<ActivityRow[]> {
  const rows = await tx<Row[]>`
    select * from activities where workspace_id = ${workspaceId} and company_id = ${companyId}
    order by occurred_at desc, created_at desc limit ${limit}`;
  return rows.map(mapActivity);
}

/**
 * Cambia la fase comercial y lo registra en el historial.
 * Las fases manuales guardan la empresa en el CRM; los avances automáticos (tras una auditoría) no.
 */
export async function setStage(
  tx: Tx,
  o: { workspaceId: string; userId: string; companyId: string; stage: CrmStage; auto?: boolean; note?: string },
): Promise<{ changed: boolean; from: CrmStage | null }> {
  const [cur] = await tx<{ crm_stage: CrmStage }[]>`
    select crm_stage from companies where id = ${o.companyId} and workspace_id = ${o.workspaceId} for update`;
  if (!cur) return { changed: false, from: null };
  if (cur.crm_stage === o.stage) return { changed: false, from: cur.crm_stage };
  await tx`update companies set crm_stage = ${o.stage}, crm_stage_changed_at = now(),
           saved = case when ${!o.auto} then true else saved end,
           saved_at = case when ${!o.auto} and not saved then now() else saved_at end
           where id = ${o.companyId} and workspace_id = ${o.workspaceId}`;
  await tx`insert into activities (workspace_id, company_id, user_id, type, summary, details)
           values (${o.workspaceId}, ${o.companyId}, ${o.userId}, 'stage_change',
                   ${o.note ?? (o.auto ? "Fase actualizada automáticamente" : "Cambio de fase")},
                   ${tx.json({ from: cur.crm_stage, to: o.stage, auto: Boolean(o.auto) })})`;
  return { changed: true, from: cur.crm_stage };
}

/** Avance automático permitido solo hacia delante y únicamente desde las primeras fases. */
export async function autoAdvance(tx: Tx, o: { workspaceId: string; userId: string; companyId: string; to: "researched" | "opportunity_detected"; note: string }) {
  const [cur] = await tx<{ crm_stage: CrmStage }[]>`select crm_stage from companies where id = ${o.companyId} and workspace_id = ${o.workspaceId}`;
  if (!cur) return;
  const from = STAGE_ORDER[cur.crm_stage];
  const to = STAGE_ORDER[o.to];
  if (from === undefined || to === undefined || from >= to || from > STAGE_ORDER.researched!) return;
  await setStage(tx, { ...o, stage: o.to, auto: true });
}

export const activityInput = z.object({
  companyId: z.string().uuid(),
  type: z.enum(["note", "contact", "meeting", "reminder", "service_offered"]),
  summary: z.string().trim().min(1, "Escribe un texto.").max(2000),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  durationMinutes: z.number().int().min(0).max(10_000).optional(),
  channel: z.enum(["telefono", "email", "presencial", "whatsapp", "otro"]).optional(),
  services: z.array(z.enum(SERVICE_KEYS)).optional(),
});
export type ActivityInput = z.infer<typeof activityInput>;

export async function addActivity(tx: Tx, workspaceId: string, userId: string, a: ActivityInput): Promise<void> {
  if (a.type === "reminder" && !a.dueAt) throw new Error("Indica la fecha del recordatorio.");
  if (a.type === "meeting" && !a.occurredAt) throw new Error("Indica la fecha de la reunión.");
  const details = { channel: a.channel, services: a.services };
  const [ok] = await tx`select 1 from companies where id = ${a.companyId} and workspace_id = ${workspaceId}`;
  if (!ok) throw new Error("Empresa no encontrada.");
  await tx`insert into activities (workspace_id, company_id, user_id, type, summary, details, occurred_at, due_at, duration_minutes)
           values (${workspaceId}, ${a.companyId}, ${userId}, ${a.type}, ${a.summary}, ${tx.json(JSON.parse(JSON.stringify(details)))},
                   ${a.occurredAt ?? new Date().toISOString()}, ${a.dueAt ?? null}, ${a.durationMinutes ?? null})`;
  if (a.type === "service_offered" && a.services?.length) {
    await tx`update companies set services_offered = (select array(select distinct unnest(services_offered || ${a.services as unknown as string[]}::text[])))
             where id = ${a.companyId} and workspace_id = ${workspaceId}`;
  }
  // Las acciones comerciales guardan la empresa en el CRM.
  if (a.type !== "note") {
    await tx`update companies set saved = true, saved_at = coalesce(saved_at, now()) where id = ${a.companyId} and workspace_id = ${workspaceId}`;
  }
}

export async function setReminderDone(tx: Tx, workspaceId: string, activityId: string, done: boolean) {
  await tx`update activities set done = ${done} where id = ${activityId} and workspace_id = ${workspaceId} and type = 'reminder'`;
}

export type ReminderRow = ActivityRow & { company_name: string; overdue: boolean };

export async function listReminders(tx: Tx, workspaceId: string, limit = 8): Promise<ReminderRow[]> {
  const rows = await tx<Row[]>`
    select x.*, c.name as company_name, (x.due_at < now()) as overdue from activities x join companies c on c.id = x.company_id
    where x.workspace_id = ${workspaceId} and x.type = 'reminder' and not x.done
    order by x.due_at asc limit ${limit}`;
  return rows.map((r) => ({ ...mapActivity(r), company_name: String(r.company_name), overdue: Boolean(r.overdue) }));
}

export const stageInput = z.object({ companyId: z.string().uuid(), stage: z.enum(CRM_STAGE_KEYS) });
