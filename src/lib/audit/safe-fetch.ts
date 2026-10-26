import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

export class SafeFetchError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid_url" | "blocked_address" | "timeout" | "network" | "too_many_redirects" | "not_html" | "too_large",
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

// ---------------------------------------------------------------------------
// Direcciones no públicas (protección SSRF)
// ---------------------------------------------------------------------------

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
    });
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1]!, 16);
      const lo = parseInt(mappedHex[2]!, 16);
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (lower === "::" || lower === "::1") return true;
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (lower.startsWith("64:ff9b:")) return true; // NAT64
    return false;
  }
  return true; // si no es una IP reconocible, se trata como no segura
}

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("La URL no es válida.", "invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SafeFetchError("Solo se admiten URL http(s).", "invalid_url");
  if (url.username || url.password) throw new SafeFetchError("La URL no puede incluir credenciales.", "invalid_url");
  if (!ALLOWED_PORTS.has(url.port)) throw new SafeFetchError("Puerto no permitido.", "blocked_address");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isPrivateIp(host)) throw new SafeFetchError("La dirección no es pública.", "blocked_address");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new SafeFetchError("La dirección no es pública.", "blocked_address");
  }
  return url;
}

/** Resolución DNS que rechaza cualquier IP no pública (también frente a DNS rebinding: se valida al conectar). */
function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as dns.LookupAddress[];
    const safe = list.filter((a) => !isPrivateIp(a.address));
    if (!safe.length) {
      const e = new Error("blocked_address") as NodeJS.ErrnoException;
      e.code = "EBLOCKED";
      return callback(e, "", 0);
    }
    if (options.all) return callback(null, safe);
    callback(null, safe[0]!.address, safe[0]!.family);
  });
}

const agent = new Agent({ connect: { lookup: guardedLookup as never, timeout: 8000 } });

export type SafeResponse = {
  url: string; // URL final tras redirecciones
  status: number;
  headers: Headers;
  body: string;
  bytes: number;
  truncated: boolean;
  ttfbMs: number;
  totalMs: number;
  redirects: string[];
};

export type SafeFetchOptions = {
  userAgent: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Si se indica, se rechazan respuestas cuyo content-type no coincida (p. ej. /html|xml/). */
  accept?: RegExp;
  /** Solo para tests: sustituye al fetch real. */
  fetchImpl?: typeof undiciFetch;
};

/** GET con protección SSRF, límite de tamaño, tiempo total y redirecciones revalidadas una a una. */
export async function safeGet(rawUrl: string, opts: SafeFetchOptions): Promise<SafeResponse> {
  const { timeoutMs = 12_000, maxBytes = 1_500_000, maxRedirects = 5, userAgent } = opts;
  const doFetch = opts.fetchImpl ?? undiciFetch;
  const started = Date.now();
  const redirects: string[] = [];
  let current = assertPublicUrl(rawUrl);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      let res;
      try {
        res = await doFetch(current.toString(), {
          method: "GET",
          redirect: "manual",
          signal: ctrl.signal,
          dispatcher: agent,
          headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5", "Accept-Language": "es-ES,es;q=0.9" },
        });
      } catch (err) {
        if (ctrl.signal.aborted) throw new SafeFetchError("La web tardó demasiado en responder.", "timeout");
        const cause = (err as { cause?: { code?: string; message?: string } }).cause;
        if (cause?.code === "EBLOCKED" || /blocked_address/.test(cause?.message ?? "")) {
          throw new SafeFetchError("La dirección resuelve a una red no pública.", "blocked_address");
        }
        throw new SafeFetchError(describeNetworkError(cause?.code), "network");
      }
      const ttfb = Date.now() - started;

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel().catch(() => {});
        if (hop === maxRedirects) throw new SafeFetchError("Demasiadas redirecciones.", "too_many_redirects");
        current = assertPublicUrl(new URL(res.headers.get("location")!, current).toString());
        redirects.push(current.toString());
        continue;
      }

      const type = res.headers.get("content-type") ?? "";
      if (opts.accept && res.ok && !opts.accept.test(type)) {
        await res.body?.cancel().catch(() => {});
        throw new SafeFetchError("La URL no devuelve una página HTML.", "not_html");
      }

      const chunks: Uint8Array[] = [];
      let bytes = 0;
      let truncated = false;
      if (res.body) {
        const reader = res.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > maxBytes) {
              truncated = true;
              chunks.push(value.subarray(0, value.byteLength - (bytes - maxBytes)));
              await reader.cancel().catch(() => {});
              break;
            }
            chunks.push(value);
          }
        } catch {
          if (ctrl.signal.aborted) throw new SafeFetchError("La web tardó demasiado en responder.", "timeout");
          throw new SafeFetchError("Se interrumpió la descarga de la página.", "network");
        }
      }
      return {
        url: current.toString(),
        status: res.status,
        headers: res.headers as unknown as Headers,
        body: new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks)),
        bytes: Math.min(bytes, maxBytes),
        truncated,
        ttfbMs: ttfb,
        totalMs: Date.now() - started,
        redirects,
      };
    }
    throw new SafeFetchError("Demasiadas redirecciones.", "too_many_redirects");
  } finally {
    clearTimeout(timer);
  }
}

function describeNetworkError(code?: string): string {
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "El dominio de la web no existe o no resuelve.";
    case "ECONNREFUSED":
      return "El servidor de la web rechazó la conexión.";
    case "ECONNRESET":
      return "El servidor de la web cerró la conexión.";
    case "UND_ERR_CONNECT_TIMEOUT":
    case "ETIMEDOUT":
      return "No se pudo conectar con la web a tiempo.";
    case "CERT_HAS_EXPIRED":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "El certificado HTTPS de la web no es válido.";
    default:
      return "No se pudo acceder a la web.";
  }
}
