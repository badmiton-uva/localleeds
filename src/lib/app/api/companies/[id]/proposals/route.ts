import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { handler } from "@/lib/api";
import { generateProposal } from "@/lib/services/ai";

export const maxDuration = 180;

export const POST = handler(
  async (ctx, _req, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const { proposalId } = await generateProposal(ctx, id);
    revalidatePath(`/companies/${id}`);
    return NextResponse.json({ proposalId });
  },
  { limit: { bucket: "ai", max: 6, windowMs: 60_000 } },
);
