import type { ReactNode } from "react";

export type Source = { id: string; label: string; url: string };

/** Minimal markdown renderer for AI answers: headings, lists, tables, code, bold/italic/code, links, and [S1] citations. `inline` renders a single line without block wrappers. */
export function Markdown({ text, sources, inline: inlineOnly = false }: { text: string; sources: Source[]; inline?: boolean }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let i = 0, key = 0;
  const srcMap = new Map(sources.map((s) => [s.id, s]));

  const inline = (s: string): ReactNode[] => {
    const parts: ReactNode[] = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\[S\d+\]|\[[^\]]+\]\((https?:[^)]+)\)|\*[^*]+\*)/g;
    let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith("**")) parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
      else if (tok.startsWith("`")) parts.push(<code key={key++} className="rounded bg-elevated px-1 text-[11px]">{tok.slice(1, -1)}</code>);
      else if (/^\[S\d+\]$/.test(tok)) {
        const id = tok.slice(1, -1); const src = srcMap.get(id);
        parts.push(src ? <a key={key++} href={src.url} target="_blank" rel="noreferrer" title={src.label} className="num mx-0.5 rounded bg-accent-soft px-1 text-[10px] text-accent hover:underline">{id}</a>
          : <span key={key++} className="num mx-0.5 rounded bg-elevated px-1 text-[10px] text-muted">{id}</span>);
      } else if (tok.startsWith("[")) {
        const t = tok.slice(1, tok.indexOf("]")); const url = m[2];
        parts.push(<a key={key++} href={url} target="_blank" rel="noreferrer" className="text-info hover:underline">{t}</a>);
      } else parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
      last = m.index + tok.length;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts;
  };

  if (inlineOnly) return <>{inline(text)}</>;

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const buf: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(<pre key={key++} className="my-1.5 overflow-auto rounded border border-line bg-bg p-2 text-[11px]">{buf.join("\n")}</pre>);
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const header = line.split("|").slice(1, -1).map((s) => s.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++].split("|").slice(1, -1).map((s) => s.trim()));
      out.push(
        <table key={key++} className="my-1.5 w-full text-[11px]">
          <thead><tr className="border-b border-line text-[10px] uppercase tracking-wider text-muted">{header.map((h, j) => <th key={j} className={`py-0.5 font-normal ${j ? "pr-2 text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri} className="border-b border-line/40">{r.map((c, j) => <td key={j} className={`py-0.5 ${j ? "pr-2 text-right" : "text-left"}`}>{inline(c)}</td>)}</tr>)}</tbody>
        </table>,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)/.exec(line);
    if (h) { out.push(<div key={key++} className={`mt-2 font-semibold ${h[1].length <= 2 ? "text-[12.5px]" : "text-[12px]"}`}>{inline(h[2])}</div>); i++; continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = []; const ordered = /^\s*\d+\./.test(line);
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      out.push(ordered ? <ol key={key++} className="my-1 list-decimal space-y-0.5 pl-5">{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol>
        : <ul key={key++} className="my-1 list-disc space-y-0.5 pl-5">{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>);
      continue;
    }
    if (line.trim() === "") { i++; continue; }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,4}\s|\s*([-*]|\d+\.)\s|```|\s*\|)/.test(lines[i])) buf.push(lines[i++]);
    out.push(<p key={key++} className="my-1 leading-relaxed">{inline(buf.join(" "))}</p>);
  }
  return <div className="text-[12px]">{out}</div>;
}
