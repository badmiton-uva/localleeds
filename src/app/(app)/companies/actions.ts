"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { setSaved } from "@/lib/data/companies";

const ids = z.array(z.string().uuid()).min(1).max(500);

export async function saveCompaniesAction(rawIds: string[], saved: boolean): Promise<{ ok: boolean; changed: number; error?: string }> {
  const parsed = ids.safeParse(rawIds);
  if (!parsed.success) return { ok: false, changed: 0, error: "Selecciona al menos una empresa." };
  const ctx = await requireContext();
  const changed = await withUser(ctx.user.id, (tx) => setSaved(tx, ctx.workspaceId, ctx.user.id, parsed.data, saved));
  revalidatePath("/companies");
  revalidatePath("/dashboard");
  revalidatePath("/crm");
  return { ok: true, changed };
}

// ---------------------------------------------------------------------------
// CRM y hallazgos
// ---------------------------------------------------------------------------
import { activityInput, addActivity, listActivities, setReminderDone, setStage, stageInput } from "@/lib/data/crm";
import { confirmFinding } from "@/lib/data/audits";
import { rescoreCompany } from "@/lib/services/audit";

type ActionResult = { ok: boolean; error?: string };

function fail(err: unknown): ActionResult {
  if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Datos no válidos." };
  if (err instanceof Error && !/^(\w+: )?(duplicate|violates|relation|column)/i.test(err.message)) return { ok: false, error: err.message };
  console.error("[action]", err);
  return { ok: false, error: "No se pudo completar la acción." };
}

export async function setStageAction(input: { companyId: string; stage: string }): Promise<ActionResult> {
  try {
    const v = stageInput.parse(input);
    const ctx = await requireContext();
    await withUser(ctx.user.id, (tx) => setStage(tx, { workspaceId: ctx.workspaceId, userId: ctx.user.id, companyId: v.companyId, stage: v.stage }));
    revalidatePath("/crm");
    revalidatePath("/dashboard");
    revalidatePath("/companies");
    revalidatePath(`/companies/${v.companyId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function addActivityAction(input: unknown): Promise<ActionResult> {
  try {
    const v = activityInput.parse(input);
    const ctx = await requireContext();
    await withUser(ctx.user.id, (tx) => addActivity(tx, ctx.workspaceId, ctx.user.id, v));
    revalidatePath(`/companies/${v.companyId}`);
    revalidatePath("/crm");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function toggleReminderAction(activityId: string, done: boolean): Promise<ActionResult> {
  try {
    const id = z.string().uuid().parse(activityId);
    const ctx = await requireContext();
    await withUser(ctx.user.id, (tx) => setReminderDone(tx, ctx.workspaceId, id, done));
    revalidatePath("/crm");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function confirmFindingAction(findingId: string, confirmed: boolean): Promise<ActionResult> {
  try {
    const id = z.string().uuid().parse(findingId);
    const ctx = await requireContext();
    const companyId = await withUser(ctx.user.id, (tx) => confirmFinding(tx, ctx.workspaceId, id, confirmed));
    if (!companyId) return { ok: false, error: "Solo las hipótesis pueden confirmarse manualmente." };
    await rescoreCompany(ctx, companyId);
    revalidatePath(`/companies/${companyId}`);
    revalidatePath("/opportunities");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function loadActivitiesAction(companyId: string) {
  const id = z.string().uuid().parse(companyId);
  const ctx = await requireContext();
  return withUser(ctx.user.id, (tx) => listActivities(tx, ctx.workspaceId, id));
}
