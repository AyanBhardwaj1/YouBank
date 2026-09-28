"use client";

import { useEffect, useState } from "react";
import { FUNCTIONS, isFunctionCode, needsTicker, type Command } from "@/lib/functions";
import type { PortfolioView } from "@/lib/terminal/portfolio";
import type { Filter, Metric, ScreenRow } from "@/lib/terminal/screen";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { BarList, DataTable, fm, fn, fp, Frame, fsp, Heatmap, Hint, Meter, Pill, postTerminal, recordSkill, Section, terminalUrl, Tile, Tiles, tone, useSkills, Why, type Column, type Sources } from "../kit";

type Props = { onRun?: (c: Command) => void; arg?: string; activeTicker: string };

type ScreenAnswer = { year: number; universe: number; metrics: Record<Metric, { label: string; format: "money" | "pct" | "x" }>; parsed?: { filters: Filter[]; sort: { metric: Metric; desc: boolean } | null; unsupported: string[] }; rows: ScreenRow[] };

const EXAMPLES = [
  "Profitable companies growing revenue over 25% with operating margins above 15%",
  "Large companies with revenue above $10B, return on equity above 20% and low debt",
  "Cash-generative small companies: revenue under $1B, operating cash flow margin above 20%",
  "Companies whose revenue fell more than 10% but still earn a net margin above 5%",
];

const fmtMetric = (format: string, v: number | null | undefined) => (v === null || v === undefined ? "—" : format === "money" ? fm(v) : format === "pct" ? fp(v, 1) : `${v.toFixed(2)}x`);
const OPS: Filter["op"][] = [">", ">=", "<", "<="];

/** EQS: screen every US filer on its latest annual figures, in plain English. The filters it ran are shown and editable. */
export function EqsScreen({ onRun, arg }: Props) {
  const [q, setQ] = useState(arg ?? "");
  const [answer, setAnswer] = useState<ScreenAnswer | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<{ metric: Metric; desc: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async (text: string) => {
    if (!text.trim()) return;
    setBusy(true); setError(null);
    const r = await postTerminal<ScreenAnswer>("screen", { q: text });
    setBusy(false);
    if (r.error || !r.data) { setError(r.error ?? "No answer"); return; }
    setAnswer(r.data); setFilters(r.data.parsed?.filters ?? []); setSort(r.data.parsed?.sort ?? null);
  };
  const rerun = async (next: Filter[], nextSort = sort) => {
    setFilters(next); setBusy(true);
    const res = await fetch(terminalUrl("screen", { filters: JSON.stringify(next), sort: nextSort?.metric, dir: nextSort && !nextSort.desc ? "asc" : undefined })).then((x) => x.json()).catch(() => null) as ScreenAnswer | null;
    setBusy(false);
    if (res?.rows) setAnswer((a) => (a ? { ...a, rows: res.rows } : res));
  };

  useEffect(() => {
    if (!arg) return;
    let live = true;
    void postTerminal<ScreenAnswer>("screen", { q: arg }).then((r) => { if (!live) return; if (r.data) { setAnswer(r.data); setFilters(r.data.parsed?.filters ?? []); setSort(r.data.parsed?.sort ?? null); } else setError(r.error ?? "No answer"); });
    return () => { live = false; };
  }, [arg]);

  const metrics = answer?.metrics;
  const shownMetrics = (metrics ? (Object.keys(metrics) as Metric[]) : []).filter((m) => ["revenue", "revenueGrowth", "operatingMargin", "netMargin", "roe", "debtToEquity", "cfoMargin"].includes(m) || filters.some((f) => f.metric === m));
  const cols: Column<ScreenRow>[] = [
    { key: "ticker", label: "Ticker", align: "left", value: (r) => r.ticker, render: (r) => <span className="num font-semibold text-accent">{r.ticker}</span> },
    { key: "name", label: "Company", align: "left", value: (r) => r.name, render: (r) => <span className="block max-w-[200px] truncate" title={r.name}>{r.name}</span> },
    ...shownMetrics.map((m): Column<ScreenRow> => ({ key: m, label: metrics![m].label.replace(" ($mm)", ""), value: (r) => r[m] ?? null, render: (r) => fmtMetric(metrics![m].format, r[m]), className: (r) => (metrics![m].format === "pct" && m.includes("Growth") ? tone(r[m]) : "") })),
  ];

  return (
    <div className="flex h-full flex-col">
      <form className="flex items-center gap-2 border-b border-line px-3 py-2" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <span className="text-accent">✦</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Describe a screen: profitable software companies growing over 20%…" className="min-w-0 flex-1 bg-transparent text-[12px] text-fg placeholder:text-faint focus:outline-none" />
        <button type="submit" disabled={busy || !q.trim()} className="ctl bg-accent px-2.5 py-1 text-[11px] font-semibold text-bg disabled:opacity-40">{busy ? "…" : "Screen"}</button>
      </form>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!answer && !busy && !error && (
          <div className="flex flex-col gap-3">
            <Hint skill="EQS">Ask in plain English. A small model turns the request into filters over every US filer&apos;s latest annual SEC figures (thousands of companies, no data licence needed), and shows the filters so you can check or change them. Industries and valuation multiples are not in the data yet; the screen says when it skipped part of a request.</Hint>
            <div className="text-[10.5px] uppercase tracking-wider text-muted">Try</div>
            <div className="flex flex-wrap gap-1.5">{EXAMPLES.map((e) => <button key={e} type="button" onClick={() => { setQ(e); void ask(e); }} className="rounded-full border border-line px-2.5 py-1 text-left text-[11px] text-fg/90 hover:border-accent/50 hover:text-accent">{e}</button>)}</div>
          </div>
        )}
        {busy && !answer && <div className="flex items-center gap-2 text-[11px] text-muted"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Reading the request and screening every filer…</div>}
        {error && <div className="text-[11px] text-neg">{error}</div>}
        {answer && metrics && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-muted">Filters:</span>
              {filters.map((f, i) => (
                <span key={`${f.metric}-${i}`} className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5">
                  {metrics[f.metric].label}
                  <select value={f.op} onChange={(e) => void rerun(filters.map((x, k) => (k === i ? { ...x, op: e.target.value as Filter["op"] } : x)))} className="bg-transparent text-accent">{OPS.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                  <input type="number" defaultValue={metrics[f.metric].format === "pct" ? +(f.value * 100).toFixed(2) : f.value} onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) void rerun(filters.map((x, k) => (k === i ? { ...x, value: metrics[f.metric].format === "pct" ? v / 100 : v } : x))); }} className="num w-16 bg-transparent text-right text-fg focus:outline-none" />
                  {metrics[f.metric].format === "pct" ? "%" : metrics[f.metric].format === "money" ? "$mm" : ""}
                  <button type="button" onClick={() => void rerun(filters.filter((_, k) => k !== i))} className="text-muted hover:text-neg" aria-label="Remove filter">×</button>
                </span>
              ))}
              {!filters.length && <span className="text-faint">none</span>}
              {answer.parsed?.unsupported.length ? <Pill kind="warn">skipped: {answer.parsed.unsupported.join("; ")}</Pill> : null}
              <span className="ml-auto text-muted">{answer.rows.length}{answer.rows.length >= 100 ? "+" : ""} of {answer.universe.toLocaleString("en-US")} filers · FY{answer.year}</span>
            </div>
            <DataTable rows={answer.rows} rowKey={(r) => r.cik} columns={cols} onRow={(r) => r.ticker && onRun?.({ ticker: r.ticker, fn: "DES", via: "click" })} initialSort={sort ? { key: sort.metric, desc: sort.desc } : undefined} />
            <Why items={[["Universe", "SEC XBRL frames: every filer's reported value for a concept in calendar year " + answer.year + ", joined to tickers. Ratios use the latest annual figures; balance-sheet items are at the year end."], ["Parsing", "A small, cheap model turns your words into the filters shown; it is told to use only these metrics and to list what it could not express."]]} sources={["SEC XBRL frames API"]} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Parse "AAPL 40 MSFT 30, KO 30" or "AAPL MSFT KO" (equal weights). */
function parseHoldings(text: string): { symbol: string; weight: number }[] {
  const tokens = text.toUpperCase().split(/[\s,;]+/).filter(Boolean);
  const out: { symbol: string; weight: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!/^[A-Z^][A-Z0-9.\-^]{0,9}$/.test(tokens[i])) continue;
    const w = Number((tokens[i + 1] ?? "").replace("%", ""));
    if (Number.isFinite(w) && w > 0) { out.push({ symbol: tokens[i], weight: w }); i++; } else out.push({ symbol: tokens[i], weight: 1 });
  }
  return out;
}

/** PORT: the risk of a whole book: volatility, beta, VaR, each holding's share of the risk, correlations and a year of outcomes. */
export function PortScreen({ arg }: Props) {
  const { config } = useWorkspace();
  const [text, setText] = useState(arg || config.watchlist.slice(0, 6).join(" "));
  const [state, setState] = useState<{ data?: PortfolioView; error?: string; planLimited?: boolean; busy: boolean; sources?: Sources } | null>(null);
  const run = async (t: string) => {
    const holdings = parseHoldings(t);
    if (!holdings.length) return;
    setState({ busy: true });
    const r = await postTerminal<PortfolioView>("portfolio", { holdings });
    setState({ busy: false, data: r.data, error: r.error, planLimited: r.planLimited, sources: r.sources });
  };
  useEffect(() => {
    if (!arg) return;
    let live = true;
    void postTerminal<PortfolioView>("portfolio", { holdings: parseHoldings(arg) }).then((r) => { if (live) setState({ busy: false, data: r.data, error: r.error, planLimited: r.planLimited, sources: r.sources }); });
    return () => { live = false; };
  }, [arg]);
  return (
    <div className="flex h-full flex-col">
      <form className="flex items-center gap-2 border-b border-line px-3 py-2" onSubmit={(e) => { e.preventDefault(); void run(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="AAPL 40 MSFT 30 KO 30" className="num min-w-0 flex-1 bg-transparent text-[12px] uppercase text-fg placeholder:normal-case placeholder:text-faint focus:outline-none" />
        <button type="submit" disabled={state?.busy} className="ctl bg-accent px-2.5 py-1 text-[11px] font-semibold text-bg disabled:opacity-40">{state?.busy ? "…" : "Analyze"}</button>
      </form>
      <div className="min-h-0 flex-1 overflow-auto">
        {!state ? (
          <div className="p-3"><Hint skill="PORT">Enter tickers and weights (weights are normalized; leave them out for equal weights). The analysis uses two years of daily prices: how volatile the book is, how much of the risk each holding contributes (rarely its share of the money), how the holdings move together, and a bootstrap of a year of outcomes.</Hint></div>
        ) : (
          <Frame q={{ data: state.data, error: state.error, planLimited: state.planLimited ?? false, loading: state.busy, sources: state.sources }} what="portfolio prices">
            {(d) => (
              <div className="flex flex-col gap-3 p-3">
                <Tiles>
                  <Tile label="Volatility" value={fp(d.stats.vol, 1)} sub={`diversification ${fn(d.stats.diversification)}x`} />
                  <Tile label="Beta" value={fn(d.stats.beta)} sub="to the S&P 500" />
                  <Tile label="1-day VaR 95%" value={fp(d.stats.var95, 2)} sub={`ES ${fp(d.stats.es95, 2)} · 99% ${fp(d.stats.var99, 2)}`} subTone="text-neg" />
                  <Tile label="Max drawdown, 2y" value={fp(d.stats.maxDrawdown, 1)} subTone="text-neg" />
                  <Tile label="Return, 1 year" value={fsp(d.stats.return1y)} subTone={tone(d.stats.return1y)} sub={`Sharpe ${fn(d.stats.sharpe)}`} />
                  <Tile label="Chance of a loss, 1 year" value={fp(d.outcomes.lossProbability, 0)} sub={`median ${fsp(d.outcomes.p50, 0)}`} />
                </Tiles>
                {d.missing.length > 0 && <div className="text-[11px] text-chart-emphasis">Left out (no price history on the current data plan): {d.missing.join(", ")}</div>}
                <div className="grid gap-4 @3xl:grid-cols-2">
                  <Section title="Share of the money vs share of the risk">
                    <DataTable rows={d.holdings} rowKey={(h) => h.symbol} initialSort={{ key: "risk", desc: true }}
                      columns={[
                        { key: "s", label: "Holding", align: "left", value: (h) => h.symbol, render: (h) => <span className="num font-semibold">{h.symbol}</span> },
                        { key: "w", label: "Weight", value: (h) => h.weight, render: (h) => fp(h.weight, 1) },
                        { key: "risk", label: "Risk share", value: (h) => h.riskShare, render: (h) => <span className={h.riskShare > h.weight * 1.3 ? "text-neg" : ""}>{fp(h.riskShare, 1)}</span> },
                        { key: "vol", label: "Vol", value: (h) => h.vol, render: (h) => fp(h.vol, 0) },
                        { key: "b", label: "Beta", value: (h) => h.beta, render: (h) => fn(h.beta) },
                        { key: "r", label: "1Y", value: (h) => h.return1y, render: (h) => fsp(h.return1y, 0), className: (h) => tone(h.return1y) },
                      ]} />
                  </Section>
                  <Section title="Correlation, daily returns"><Heatmap labels={d.correlation.symbols} matrix={d.correlation.matrix} /></Section>
                </div>
                <Section title="One year ahead: 2,000 bootstrapped paths">
                  <BarList format={(v) => fsp(v, 0)} rows={[{ label: "Bad year (5th percentile)", value: d.outcomes.p5 }, { label: "25th percentile", value: d.outcomes.p25 }, { label: "Median", value: d.outcomes.p50 }, { label: "75th percentile", value: d.outcomes.p75 }, { label: "Good year (95th)", value: d.outcomes.p95 }]} />
                </Section>
                <Why items={[["Risk share", "Each holding's weight times its covariance with the portfolio, over the portfolio variance: the contributions add to 100%."], ["Diversification ratio", "Weighted average of the holdings' volatilities over the portfolio's: above 1 means the holdings offset each other."], ["Outcomes", "2,000 one-year paths resampled day by day from the portfolio's own two-year return history, so fat tails and skew are kept; serial dependence is not."]]} sources={["Daily prices: Financial Modeling Prep"]} />
              </div>
            )}
          </Frame>
        )}
      </div>
    </div>
  );
}

type QuizQ = { key: string; question: string; options: string[]; answer: number; explanation: string };

/** LEARN: knowledge tracing made visible: mastery per function, what to learn next, and a quick quiz. */
export function LearnScreen({ onRun, activeTicker }: Props) {
  const s = useSkills();
  const [quiz, setQuiz] = useState<{ q?: QuizQ; picked?: number; busy: boolean; error?: string } | null>(null);
  const ask = async (key: string) => {
    setQuiz({ busy: true });
    const r = await postTerminal<QuizQ>("quiz", { key });
    setQuiz({ busy: false, q: r.data, error: r.error });
  };
  const pick = (i: number) => {
    if (!quiz?.q || quiz.picked !== undefined) return;
    setQuiz({ ...quiz, picked: i });
    recordSkill(quiz.q.key, i === quiz.q.answer, "quiz");
  };
  const open = (key: string) => { if (isFunctionCode(key)) onRun?.({ ticker: needsTicker(key) ? activeTicker : "", fn: key, via: "click" }); };
  if (!s) return <div className="p-3 text-[11px] text-muted">Loading your progress…</div>;
  const mastered = s.skills.filter((k) => k.mastery === "mastered").length;
  const weakest = [...s.skills].filter((k) => k.n > 0 && k.mastery !== "mastered").sort((a, b) => a.p - b.p)[0];
  return (
    <div className="flex flex-col gap-3 p-3">
      <Tiles>
        <Tile label="Mastered" value={`${mastered}/${s.skills.length}`} sub="functions" />
        <Tile label="In progress" value={String(s.skills.filter((k) => k.mastery === "learning" || k.mastery === "practised").length)} />
        <Tile label="Not tried" value={String(s.skills.filter((k) => k.mastery === "new").length)} />
      </Tiles>
      <Hint skill="LEARN">The terminal keeps a running estimate of how well you know each function (Bayesian knowledge tracing): typing a command unaided counts for more than clicking, closing a panel straight away counts against, and knowledge fades without use. Hints shrink as mastery grows, and the suggestions below only unlock once you know what they build on.</Hint>
      <Section title="Next to learn">
        <div className="grid gap-2 @2xl:grid-cols-3">
          {s.next.map((n) => (
            <div key={n.key} className="flex flex-col rounded-md border border-accent/30 bg-accent-soft/30 p-2.5">
              <div className="flex items-baseline justify-between"><span className="num text-[13px] font-semibold text-accent">{n.key}</span><span className="text-[11px] text-muted">{n.label}</span></div>
              <div className="mt-1 flex-1 text-[11px] text-fg/85">{n.why}</div>
              <div className="mt-2 flex gap-1.5"><button type="button" onClick={() => open(n.key)} className="ctl bg-accent px-2 py-0.5 text-[10.5px] font-semibold text-bg">Open {n.key}</button><button type="button" onClick={() => void ask(n.key)} className="ctl border border-line px-2 py-0.5 text-[10.5px] text-muted hover:text-fg">Quiz me</button></div>
            </div>
          ))}
        </div>
      </Section>
      {quiz && (
        <Section title="Quick check">
          {quiz.busy && <div className="text-[11px] text-muted">Writing a question…</div>}
          {quiz.error && <div className="text-[11px] text-neg">{quiz.error}</div>}
          {quiz.q && (
            <div className="rounded-md border border-line p-3">
              <div className="text-[12px] text-fg"><span className="num mr-1.5 text-accent">{quiz.q.key}</span>{quiz.q.question}</div>
              <div className="mt-2 grid gap-1.5 @xl:grid-cols-2">
                {quiz.q.options.map((o, i) => {
                  const shown = quiz.picked !== undefined;
                  const right = i === quiz.q!.answer, chosen = i === quiz.picked;
                  return <button key={o} type="button" onClick={() => pick(i)} disabled={shown} className={`ctl border px-2.5 py-1.5 text-left text-[11.5px] ${shown ? (right ? "border-pos/50 bg-pos/10" : chosen ? "border-neg/50 bg-neg/10" : "border-line opacity-60") : "border-line hover:border-accent/50"}`}>{String.fromCharCode(65 + i)}. {o}</button>;
                })}
              </div>
              {quiz.picked !== undefined && <div className="mt-2 text-[11px] text-muted"><span className={quiz.picked === quiz.q.answer ? "font-semibold text-pos" : "font-semibold text-neg"}>{quiz.picked === quiz.q.answer ? "Right." : "Not quite."}</span> {quiz.q.explanation}</div>}
            </div>
          )}
        </Section>
      )}
      <Section title="Every function" right={weakest ? <button type="button" onClick={() => void ask(weakest.key)} className="text-accent hover:underline">Quiz my weakest ({weakest.key})</button> : undefined}>
        <DataTable rows={s.skills} rowKey={(k) => k.key} initialSort={{ key: "p", desc: true }} onRow={(k) => open(k.key)}
          columns={[
            { key: "key", label: "Function", align: "left", value: (k) => k.key, render: (k) => <span><span className="num font-semibold text-accent">{k.key}</span> <span className="text-muted">{isFunctionCode(k.key) ? FUNCTIONS[k.key].label : k.label}</span></span> },
            { key: "p", label: "Mastery", value: (k) => k.p, render: (k) => <span className="inline-flex w-36 items-center gap-2"><span className="h-1.5 flex-1 rounded-full bg-elevated"><span className={`block h-full rounded-full ${k.p >= 0.95 ? "bg-pos" : k.p >= 0.6 ? "bg-chart-1" : "bg-chart-emphasis"}`} style={{ width: `${Math.max(3, k.p * 100)}%` }} /></span><span className="num w-9 text-right">{fp(k.p, 0)}</span></span> },
            { key: "m", label: "Status", value: (k) => k.mastery, render: (k) => <Pill kind={k.mastery === "mastered" ? "pos" : k.mastery === "new" ? "muted" : "accent"}>{k.mastery}</Pill> },
            { key: "n", label: "Uses", value: (k) => k.n },
            { key: "req", label: "Builds on", value: (k) => (k.requires ?? []).join(" "), render: (k) => <span className="num text-muted">{(k.requires ?? []).join(" ") || "—"}</span> },
          ]} />
      </Section>
      <Meter label="Share of functions mastered" value={mastered / Math.max(1, s.skills.length)} zones={[0.3, 0.7]} invert />
    </div>
  );
}
