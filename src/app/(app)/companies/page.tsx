import Link from "next/link";
import { Star } from "lucide-react";
import { requireContext } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { listCompanies, purgeExpired } from "@/lib/data/companies";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { CompanyTable } from "@/components/companies/company-table";
import { cn } from "@/lib/utils";

export const metadata = { title: "Mis empresas" };

export default async function MyCompaniesPage() {
  const ctx = await requireContext();
  const rows = await withUser(ctx.user.id, async (tx) => {
    await purgeExpired(tx, ctx.workspaceId);
    return listCompanies(tx, ctx.workspaceId, { saved: true });
  });
  return (
    <>
      <PageHeader title="Mis empresas" description="Empresas que has guardado para investigar y dar seguimiento comercial." />
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={Star}
            title="Aún no has guardado ninguna empresa"
            description="Selecciona empresas en los resultados de una búsqueda y pulsa «Guardar»; aparecerán aquí y en tu CRM."
            action={<Link href="/discover" className={cn(buttonVariants())}>Descubrir empresas</Link>}
          />
        ) : (
          <CompanyTable rows={rows} exportScope="saved" />
        )}
      </Card>
    </>
  );
}
