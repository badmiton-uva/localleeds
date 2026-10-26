"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { SERVICES, type ScoringWeights, type ServiceKey } from "@/lib/domain";
import type { Settings } from "@/lib/data/settings";
import { cn } from "@/lib/utils";
import { saveSettingsAction } from "./actions";

const WEIGHT_FIELDS: { key: keyof ScoringWeights; label: string; hint: string }[] = [
  { key: "digital", label: "Oportunidad de mejora digital", hint: "Cuántas mejoras accionables hay y su impacto." },
  { key: "fit", label: "Encaje con nuestros servicios", hint: "Cuántos de tus servicios activos respaldan las evidencias." },
  { key: "accessibility", label: "Accesibilidad comercial", hint: "Qué canales públicos hay para contactar con el negocio." },
  { key: "evidence", label: "Calidad de las evidencias", hint: "Qué parte del diagnóstico está comprobada y medida." },
];

export function SettingsForm({ initial, googleConfigured }: { initial: Settings; googleConfigured: boolean }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [weights, setWeights] = useState<ScoringWeights>(initial.weights);
  const [high, setHigh] = useState(initial.thresholds.high);
  const [medium, setMedium] = useState(initial.thresholds.medium);
  const [services, setServices] = useState<ServiceKey[]>(initial.enabledServices);
  const [limit, setLimit] = useState(initial.aiDailyLimit);
  const [provider, setProvider] = useState(initial.defaultProvider);
  const [senderName, setSenderName] = useState(initial.senderName ?? "");
  const [senderPitch, setSenderPitch] = useState(initial.senderPitch ?? "");
  const [recompute, setRecompute] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sum = Math.round(Object.values(weights).reduce((a, b) => a + b, 0));

  function submit() {
    start(async () => {
      const res = await saveSettingsAction(
        { weights, thresholds: { high, medium }, enabledServices: services, aiDailyLimit: limit, defaultProvider: provider, senderName: senderName.trim() || null, senderPitch: senderPitch.trim() || null },
        recompute,
      );
      if (!res.ok) {
        setError(res.error ?? "No se pudo guardar.");
        return;
      }
      setError(null);
      toast.success(recompute ? `Configuración guardada. ${res.rescored} puntuación(es) recalculada(s).` : "Configuración guardada.");
    });
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Puntuación comercial</CardTitle>
            <CardDescription>Ponderaciones de los cuatro criterios (deben sumar 100) y umbrales de prioridad.</CardDescription>
          </div>
          <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", sum === 100 ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>Suma: {sum}</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {WEIGHT_FIELDS.map((f) => (
              <div key={f.key}>
                <Label htmlFor={`w-${f.key}`}>{f.label} (%)</Label>
                <Input id={`w-${f.key}`} type="number" min={0} max={100} value={weights[f.key]} onChange={(e) => setWeights({ ...weights, [f.key]: Number(e.target.value) })} />
                <FieldHint>{f.hint}</FieldHint>
              </div>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="t-high">Prioridad alta desde (puntos)</Label>
              <Input id="t-high" type="number" min={1} max={100} value={high} onChange={(e) => setHigh(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="t-med">Prioridad media desde (puntos)</Label>
              <Input id="t-med" type="number" min={1} max={100} value={medium} onChange={(e) => setMedium(Number(e.target.value))} />
              <FieldHint>Por debajo de este valor: prioridad baja.</FieldHint>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Servicios que ofreces</CardTitle>
            <CardDescription>Solo estos servicios cuentan para el encaje y pueden recomendarse en los análisis con IA.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {SERVICES.map((s) => (
              <label key={s.key} className="flex items-center gap-2 text-sm">
                <Checkbox checked={services.includes(s.key)} onChange={(e) => setServices((cur) => (e.target.checked ? [...cur, s.key] : cur.filter((k) => k !== s.key)))} />
                {s.label}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Búsqueda e IA</CardTitle>
            <CardDescription>Fuente por defecto y control de costes de la IA.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="provider">Fuente de datos por defecto</Label>
            <Select id="provider" value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
              <option value="osm">OpenStreetMap (Overpass)</option>
              <option value="google_places" disabled={!googleConfigured}>Google Places{googleConfigured ? "" : " — requiere configuración"}</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="limit">Límite diario de peticiones a la IA</Label>
            <Input id="limit" type="number" min={0} max={1000} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
            <FieldHint>Cada análisis o propuesta cuenta como una petición (24 h móviles). 0 desactiva la IA.</FieldHint>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Datos del remitente</CardTitle>
            <CardDescription>Se usan solo para redactar los borradores de propuesta. No se envían a ninguna empresa.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="sender-name">Nombre o agencia</Label>
            <Input id="sender-name" maxLength={120} value={senderName} onChange={(e) => setSenderName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="sender-pitch">Descripción de tu oferta</Label>
            <Textarea id="sender-pitch" maxLength={1500} value={senderPitch} onChange={(e) => setSenderPitch(e.target.value)} placeholder="Qué haces, a quién ayudas, cómo trabajas… (sin precios)" />
          </div>
        </CardContent>
      </Card>

      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" loading={pending} disabled={sum !== 100 || services.length === 0}><Save /> Guardar configuración</Button>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={recompute} onChange={(e) => setRecompute(e.target.checked)} /> Recalcular las puntuaciones existentes
        </label>
      </div>
    </form>
  );
}
