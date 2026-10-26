"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type TrendPoint = { day: string; value: number };

const fmt = (d: string) =>
  new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(new Date(`${d}T00:00:00`));

/** Rellena con ceros los días sin actividad de los últimos `days` días. */
function fillDays(points: TrendPoint[], days: number): TrendPoint[] {
  const map = new Map(points.map((p) => [p.day, p.value]));
  const out: TrendPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ day: key, value: map.get(key) ?? 0 });
  }
  return out;
}

export function TrendChart({ points, days = 30, seriesLabel }: { points: TrendPoint[]; days?: number; seriesLabel: string }) {
  const [table, setTable] = useState(false);
  const data = fillDays(points, days);
  const total = data.reduce((s, p) => s + p.value, 0);

  if (total === 0) {
    return <p className="py-8 text-center text-[13px] text-muted">Aún no hay análisis completados en los últimos {days} días.</p>;
  }
  return (
    <div>
      {table ? (
        <div className="max-h-56 overflow-auto rounded-md border">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
              <tr><th className="px-3 py-1.5 font-medium">Día</th><th className="px-3 py-1.5 text-right font-medium">{seriesLabel}</th></tr>
            </thead>
            <tbody>
              {data.filter((p) => p.value > 0).map((p) => (
                <tr key={p.day} className="border-t"><td className="px-3 py-1.5">{fmt(p.day)}</td><td className="px-3 py-1.5 text-right tabular-nums">{p.value}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-52" role="img" aria-label={`${seriesLabel}: ${total} en los últimos ${days} días`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="day" tickFormatter={fmt} tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} minTickGap={32} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as TrendPoint | undefined;
                  if (!active || !p) return null;
                  return (
                    <div className="rounded-lg border bg-background px-3 py-2 text-[13px] shadow-md">
                      <p className="text-xs text-muted">{fmt(p.day)}</p>
                      <p className="font-medium tabular-nums">{p.value} {seriesLabel.toLowerCase()}</p>
                    </div>
                  );
                }}
              />
              <Area type="monotone" isAnimationActive={false} dataKey="value" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.12} activeDot={{ r: 4, stroke: "var(--background)", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <button onClick={() => setTable((t) => !t)} className="mt-2 text-xs text-muted underline-offset-2 hover:text-foreground hover:underline">
        {table ? "Ver gráfico" : "Ver como tabla"}
      </button>
    </div>
  );
}
