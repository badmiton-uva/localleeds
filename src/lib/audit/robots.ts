import { safeGet, SafeFetchError } from "./safe-fetch";

export type RobotsRules = { agents: string[]; rules: { allow: boolean; path: string }[] }[];
export type RobotsInfo = {
  /** 'found': leído; 'absent': no existe (4xx → todo permitido); 'denied': 5xx (RFC 9309: se asume bloqueo); 'unreachable': error de red. */
  state: "found" | "absent" | "denied" | "unreachable";
  groups: RobotsRules;
  sitemaps: string[];
  url: string;
};

export const BOT_TOKEN = "localleadbot";

export function parseRobots(text: string): { groups: RobotsRules; sitemaps: string[] } {
  const groups: RobotsRules = [];
  const sitemaps: string[] = [];
  let current: RobotsRules[number] | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "allow" || field === "disallow") {
      lastWasAgent = false;
      if (current) current.rules.push({ allow: field === "allow", path: value });
    } else if (field === "sitemap") {
      sitemaps.push(value);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

function patternToRegex(path: string): RegExp {
  const anchored = path.endsWith("$");
  const body = (anchored ? path.slice(0, -1) : path).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Evalúa si `path` puede rastrearse con el agente indicado (regla más específica gana; empate → permitir). */
export function isAllowed(groups: RobotsRules, path: string, agent = BOT_TOKEN): boolean {
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const applicable = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of applicable) {
    for (const r of g.rules) {
      if (!r.path) continue; // "Disallow:" vacío = permitir todo
      if (patternToRegex(r.path).test(path)) {
        const len = r.path.length;
        if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
      }
    }
  }
  return best ? best.allow : true;
}

export async function fetchRobots(origin: string, userAgent: string): Promise<RobotsInfo> {
  const url = new URL("/robots.txt", origin).toString();
  try {
    const res = await safeGet(url, { userAgent, timeoutMs: 8000, maxBytes: 200_000 });
    if (res.status >= 500) return { state: "denied", groups: [], sitemaps: [], url };
    if (res.status >= 400) return { state: "absent", groups: [], sitemaps: [], url };
    const type = res.headers.get("content-type") ?? "";
    if (/html/i.test(type)) return { state: "absent", groups: [], sitemaps: [], url }; // páginas 200 "blandas"
    return { state: "found", ...parseRobots(res.body), url };
  } catch (err) {
    if (err instanceof SafeFetchError && err.code === "blocked_address") throw err;
    return { state: "unreachable", groups: [], sitemaps: [], url };
  }
}
