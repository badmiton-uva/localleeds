import { env } from "@/lib/env";
import { request } from "@/lib/providers/http";

export type PsiResult = {
  strategy: "mobile";
  lighthouseVersion: string | null;
  scores: { performance: number | null; accessibility: number | null; seo: number | null; bestPractices: number | null };
  metrics: { lcpMs: number | null; cls: number | null; tbtMs: number | null; fcpMs: number | null };
  failing: { accessibility: { id: string; title: string }[]; seo: { id: string; title: string }[] };
};

type LhAudit = { id: string; title: string; score: number | null; scoreDisplayMode?: string; numericValue?: number };
type LhCategory = { score: number | null; auditRefs?: { id: string; weight: number }[] };

const pct = (s: number | null | undefined) => (typeof s === "number" ? Math.round(s * 100) : null);

export function parsePsi(json: {
  lighthouseResult?: { lighthouseVersion?: string; categories?: Record<string, LhCategory>; audits?: Record<string, LhAudit> };
}): PsiResult | null {
  const lh = json.lighthouseResult;
  if (!lh?.categories) return null;
  const audits = lh.audits ?? {};
  const failing = (cat: string) =>
    (lh.categories?.[cat]?.auditRefs ?? [])
      .filter((r) => r.weight > 0)
      .map((r) => audits[r.id])
      .filter((a): a is LhAudit => a !== undefined && a.score !== null && a.score < 1 && a.scoreDisplayMode !== "notApplicable" && a.scoreDisplayMode !== "manual")
      .slice(0, 5)
      .map((a) => ({ id: a.id, title: a.title }));
  return {
    strategy: "mobile",
    lighthouseVersion: lh.lighthouseVersion ?? null,
    scores: {
      performance: pct(lh.categories.performance?.score),
      accessibility: pct(lh.categories.accessibility?.score),
      seo: pct(lh.categories.seo?.score),
      bestPractices: pct(lh.categories["best-practices"]?.score),
    },
    metrics: {
      lcpMs: audits["largest-contentful-paint"]?.numericValue ?? null,
      cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
      tbtMs: audits["total-blocking-time"]?.numericValue ?? null,
      fcpMs: audits["first-contentful-paint"]?.numericValue ?? null,
    },
    failing: { accessibility: failing("accessibility"), seo: failing("seo") },
  };
}

/** Ejecuta Lighthouse (móvil) mediante la API oficial PageSpeed Insights v5. Requiere PAGESPEED_API_KEY. */
export async function runPageSpeed(url: string, fetchImpl?: typeof fetch): Promise<{ result: PsiResult | null; reason?: string }> {
  const key = env().PAGESPEED_API_KEY;
  if (!key) return { result: null, reason: "no_key" };
  const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  api.searchParams.set("url", url);
  api.searchParams.set("strategy", "mobile");
  api.searchParams.set("locale", "es");
  api.searchParams.set("key", key);
  for (const c of ["performance", "accessibility", "seo", "best-practices"]) api.searchParams.append("category", c);
  try {
    const res = await request(api.toString(), { method: "GET" }, { timeoutMs: 70_000, retries: 1, fetchImpl });
    if (res.status === 429) return { result: null, reason: "rate_limited" };
    if (!res.ok) return { result: null, reason: `http_${res.status}` };
    const parsed = parsePsi(await res.json());
    return parsed ? { result: parsed } : { result: null, reason: "bad_response" };
  } catch {
    return { result: null, reason: "unavailable" };
  }
}
