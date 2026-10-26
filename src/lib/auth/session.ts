import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import { rawSql, withUser } from "@/lib/db";

export type AuthUser = { id: string; email: string | null };
export type Ctx = { user: AuthUser; workspaceId: string };

export function supabaseConfigured() {
  const e = env();
  return Boolean(e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function createSupabaseServerClient() {
  const e = env();
  const store = await cookies();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Llamado desde un Server Component: el proxy ya refresca la sesión.
        }
      },
    },
  });
}

async function devUser(): Promise<AuthUser> {
  const e = env();
  // Modo local sin Supabase Auth: un único usuario fijo. Prohibido en producción (env.ts).
  await rawSql()`
    insert into auth.users (id, email) values (${e.DEV_USER_ID}, ${e.DEV_USER_EMAIL})
    on conflict (id) do nothing`;
  return { id: e.DEV_USER_ID, email: e.DEV_USER_EMAIL };
}

export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  if (env().AUTH_MODE === "dev") return devUser();
  if (!supabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
});

/** Usuario + espacio de trabajo (se crea en el primer acceso). null si no hay sesión. */
export const getContext = cache(async (): Promise<Ctx | null> => {
  const user = await getAuthUser();
  if (!user) return null;
  const workspaceId = await withUser(user.id, async (tx) => {
    const [row] = await tx<{ id: string }[]>`select public.ensure_workspace(${user.email}) as id`;
    return row!.id;
  });
  return { user, workspaceId };
});

/** Para páginas y layouts: redirige a /login sin sesión. */
export async function requireContext(): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  return ctx;
}
