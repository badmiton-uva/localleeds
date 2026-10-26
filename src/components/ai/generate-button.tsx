"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";

/** Lanza una operación de IA en el servidor, con estado de carga, error reintentable y confirmación. */
export function GenerateButton({
  endpoint,
  label,
  loadingLabel,
  successMessage,
  redirectTo,
  variant = "accent",
  disabled,
  disabledReason,
}: {
  endpoint: string;
  label: string;
  loadingLabel: string;
  successMessage: string;
  /** Plantilla de redirección: `{proposalId}` se sustituye por el id devuelto. */
  redirectTo?: string;
  variant?: "accent" | "outline" | "primary";
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const body = (await res.json()) as { error?: string; proposalId?: string };
      if (!res.ok) {
        setError(body.error ?? "No se pudo completar la operación.");
        return;
      }
      toast.success(successMessage);
      if (redirectTo && body.proposalId) router.push(redirectTo.replace("{proposalId}", body.proposalId));
      else router.refresh();
    } catch {
      setError("No se pudo contactar con el servidor. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button variant={variant} onClick={run} loading={loading} disabled={disabled} title={disabled ? disabledReason : undefined}>
        <Sparkles /> {loading ? loadingLabel : label}
      </Button>
      {error && <ErrorState title="No se pudo completar" message={error} onRetry={run} />}
    </div>
  );
}
