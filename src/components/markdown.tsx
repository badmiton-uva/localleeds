import * as React from "react";

/** Renderizador Markdown mínimo y seguro (sin HTML crudo): títulos, listas, citas, énfasis y enlaces http(s). */
function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|_[^_\n]+_|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const key = `${keyBase}-${i++}`;
    if (t.startsWith("**") || t.startsWith("__")) out.push(<strong key={key}>{inline(t.slice(2, -2), key)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={key} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em]">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const [, label, href] = /^\[([^\]]+)\]\((.+)\)$/.exec(t)!;
      out.push(<a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline">{label}</a>);
    } else out.push(<em key={key}>{inline(t.slice(1, -1), key)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      const level = m[1]!.length;
      const cls = level === 1 ? "mt-1 mb-3 text-2xl font-semibold tracking-tight" : level === 2 ? "mt-7 mb-2 border-b pb-1.5 text-lg font-semibold tracking-tight" : "mt-4 mb-1.5 text-base font-semibold";
      const Tag = (`h${level}`) as "h1" | "h2" | "h3";
      blocks.push(<Tag key={k++} className={cls}>{inline(m[2]!, `h${k}`)}</Tag>);
      i++;
    } else if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={k++} className="my-6" />);
      i++;
    } else if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^>\s?/, ""));
      blocks.push(<blockquote key={k++} className="my-3 border-l-2 border-accent bg-accent-soft/50 px-3 py-2 text-[13px] leading-relaxed">{inline(quote.join(" "), `q${k}`)}</blockquote>);
    } else if (/^\s*([-*])\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*])\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*])\s+/, ""));
      blocks.push(<ul key={k++} className="my-2 list-disc space-y-1 pl-5">{items.map((t, j) => <li key={j}>{inline(t, `l${k}-${j}`)}</li>)}</ul>);
    } else if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push(<ol key={k++} className="my-2 list-decimal space-y-1 pl-5">{items.map((t, j) => <li key={j}>{inline(t, `o${k}-${j}`)}</li>)}</ol>);
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() && !/^(#{1,3}\s|>|\s*[-*]\s|\s*\d+[.)]\s|---+$)/.test(lines[i]!)) para.push(lines[i++]!);
      blocks.push(<p key={k++} className="my-2 leading-relaxed">{inline(para.join(" "), `p${k}`)}</p>);
    }
  }
  return <div className={className ?? "text-sm"}>{blocks}</div>;
}
