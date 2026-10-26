"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient, supabaseConfigured } from "@/lib/auth/session";
import { env } from "@/lib/env";

export type AuthState = { error?: string; message?: string };

const credentials = z.object({
  email: z.string().trim().email("Introduce un correo válido."),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres."),
});

function notConfigured(): AuthState {
  return { error: "Supabase no está configurado. Define NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY (ver README)." };
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!supabaseConfigured()) return notConfigured();
  const parsed = credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Correo o contraseña incorrectos." };
  redirect("/dashboard");
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!supabaseConfigured()) return notConfigured();
  const parsed = credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${env().APP_URL}/auth/callback` },
  });
  if (error) return { error: "No se pudo crear la cuenta. Comprueba el correo o inténtalo más tarde." };
  if (!data.session) {
    return { message: "Cuenta creada. Revisa tu correo para confirmar la dirección y vuelve para iniciar sesión." };
  }
  redirect("/dashboard");
}

export async function signOut() {
  if (supabaseConfigured() && env().AUTH_MODE !== "dev") {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect(env().AUTH_MODE === "dev" ? "/dashboard" : "/login");
}
