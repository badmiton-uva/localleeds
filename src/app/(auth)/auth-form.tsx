"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { Notice } from "@/components/ui/states";
import type { AuthState } from "./actions";

export function AuthForm({
  mode,
  action,
}: {
  mode: "login" | "signup";
  action: (prev: AuthState, fd: FormData) => Promise<AuthState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const isLogin = mode === "login";
  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="email">Correo electrónico</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          minLength={8}
          required
        />
      </div>
      {state.error && <p role="alert" className="text-[13px] text-danger">{state.error}</p>}
      {state.message && <Notice tone="success">{state.message}</Notice>}
      <Button type="submit" className="w-full" loading={pending}>
        {isLogin ? "Iniciar sesión" : "Crear cuenta"}
      </Button>
      <p className="text-center text-[13px] text-muted">
        {isLogin ? "¿Aún no tienes cuenta? " : "¿Ya tienes cuenta? "}
        <Link href={isLogin ? "/signup" : "/login"} className="font-medium text-accent hover:underline">
          {isLogin ? "Crear cuenta" : "Iniciar sesión"}
        </Link>
      </p>
    </form>
  );
}
