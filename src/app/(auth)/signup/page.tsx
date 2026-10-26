import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { AuthForm } from "../auth-form";
import { signUp } from "../actions";

export const metadata = { title: "Crear cuenta" };

export default function SignupPage() {
  if (env().AUTH_MODE === "dev") redirect("/dashboard");
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Crear cuenta</h1>
      <p className="mb-5 text-[13px] text-muted">Se creará un espacio de trabajo personal.</p>
      <AuthForm mode="signup" action={signUp} />
    </>
  );
}
