"use client";

/**
 * What a block produced, in full: ground changes, a pro-forma, a cited memo (citation chips open their
 * source), a signal, a table (labeled when synthetic), a ranking, a scenario, an answer, or a file.
 */
import { Download, ExternalLink } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { kindOfValue, type Answer, type Companies, type Findings, type Memo, type Places, type ProformaValue, type Ranking, type Scenario, type Signal, type Table } from "@/lib/edge/canvas/values";
import { MiniPreview } from "./ModuleNode";

const fmt = (v: number | null | undefined, dp = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: dp }));

/** Paragraph markdown with **bold**, *italic* and [n] citation chips. */
export function MemoText({ markdown, sources, onCite }: { markdown: string; sources: { n: number; label: string; url?: string }[]; onCite?: (n: number) => void }) {
  const byN = new Map(sources.map((s) => [s.n, s]));
  const inline = (s: string, key: string): ReactNode[] => {
    const out: ReactNode[] = [];
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[\d+\])/g;
    let last = 0, m: RegExpExecArray | null, k = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index));
      const t = m[0];
      if (t.startsWith("**")) out.push(<strong key={`${key}-${k++}`}>{t.slice(2, -2)}</strong>);
      else if (t.startsWith("[")) {
        const n = Number(t.slice(1, -1)), src = byN.get(n);
        out.push(<button key={`${key}-${k++}`} type="button" onClick={() => onCite?.(n)} title={src?.label ?? ""} className="num mx-px rounded bg-accent-soft px-1 align-baseline text-[10px] text-accent hover:underline">{n}</button>);
      } else out.push(<em key={`${key}-${k++}`}>{t.slice(1, -1)}</em>);
      last = m.index + t.length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  };
  return <div className="space-y-2.5 text-[12.5px] leading-relaxed">{markdown.split(/\n{2,}/).map((p, i) => <p key={i}>{inline(p, `p${i}`)}</p>)}</div>;
}

function MemoView({ memo }: { memo: Memo }) {
  return (
    <div>
      <h3 className="text-[14px] font-semibold">{memo.title}</h3>
      <div className="mt-2"><MemoText markdown={memo.markdown} sources={memo.sources} onCite={(n) => document.getElementById(`src-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} /></div>
      <ol className="mt-3 space-y-1 border-t border-line pt-2 text-[11px] text-muted">
        {memo.sources.map((s) => <li key={s.n} id={`src-${s.n}`}><span className="num mr-1 text-accent">[{s.n}]</span>{s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">{s.label}</a> : s.label}</li>)}
      </ol>
    </div>
  );
}

function FindingsView({ v }: { v: Findings }) {
  if (!v.items.length) return <p className="text-[12px] text-muted">{v.note ?? "No ground change."}</p>;
  return (
    <ul className="space-y-2">
      {v.items.map((f) => (
        <li key={f.id} className="rounded-lg border border-line bg-elevated/40 px-2.5 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px] font-medium">{f.title}</span>
            <span className="num shrink-0 text-[10.5px] text-muted">{Math.round(f.confidence * 100)}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted">{[f.site, f.company, f.observedAt?.slice(0, 10), f.hectares ? `${f.hectares} ha` : "", f.verdict ? `foundation models: ${f.verdict}` : ""].filter(Boolean).join(" · ")}</div>
          <p className="mt-1 line-clamp-3 text-[11.5px] text-muted">{f.summary}</p>
        </li>
      ))}
    </ul>
  );
}

function ProformaView({ v }: { v: ProformaValue }) {
  return (
    <div className="space-y-3 text-[12px]">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[["Processing", `${fmt(v.combined.capacityMMcfd)} MMcfd`], ["Share", `${Math.round(v.combined.capacityShare * 100)}%`], ["Pipeline", `${fmt(v.combined.pipelineKm)} km`]].map(([k, x]) => <div key={k} className="rounded-md bg-elevated/60 px-2 py-1.5"><div className="text-[10px] uppercase tracking-wider text-muted">{k}</div><div className="num text-[14px] font-semibold">{x}</div></div>)}
      </div>
      <table className="w-full text-[11.5px]">
        <thead><tr className="text-left text-[10.5px] text-muted"><th className="font-medium">Company</th><th className="text-right font-medium">Plants</th><th className="text-right font-medium">MMcfd</th><th className="text-right font-medium">Pipe km</th></tr></thead>
        <tbody>{v.parties.map((p) => <tr key={p.label} className="border-t border-line"><td className="py-0.5">{p.label}</td><td className="text-right">{p.plants}</td><td className="num text-right">{fmt(p.capacityMMcfd)}</td><td className="num text-right">{fmt(p.pipelineKm)}</td></tr>)}</tbody>
      </table>
      {v.counties.length > 0 && (
        <table className="w-full text-[11.5px]">
          <thead><tr className="text-left text-[10.5px] text-muted"><th className="font-medium">County</th><th className="text-right font-medium">HHI before</th><th className="text-right font-medium">After</th><th className="text-right font-medium">Change</th></tr></thead>
          <tbody>{v.counties.slice(0, 10).map((c) => <tr key={c.name} className="border-t border-line"><td className="py-0.5">{c.name}{c.flag === "high" && <span className="ml-1 text-[10px] text-neg">screens high</span>}</td><td className="num text-right">{fmt(c.hhiBefore)}</td><td className="num text-right">{fmt(c.hhiAfter)}</td><td className="num text-right">{c.delta ? `+${fmt(c.delta)}` : "—"}</td></tr>)}</tbody>
        </table>
      )}
      {v.divestitures.length > 0 && <div className="rounded-lg border border-neg/30 bg-neg/5 px-2.5 py-1.5"><div className="text-[11px] font-medium text-neg">Likely divestitures</div><div className="text-[11px] text-muted">{v.divestitures.map((d) => `${d.plant} (${d.company}, ${fmt(d.capacityMMcfd)} MMcfd, ${d.county})`).join("; ")}</div></div>}
      <p className="text-[10.5px] text-faint">{v.method}</p>
    </div>
  );
}

function TableView({ v }: { v: Table }) {
  return (
    <div>
      {v.synthetic && <div className="mb-1.5 rounded-md border border-accent/40 bg-accent-soft px-2 py-1 text-[11px] text-accent">Synthetic data · {v.synthetic.recipe} · seed {v.synthetic.seed}{v.synthetic.realism !== undefined ? ` · realism ${Math.round(v.synthetic.realism)}` : ""}</div>}
      <div className="overflow-x-auto">
        <table className="min-w-full text-[11px]">
          <thead><tr className="text-left text-[10.5px] text-muted">{v.columns.map((c) => <th key={c.name} className="whitespace-nowrap pr-3 font-medium">{c.name}</th>)}</tr></thead>
          <tbody>{v.rows.slice(0, 25).map((r, i) => <tr key={i} className="border-t border-line">{r.map((x, j) => <td key={j} className="num whitespace-nowrap py-0.5 pr-3">{typeof x === "number" ? fmt(x, 3) : x ?? ""}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {v.rows.length > 25 && <p className="mt-1 text-[10.5px] text-faint">{v.rows.length - 25} more rows in the export</p>}
    </div>
  );
}

function RankingView({ v }: { v: Ranking }) {
  return (
    <div>
      {v.scorecard && <p className="mb-1.5 text-[11px] text-muted">{v.scorecard}</p>}
      <ol className="space-y-1.5">{v.items.map((i, k) => <li key={`${i.name}-${k}`} className="rounded-md bg-elevated/40 px-2 py-1.5"><div className="flex justify-between gap-2 text-[12px]"><span><span className="num mr-1 text-muted">{k + 1}.</span>{i.name}{i.ticker ? <span className="num ml-1 text-muted">{i.ticker}</span> : null}</span><span className="num text-muted">{i.score.toFixed(2)}</span></div>{i.reasons.length > 0 && <div className="mt-0.5 text-[11px] text-muted">{i.reasons.slice(0, 3).join(" · ")}</div>}</li>)}</ol>
    </div>
  );
}

function ScenarioView({ v }: { v: Scenario }) {
  return (
    <div className="space-y-2">
      <div className="rounded-md border border-accent/40 bg-accent-soft px-2 py-1 text-[11px] text-accent">Synthetic · {v.recipe} · seed {v.seed} · {v.paths.toLocaleString("en-US")} paths over {v.horizon} days{v.realism !== undefined ? ` · realism ${Math.round(v.realism)}` : ""}</div>
      <div className="grid grid-cols-2 gap-1.5">{v.stats.map((s) => <div key={s.label} className="rounded-md bg-elevated/60 px-2 py-1"><div className="text-[10px] uppercase tracking-wider text-muted">{s.label}</div><div className="num text-[13px] font-semibold">{s.value}</div></div>)}</div>
      {v.fan?.map((f) => <MiniPreview key={f.label} large preview={{ kind: "chart", synthetic: true, series: [{ label: "p5", values: f.p5 }, { label: "median", values: f.p50 }, { label: "p95", values: f.p95 }] }} />)}
    </div>
  );
}

function AnswerView({ v }: { v: Answer }) {
  if (v.notFound) return <p className="text-[12px] text-muted">The documents do not answer “{v.question}”.</p>;
  return (
    <div>
      <MemoText markdown={v.text} sources={v.citations.map((c) => ({ n: c.n, label: `${c.title}${c.page ? `, p. ${c.page}` : ""}`, url: c.url }))} onCite={(n) => document.getElementById(`cite-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} />
      <ol className="mt-3 space-y-1.5 border-t border-line pt-2">{v.citations.map((c) => <li key={c.n} id={`cite-${c.n}`} className="text-[11px]"><span className="num mr-1 text-accent">[{c.n}]</span><span className="text-muted">{c.title}{c.page ? `, p. ${c.page}` : ""}</span><div className="mt-0.5 border-l-2 border-accent/40 pl-2 text-muted">“{c.quote}”</div></li>)}</ol>
      {v.answerId ? <a href={`/app/edge?view=documents&answer=${v.answerId}`} className="mt-2 inline-block text-[11.5px] text-accent hover:underline">Open the evidence board and sources</a> : null}
    </div>
  );
}

function SignalView({ v }: { v: Signal }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`num text-[28px] font-semibold ${v.triggered ? "text-neg" : ""}`}>{fmt(v.value, 3)}</div>
      <div className="text-[12px]"><div className="font-medium">{v.metric}</div><div className="text-muted">{v.previous !== null && v.previous !== undefined ? `was ${fmt(v.previous, 3)} · ` : ""}{v.triggered ? "crossed its line" : "quiet"}{v.detail ? ` · ${v.detail}` : ""}</div></div>
    </div>
  );
}

/** One value in its own view (what a story section shows). */
export function ValueView({ value }: { value: unknown }) {
  const kind = kindOfValue(value);
  return kind === "memo" ? <MemoView memo={value as Memo} /> : kind === "findings" ? <FindingsView v={value as Findings} /> : kind === "proforma" ? <ProformaView v={value as ProformaValue} />
    : kind === "table" ? <TableView v={value as Table} /> : kind === "ranking" ? <RankingView v={value as Ranking} /> : kind === "scenario" ? <ScenarioView v={value as Scenario} />
    : kind === "answer" ? <AnswerView v={value as Answer} /> : kind === "signal" ? <SignalView v={value as Signal} /> : null;
}

/** Every output of a block, each in its own view. */
export function Outputs({ outputs, downloads }: { outputs: Record<string, unknown>; downloads: { name: string; url: string }[] }) {
  const entries = Object.entries(outputs);
  return (
    <div className="space-y-4">
      {downloads.map((d) => <a key={d.url} href={d.url} className="ctl inline-flex items-center gap-1.5 border border-line px-2.5 py-1.5 text-[12px] hover:border-accent/50"><Download className="h-3.5 w-3.5" />{d.name}</a>)}
      {entries.map(([port, v]) => {
        const kind = kindOfValue(v);
        const body = kind === "memo" ? <MemoView memo={v as Memo} /> : kind === "findings" ? <FindingsView v={v as Findings} /> : kind === "proforma" ? <ProformaView v={v as ProformaValue} />
          : kind === "table" ? <TableView v={v as Table} /> : kind === "ranking" ? <RankingView v={v as Ranking} /> : kind === "scenario" ? <ScenarioView v={v as Scenario} />
          : kind === "answer" ? <AnswerView v={v as Answer} /> : kind === "signal" ? <SignalView v={v as Signal} />
          : kind === "companies" ? <div className="flex flex-wrap gap-1">{(v as Companies).items.map((c) => <span key={c.ticker} className="num rounded bg-elevated px-1.5 py-0.5 text-[11px]">{c.ticker} · {c.name}</span>)}</div>
          : kind === "places" ? <div className="text-[12px]">{(v as Places).items.map((p) => p.name).join(", ")}</div>
          : kind === "file" ? ((v as { url?: string; name?: string }).url ? <a href={(v as { url: string }).url} className="ctl inline-flex items-center gap-1.5 border border-accent/40 bg-accent-soft px-2.5 py-1.5 text-[12px] text-accent hover:underline"><ExternalLink className="h-3.5 w-3.5" />{(v as { url: string }).url.startsWith("/app/studio/") ? "Review in Studio" : "Open the story"}: {(v as { name?: string }).name}</a> : null)
          : <pre className="max-h-60 overflow-auto rounded bg-bg p-2 text-[10.5px]">{JSON.stringify(v, null, 1).slice(0, 4000)}</pre>;
        return body ? <Fragment key={port}>{body}</Fragment> : null;
      })}
      {!entries.length && !downloads.length && <p className="text-[12px] text-muted">No output.</p>}
    </div>
  );
}

export function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-info hover:underline">{children}<ExternalLink className="h-3 w-3" /></a>;
}
