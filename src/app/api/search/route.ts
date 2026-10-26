import { NextResponse } from "next/server";
import { handler, readJson } from "@/lib/api";
import { runSearch, searchInput } from "@/lib/services/discovery";

export const maxDuration = 90;

export const POST = handler(
  async (ctx, req) => {
    const input = searchInput.parse(await readJson(req));
    const outcome = await runSearch(ctx, input);
    return NextResponse.json(outcome);
  },
  { limit: { bucket: "search", max: 10, windowMs: 60_000 } },
);
