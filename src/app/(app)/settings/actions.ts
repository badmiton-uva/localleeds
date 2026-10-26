"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { saveSettings, settingsInput } from "@/lib/data/settings";
import { rescoreAll } from "@/lib/services/audit";

export async function saveSettingsAction(raw: unknown, recompute: boolean): Promise<{ ok: boolean; error?: string; rescored?: number }> {
  const parsed = settingsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  const ctx = await requireContext();
  await withUser(ctx.user.id, (tx) => saveSettings(tx, ctx.workspaceId, parsed.data));
  const rescored = recompute ? await rescoreAll(ctx) : 0;
  for (const path of ["/settings", "/opportunities", "/companies", "/dashboard", "/discover"]) revalidatePath(path);
  return { ok: true, rescored };
}
