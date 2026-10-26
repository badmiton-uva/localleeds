/** Escapa una celda CSV y neutraliza inyección de fórmulas en hojas de cálculo. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(","));
  // BOM para que Excel abra correctamente los acentos.
  return `﻿${lines.join("\r\n")}\r\n`;
}
