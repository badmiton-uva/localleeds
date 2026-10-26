import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { AuthForm } from "../auth-form";
import { signIn } from "../actions";
import { supabaseConfigured } from "@/lib/auth/session";
import { Notice } from "@/components/ui/states";

export const metadata = { title: "Iniciar sesión" };

export default function LoginPage() {
  if (env().AUTH_MODE === "dev") redirect("/dashboard");
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Iniciar sesión</h1>
      <p className="mb-5 text-[13px] text-muted">Accede a tu espacio de trabajo.</p>
      {!supabaseConfigured() && (
        <Notice tone="warning" className="mb-4">
          Supabase no está configurado en este entorno. Consulta el README para activar la autenticación.
        </Notice>
      )}
      <AuthForm mode="login" action={signIn} />
    </>
  );
}
