import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { handler } from "@/lib/api";
import { runAudit } from "@/lib/services/audit";

export const maxDuration = 120;

export const POST = handler(
  async (ctx, _req, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const outcome = await runAudit(ctx, id);
    revalidatePath(`/companies/${id}`);
    return NextResponse.json(outcome);
  },
  { limit: { bucket: "audit", max: 40, windowMs: 60_000 } },
);
