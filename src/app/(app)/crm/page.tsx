import Link from "next/link";
import { KanbanSquare } from "lucide-react";
import { requireContext } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { listCompanies, purgeExpired } from "@/lib/data/companies";
import { listReminders } from "@/lib/data/crm";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { KanbanBoard } from "./kanban-board";
import { RemindersPanel } from "./reminders-panel";

export const metadata = { title: "CRM" };

export default async function CrmPage() {
  const ctx = await requireContext();
  const { companies, reminders } = await withUser(ctx.user.id, async (tx) => {
    await purgeExpired(tx, ctx.workspaceId);
    return { companies: await listCompanies(tx, ctx.workspaceId, { saved: true }), reminders: await listReminders(tx, ctx.workspaceId, 8) };
  });
  return (
    <>
      <PageHeader
        title="CRM"
        description="Pipeline comercial de las empresas que has guardado. LocalLead no envía correos ni mensajes: cada contacto lo realizas tú y lo registras aquí."
      />
      {companies.length === 0 ? (
        <Card>
          <EmptyState
            icon={KanbanSquare}
            title="Tu pipeline está vacío"
            description="Guarda empresas desde los resultados de búsqueda o desde su ficha para gestionarlas por fases."
            action={<Link href="/discover" className={cn(buttonVariants())}>Descubrir empresas</Link>}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Recordatorios pendientes</CardTitle>
                <CardDescription>Los recordatorios son internos: no envían avisos a las empresas.</CardDescription>
              </div>
            </CardHeader>
            <CardContent><RemindersPanel reminders={reminders} /></CardContent>
          </Card>
          <KanbanBoard companies={companies} />
        </div>
      )}
    </>
  );
}
