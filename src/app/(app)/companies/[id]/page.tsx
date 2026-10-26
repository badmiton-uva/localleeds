import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, ExternalLink } from "lucide-react";
import { requireContext } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { getCompany, purgeExpired } from "@/lib/data/companies";
import { getFindings, getLatestAudit, getLatestCompletedAudit, getLatestScore } from "@/lib/data/audits";
import { listActivities } from "@/lib/data/crm";
import { getLatestAnalysis, listProposals } from "@/lib/data/ai";
import { capabilities } from "@/lib/env";
import { PROVIDER_METAS } from "@/lib/providers";
import { stageLabel } from "@/lib/domain";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/states";
import { AuditStatusBadge, ScoreBadge } from "@/components/companies/badges";
import { ActivityPanel } from "@/components/companies/activity-panel";
import { FindingsList } from "@/components/findings/findings-list";
import { ScoreCard } from "@/components/scoring/score-card";
import { AnalysisView } from "@/components/ai/analysis-view";
import { GenerateButton } from "@/components/ai/generate-button";
import { CompanyActions } from "./company-actions";
import { NA, cn, domainOf, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "summary", label: "Resumen" },
  { key: "diagnosis", label: "Diagnóstico digital" },
  { key: "ai", label: "Análisis IA" },
  { key: "proposals", label: "Propuestas" },
  { key: "tracking", label: "Seguimiento" },
] as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const c = await withUser(ctx.user.id, (tx) => getCompany(tx, ctx.workspaceId, id));
  return { title: c?.name ?? "Empresa" };
}

export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam! : "summary";
  const ctx = await requireContext();

  const data = await withUser(ctx.user.id, async (tx) => {
    await purgeExpired(tx, ctx.workspaceId);
    const company = await getCompany(tx, ctx.workspaceId, id);
    if (!company) return null;
    const latest = await getLatestAudit(tx, ctx.workspaceId, id);
    const completed = latest?.status === "completed" ? latest : await getLatestCompletedAudit(tx, ctx.workspaceId, id);
    return {
      company,
      latest,
      completed,
      findings: completed ? await getFindings(tx, ctx.workspaceId, completed.id) : [],
      score: await getLatestScore(tx, ctx.workspaceId, id),
      activities: tab === "tracking" ? await listActivities(tx, ctx.workspaceId, id) : [],
      analysis: tab === "ai" || tab === "proposals" ? await getLatestAnalysis(tx, ctx.workspaceId, id) : null,
      proposals: tab === "proposals" ? await listProposals(tx, ctx.workspaceId, id) : [],
    };
  });
  if (!data) notFound();
  const { company: c, latest, completed, findings, score, activities, analysis, proposals } = data;
  const aiReady = capabilities.openai();
  const facts = completed?.metrics.facts;
  const canAudit = Boolean(c.website) && !c.data_expired;

  return (
    <>
      <Link href="/companies" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Mis empresas
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{c.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">{[c.sector_label, c.city].filter(Boolean).join(" · ") || NA}</span>
            <Badge tone="accent">{stageLabel(c.crm_stage)}</Badge>
            <AuditStatusBadge company={c} />
            <ScoreBadge total={c.score_total} priority={c.score_priority} />
          </div>
        </div>
        <CompanyActions
          companyId={c.id}
          saved={c.saved}
          stage={c.crm_stage}
          canAudit={canAudit}
          auditDisabledReason={c.data_expired ? "Datos caducados" : "La fuente no indica página web"}
          hasAudit={Boolean(latest)}
        />
      </div>

      {c.data_expired && (
        <Notice tone="warning" className="mb-5">
          <AlertTriangle className="mr-1.5 inline size-3.5" />
          Los datos de esta empresa procedían de un proveedor que limita su conservación y han caducado. Se mantienen tus notas, fases y hallazgos; busca la empresa de nuevo para recuperar sus datos actualizados.
        </Notice>
      )}

      <nav className="mb-5 flex gap-1 border-b" aria-label="Secciones de la ficha">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/companies/${c.id}?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === t.key ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "summary" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Información general</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  <Field label="Nombre">{c.name}</Field>
                  <Field label="Sector">{c.sector_label ?? NA}</Field>
                  <Field label="Localidad">{c.city ?? NA}{c.region ? `, ${c.region}` : ""}</Field>
                  <Field label="Dirección">{[c.address, c.postal_code].filter(Boolean).join(", ") || NA}</Field>
                  <Field label="Página web">
                    {c.website ? (
                      <a href={c.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all text-accent hover:underline">
                        {domainOf(c.website)} <ExternalLink className="size-3 shrink-0" />
                      </a>
                    ) : NA}
                  </Field>
                  <Field label="Teléfono publicado">{c.phone ?? NA}</Field>
                  <Field label="Descripción pública"><span className="text-foreground/85">{c.description ?? NA}</span></Field>
                  <Field label="Servicios ofrecidos">{c.services_offered.length ? c.services_offered.length + " registrado(s)" : NA}</Field>
                </dl>
                {facts && (facts.social.length > 0 || facts.cms) && (
                  <div className="mt-4 border-t pt-3 text-[13px]">
                    <p className="text-xs text-muted">Detectado en la web (última auditoría)</p>
                    <p className="mt-1">
                      {facts.social.length > 0 && <>Redes enlazadas: {facts.social.join(", ")}. </>}
                      {facts.cms && <>Plataforma: {facts.cms}.</>}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Fuente de los datos</CardTitle>
                  <CardDescription>De dónde procede cada dato y bajo qué licencia puede conservarse.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {c.sources.length === 0 && <p className="text-[13px] text-muted">{NA}</p>}
                {c.sources.map((s) => {
                  const meta = PROVIDER_METAS[s.provider as keyof typeof PROVIDER_METAS];
                  return (
                    <div key={s.provider} className="rounded-lg border p-3 text-[13px]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{s.provider_name}</span>
                        <Badge tone={meta?.storagePolicy === "expiring" ? "warning" : "success"}>
                          {meta?.storagePolicy === "expiring" ? "Retención limitada" : "Almacenamiento permitido"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-muted">Licencia: {s.license} · {s.attribution}</p>
                      <p className="mt-1 text-muted">
                        Consultado el {formatDate(s.fetched_at, true)}
                        {s.expires_at && <> · se conserva hasta el {formatDate(s.expires_at)}</>}
                      </p>
                      {s.source_url && (
                        <a href={s.source_url} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-flex items-center gap-1 text-accent hover:underline">
                          Ver ficha original <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <ScoreCard score={score} />
            <Card>
              <CardHeader><CardTitle>Última auditoría web</CardTitle></CardHeader>
              <CardContent className="text-[13px]">
                {!latest && <p className="text-muted">Todavía no se ha analizado la web.</p>}
                {latest && (
                  <dl className="grid gap-y-1.5">
                    <div className="flex justify-between gap-3"><dt className="text-muted">Estado</dt><dd><AuditStatusBadge company={{ ...c, audit_status: latest.status }} /></dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted">Fecha</dt><dd>{formatDate(latest.finished_at ?? latest.started_at, true)}</dd></div>
                    {latest.http_status && <div className="flex justify-between gap-3"><dt className="text-muted">Respuesta HTTP</dt><dd>{latest.http_status}</dd></div>}
                    {latest.response_ms !== null && <div className="flex justify-between gap-3"><dt className="text-muted">Primer byte</dt><dd>{latest.response_ms} ms</dd></div>}
                    {latest.error_message && <p className="mt-1 text-danger">{latest.error_message}</p>}
                    {latest.status !== "completed" && completed && <p className="mt-1 text-muted">Se muestran los resultados de la última auditoría completada ({formatDate(completed.finished_at)}).</p>}
                  </dl>
                )}
                <p className="mt-3 text-xs text-muted">Solo se consulta la página principal, una vez y respetando robots.txt.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === "diagnosis" && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Diagnóstico digital</CardTitle>
              <CardDescription>
                {completed ? `Auditoría del ${formatDate(completed.finished_at, true)} sobre ${completed.final_url ?? completed.url}.` : "Sin auditoría completada."}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {latest && latest.status !== "completed" && (
              <Notice tone="warning" className="mb-4">{latest.error_message ?? "El último intento de análisis no se completó."} No se han generado oportunidades a partir de ese intento.</Notice>
            )}
            {findings.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted">{canAudit ? "Pulsa «Analizar web» para generar el diagnóstico con evidencias." : "Esta empresa no tiene web analizable."}</p>
            ) : (
              <FindingsList findings={findings} />
            )}
          </CardContent>
        </Card>
      )}

      {tab === "ai" && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Análisis con IA</CardTitle>
              <CardDescription>La IA recibe solo hallazgos comprobados y su respuesta se valida contra esas evidencias.</CardDescription>
            </div>
            <GenerateButton
              endpoint={`/api/companies/${c.id}/analyze`}
              label={analysis ? "Regenerar análisis" : "Generar análisis"}
              loadingLabel="Analizando…"
              successMessage="Análisis generado y validado."
              variant={analysis ? "outline" : "accent"}
              disabled={!completed || !aiReady}
              disabledReason={!aiReady ? "Configura OPENAI_API_KEY y OPENAI_MODEL" : "Analiza primero la web de la empresa"}
            />
          </CardHeader>
          <CardContent>
            {!aiReady && <Notice tone="warning" className="mb-4">La IA no está configurada en este entorno: define <code>OPENAI_API_KEY</code> y <code>OPENAI_MODEL</code> en el servidor (ver README).</Notice>}
            {!completed && <p className="py-8 text-center text-[13px] text-muted">La IA solo trabaja con información contrastada. Analiza primero la web de la empresa en la pestaña Resumen.</p>}
            {completed && !analysis && <p className="py-8 text-center text-[13px] text-muted">Aún no hay análisis. Genera uno para obtener oportunidades, servicios relevantes y preguntas para el negocio.</p>}
            {analysis && <AnalysisView analysis={analysis} findings={findings} />}
          </CardContent>
        </Card>
      )}

      {tab === "proposals" && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Propuestas comerciales</CardTitle>
              <CardDescription>Borradores editables. No incluyen precios ni estimaciones de resultados.</CardDescription>
            </div>
            <GenerateButton
              endpoint={`/api/companies/${c.id}/proposals`}
              label="Generar propuesta"
              loadingLabel="Redactando…"
              successMessage="Borrador de propuesta creado."
              redirectTo={`/companies/${c.id}/proposals/{proposalId}`}
              disabled={!completed || !aiReady}
              disabledReason={!aiReady ? "Configura OPENAI_API_KEY y OPENAI_MODEL" : "Analiza primero la web de la empresa"}
            />
          </CardHeader>
          <CardContent>
            {!aiReady && <Notice tone="warning" className="mb-4">La IA no está configurada en este entorno: define <code>OPENAI_API_KEY</code> y <code>OPENAI_MODEL</code> para generar propuestas.</Notice>}
            {proposals.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted">{completed ? "Todavía no hay propuestas para esta empresa." : "Analiza primero la web de la empresa para poder generar una propuesta."}</p>
            ) : (
              <ul className="divide-y">
                {proposals.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <Link href={`/companies/${c.id}/proposals/${p.id}`} className="text-sm font-medium hover:text-accent hover:underline">{p.title}</Link>
                      <p className="text-xs text-muted">Actualizada el {formatDate(p.updated_at, true)}</p>
                    </div>
                    <Badge tone={p.status === "final" ? "success" : "neutral"}>{p.status === "final" ? "Final" : "Borrador"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "tracking" && (
        <Card>
          <CardContent className="pt-5">
            <ActivityPanel companyId={c.id} activities={activities} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
