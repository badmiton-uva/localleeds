import Link from "next/link";
import { Target } from "lucide-react";
import { requireContext } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { listOpportunities } from "@/lib/data/opportunities";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { OpportunitiesTable } from "./opportunities-table";

export const metadata = { title: "Oportunidades" };

export default async function OpportunitiesPage() {
  const ctx = await requireContext();
  const rows = await withUser(ctx.user.id, (tx) => listOpportunities(tx, ctx.workspaceId));
  return (
    <>
      <PageHeader
        title="Oportunidades"
        description="Empresas analizadas ordenadas por puntuación comercial. Solo aparecen las que tienen una auditoría web completada."
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={Target}
            title="Todavía no hay empresas analizadas"
            description="Busca empresas, selecciónalas y pulsa «Analizar». Las oportunidades aparecerán aquí con su puntuación y las evidencias que la respaldan."
            action={<Link href="/discover" className={cn(buttonVariants())}>Descubrir empresas</Link>}
          />
        ) : (
          <OpportunitiesTable rows={rows} />
        )}
      </Card>
    </>
  );
}
