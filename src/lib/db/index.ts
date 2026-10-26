import postgres from "postgres";
import { env } from "@/lib/env";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

const g = globalThis as unknown as { __localleadSql?: Sql };

/** Conexión de servicio (rol del DATABASE_URL). No usar para datos de usuario: no aplica RLS. */
export function rawSql(): Sql {
  if (!g.__localleadSql) {
    g.__localleadSql = postgres(env().DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      prepare: false, // compatible con el pooler de Supabase en modo transacción
      onnotice: () => {},
      transform: { undefined: null },
    });
  }
  return g.__localleadSql;
}

export async function closeSql() {
  if (g.__localleadSql) {
    await g.__localleadSql.end();
    g.__localleadSql = undefined;
  }
}

/**
 * Ejecuta `fn` dentro de una transacción con el contexto de un usuario autenticado:
 * `request.jwt.claims` y rol `authenticated`, de modo que las políticas RLS se
 * aplican igual que con PostgREST. Todo acceso a datos de usuario pasa por aquí.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  return rawSql().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true),
                    set_config('request.jwt.claim.sub', ${userId}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  }) as Promise<T>;
}
