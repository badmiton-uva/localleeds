"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { deleteProposal, updateProposal } from "@/lib/data/ai";

const input = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1, "Indica un título.").max(200),
  content: z.string().min(1, "La propuesta no puede estar vacía.").max(60_000, "La propuesta es demasiado larga."),
  status: z.enum(["draft", "final"]),
});

export async function saveProposalAction(raw: unknown): Promise<{ ok: boolean; error?: string; updatedAt?: string }> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  const ctx = await requireContext();
  const saved = await withUser(ctx.user.id, (tx) => updateProposal(tx, ctx.workspaceId, parsed.data.id, parsed.data));
  if (!saved) return { ok: false, error: "Propuesta no encontrada." };
  revalidatePath(`/companies/${saved.company_id}`);
  return { ok: true, updatedAt: saved.updated_at };
}

export async function deleteProposalAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "Identificador no válido." };
  const ctx = await requireContext();
  await withUser(ctx.user.id, (tx) => deleteProposal(tx, ctx.workspaceId, parsed.data));
  revalidatePath("/companies");
  return { ok: true };
}
