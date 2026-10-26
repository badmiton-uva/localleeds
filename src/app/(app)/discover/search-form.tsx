"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select } from "@/components/ui/form";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { COUNTRIES, SECTORS } from "@/lib/domain";

type ProviderOption = { key: "osm" | "google_places"; name: string; configured: boolean };

export function SearchForm({
  providers,
  defaultProvider,
  initial,
}: {
  providers: ProviderOption[];
  defaultProvider: "osm" | "google_places";
  initial?: { city?: string; region?: string; sectorKey?: string; keywords?: string; maxResults?: number };
}) {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [provider, setProvider] = useState(providers.find((p) => p.key === defaultProvider && p.configured)?.key ?? "osm");

  async function submit(form: HTMLFormElement) {
    const fd = new FormData(form);
    const radius = Number(fd.get("radiusM"));
    const payload = {
      provider,
      country: fd.get("country"),
      region: fd.get("region"),
      city: fd.get("city"),
      sectorKey: fd.get("sectorKey"),
      keywords: fd.get("keywords"),
      radiusM: radius > 0 ? radius : undefined,
      maxResults: Number(fd.get("maxResults")),
    };
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await res.json()) as { searchId?: string; count?: number; newCount?: number; error?: string; retryable?: boolean };
      if (!res.ok || !body.searchId) {
        setError({ message: body.error ?? "No se pudo completar la búsqueda.", retryable: body.retryable ?? res.status >= 500 });
        return;
      }
      toast.success(body.count ? `${body.count} empresas encontradas (${body.newCount} nuevas).` : "La búsqueda terminó sin resultados.");
      router.push(`/discover?search=${body.searchId}`);
      router.refresh();
    } catch {
      setError({ message: "No se pudo contactar con el servidor. Comprueba tu conexión.", retryable: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      id="search-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(e.currentTarget);
      }}
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor="country">País</Label>
          <Select id="country" name="country" defaultValue="ES">
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="region">Provincia o comunidad</Label>
          <Input id="region" name="region" placeholder="Valladolid" defaultValue={initial?.region} />
        </div>
        <div>
          <Label htmlFor="city">Ciudad o municipio</Label>
          <Input id="city" name="city" placeholder="Medina del Campo" required defaultValue={initial?.city} />
        </div>
        <div>
          <Label htmlFor="sectorKey">Sector</Label>
          <Select id="sectorKey" name="sectorKey" defaultValue={initial?.sectorKey ?? ""}>
            <option value="">Cualquiera</option>
            {SECTORS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="keywords">Palabras clave en el nombre</Label>
          <Input id="keywords" name="keywords" placeholder="Opcional: p. ej. «dental», «centro»" defaultValue={initial?.keywords} />
        </div>
        <div>
          <Label htmlFor="radiusM">Radio</Label>
          <Select id="radiusM" name="radiusM" defaultValue="0">
            <option value="0">Municipio completo</option>
            <option value="500">500 m desde el centro</option>
            <option value="1000">1 km</option>
            <option value="2000">2 km</option>
            <option value="5000">5 km</option>
            <option value="10000">10 km</option>
            <option value="25000">25 km</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="maxResults">Máximo de resultados</Label>
          <Select id="maxResults" name="maxResults" defaultValue={String(initial?.maxResults ?? 30)}>
            {[10, 20, 30, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-56">
          <Label htmlFor="provider">Fuente de datos</Label>
          <Select id="provider" value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
            {providers.map((p) => (
              <option key={p.key} value={p.key} disabled={!p.configured}>
                {p.name}{p.configured ? "" : " — requiere configuración"}
              </option>
            ))}
          </Select>
          <FieldHint>
            {provider === "osm"
              ? "Datos abiertos (ODbL). Cobertura variable según la comunidad local."
              : "Datos de Google Maps: se conservan 30 días y generan coste en tu cuenta de Google Cloud."}
          </FieldHint>
        </div>
        <Button type="submit" size="lg" loading={loading}>
          <Search /> Buscar empresas
        </Button>
      </div>

      {loading && <p className="text-[13px] text-muted" role="status">Consultando la fuente de datos… puede tardar hasta un minuto si el servicio está ocupado.</p>}
      {error && (
        <ErrorState
          title="La búsqueda no se completó"
          message={error.message}
          onRetry={error.retryable ? () => document.querySelector<HTMLFormElement>("#search-form")?.requestSubmit() : undefined}
        />
      )}
    </form>
  );
}
