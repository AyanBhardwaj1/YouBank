"use client";

/**
 * A cited answer. The direct answer comes first, then its shape (a table, a timeline), then the
 * evidence board: each claim on the left wired to the passages that support it on the right, with
 * passages that disagree joined in red. Every quote was checked against its passage on the server;
 * the header says how many passed and what was removed. Any citation opens the source viewer.
 */
import { AlertTriangle, Check, Copy, Globe, Languages, Mic, FileText } from "lucide-react";
import { SendToStudio } from "../SendToStudio";
import { useCallback, useEffect, useRef, useState } from "react";
import { clockOf } from "@/lib/edge/docs/text";
import { answerMarkdown, directOf, SOURCE_LABEL, type Cite, type DocAnswer, type ViewTarget } from "./client";

function CiteChip({ n, onClick, onHover }: { n: number; onClick: () => void; onHover?: (on: boolean) => void }) {
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => onHover?.(true)} onMouseLeave={() => onHover?.(false)} onFocus={() => onHover?.(true)} onBlur={() => onHover?.(false)}
      className="num mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-accent/40 bg-accent-soft px-1 align-[1px] text-[10.5px] text-accent hover:bg-accent hover:text-accent-fg">{n}</button>
  );
}

const where = (c: Cite) => [c.section, c.page ? `p. ${c.page}` : "", c.tStart !== undefined ? clockOf(c.tStart) : ""].filter(Boolean).join(" · ");

type Geo = { w: number; h: number; claims: { x: number; y: number }[]; cites: Map<number, { x: number; xr: number; y: number }> };

/** Claims wired to passages. The wires are drawn from measured positions and hidden on narrow screens. */
function EvidenceBoard({ a, open }: { a: DocAnswer; open: (c: Cite) => void }) {
  const board = useRef<HTMLDivElement>(null);
  const claimEls = useRef<(HTMLElement | null)[]>([]);
  const citeEls = useRef(new Map<number, HTMLElement>());
  const [geo, setGeo] = useState<Geo | null>(null);
  const [hover, setHover] = useState<{ claim?: number; cite?: number } | null>(null);
  const byN = new Map(a.citations.map((c) => [c.n, c]));
  const contradicted = new Set(a.contradictions.flatMap((c) => [c.a, c.b]));

  const measure = useCallback(() => {
    const b = board.current;
    if (!b) return;
    const box = b.getBoundingClientRect();
    const claims = claimEls.current.map((el) => { const r = el?.getBoundingClientRect(); return r ? { x: r.right - box.left, y: r.top - box.top + Math.min(r.height / 2, 22) } : { x: 0, y: 0 }; });
    const cites = new Map<number, { x: number; xr: number; y: number }>();
    citeEls.current.forEach((el, n) => { const r = el.getBoundingClientRect(); cites.set(n, { x: r.left - box.left, xr: r.right - box.left, y: r.top - box.top + Math.min(r.height / 2, 22) }); });
    setGeo({ w: box.width, h: box.height, claims, cites });
  }, []);

  useEffect(() => {
    const b = board.current;
    if (!b) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(b);
    return () => ro.disconnect();
  }, [measure, a]);

  const lit = (claim: number, n: number) => !hover || hover.claim === claim || hover.cite === n;
  const citeLit = (n: number) => !hover || hover.cite === n || (hover.claim !== undefined && a.claims[hover.claim]?.cites.includes(n));

  return (
    <div ref={board} className="relative grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-x-16 lg:pr-8">
      {geo && (
        <svg className="pointer-events-none absolute inset-0 hidden lg:block" width={geo.w} height={geo.h} aria-hidden>
          {a.claims.map((c, i) => c.cites.map((n) => {
            const s = geo.claims[i], e = geo.cites.get(n);
            if (!s || !e || !s.x) return null;
            const dx = Math.max(24, (e.x - s.x) / 2);
            const on = lit(i, n);
            return <path key={`${i}-${n}`} d={`M${s.x},${s.y} C${s.x + dx},${s.y} ${e.x - dx},${e.y} ${e.x},${e.y}`} fill="none" stroke={on && hover ? "var(--accent)" : "var(--line-strong)"} strokeWidth={on && hover ? 1.8 : 1.1} opacity={on ? 1 : 0.25} />;
          }))}
          {a.contradictions.map((x, i) => {
            const p = geo.cites.get(x.a), q = geo.cites.get(x.b);
            if (!p || !q) return null;
            const r = Math.max(p.xr, q.xr), bend = 26 + Math.min(60, Math.abs(q.y - p.y) / 6);
            return <path key={`x${i}`} d={`M${p.xr},${p.y} C${r + bend},${p.y} ${r + bend},${q.y} ${q.xr},${q.y}`} fill="none" stroke="var(--neg)" strokeWidth={1.6} strokeDasharray="5 4" />;
          })}
        </svg>
      )}
      <ol className="space-y-2">
        <li className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Claims</li>
        {a.claims.map((c, i) => (
          <li key={i} ref={(el) => { claimEls.current[i] = el; }} onMouseEnter={() => setHover({ claim: i })} onMouseLeave={() => setHover(null)}
            className={`rounded-md border px-2.5 py-2 text-[12.5px] leading-relaxed transition ${c.analysis ? "border-dashed border-line" : "border-line"} ${hover && hover.claim !== i && !(hover.cite !== undefined && c.cites.includes(hover.cite)) ? "opacity-50" : ""} bg-panel`}>
            {c.analysis && <span className="mr-1.5 rounded-full border border-line px-1.5 py-px text-[10px] text-muted">Analysis</span>}
            <span className={c.analysis ? "italic text-muted" : ""}>{c.text}</span>
            {c.cites.map((n) => { const cite = byN.get(n); return cite ? <CiteChip key={n} n={n} onClick={() => open(cite)} onHover={(on) => setHover(on ? { cite: n } : null)} /> : null; })}
          </li>
        ))}
      </ol>
      <ol className="space-y-2">
        <li className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Passages</li>
        {a.citations.map((c) => {
          const Icon = c.source === "web" ? Globe : c.tStart !== undefined ? Mic : FileText;
          return (
            <li key={c.n} ref={(el) => { if (el) citeEls.current.set(c.n, el); else citeEls.current.delete(c.n); }}>
              <button type="button" onClick={() => open(c)} onMouseEnter={() => setHover({ cite: c.n })} onMouseLeave={() => setHover(null)}
                className={`w-full rounded-md border px-2.5 py-2 text-left transition hover:border-accent/60 ${contradicted.has(c.n) ? "border-neg/50" : "border-line"} ${citeLit(c.n) ? "" : "opacity-40"} bg-panel`}>
                <div className="flex items-center gap-1.5 text-[11px] text-muted">
                  <span className="num rounded border border-accent/40 bg-accent-soft px-1 text-[10.5px] text-accent">{c.n}</span>
                  <Icon className="h-3 w-3 shrink-0" />
                  <span className="truncate font-medium text-fg">{c.title}</span>
                </div>
                <div className="mt-0.5 text-[10.5px] text-faint">{[c.source ? SOURCE_LABEL[c.source] ?? c.source : "", where(c)].filter(Boolean).join(" · ")}</div>
                <div className="mt-1 line-clamp-4 text-[12px] leading-relaxed">“{c.quote}”</div>
                {c.translation && <div className="mt-1 flex gap-1 text-[11.5px] text-muted"><Languages className="mt-0.5 h-3 w-3 shrink-0" /><span className="line-clamp-3">{c.translation}</span></div>}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function AnswerView({ a, onCite }: { a: DocAnswer; onCite: (t: ViewTarget) => void }) {
  const [copied, setCopied] = useState(false);
  const open = (c: Cite) => {
    if (c.chunkId) onCite({ chunkId: c.chunkId, quote: c.quote, cite: c });
    else if (c.url) window.open(c.url, "_blank", "noopener,noreferrer");
  };
  const byN = new Map(a.citations.map((c) => [c.n, c]));
  const copy = () => { void navigator.clipboard.writeText(answerMarkdown(a)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }); };
  const checked = a.checked;
  return (
    <article className="panel rise space-y-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold leading-snug">{a.question}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
            <span className={`rounded-full border px-1.5 py-px ${a.mode === "strict" ? "border-accent/40 text-accent" : "border-line"}`}>{a.mode === "strict" ? "Strict" : "Balanced"}</span>
            {checked && checked.quotes > 0 && <span className="flex items-center gap-1"><Check className="h-3 w-3 text-pos" />{checked.verified} of {checked.quotes} quotes found in their passages</span>}
            {checked && checked.dropped > 0 && <span>· {checked.dropped} unsupported claim{checked.dropped === 1 ? "" : "s"} removed</span>}
            {a.scopeDocs !== undefined && <span>· {a.scopeDocs} document{a.scopeDocs === 1 ? "" : "s"} in scope</span>}
            {checked?.recovered ? <span>· {checked.recovered} found on a second reading</span> : null}
          </div>
          {a.method && <p className="mt-1 text-[10.5px] leading-snug text-faint">{a.method}.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!a.notFound && a.answerId ? <SendToStudio title={a.question.slice(0, 120)} source={`answer:${a.answerId}`} items={[{ label: "Answer", value: a }]} /> : null}
          <button type="button" onClick={copy} className="ctl flex items-center gap-1 border border-line px-2 py-1 text-[11px] text-muted hover:text-fg">{copied ? <Check className="h-3 w-3 text-pos" /> : <Copy className="h-3 w-3" />}{copied ? "Copied" : "Copy with sources"}</button>
        </div>
      </header>

      <div className={`rounded-md border-l-2 px-3 py-2 text-[13.5px] leading-relaxed ${a.notFound ? "border-faint bg-elevated/40 text-muted" : "border-accent bg-accent-soft/40"}`}>
        {a.notFound && <span className="mr-1.5 rounded-full border border-line px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wider">Not found</span>}
        {a.notFound ? a.text.replace(/^Not found:\s*/, "") : directOf(a)}
      </div>

      {a.table && a.table.rows.length > 0 && (
        <div className="table-scroll overflow-x-auto rounded-md border border-line">
          <table className="w-full text-[12px]">
            <thead className="bg-elevated/60"><tr>{a.table.columns.map((c) => <th key={c} className="px-2 py-1.5 text-left font-sans font-semibold">{c}</th>)}</tr></thead>
            <tbody>{a.table.rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((v, j) => <td key={j} className="px-2 py-1.5 align-top font-sans">{v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}

      {a.timeline && a.timeline.length > 0 && (
        <ol className="relative ml-2 space-y-3 border-l border-line pl-4">
          {a.timeline.map((t, i) => (
            <li key={i} className="relative text-[12.5px]">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-accent bg-panel" />
              <div className="num text-[11px] text-accent">{t.date}</div>
              <div>{t.event}{t.cites.map((n) => { const c = byN.get(n); return c ? <CiteChip key={n} n={n} onClick={() => open(c)} /> : null; })}</div>
            </li>
          ))}
        </ol>
      )}

      {!a.notFound && a.claims.length > 0 && <EvidenceBoard a={a} open={open} />}

      {a.contradictions.length > 0 && (
        <ul className="space-y-1.5">
          {a.contradictions.map((x, i) => (
            <li key={i} className="flex gap-2 rounded-md border border-neg/40 bg-neg/5 px-2.5 py-2 text-[12px]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neg" />
              <span>Passages <CiteChip n={x.a} onClick={() => { const c = byN.get(x.a); if (c) open(c); }} /> and <CiteChip n={x.b} onClick={() => { const c = byN.get(x.b); if (c) open(c); }} /> disagree: {x.note}</span>
            </li>
          ))}
        </ul>
      )}

      {a.web.length > 0 && (
        <div className="border-t border-line pt-2 text-[11.5px]">
          <div className="mb-1 flex items-center gap-1 text-muted"><Globe className="h-3 w-3" />From the web</div>
          <ul className="space-y-0.5">{a.web.slice(0, 6).map((w) => <li key={w.url}><a href={w.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{w.title || w.url}</a></li>)}</ul>
        </div>
      )}
    </article>
  );
}
