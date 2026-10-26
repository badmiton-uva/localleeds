import { ProviderError } from "./types";

export type FetchLike = typeof fetch;

export type RequestOptions = {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Reintentos adicionales ante 5xx / 429 / error de red (con espera exponencial). */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
};

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** fetch con timeout, reintentos controlados y errores tipados. */
export async function request(url: string, init: RequestInit, opts: RequestOptions = {}): Promise<Response> {
  const { fetchImpl = fetch, timeoutMs = 20_000, retries = 0, sleep: wait = sleep } = opts;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener("abort", onAbort);
    try {
      const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await res.body?.cancel().catch(() => {});
        await wait(500 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      if (attempt < retries) {
        await wait(500 * 2 ** attempt);
        continue;
      }
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
  throw new ProviderError("No se pudo conectar con la fuente de datos. Inténtalo de nuevo en unos minutos.", "unavailable", true);
}
