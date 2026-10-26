import { cn } from "@/lib/utils";

export type BarItem = { label: string; value: number; hint?: string; shade?: number };

/**
 * Barras horizontales con etiqueta y valor directos (sin ejes ni leyenda: una sola serie).
 * `shade` (0-1) permite una escala secuencial del mismo tono para datos ordinales.
 */
export function BarList({
  items,
  emptyLabel = "Sin datos todavía",
  formatValue = (v: number) => v.toLocaleString("es-ES"),
  className,
}: {
  items: BarItem[];
  emptyLabel?: string;
  formatValue?: (v: number) => string;
  className?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0 || items.every((i) => i.value === 0)) {
    return <p className="py-8 text-center text-[13px] text-muted">{emptyLabel}</p>;
  }
  return (
    <ul className={cn("space-y-2.5", className)}>
      {items.map((item) => {
        const width = item.value === 0 ? 0 : Math.max(2, (item.value / max) * 100);
        const shade = item.shade ?? 1;
        return (
          <li key={item.label} title={item.hint ?? `${item.label}: ${formatValue(item.value)}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-foreground/85">{item.label}</span>
              <span className="shrink-0 font-medium tabular-nums">{formatValue(item.value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-r-sm rounded-l-sm bg-surface-2">
              <div
                className="h-full rounded-r-[4px] transition-[width] duration-500"
                style={{
                  width: `${width}%`,
                  background: `color-mix(in oklab, var(--series-1) ${Math.round(shade * 100)}%, var(--background))`,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
