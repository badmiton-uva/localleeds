import type { Tx } from "@/lib/db";

export type SearchRow = {
  id: string;
  provider: string;
  country: string;
  region: string | null;
  city: string;
  sector_key: string | null;
  keywords: string | null;
  radius_m: number | null;
  max_results: number;
  status: "running" | "completed" | "failed";
  result_count: number;
  new_count: number;
  error: string | null;
  notes: string[];
  created_at: string;
};

const map = (r: Record<string, unknown>): SearchRow => ({
  id: String(r.id),
  provider: String(r.provider),
  country: String(r.country),
  region: (r.region as string) ?? null,
  city: String(r.city),
  sector_key: (r.sector_key as string) ?? null,
  keywords: (r.keywords as string) ?? null,
  radius_m: (r.radius_m as number) ?? null,
  max_results: Number(r.max_results),
  status: r.status as SearchRow["status"],
  result_count: Number(r.result_count),
  new_count: Number(r.new_count),
  error: (r.error as string) ?? null,
  notes: (r.notes as string[]) ?? [],
  created_at: new Date(r.created_at as string).toISOString(),
});

export async function listSearches(tx: Tx, workspaceId: string, limit = 8): Promise<SearchRow[]> {
  const rows = await tx<Record<string, unknown>[]>`
    select * from searches where workspace_id = ${workspaceId} order by created_at desc limit ${limit}`;
  return rows.map(map);
}

export async function getSearch(tx: Tx, workspaceId: string, id: string): Promise<SearchRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await tx<Record<string, unknown>[]>`select * from searches where workspace_id = ${workspaceId} and id = ${id}`;
  return r ? map(r) : null;
}
