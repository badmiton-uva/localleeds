import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { env } from "@/lib/env";
import { AppError } from "@/lib/api";

export type StructuredCall<T extends z.ZodType> = {
  name: string;
  schema: T;
  system: string;
  user: string;
  maxOutputTokens: number;
};

export type StructuredResult<T> = { parsed: T; model: string; tokensIn: number | null; tokensOut: number | null };

/** Cliente mínimo inyectable (permite probar sin llamar a la API real). */
export type StructuredClient = {
  call<T extends z.ZodType>(c: StructuredCall<T>): Promise<StructuredResult<z.infer<T>>>;
};

export function aiConfigured(): boolean {
  return Boolean(env().OPENAI_API_KEY && env().OPENAI_MODEL);
}

/** Llamada del lado servidor: la clave nunca llega al navegador. */
export function createOpenAIClient(): StructuredClient {
  const e = env();
  if (!e.OPENAI_API_KEY || !e.OPENAI_MODEL) {
    throw new AppError("La IA no está configurada. Define OPENAI_API_KEY y OPENAI_MODEL (ver README).", 503, "ai_not_configured");
  }
  const client = new OpenAI({ apiKey: e.OPENAI_API_KEY, maxRetries: 2, timeout: 90_000 });
  const model = e.OPENAI_MODEL;
  return {
    async call<T extends z.ZodType>(c: StructuredCall<T>) {
      try {
        const res = await client.responses.parse({
          model,
          instructions: c.system,
          input: c.user,
          max_output_tokens: c.maxOutputTokens,
          store: false,
          text: { format: zodTextFormat(c.schema, c.name) },
        });
        if (!res.output_parsed) {
          throw new AppError("El modelo no devolvió un resultado estructurado válido. Inténtalo de nuevo.", 502, "ai_bad_output");
        }
        return { parsed: res.output_parsed as z.infer<T>, model, tokensIn: res.usage?.input_tokens ?? null, tokensOut: res.usage?.output_tokens ?? null };
      } catch (err) {
        if (err instanceof AppError) throw err;
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403) throw new AppError("OpenAI rechazó la clave de API. Revisa OPENAI_API_KEY.", 503, "ai_auth");
        if (status === 404) throw new AppError("El modelo configurado en OPENAI_MODEL no está disponible para tu cuenta.", 503, "ai_model");
        if (status === 429) throw new AppError("OpenAI ha limitado las peticiones o se agotó la cuota. Reintenta más tarde.", 429, "ai_rate_limited");
        console.error("[openai]", err instanceof Error ? err.message : err);
        throw new AppError("No se pudo completar la consulta a la IA. Inténtalo de nuevo.", 502, "ai_unavailable");
      }
    },
  };
}
