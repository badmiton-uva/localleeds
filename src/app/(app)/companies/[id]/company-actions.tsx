"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ScanSearch, Star, StarOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { saveCompaniesAction, setStageAction } from "../actions";
import { CRM_STAGES, type CrmStage } from "@/lib/domain";

export function CompanyActions({
  companyId,
  saved,
  stage,
  canAudit,
  auditDisabledReason,
  hasAudit,
}: {
  companyId: string;
  saved: boolean;
  stage: CrmStage;
  canAudit: boolean;
  auditDisabledReason?: string;
  hasAudit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [auditing, setAuditing] = useState(false);

  async function audit() {
    setAuditing(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/audit`, { method: "POST" });
      const body = (await res.json()) as { status?: string; message?: string; error?: string };
      if (!res.ok) toast.error(body.error ?? "No se pudo analizar la web.");
      else if (body.status === "completed") toast.success("Análisis completado.");
      else toast.error(body.message ?? "La web no pudo analizarse.");
      router.refresh();
    } catch {
      toast.error("No se pudo contactar con el servidor. Inténtalo de nuevo.");
    } finally {
      setAuditing(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Fase comercial"
        className="w-auto"
        value={stage}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const res = await setStageAction({ companyId, stage: e.target.value });
            if (!res.ok) toast.error(res.error ?? "No se pudo cambiar la fase.");
            else toast.success("Fase actualizada.");
            router.refresh();
          })
        }
      >
        {CRM_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </Select>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await saveCompaniesAction([companyId], !saved);
            if (!res.ok) toast.error(res.error ?? "No se pudo guardar.");
            else toast.success(saved ? "Quitada de Mis empresas." : "Guardada en Mis empresas.");
            router.refresh();
          })
        }
      >
        {saved ? <StarOff /> : <Star />} {saved ? "Quitar de guardadas" : "Guardar"}
      </Button>
      <Button variant="accent" onClick={audit} loading={auditing} disabled={!canAudit} title={canAudit ? undefined : auditDisabledReason}>
        <ScanSearch /> {hasAudit ? "Volver a analizar" : "Analizar web"}
      </Button>
    </div>
  );
}
