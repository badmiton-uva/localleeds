import Link from "next/link";
import { Radar, Search } from "lucide-react";
import { requireContext } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { getAnalytics, getRecentActivity } from "@/lib/data/analytics";
import { PRIORITY_LABEL } from "@/lib/domain";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { StatTile } from "@/components/stat-tile";
import { BarList } from "@/components/charts/bar-list";
import { TrendChart } from "@/components/charts/trend-chart";
import { ActivityFeed } from "@/components/activity-feed";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireContext();
  const { a, recent } = await withUser(ctx.user.id, async (tx) => ({
    a: await getAnalytics(tx, ctx.workspaceId),
    recent: await getRecentActivity(tx, ctx.workspaceId, 8),
  }));
  const k = a.kpis;

  if (k.discovered === 0) {
    return (
      <>
        <PageHeader title="Dashboard" description="Resumen de tu actividad de prospección." />
        <Card>
          <EmptyState
            icon={Radar}
            title="Todavía no hay empresas en tu espacio de trabajo"
            description="Busca empresas por ciudad y sector. Los indicadores de este panel se calculan siempre a partir de los datos que guardes."
            action={
              <Link href="/discover" className={cn(buttonVariants({ variant: "primary" }))}>
                <Search /> Descubrir empresas
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const shades = { alta: 1, media: 0.62, baja: 0.38, sin_evaluar: 0.2 } as const;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Resumen de tu actividad de prospección. Todas las cifras proceden de tu base de datos."
        actions={
          <Link href="/discover" className={cn(buttonVariants({ variant: "primary" }))}>
            <Search /> Descubrir empresas
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Empresas descubiertas" value={k.discovered} hint="Empresas encontradas en tus búsquedas" />
        <StatTile label="Empresas analizadas" value={k.analyzed} hint="Con al menos una auditoría web completada" />
        <StatTile label="Oportunidades identificadas" value={k.opportunities} hint="Empresas con algún problema verificado u oportunidad en su última auditoría" />
        <StatTile label="Prioridad alta" value={k.highPriority} hint="Puntuación comercial de 75 a 100" />
        <StatTile label="Empresas guardadas" value={k.saved} />
        <StatTile label="Empresas contactadas" value={k.contacted} hint="En fase Contactado o posterior, o con contacto registrado" />
        <StatTile label="Reuniones registradas" value={k.meetings} />
        <StatTile label="Clientes conseguidos" value={k.won} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Oportunidades por sector</CardTitle>
              <CardDescription>Empresas con hallazgos accionables, por sector.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BarList items={a.opportunitiesBySector} emptyLabel="Analiza empresas para ver oportunidades por sector." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Empresas por localidad</CardTitle>
              <CardDescription>Dónde se concentran tus empresas descubiertas.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BarList items={a.companiesByCity} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Prioridad comercial</CardTitle>
              <CardDescription>Empresas sin evidencias suficientes figuran como «Sin evaluar».</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <BarList items={a.priorityDistribution.map((p) => ({ label: PRIORITY_LABEL[p.key], value: p.value, shade: shades[p.key] }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Empresas analizadas</CardTitle>
              <CardDescription>Primeras auditorías completadas, últimos 30 días.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <TrendChart points={a.analyzedEvolution} seriesLabel="Analizadas" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Embudo comercial</CardTitle>
              <CardDescription>Empresas guardadas por estado actual.</CardDescription>
            </div>
            <Link href="/crm" className="text-xs text-accent hover:underline">Abrir CRM</Link>
          </CardHeader>
          <CardContent>
            <BarList items={a.funnel.map((f) => ({ label: f.label, value: f.value }))} emptyLabel="Guarda empresas para ver tu embudo." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Actividad reciente</CardTitle>
              <CardDescription>Últimos movimientos en tus empresas.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {recent.length ? <ActivityFeed items={recent} /> : <p className="py-8 text-center text-[13px] text-muted">Sin actividad todavía.</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
