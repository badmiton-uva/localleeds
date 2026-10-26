// Prueba real contra Nominatim + Overpass. Solo se ejecuta con LIVE=1 (usa red).
import { describe, expect, it } from "vitest";
import { createOsmProvider } from "@/lib/providers/osm";

describe.skipIf(!process.env.LIVE)("OSM en vivo", () => {
  it("encuentra negocios reales en Medina del Campo", async () => {
    process.env.DATABASE_URL ??= "postgres://unused";
    const provider = createOsmProvider();
    const res = await provider.search({ country: "ES", region: "Valladolid", city: "Medina del Campo", sectorKey: "restaurantes", maxResults: 15 });
    console.log(res.notes, res.companies.slice(0, 5));
    expect(res.companies.length).toBeGreaterThan(0);
    expect(res.companies.every((c) => c.name && c.providerId && c.sourceUrl.startsWith("https://www.openstreetmap.org/"))).toBe(true);
  }, 90_000);
});
