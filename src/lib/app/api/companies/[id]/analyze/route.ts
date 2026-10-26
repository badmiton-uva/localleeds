import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { handler } from "@/lib/api";
import { analyzeCompany } from "@/lib/services/ai";

export const maxDuration = 120;

export const POST = handler(
  async (ctx, _req, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const analysis = await analyzeCompany(ctx, id);
    revalidatePath(`/companies/${id}`);
    return NextResponse.json({ analysisId: analysis.id });
  },
  { limit: { bucket: "ai", max: 6, windowMs: 60_000 } },
);
