import Link from "next/link";
import { FileText } from "lucide-react";
import { requireContext } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { getAnalytics, type AnalyticsFilters } from "@/lib/data/analytics";
import { getFilterOptions, listAllProposals } from "@/lib/data/opportunities";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatTile } from "@/components/stat-tile";
import { BarList } from "@/components/charts/bar-list";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Informes" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
const hours = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const { options, proposals } = await withUser(ctx.user.id, async (tx) => ({
    options: await getFilterOptions(tx, ctx.workspaceId),
    proposals: await listAllProposals(tx, ctx.workspaceId, 15),
  }));
  const filters: AnalyticsFilters = {
    from: sp.from && DATE.test(sp.from) ? sp.from : undefined,
    to: sp.to && DATE.test(sp.to) ? sp.to : undefined,
    sector: sp.sector && options.sectors.some((s) => s.key === sp.sector) ? sp.sector : undefined,
    city: sp.city && options.cities.includes(sp.city) ? sp.city : undefined,
  };
  const filtered = Boolean(filters.from || filters.to || filters.sector || filters.city);
  const a = await withUser(ctx.user.id, (tx) => getAnalytics(tx, ctx.workspaceId, filters));
  const k = a.kpis;

  return (
    <>
      <PageHeader title="Informes" description="Analítica comercial calculada con los datos persistidos de tu espacio de trabajo." />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div><Label htmlFor="from">Descubiertas desde</Label><Input id="from" type="date" name="from" defaultValue={filters.from} /></div>
            <div><Label htmlFor="to">hasta</Label><Input id="to" type="date" name="to" defaultValue={filters.to} /></div>
            <div>
              <Label htmlFor="sector">Sector</Label>
              <Select id="sector" name="sector" defaultValue={filters.sector ?? ""}>
                <option value="">Todos</option>
                {options.sectors.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="city">Municipio</Label>
              <Select id="city" name="city" defaultValue={filters.city ?? ""}>
                <option value="">Todos</option>
                {options.cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <Button type="submit">Aplicar filtros</Button>
            {filtered && <Link href="/reports" className={cn(buttonVariants({ variant: "ghost" }))}>Limpiar</Link>}
          </form>
        </CardContent>
      </Card>

      {k.discovered === 0 ? (
        <Card><p className="px-6 py-12 text-center text-sm text-muted">{filtered ? "No hay empresas con estos filtros." : "Aún no hay datos. Cuando descubras y gestiones empresas, aquí verás tu analítica."}</p></Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Empresas descubiertas" value={k.discovered} />
            <StatTile label="Empresas investigadas" value={k.analyzed} hint="Con auditoría web completada" />
            <StatTile label="Contactadas" value={pct(a.contactedRate)} hint={`${k.contacted} de ${k.saved} guardadas`} />
            <StatTile label="Reuniones" value={k.meetings} />
            <StatTile label="Propuestas enviadas" value={k.proposalsSent} hint="Empresas que han llegado a la fase «Propuesta enviada»" />
            <StatTile label="Clientes conseguidos" value={k.won} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><div><CardTitle>Sectores con más oportunidades</CardTitle><CardDescription>Empresas con hallazgos accionables en su última auditoría.</CardDescription></div></CardHeader>
              <CardContent><BarList items={a.opportunitiesBySector} emptyLabel="Sin oportunidades identificadas con estos filtros." /></CardContent>
            </Card>
            <Card>
              <CardHeader><div><CardTitle>Localidades investigadas</CardTitle><CardDescription>Empresas descubiertas y analizadas por municipio.</CardDescription></div></CardHeader>
              <CardContent>
                <Table>
                  <THead><tr><TH>Localidad</TH><TH className="text-right">Descubiertas</TH><TH className="text-right">Analizadas</TH></tr></THead>
                  <TBody>{a.citiesInvestigated.map((c) => <TR key={c.label}><TD>{c.label}</TD><TD className="text-right tabular-nums">{c.discovered}</TD><TD className="text-right tabular-nums">{c.analyzed}</TD></TR>)}</TBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><div><CardTitle>Conversión por fase comercial</CardTitle><CardDescription>Empresas guardadas que han alcanzado cada fase (actual o histórica) y su paso desde la fase anterior.</CardDescription></div></CardHeader>
            <CardContent>
              {k.saved === 0 ? <p className="py-6 text-center text-[13px] text-muted">Guarda empresas en el CRM para medir la conversión.</p> : (
                <Table>
                  <THead><tr><TH>Fase</TH><TH className="text-right">Empresas que la alcanzaron</TH><TH className="text-right">Conversión desde la fase anterior</TH><TH className="text-right">Ahora en esta fase</TH></tr></THead>
                  <TBody>
                    {a.conversion.map((c) => (
                      <TR key={c.key}>
                        <TD>{c.label}</TD>
                        <TD className="text-right tabular-nums">{c.reached}</TD>
                        <TD className="text-right tabular-nums">{pct(c.rateFromPrevious)}</TD>
                        <TD className="text-right tabular-nums">{a.funnel.find((f) => f.key === c.key)?.value ?? 0}</TD>
                      </TR>
                    ))}
                    <TR><TD className="text-muted">Descartado</TD><TD className="text-right text-muted">—</TD><TD className="text-right text-muted">—</TD><TD className="text-right tabular-nums">{a.funnel.find((f) => f.key === "discarded")?.value ?? 0}</TD></TR>
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><div><CardTitle>Tiempo dedicado</CardTitle><CardDescription>Suma de los minutos que has registrado en contactos y reuniones.</CardDescription></div>{a.totalMinutes > 0 && <Badge tone="accent">Total: {hours(a.totalMinutes)}</Badge>}</CardHeader>
              <CardContent>
                {a.timeSpent.length === 0 ? <p className="py-6 text-center text-[13px] text-muted">Aún no has registrado tiempo. Puedes indicarlo al añadir un contacto o una reunión.</p> : (
                  <Table>
                    <THead><tr><TH>Empresa</TH><TH className="text-right">Tiempo</TH></tr></THead>
                    <TBody>{a.timeSpent.map((t) => <TR key={t.companyId}><TD><Link href={`/companies/${t.companyId}?tab=tracking`} className="hover:text-accent hover:underline">{t.name}</Link></TD><TD className="text-right tabular-nums">{hours(t.minutes)}</TD></TR>)}</TBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><div><CardTitle>Propuestas recientes</CardTitle><CardDescription>De todas tus empresas (sin filtros).</CardDescription></div></CardHeader>
              <CardContent>
                {proposals.length === 0 ? <p className="py-6 text-center text-[13px] text-muted"><FileText className="mx-auto mb-2 size-5" />Aún no has generado propuestas.</p> : (
                  <ul className="divide-y">
                    {proposals.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                        <div className="min-w-0">
                          <Link href={`/companies/${p.company_id}/proposals/${p.id}`} className="block truncate font-medium hover:text-accent hover:underline">{p.title}</Link>
                          <span className="text-xs text-muted">{p.company_name} · {formatDate(p.updated_at)}</span>
                        </div>
                        <Badge tone={p.status === "final" ? "success" : "neutral"}>{p.status === "final" ? "Final" : "Borrador"}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
