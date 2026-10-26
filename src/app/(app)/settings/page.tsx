import { CheckCircle2, CircleDashed } from "lucide-react";
import { requireContext } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { getSettings } from "@/lib/data/settings";
import { capabilities, env } from "@/lib/env";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const ctx = await requireContext();
  const settings = await withUser(ctx.user.id, (tx) => getSettings(tx, ctx.workspaceId));
  const e = env();
  const integrations = [
    { name: "OpenStreetMap / Overpass", on: true, note: "No requiere clave. Datos abiertos (ODbL).", vars: "OVERPASS_URL (opcional)" },
    { name: "Google Places API (New)", on: capabilities.googlePlaces(), note: "Búsqueda con datos de Google Maps; conservación limitada a 30 días y con coste.", vars: "GOOGLE_PLACES_API_KEY" },
    { name: "OpenAI (análisis y propuestas)", on: capabilities.openai(), note: "Llamadas únicamente desde el servidor.", vars: "OPENAI_API_KEY, OPENAI_MODEL" },
    { name: "Lighthouse · PageSpeed Insights", on: capabilities.pagespeed(), note: "Rendimiento, accesibilidad y SEO medidos por Lighthouse (móvil).", vars: "PAGESPEED_API_KEY" },
    { name: "Autenticación", on: e.AUTH_MODE === "supabase" && Boolean(e.NEXT_PUBLIC_SUPABASE_URL), note: e.AUTH_MODE === "dev" ? "Modo local sin Supabase Auth (solo desarrollo)." : "Supabase Auth.", vars: "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  ];
  return (
    <>
      <PageHeader title="Configuración" description="Ajusta cómo se puntúan las oportunidades, qué servicios ofreces y los límites de uso de la IA." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SettingsForm initial={settings} googleConfigured={capabilities.googlePlaces()} />
        <Card className="self-start">
          <CardHeader>
            <div>
              <CardTitle>Integraciones</CardTitle>
              <CardDescription>Se activan con variables de entorno en el servidor. Las claves nunca se muestran ni llegan al navegador.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {integrations.map((i) => (
                <li key={i.name} className="py-3 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{i.name}</span>
                    <Badge tone={i.on ? "success" : "outline"}>{i.on ? <><CheckCircle2 /> Activa</> : <><CircleDashed /> Sin configurar</>}</Badge>
                  </div>
                  <p className="mt-1 text-muted">{i.note}</p>
                  {!i.on && <p className="mt-1 font-mono text-xs text-muted">{i.vars}</p>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
