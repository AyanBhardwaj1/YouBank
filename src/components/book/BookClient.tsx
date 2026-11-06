"use client";

/**
 * The Book (src/lib/book): a fund's positions, each with a thesis written so it can be proved wrong. Every
 * load checks each kill criterion against the company's SEC filings and price and shows the actual value,
 * its period and a link to the source; the thesis reads intact, on watch or broken, most urgent first. The
 * strip at the top is the book's exposure and how much of it rests on a thesis that is close to breaking.
 * A red team (an agent briefed to argue the other side, with sources) can be run on any position.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Markdown } from "@/components/terminal/Markdown";
import { confirmDialog } from "@/components/ui/Dialog";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { streakOf, type BookHistory, type HistoryPoint } from "@/lib/book/alerts";
import { Sparkline } from "@/components/charts/Sparkline";
import { isPct, METRIC_KEYS, METRICS, TEMPLATES, type BookSummary, type CheckState, type Evaluation, type MetricKey, type Op, type Position, type Verdict } from "@/lib/book/position";

type BookData = { positions: Position[]; evaluations: Evaluation[]; summary: BookSummary; history?: BookHistory };

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  intact: { label: "Intact", cls: "bg-pos/15 text-pos" },
  watch: { label: "On watch", cls: "bg-accent-soft text-accent" },
  broken: { label: "Broken", cls: "bg-neg/15 text-neg" },
  unknown: { label: "No data", cls: "bg-elevated text-muted" },
};
const STATE: Record<CheckState, { label: string; cls: string }> = {
  pass: { label: "holds", cls: "text-pos" },
  near: { label: "close", cls: "text-accent" },
  fail: { label: "failed", cls: "text-neg" },
  unknown: { label: "no data", cls: "text-muted" },
};
const pctOf = (x: number | null, digits = 1) => (x === null ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`);
const navPct = (x: number) => `${x.toFixed(x % 1 ? 1 : 0)}%`;

/* ---------------- The editor ---------------- */

type Draft = {
  id?: string; ticker: string; direction: "long" | "short"; weight: string; entry: string; thesis: string; pillars: string;
  criteria: { metric: MetricKey; op: Op; value: string; note: string }[]; catalysts: { label: string; date: string }[];
};
const emptyDraft = (): Draft => ({ ticker: "", direction: "long", weight: "", entry: "", thesis: "", pillars: "", criteria: [{ metric: "revenue_growth", op: ">=", value: "", note: "" }], catalysts: [] });
const draftOf = (p: Position): Draft => ({
  id: p.id, ticker: p.ticker, direction: p.direction, weight: p.weight?.toString() ?? "", entry: p.entry?.toString() ?? "", thesis: p.thesis, pillars: p.pillars.join("\n"),
  criteria: p.criteria.map((c) => ({ metric: c.metric, op: c.op, value: String(c.value), note: c.note ?? "" })), catalysts: p.catalysts.map((c) => ({ label: c.label, date: c.date })),
});
const unitHint = (m: MetricKey) => (isPct(m) ? "%" : METRICS[m].unit === "usd" ? "$" : METRICS[m].unit === "usdmm" ? "$M" : METRICS[m].unit === "x" ? "x" : "pts");

const field = "ctl w-full border border-line bg-bg px-2 py-1.5 text-[12px] placeholder:text-faint focus:border-accent/60 focus:outline-none";

function Editor({ initial, onSaved, onCancel }: { initial: Draft; onSaved: () => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true); setErr("");
    try {
      await fetchJson("/api/book", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...d, weight: d.weight || null, entry: d.entry || null, pillars: d.pillars.split("\n"),
          criteria: d.criteria.filter((c) => c.value.trim()).map((c) => ({ ...c, value: Number(c.value) })),
          catalysts: d.catalysts.filter((c) => c.label.trim() && c.date),
        }),
      });
      onSaved();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <section className="panel space-y-3 p-4" aria-label={d.id ? "Edit position" : "New position"}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-semibold">{d.id ? `Edit ${d.ticker}` : "New position"}</h2>
        {!d.id && (
          <div className="ml-auto flex flex-wrap gap-1 text-[11px]">
            <span className="text-muted">Start from:</span>
            {TEMPLATES.map((t) => (
              <button key={t.id} type="button" className="ctl border border-line px-2 py-0.5 text-muted hover:text-fg"
                onClick={() => setD((x) => ({ ...x, direction: t.direction, thesis: x.thesis || t.thesis, criteria: t.criteria.map((c) => ({ metric: c.metric, op: c.op, value: String(c.value), note: "" })) }))}>{t.label}</button>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-[11px] text-muted">Ticker<input className={field} value={d.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} placeholder="SNOW" disabled={!!d.id} /></label>
        <label className="text-[11px] text-muted">Side
          <select className={field} value={d.direction} onChange={(e) => set("direction", e.target.value as Draft["direction"])}><option value="long">Long</option><option value="short">Short</option></select>
        </label>
        <label className="text-[11px] text-muted">Weight (% of NAV)<input className={field} inputMode="decimal" value={d.weight} onChange={(e) => set("weight", e.target.value)} placeholder="4.5" /></label>
        <label className="text-[11px] text-muted">Entry price ($)<input className={field} inputMode="decimal" value={d.entry} onChange={(e) => set("entry", e.target.value)} placeholder="150" /></label>
      </div>
      <label className="block text-[11px] text-muted">Thesis, in one line<input className={field} value={d.thesis} maxLength={280} onChange={(e) => set("thesis", e.target.value)} placeholder="Consumption growth re-accelerates as AI workloads land." /></label>
      <label className="block text-[11px] text-muted">Pillars: why it works, one per line<textarea className={`${field} min-h-[64px]`} value={d.pillars} onChange={(e) => set("pillars", e.target.value)} placeholder={"AI data workloads move to the platform\nNet retention bottoms this year"} /></label>
      <div>
        <div className="mb-1 flex items-baseline justify-between"><h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Kill criteria</h3><span className="text-[10.5px] text-faint">Checked against SEC filings and the price on every load</span></div>
        <div className="space-y-1.5">
          {d.criteria.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <select aria-label="Metric" className={`${field} w-auto flex-1`} value={c.metric} onChange={(e) => set("criteria", d.criteria.map((x, j) => (j === i ? { ...x, metric: e.target.value as MetricKey } : x)))}>
                {METRIC_KEYS.map((m) => <option key={m} value={m}>{METRICS[m].label}</option>)}
              </select>
              <select aria-label="Condition" className={`${field} w-auto`} value={c.op} onChange={(e) => set("criteria", d.criteria.map((x, j) => (j === i ? { ...x, op: e.target.value as Op } : x)))}>
                <option value=">=">at least</option><option value="<=">at most</option>
              </select>
              <input aria-label="Threshold" className={`${field} w-24`} inputMode="decimal" value={c.value} onChange={(e) => set("criteria", d.criteria.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder={unitHint(c.metric)} />
              <span className="w-6 text-[11px] text-muted">{unitHint(c.metric)}</span>
              <button type="button" aria-label="Remove criterion" className="text-muted hover:text-neg" onClick={() => set("criteria", d.criteria.filter((_, j) => j !== i))}><Icon name="X" className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          {d.criteria.length < 8 && <button type="button" className="text-[11.5px] text-accent" onClick={() => set("criteria", [...d.criteria, { metric: "gross_margin", op: ">=", value: "", note: "" }])}>+ Add a kill criterion</button>}
        </div>
      </div>
      <div>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Catalysts</h3>
        <div className="space-y-1.5">
          {d.catalysts.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input aria-label="Catalyst" className={`${field} flex-1`} value={c.label} onChange={(e) => set("catalysts", d.catalysts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Q3 earnings" />
              <input aria-label="Date" type="date" className={`${field} w-40`} value={c.date} onChange={(e) => set("catalysts", d.catalysts.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
              <button type="button" aria-label="Remove catalyst" className="text-muted hover:text-neg" onClick={() => set("catalysts", d.catalysts.filter((_, j) => j !== i))}><Icon name="X" className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          {d.catalysts.length < 8 && <button type="button" className="text-[11.5px] text-accent" onClick={() => set("catalysts", [...d.catalysts, { label: "", date: "" }])}>+ Add a catalyst</button>}
        </div>
      </div>
      {err && <p role="alert" className="text-[12px] text-neg">{err}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !d.ticker.trim() || !d.thesis.trim()} onClick={save} className="ctl bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-50">{busy ? "Saving…" : "Save position"}</button>
        <button type="button" onClick={onCancel} className="ctl px-3 py-1.5 text-[12px] text-muted hover:text-fg">Cancel</button>
      </div>
    </section>
  );
}

/* ---------------- A position ---------------- */

function PositionCard({ ev, position, history = [], focused, onEdit, onChanged }: { ev: Evaluation; position: Position | undefined; history?: HistoryPoint[]; focused?: boolean; onEdit: () => void; onChanged: () => void }) {
  const [open, setOpen] = useState(ev.verdict === "broken" || !!focused);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [focused]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const v = VERDICT[ev.verdict];
  const redTeam = async () => {
    setBusy("red"); setErr("");
    try { await fetchJson("/api/book/redteam", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: ev.positionId }) }); onChanged(); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(""); }
  };
  const close = async () => {
    if (!(await confirmDialog({ title: `Close ${ev.ticker}?`, body: "It leaves the book with its kill criteria and red team. Nothing is traded.", confirmLabel: "Close position", tone: "danger" }))) return;
    setBusy("del"); setErr("");
    try { await fetchJson(`/api/book?id=${encodeURIComponent(ev.positionId)}`, { method: "DELETE" }); onChanged(); }
    catch (e) { setErr(errorMessage(e)); setBusy(""); }
  };
  return (
    <li ref={ref} className={`panel scroll-mt-20 ${focused ? "ring-1 ring-accent/60" : ""}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-3 text-left">
        <span className="num w-16 text-[13px] font-semibold">{ev.ticker}</span>
        <span className={`ctl px-1.5 py-0.5 text-[10.5px] font-semibold uppercase ${ev.direction === "long" ? "bg-pos/10 text-pos" : "bg-neg/10 text-neg"}`}>{ev.direction}</span>
        <span className={`ctl px-1.5 py-0.5 text-[10.5px] font-semibold ${v.cls}`}>{v.label}</span>
        <span className="order-last w-full text-[12px] text-muted sm:order-none sm:w-auto sm:min-w-0 sm:flex-1 sm:truncate">{ev.summary}</span>
        <span className="num text-[11.5px] text-muted" title="Weight, % of NAV">{ev.weight !== null ? navPct(ev.weight) : "—"}</span>
        <span className="num w-20 text-right text-[11.5px]">{ev.price !== null ? `$${ev.price.toFixed(2)}` : "—"}</span>
        <span className={`num w-16 text-right text-[11.5px] ${ev.pnl === null ? "text-muted" : ev.pnl >= 0 ? "text-pos" : "text-neg"}`} title="Since entry, in the position's favour">{pctOf(ev.pnl)}</span>
        <span className="num w-10 text-right text-[11px] text-muted" title="Share of kill criteria holding with room">{ev.score ?? "—"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line p-3 text-[12px]">
          <div>
            <div className="text-[11px] text-muted">{ev.name}</div>
            <p className="mt-0.5 text-[13px]">{position?.thesis}</p>
            {(() => {
              const st = streakOf(history, new Date());
              const scores = history.map((h) => h.s).filter((x): x is number => x !== null);
              if (!st) return null;
              const word = st.verdict === "intact" ? "Intact" : st.verdict === "watch" ? "On watch" : "Broken";
              return (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                  <span>{st.days === 0 ? `${word} since today` : `${word} for ${st.days} day${st.days === 1 ? "" : "s"} (since ${st.since})`} · {history.length} daily check{history.length === 1 ? "" : "s"}</span>
                  {scores.length > 1 && <Sparkline values={scores} width={96} height={18} stroke={st.verdict === "broken" ? "var(--neg)" : st.verdict === "watch" ? "var(--accent)" : "var(--pos)"} />}
                </div>
              );
            })()}
            {!!position?.pillars.length && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">{position.pillars.map((p) => <li key={p}>{p}</li>)}</ul>}
          </div>
          {ev.checks.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted"><th className="py-1 font-medium">Kill criterion</th><th className="font-medium">Now</th><th className="font-medium">Needs</th><th className="font-medium">State</th><th className="hidden font-medium sm:table-cell">Evidence</th></tr></thead>
                <tbody>
                  {ev.checks.map((c) => (
                    <tr key={c.criterion.id} className="border-t border-line/60">
                      <td className="py-1 pr-2">{c.label}</td>
                      <td className="num pr-2">{c.evidence ? <a href={c.evidence.url} target="_blank" rel="noreferrer" title={`${c.evidence.source}, ${c.evidence.period}`} className="underline decoration-dotted underline-offset-2 sm:no-underline">{c.shown}</a> : c.shown}</td>
                      <td className="pr-2 text-muted">{c.target}</td>
                      <td className={`pr-2 font-semibold ${STATE[c.state].cls}`}>{STATE[c.state].label}</td>
                      <td className="hidden text-muted sm:table-cell">{c.evidence ? <a href={c.evidence.url} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">{c.evidence.source}, {c.evidence.period}</a> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(ev.catalysts.length > 0 || ev.news.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {ev.catalysts.length > 0 && (
                <div>
                  <h3 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Catalysts</h3>
                  <ul className="space-y-0.5">{ev.catalysts.map((c) => <li key={c.id} className="flex justify-between gap-2"><span>{c.label}</span><span className="num text-muted">{c.date} · {c.inDays < 0 ? `${-c.inDays}d ago` : c.inDays === 0 ? "today" : `in ${c.inDays}d`}</span></li>)}</ul>
                </div>
              )}
              {ev.news.length > 0 && (
                <div>
                  <h3 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">This week in the Newsroom</h3>
                  <ul className="space-y-0.5">{ev.news.map((n) => <li key={n.id} className="truncate"><Link href={`/app/news?story=${n.id}`} className="hover:underline">{n.headline}</Link></li>)}</ul>
                </div>
              )}
            </div>
          )}
          <div className="rounded-md border border-line p-2.5">
            <div className="mb-1 flex items-center gap-2">
              <Icon name="Shield" className="h-3.5 w-3.5 text-accent" />
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Red team</h3>
              {position?.redTeam && <span className="text-[10.5px] text-faint">{new Date(position.redTeam.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>}
              <button type="button" disabled={!!busy} onClick={redTeam} className="ml-auto ctl border border-line px-2 py-0.5 text-[11px] text-muted hover:text-fg disabled:opacity-50">{busy === "red" ? "Arguing the other side… (about a minute)" : position?.redTeam ? "Run again" : "Argue the other side"}</button>
            </div>
            {position?.redTeam
              ? <div className="prose-sm text-[12px] leading-relaxed"><Markdown text={position.redTeam.text} sources={position.redTeam.sources} /></div>
              : <p className="text-[11.5px] text-muted">An agent briefed as a {ev.direction === "long" ? "short seller" : "bull"} makes the strongest sourced case against this thesis, names its weakest pillar, and lists the signals that would prove it wrong. It works alone, so it argues rather than agrees.</p>}
          </div>
          {err && <p role="alert" className="text-neg">{err}</p>}
          <div className="flex flex-wrap gap-3 text-[11.5px]">
            <button type="button" onClick={onEdit} className="text-accent">Edit</button>
            <Link href={`/app/terminal?ticker=${encodeURIComponent(ev.ticker)}`} className="text-muted hover:text-fg">Open in Terminal</Link>
            <Link href={`/app/edge?view=theses`} className="text-muted hover:text-fg">Investigate with an agent (Edge theses)</Link>
            <button type="button" disabled={!!busy} onClick={close} className="ml-auto text-muted hover:text-neg">Close position</button>
          </div>
        </div>
      )}
    </li>
  );
}

/* ---------------- Getting a book in ---------------- */

type ImportRes = { added: Position[]; skipped: string[]; problems: string[] };

function Importer({ onDone, onCancel }: { onDone: (r: ImportRes) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [template, setTemplate] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async () => {
    setBusy(true); setErr("");
    try { onDone(await fetchJson<ImportRes>("/api/book/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, template }) })); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <section className="panel space-y-2.5 p-4" aria-label="Import positions">
      <h2 className="text-[13px] font-semibold">Paste your positions</h2>
      <p className="text-[12px] text-muted">Copy rows from a spreadsheet or your OMS: a ticker, long or short, the weight (% of NAV), the entry price and a thesis, in any order. A header row is fine. Tickers already in the book are kept as they are.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Positions" spellCheck={false} placeholder={"NVDA\tLong\t6%\t$118\tData-centre demand stays ahead of supply\nINTC\tShort\t3%\t$31\tFoundry capex burns cash"} className={`${field} num min-h-[120px]`} />
      <label className="flex flex-wrap items-center gap-2 text-[12px] text-muted">Kill criteria to start with
        <select value={template} onChange={(e) => setTemplate(e.target.value)} className={`${field} w-auto`}>
          <option value="auto">Suggested: growth for longs, deteriorating for shorts</option>
          {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          <option value="none">None: I will write them</option>
        </select>
      </label>
      {err && <p role="alert" className="text-[12px] text-neg">{err}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !text.trim()} onClick={go} className="ctl bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-50">{busy ? "Importing…" : "Import"}</button>
        <button type="button" onClick={onCancel} className="ctl px-3 py-1.5 text-[12px] text-muted hover:text-fg">Cancel</button>
      </div>
    </section>
  );
}

/* ---------------- The page ---------------- */

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div title={hint} className="min-w-[96px]">
      <div className="text-[10.5px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`num text-[16px] font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export function BookClient({ focus }: { focus?: string }) {
  const [data, setData] = useState<BookData | null>(null);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<ImportRes | null>(null);
  const [sampling, setSampling] = useState(false);
  const load = useCallback(() => {
    fetchJson<BookData>("/api/book").then((d) => { setData(d); setErr(""); }).catch((e) => setErr(errorMessage(e)));
  }, []);
  useEffect(() => { load(); }, [load]);
  const sample = async () => {
    setSampling(true); setErr("");
    try { setNote(await fetchJson<ImportRes>("/api/book/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sample: true }) })); load(); }
    catch (e) { setErr(errorMessage(e)); } finally { setSampling(false); }
  };
  const byId = useMemo(() => new Map((data?.positions ?? []).map((p) => [p.id, p])), [data]);
  const s = data?.summary;
  return (
    <div className="scroll-touch h-full overflow-auto">
    <div data-book-top className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px] font-semibold">The Book</h1>
          <p className="text-[12.5px] text-muted">Every position with a thesis that can be proved wrong. Each kill criterion is checked against SEC filings and the market on every load, with the figure, its period and a link to the source.</p>
        </div>
        <div className="flex gap-2">
          {!!data?.evaluations.length && <Link href="/report/book" className="ctl flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12px] text-muted hover:text-fg"><Icon name="FileText" className="h-3.5 w-3.5" />Report</Link>}
          <button type="button" onClick={() => { setImporting((v) => !v); setEditing(null); }} className="ctl flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12px] text-muted hover:text-fg"><Icon name="Upload" className="h-3.5 w-3.5" />Import</button>
          <button type="button" onClick={() => { setEditing(emptyDraft()); setImporting(false); }} className="ctl flex items-center gap-1.5 bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg"><Icon name="Plus" className="h-3.5 w-3.5" />Add a position</button>
        </div>
      </header>

      {importing && <Importer onCancel={() => setImporting(false)} onDone={(r) => { setImporting(false); setNote(r); load(); }} />}
      {note && (
        <div role="status" className="panel flex flex-wrap items-start gap-2 p-3 text-[12px]">
          <span className="min-w-0 flex-1">
            Added {note.added.length} position{note.added.length === 1 ? "" : "s"}{note.added.length ? `: ${note.added.map((p) => p.ticker).join(", ")}` : ""}.
            {[...note.skipped, ...note.problems].length > 0 && <span className="text-muted"> {[...note.skipped, ...note.problems].join(" · ")}</span>}
          </span>
          <button type="button" aria-label="Dismiss" onClick={() => setNote(null)} className="text-muted hover:text-fg"><Icon name="X" className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {editing && <Editor key={editing.id ?? "new"} initial={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

      {err && <div role="alert" className="panel p-3 text-[12px] text-neg">{err} <button type="button" onClick={load} className="ml-2 text-accent">Try again</button></div>}
      {!data && !err && <div className="shimmer h-40 ctl" />}

      {s && s.positions > 0 && (
        <section aria-label="Exposure" className="panel flex flex-wrap gap-x-6 gap-y-3 p-4">
          <Stat label="Positions" value={String(s.positions)} />
          <Stat label="Gross" value={navPct(s.gross)} hint="Long plus short weight, % of NAV" />
          <Stat label="Net" value={navPct(s.net)} hint="Long minus short weight, % of NAV" />
          <Stat label="Long / short" value={`${navPct(s.long)} / ${navPct(s.short)}`} />
          <Stat label="At risk" value={navPct(s.atRiskWeight)} tone={s.atRiskWeight > 0 ? "text-neg" : ""} hint="Weight in positions whose thesis is broken or on watch" />
          <Stat label="P&L since entry" value={s.pnlContribution === null ? "n/a" : `${s.pnlContribution >= 0 ? "+" : ""}${s.pnlContribution.toFixed(2)}% NAV`} tone={s.pnlContribution === null ? "" : s.pnlContribution >= 0 ? "text-pos" : "text-neg"} hint="Weight times return since entry, over positions with both" />
          <div className="ml-auto flex items-end gap-1.5">
            {(Object.keys(VERDICT) as Verdict[]).filter((k) => s.verdicts[k]).map((k) => <span key={k} className={`ctl px-2 py-1 text-[11px] font-semibold ${VERDICT[k].cls}`}>{s.verdicts[k]} {VERDICT[k].label.toLowerCase()}</span>)}
          </div>
        </section>
      )}

      {data && data.evaluations.length === 0 && !editing && !importing && (
        <section className="panel p-6 text-center">
          <Icon name="Briefcase" className="mx-auto h-6 w-6 text-accent" />
          <h2 className="mt-2 text-[14px] font-semibold">Put your book in, and YouBank watches every thesis</h2>
          <p className="mx-auto mt-1 max-w-xl text-[12.5px] text-muted">Write each position&apos;s thesis with the numbers that would prove it wrong: growth at least 20%, gross margin at least 70%, a price stop. YouBank checks them against the company&apos;s filings and price, flags the ones close to breaking, and can run a red team that argues the other side with sources.</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => setEditing(emptyDraft())} className="ctl bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg">Add your first position</button>
            <button type="button" onClick={() => setImporting(true)} className="ctl border border-line px-3 py-1.5 text-[12px] text-muted hover:text-fg">Paste from a spreadsheet</button>
            <button type="button" disabled={sampling} onClick={sample} className="ctl border border-line px-3 py-1.5 text-[12px] text-muted hover:text-fg disabled:opacity-50">{sampling ? "Loading…" : "Try a sample book"}</button>
          </div>
          <p className="mt-2 text-[11px] text-faint">The sample book holds five well-known names with illustrative weights. Close any position to remove it.</p>
        </section>
      )}

      {data && data.evaluations.length > 0 && (
        <ul className="space-y-2">
          {data.evaluations.map((ev) => {
            const p = byId.get(ev.positionId);
            return <PositionCard key={ev.positionId} ev={ev} position={p} history={data.history?.[ev.positionId]} focused={ev.positionId === focus} onChanged={load} onEdit={() => { if (p) { setEditing(draftOf(p)); document.querySelector("[data-book-top]")?.scrollIntoView({ behavior: "smooth" }); } }} />;
          })}
        </ul>
      )}
      <p className="text-[11px] text-faint">Nothing here places trades. Filings refresh every six hours, prices on every load. Percentages are entered as percent (20 means 20%).</p>
    </div>
    </div>
  );
}
