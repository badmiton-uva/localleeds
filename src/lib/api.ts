import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getContext, type Ctx } from "@/lib/auth/session";
import { ProviderError } from "@/lib/providers/types";

/** Error de negocio con mensaje seguro para el usuario. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "bad_request",
  ) {
    super(message);
    this.name = "AppError";
  }
}

// Límite simple en memoria por usuario (suficiente para un único proceso; ver README para producción).
const hits = new Map<string, number[]>();
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    throw new AppError("Demasiadas peticiones seguidas. Espera unos segundos y reintenta.", 429, "rate_limited");
  }
  list.push(now);
  hits.set(key, list);
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  if (err instanceof ZodError) {
    return NextResponse.json({ error: err.issues[0]?.message ?? "Datos no válidos.", code: "validation" }, { status: 400 });
  }
  if (err instanceof ProviderError) {
    const status = err.code === "rate_limited" ? 429 : err.code === "not_found" || err.code === "bad_response" ? 422 : err.code === "not_configured" ? 503 : 502;
    return NextResponse.json({ error: err.message, code: err.code, retryable: err.retryable }, { status });
  }
  console.error("[api]", err);
  return NextResponse.json({ error: "Error interno. Inténtalo de nuevo.", code: "internal" }, { status: 500 });
}

/** Envuelve un handler: exige sesión, aplica límite de peticiones y normaliza errores. */
export function handler<A extends unknown[]>(
  fn: (ctx: Ctx, req: Request, ...args: A) => Promise<Response>,
  opts: { limit?: { max: number; windowMs: number; bucket: string } } = {},
) {
  return async (req: Request, ...args: A): Promise<Response> => {
    try {
      const ctx = await getContext();
      if (!ctx) throw new AppError("Sesión no válida. Inicia sesión de nuevo.", 401, "unauthorized");
      if (opts.limit) rateLimit(`${opts.limit.bucket}:${ctx.user.id}`, opts.limit.max, opts.limit.windowMs);
      return await fn(ctx, req, ...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("El cuerpo de la petición no es JSON válido.");
  }
}
