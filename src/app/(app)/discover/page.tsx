import Link from "next/link";
import { History } from "lucide-react";
import { requireContext } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { getSettings } from "@/lib/data/settings";
import { getSearch, listSearches } from "@/lib/data/searches";
import { listCompanies, purgeExpired } from "@/lib/data/companies";
import { providerStatus, PROVIDER_METAS } from "@/lib/providers";
import { sectorByKey } from "@/lib/domain";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { CompanyTable } from "@/components/companies/company-table";
import { SearchForm } from "./search-form";
import { formatDate, timeAgo } from "@/lib/utils";

export const metadata = { title: "Descubrir empresas" };

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  const { search: searchId } = await searchParams;
  const ctx = await requireContext();
  const data = await withUser(ctx.user.id, async (tx) => {
    await purgeExpired(tx, ctx.workspaceId);
    const search = searchId ? await getSearch(tx, ctx.workspaceId, searchId) : null;
    return {
      settings: await getSettings(tx, ctx.workspaceId),
      recent: await listSearches(tx, ctx.workspaceId, 6),
      search,
      rows: search ? await listCompanies(tx, ctx.workspaceId, { searchId: search.id }) : [],
    };
  });
  const providers = providerStatus().map((p) => ({ key: p.meta.key, name: p.meta.name, configured: p.configured }));
  const { search, rows, recent, settings } = data;
  const meta = search ? PROVIDER_METAS[search.provider as keyof typeof PROVIDER_METAS] : null;

  return (
    <>
      <PageHeader
        title="Descubrir empresas"
        description="Busca negocios reales por ciudad y sector. Cada resultado conserva la fuente original y su licencia."
      />

      <Card>
        <CardContent className="pt-5">
          <SearchForm providers={providers} defaultProvider={settings.defaultProvider} initial={search ? { city: search.city, region: search.region ?? undefined, sectorKey: search.sector_key ?? undefined, keywords: search.keywords ?? undefined, maxResults: search.max_results } : undefined} />
        </CardContent>
      </Card>

      {search && meta && (
        <Card className="mt-6">
          <CardHeader>
            <div>
              <CardTitle>
                Resultados · {search.city}
                {search.sector_key ? ` · ${sectorByKey(search.sector_key)?.label}` : ""}
                {search.keywords ? ` · «${search.keywords}»` : ""}
              </CardTitle>
              <CardDescription>
                {search.result_count} empresas ({search.new_count} nuevas en tu base) · {formatDate(search.created_at, true)} · Fuente: {meta.name}
              </CardDescription>
            </div>
            <Badge tone="outline" title={`Licencia: ${meta.license}`}>{meta.attribution}</Badge>
          </CardHeader>
          {(search.notes.length > 0 || search.status === "failed") && (
            <div className="space-y-2 px-5 pb-3">
              {search.status === "failed" && <Notice tone="warning">{search.error ?? "La búsqueda falló."}</Notice>}
              {search.notes.map((n) => <Notice key={n}>{n}</Notice>)}
            </div>
          )}
          <CompanyTable
            rows={rows}
            exportScope={`search:${search.id}`}
            emptyTitle="Sin resultados"
            emptyDescription="La fuente no devolvió negocios para esta búsqueda. Prueba con otro sector, amplía el radio o usa otra palabra clave. No se muestran empresas ficticias."
          />
        </Card>
      )}

      {recent.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2"><History className="size-4 text-muted" /> Búsquedas recientes</CardTitle>
              <CardDescription>Abre una búsqueda anterior sin volver a consultar la fuente.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {recent.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13px]">
                  <Link href={`/discover?search=${s.id}`} className="font-medium hover:text-accent hover:underline">
                    {s.city}{s.sector_key ? ` · ${sectorByKey(s.sector_key)?.label}` : ""}{s.keywords ? ` · «${s.keywords}»` : ""}
                  </Link>
                  <span className="text-muted">
                    {s.status === "failed" ? "Falló" : `${s.result_count} resultados`} · {PROVIDER_METAS[s.provider as keyof typeof PROVIDER_METAS]?.name ?? s.provider} · {timeAgo(s.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
