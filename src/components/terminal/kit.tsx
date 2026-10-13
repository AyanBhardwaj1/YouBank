"use client";

/**
 * The terminal's analytics kit: a cached data hook for /api/terminal/*, knowledge-tracing state for
 * adaptive hints, formatters, and the SVG charts the analytics screens share (time series with bands,
 * histograms, tornados, heatmaps, signed bars, probability meters). Everything here is dependency-free
 * so each screen stays small when it is lazy-loaded.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Command } from "@/lib/functions";
import type { Researched } from "@/lib/market/research";
import type { Snapshot } from "@/lib/terminal/snapshot";
import { errorMessage, messageFor } from "@/lib/client/errors";

/* ----------------------------------------------------------------------------------------------- */
/* Data                                                                                             */
/* ----------------------------------------------------------------------------------------------- */

/** Where an answer's numbers came from (the data layer's fallbacks), from the x-data-sources header. */
export type Sources = { providers: string[]; notes: string[] };
export type Result<T> = { data?: T; error?: string; planLimited?: boolean; sources?: Sources; snapshot?: Snapshot };
const cache = new Map<string, { at: number; r: Result<unknown> }>();
const inflight = new Map<string, Promise<Result<unknown>>>();
const FRESH_MS = 90_000;

const sourcesOf = (res: Response): Sources | undefined => {
  try { const h = res.headers.get("x-data-sources"); return h ? (JSON.parse(h) as Sources) : undefined; } catch { return undefined; }
};

async function load<T>(url: string): Promise<Result<T>> {
  const existing = inflight.get(url);
  if (existing) return existing as Promise<Result<T>>;
  const p = (async (): Promise<Result<unknown>> => {
    try {
      const res = await fetch(url);
      const j = (await res.json().catch(() => ({}))) as { error?: string; planLimited?: boolean; snapshot?: Snapshot };
      const sources = sourcesOf(res);
      const r: Result<unknown> = res.ok ? { data: j, sources } : { error: messageFor(res.status, j).message, planLimited: !!j.planLimited, sources, snapshot: j.snapshot };
      // Keep answers and plan limits; let transient failures retry on the next open.
      if (res.ok || j.planLimited || res.status === 404 || res.status === 400) cache.set(url, { at: Date.now(), r });
      return r;
    } catch (e) {
      return { error: errorMessage(e) };
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p as Promise<Result<T>>;
}

export const terminalUrl = (fn: string, params: Record<string, string | number | undefined | null> = {}) => {
  const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return `/api/terminal/${fn}${qs ? `?${qs}` : ""}`;
};

/** Warm the cache for a function (hover on a strip button, the next likely panel). */
export function prefetchTerminal(fn: string, params: Record<string, string | number | undefined> = {}) {
  const url = terminalUrl(fn, params);
  const c = cache.get(url);
  if (!c || Date.now() - c.at > FRESH_MS) void load(url);
}

/** Stale-while-revalidate fetch of one analytics function. Cached answers render at once. */
export function useTerminal<T>(fn: string, params: Record<string, string | number | undefined | null> = {}, enabled = true) {
  const url = terminalUrl(fn, params);
  const [state, setState] = useState<{ url: string; r: Result<T> } | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const c = cache.get(url);
    if (c && nonce === 0 && Date.now() - c.at < FRESH_MS) return;
    void load<T>(url).then((r) => { if (live) setState({ url, r }); });
    return () => { live = false; };
  }, [url, enabled, nonce]);
  const r = (state?.url === url ? state.r : (cache.get(url)?.r as Result<T> | undefined));
  return {
    data: r?.data, error: r?.error, planLimited: r?.planLimited ?? false, loading: enabled && !r, sources: r?.sources, snapshot: r?.snapshot,
    reload: () => { cache.delete(url); setNonce((n) => n + 1); },
  };
}

export async function postTerminal<T>(fn: string, body: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(`/api/terminal/${fn}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as { error?: string; planLimited?: boolean };
    return res.ok ? { data: j as T, sources: sourcesOf(res) } : { error: messageFor(res.status, j).message, planLimited: !!j.planLimited, sources: sourcesOf(res) };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

/* ----------------------------------------------------------------------------------------------- */
/* Knowledge tracing (client side): mastery per function, for hints and suggestions                 */
/* ----------------------------------------------------------------------------------------------- */

export type SkillRow = { key: string; label: string; p: number; n: number; mastery: "new" | "learning" | "practised" | "mastered"; hint: "full" | "light" | "none"; why: string; requires?: string[] };
export type SkillsView = { skills: SkillRow[]; next: { key: string; label: string; why: string }[] };

let skills: SkillsView | null = null;
let skillsRequested = false;
const skillListeners = new Set<() => void>();
const setSkills = (v: SkillsView) => { skills = v; skillListeners.forEach((l) => l()); };
const subscribeSkills = (l: () => void) => { skillListeners.add(l); return () => { skillListeners.delete(l); }; };

function requestSkills() {
  if (skillsRequested) return;
  skillsRequested = true;
  void load<SkillsView>(terminalUrl("skills")).then((r) => { if (r.data) setSkills(r.data); else skillsRequested = false; });
}

export function useSkills(): SkillsView | null {
  const v = useSyncExternalStore(subscribeSkills, () => skills, () => null);
  useEffect(() => { requestSkills(); }, []);
  return v;
}

/** Evidence for a function: opened (typed counts more than clicked), abandoned, or a quiz answer. Fire and forget. */
export function recordSkill(key: string, correct: boolean, mode: "typed" | "click" | "quiz") {
  void postTerminal<SkillsView>("skills", { key, correct, mode }).then((r) => { if (r.data) { cache.delete(terminalUrl("skills")); setSkills(r.data); } });
}

/* ----------------------------------------------------------------------------------------------- */
/* Formatting                                                                                       */
/* ----------------------------------------------------------------------------------------------- */

const DASH = "—";
const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
export const fp = (v: number | null | undefined, d = 1) => (ok(v) ? `${(v * 100).toFixed(d)}%` : DASH);
export const fsp = (v: number | null | undefined, d = 1) => (ok(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%` : DASH);
export const fn = (v: number | null | undefined, d = 2) => (ok(v) ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : DASH);
export const fx = (v: number | null | undefined, d = 2) => (ok(v) ? `${v.toFixed(d)}x` : DASH);
export const fbp = (v: number | null | undefined) => (ok(v) ? `${(v * 10_000).toFixed(0)} bp` : DASH);
/** USD millions as $1.2B / $340M. */
export const fm = (v: number | null | undefined) => (!ok(v) ? DASH : Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}T` : Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${v.toFixed(v < 10 ? 1 : 0)}M`);
export const fbig = (v: number | null | undefined) => (!ok(v) ? DASH : Math.abs(v) >= 1e12 ? `${(v / 1e12).toFixed(2)}T` : Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09-25" as "Sep 25" (or "Sep '26" when the span is long). */
export const fdate = (iso: string, long = false) => { const [y, m, d] = iso.split("-"); const mm = MONTHS[Number(m) - 1] ?? m; return long ? `${mm} '${(y ?? "").slice(2)}` : `${mm} ${Number(d) || ""}`.trim(); };
export const tone = (v: number | null | undefined) => (!ok(v) ? "text-faint" : v > 0 ? "text-pos" : v < 0 ? "text-neg" : "text-muted");

/* ----------------------------------------------------------------------------------------------- */
/* Layout                                                                                           */
/* ----------------------------------------------------------------------------------------------- */

type Q<T> = { data?: T; error?: string; planLimited: boolean; loading: boolean; reload?: () => void; sources?: Sources; snapshot?: Snapshot };

/** The providers that count as backups: a screen that used any of them says so. */
const BACKUPS = ["Nasdaq", "ECB", "CoinGecko", "SEC EDGAR", "AI research"];
/** The sources behind the Frame being rendered, so "Models and sources" can name the backups that answered. */
const SourcesContext = createContext<Sources | undefined>(undefined);

/**
 * Loading, errors and plan limits for one query; renders children once the data is in. When the data
 * layer fell back from FMP, a badge says which backups answered, and figures looked up by AI research
 * are listed with their sources. When no feed had the prices a screen needs, a researched snapshot
 * stands in for the error.
 */
export function Frame<T>({ q, what, children }: { q: Q<T>; what: string; children: (data: T) => ReactNode }) {
  if (q.data) {
    const research = (q.data as { research?: Researched | null }).research ?? null;
    return <SourcesContext value={q.sources}><SourceBadge sources={q.sources} />{children(q.data)}{research && <div className="px-3 pb-3"><ResearchNote research={research} /></div>}</SourcesContext>;
  }
  if (q.snapshot) return <SnapshotCard snapshot={q.snapshot} what={what} sources={q.sources} />;
  if (q.loading || (!q.error && !q.data)) {
    return (
      <div className="flex flex-col gap-3 p-3" aria-busy="true">
        <div className="flex items-center gap-2 text-[11px] text-muted"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Loading {what}…</div>
        <div className="grid grid-cols-2 gap-2 @4xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="shimmer h-14 ctl" style={{ animationDelay: `${i * 60}ms` }} />)}</div>
        <div className="shimmer h-40 ctl" />
      </div>
    );
  }
  if (q.planLimited) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="text-[13px] text-fg">Not on the current market-data plan</div>
        <p className="max-w-[460px] text-[11.5px] text-muted">{/daily request limit/.test(q.error ?? "") ? `${q.error} ` : `${what} needs market data that the plan behind this workspace does not include for this ticker. `}SEC-based functions work for every US filer: <span className="num text-accent">FA IRAT QUAL FCST DDIS CAP</span>, and so do the Treasury and economy screens: <span className="num text-accent">GC ECO EQS</span>.</p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <div className="text-[13px] text-neg">Could not load {what}</div>
      <div className="max-w-[460px] text-[11px] text-muted">{q.error}</div>
      {q.reload && <button type="button" onClick={q.reload} className="ctl mt-1 border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-fg">Try again</button>}
    </div>
  );
}

/** "Backup data" when the data layer fell back from FMP: which sources answered, with their notes on hover. */
export function SourceBadge({ sources }: { sources?: Sources }) {
  const backups = (sources?.providers ?? []).filter((p) => BACKUPS.includes(p));
  if (!backups.length) return null;
  const ai = backups.includes("AI research"), partly = sources?.providers.includes("FMP");
  return (
    <div className={`mx-3 mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border px-2.5 py-1 text-[10.5px] ${ai ? "border-chart-emphasis/40 bg-chart-emphasis/10" : "border-info/30 bg-info/10"}`} title={(sources?.notes ?? []).join("\n")}>
      <span className="font-semibold text-fg/90">{ai ? "Backup data, partly researched by AI" : "Backup data"}</span>
      <span className="text-muted">{partly ? "Some of this" : "This"} came from {backups.join(", ")} because FMP was unavailable.</span>
      {sources?.notes?.length ? <span className="text-faint">{sources.notes.slice(0, 2).join(" · ")}{sources.notes.length > 2 ? " …" : ""}</span> : null}
    </div>
  );
}

const FACT_LABEL: Record<string, string> = {
  price: "Price", changePct: "Change today", marketCap: "Market cap", high52: "52-week high", low52: "52-week low", beta: "Beta", rating: "Consensus rating",
  analysts: "Analysts", buy: "Buy ratings", hold: "Hold ratings", sell: "Sell ratings", targetMean: "Consensus target", targetHigh: "High target", targetLow: "Low target",
  nextEarningsDate: "Next earnings", epsEstimate: "EPS estimate, next quarter", revenueEstimate: "Revenue estimate, next quarter", lastEps: "EPS, last quarter",
  lastEpsEstimate: "EPS estimate, last quarter", lastReportDate: "Last report", annualDividend: "Annual dividend", dividendYield: "Dividend yield",
  exDividendDate: "Ex-dividend date", payoutRatio: "Payout ratio", description: "Description", sector: "Sector", industry: "Industry",
};
const PCT_FACTS = new Set(["changePct", "dividendYield", "payoutRatio"]);
const fmtFact = (field: string, v: number | string) => (typeof v !== "number" ? v : PCT_FACTS.has(field) ? fp(v, 2) : field === "marketCap" || field === "revenueEstimate" ? `$${fbig(v)}` : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

/** The figures AI research supplied, each with the page it was read from (the quote on hover). */
export function ResearchNote({ research }: { research: Researched }) {
  const facts = Object.entries(research.facts).filter(([, f]) => f);
  if (!facts.length) return null;
  return (
    <details className="rounded-md border border-chart-emphasis/40 bg-chart-emphasis/5 px-2.5 py-1.5 text-[11px]">
      <summary className="cursor-pointer select-none text-[10.5px] font-semibold text-fg/90">Researched by AI on the web: {facts.length} figure{facts.length === 1 ? "" : "s"}, each checked against its source</summary>
      <div className="table-scroll"><table className="mt-1.5 w-full text-[11px]">
        <tbody>
          {facts.map(([k, f]) => (
            <tr key={k} className="border-b border-line/50 last:border-0 align-top">
              <td className="py-0.5 pr-2 text-muted">{FACT_LABEL[k] ?? k}</td>
              <td className="num py-0.5 pr-2 text-fg">{k === "description" ? <span className="font-sans">{String(f!.value).slice(0, 220)}{String(f!.value).length > 220 ? "…" : ""}</span> : fmtFact(k, f!.value)}</td>
              <td className="num py-0.5 pr-2 text-faint">{f!.asOf ?? ""}</td>
              <td className="py-0.5 text-right"><a href={f!.source} target="_blank" rel="noreferrer" title={f!.quote} className="text-info hover:underline">{hostOf(f!.source)}</a></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {research.rejected.length > 0 && <div className="mt-1 text-[10px] text-faint">Left out: {research.rejected.slice(0, 6).map((r) => `${FACT_LABEL[r.field] ?? r.field} (${r.reason})`).join("; ")}</div>}
      <div className="mt-1 text-[10px] text-faint">{research.model} · {research.searches} search{research.searches === 1 ? "" : "es"} · {research.researchedAt.slice(0, 16).replace("T", " ")} UTC. A backup, not a data feed: check anything you rely on.</div>
    </details>
  );
}

/** When no feed has a company's daily prices: what the feeds and a checked web lookup could confirm. */
export function SnapshotCard({ snapshot: s, what, sources }: { snapshot: Snapshot; what: string; sources?: Sources }) {
  return (
    <div className="flex flex-col gap-3 pb-3">
      <SourceBadge sources={sources} />
      <div className="mx-3 rounded-md border border-line p-3">
        <div className="flex items-baseline gap-2"><span className="text-[13px] font-semibold">{s.name}</span><span className="num text-muted">{s.ticker}</span></div>
        <p className="mt-1 text-[11.5px] text-muted">No feed has the daily prices {what} needs for this ticker right now, so its charts and models cannot run. Here is what the feeds and a web lookup could confirm.</p>
        <div className="mt-2"><Tiles>
          <Tile label="Price" value={s.price !== null ? fn(s.price) : "—"} sub={s.changePct !== null ? `${fsp(s.changePct, 2)} on the day` : undefined} subTone={tone(s.changePct)} />
          <Tile label="52-week range" value={s.low52 !== null && s.high52 !== null ? `${fn(s.low52)}–${fn(s.high52)}` : "—"} />
          <Tile label="Market cap" value={fm(s.marketCap)} />
          <Tile label="Beta (published)" value={s.beta !== null ? fn(s.beta) : "—"} sub="5-year monthly" />
        </Tiles></div>
        {s.description && <p className="mt-2 text-[11.5px] leading-relaxed text-fg/85">{s.description}</p>}
      </div>
      {s.research && <div className="mx-3"><ResearchNote research={s.research} /></div>}
    </div>
  );
}

export function Section({ title, right, children, className = "" }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 ${className}`}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
        {right && <div className="text-[10.5px] text-muted">{right}</div>}
      </div>
      {children}
    </section>
  );
}

export function Tile({ label, value, sub, subTone, title }: { label: string; value: string; sub?: string; subTone?: string; title?: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-between rounded-md border border-line bg-elevated/60 px-2.5 py-2" title={title}>
      <div className="truncate text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="num mt-1 truncate text-[16px] font-semibold leading-none text-fg">{value}</div>
      {sub && <div className={`num mt-1 truncate text-[10.5px] ${subTone ?? "text-muted"}`}>{sub}</div>}
    </div>
  );
}

export const Tiles = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @4xl:grid-cols-6">{children}</div>;

export function Pill({ children, kind = "muted" }: { children: ReactNode; kind?: "pos" | "neg" | "warn" | "muted" | "accent" }) {
  const cls = { pos: "border-pos/40 bg-pos/10 text-pos", neg: "border-neg/40 bg-neg/10 text-neg", warn: "border-chart-emphasis/40 bg-chart-emphasis/10 text-chart-emphasis", muted: "border-line text-muted", accent: "border-accent/40 bg-accent-soft text-accent" }[kind];
  return <span className={`inline-flex items-center rounded-full border px-2 py-px text-[10.5px] ${cls}`}>{children}</span>;
}

/**
 * How to read a screen. Knowledge tracing decides how much to show: the full note for someone new to
 * the function, a collapsed one while they practise, nothing once they have mastered it.
 */
export function Hint({ skill, children }: { skill: string; children: ReactNode }) {
  const s = useSkills();
  const level = s?.skills.find((k) => k.key === skill)?.hint ?? "full";
  if (level === "none") return null;
  if (level === "light") {
    return (
      <details className="text-[11px] text-muted">
        <summary className="cursor-pointer select-none text-[10.5px] text-faint hover:text-muted">How to read this</summary>
        <div className="mt-1 leading-relaxed">{children}</div>
      </details>
    );
  }
  return <div className="rounded-md border border-accent/25 bg-accent-soft/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-fg/85"><span className="mr-1 font-semibold text-accent">How to read this.</span>{children}</div>;
}

/** The working behind an inference: the model, its assumptions, and where the inputs came from. */
export function Why({ items, sources }: { items: [string, ReactNode][]; sources?: string[] }) {
  const backups = (useContext(SourcesContext)?.providers ?? []).filter((p) => BACKUPS.includes(p));
  return (
    <details className="rounded-md border border-line bg-elevated/30 px-2.5 py-1.5 text-[11px]">
      <summary className="cursor-pointer select-none text-[10.5px] font-semibold uppercase tracking-wider text-muted hover:text-fg">Models and sources</summary>
      <dl className="mt-1.5 space-y-1.5">
        {items.map(([k, v]) => <div key={k}><dt className="font-semibold text-fg/90">{k}</dt><dd className="leading-relaxed text-muted">{v}</dd></div>)}
      </dl>
      {sources && sources.length > 0 && <div className="mt-2 border-t border-line pt-1.5 text-[10.5px] text-faint">Sources: {sources.join(" · ")}</div>}
      {backups.length > 0 && <div className="mt-1 text-[10.5px] text-faint">This time {backups.join(", ")} stood in where FMP was out (see the note at the top).</div>}
    </details>
  );
}

/** "Ask AI about this": opens the AI panel with a question ready to send. */
export function AskAi({ onRun, ticker, question, label = "Ask AI" }: { onRun?: (c: Command) => void; ticker: string; question: string; label?: string }) {
  if (!onRun) return null;
  return (
    <button type="button" onClick={() => onRun({ ticker, fn: "AI", arg: question, via: "click" })} title={question}
      className="ctl inline-flex items-center gap-1 border border-line px-2 py-0.5 text-[10.5px] text-muted hover:border-accent/50 hover:text-accent">
      <span className="text-accent">✦</span> {label}
    </button>
  );
}

type Read = { headline: string; bullets: string[]; watch: string[] };

/**
 * A short read of the screen by a small model, grounded only in the numbers the screen shows. Cheap
 * enough to offer everywhere: the extraction and summary tier, not the flagship.
 */
export function AiRead({ fn, params }: { fn: string; params: Record<string, string | undefined> }) {
  const [state, setState] = useState<{ key: string; read?: Read; error?: string; busy: boolean } | null>(null);
  const key = terminalUrl(fn, params);
  const cur = state?.key === key ? state : null;
  const run = async () => {
    setState({ key, busy: true });
    const r = await postTerminal<Read>("explain", { fn, ...params });
    setState({ key, busy: false, read: r.data, error: r.error });
  };
  if (!cur) return <button type="button" onClick={run} className="ctl inline-flex items-center gap-1 border border-line px-2 py-0.5 text-[10.5px] text-muted hover:border-accent/50 hover:text-accent"><span className="text-accent">✦</span> AI read</button>;
  if (cur.busy) return <span className="inline-flex items-center gap-1.5 text-[10.5px] text-muted"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> Reading the numbers…</span>;
  if (cur.error || !cur.read) return <span className="text-[10.5px] text-neg">{cur.error ?? "No answer"}</span>;
  return (
    <div className="rise col-span-full rounded-md border border-accent/30 bg-accent-soft/30 px-3 py-2 text-[11.5px]">
      <div className="flex items-baseline justify-between gap-2"><div className="font-semibold text-fg"><span className="mr-1 text-accent">✦</span>{cur.read.headline}</div><button type="button" onClick={() => setState(null)} className="text-[10px] text-faint hover:text-fg">close</button></div>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-fg/85">{cur.read.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
      {cur.read.watch.length > 0 && <div className="mt-1.5 text-[10.5px] text-muted"><span className="font-semibold">Watch:</span> {cur.read.watch.join(" · ")}</div>}
      <div className="mt-1 text-[9.5px] text-faint">Written by a small model from the figures on this screen only. Check before relying on it.</div>
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------- */
/* Tables                                                                                           */
/* ----------------------------------------------------------------------------------------------- */

export type Column<R> = { key: string; label: string; align?: "left" | "right"; value: (r: R) => number | string | null; render?: (r: R) => ReactNode; className?: (r: R) => string; sortable?: boolean; title?: string };

/** A dense, sortable table. Click a header to sort; numbers sort numerically, text alphabetically. */
export function DataTable<R>({ rows, columns, rowKey, initialSort, onRow, max, empty = "Nothing to show." }: { rows: R[]; columns: Column<R>[]; rowKey: (r: R, i: number) => string; initialSort?: { key: string; desc: boolean }; onRow?: (r: R) => void; max?: number; empty?: string }) {
  const [sort, setSort] = useState(initialSort ?? null);
  const col = sort ? columns.find((c) => c.key === sort.key) : null;
  const sorted = col ? [...rows].sort((a, b) => {
    const x = col.value(a), y = col.value(b);
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return sort!.desc ? -d : d;
  }) : rows;
  const shown = max ? sorted.slice(0, max) : sorted;
  if (!rows.length) return <div className="py-3 text-[11px] text-muted">{empty}</div>;
  return (
    <div className="table-scroll min-w-0 overflow-x-auto">
      <table className="num w-full text-[11px]">
        <thead className="sticky top-0 z-10 bg-panel text-[10px] uppercase tracking-wider text-muted">
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th key={c.key} title={c.title} className={`whitespace-nowrap px-1.5 py-1 font-normal ${c.align === "left" ? "text-left" : "text-right"}`}>
                {c.sortable === false ? c.label : (
                  <button type="button" className={`uppercase tracking-wider hover:text-fg ${sort?.key === c.key ? "text-fg" : ""}`} onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: true }))}>
                    {c.label}{sort?.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={rowKey(r, i)} onClick={onRow ? () => onRow(r) : undefined} className={`border-b border-line/50 last:border-0 hover:bg-elevated/60 ${onRow ? "cursor-pointer" : ""}`}>
              {columns.map((c) => (
                <td key={c.key} className={`whitespace-nowrap px-1.5 py-1 ${c.align === "left" ? "text-left font-sans" : "text-right"} ${c.className?.(r) ?? ""}`}>
                  {c.render ? c.render(r) : (c.value(r) ?? DASH)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------- */
/* Charts                                                                                           */
/* ----------------------------------------------------------------------------------------------- */

const PALETTE = ["var(--chart-1)", "var(--chart-emphasis)", "var(--pos)", "var(--info)", "var(--neg)", "var(--muted)"];

function niceTicks(lo: number, hi: number, n = 5): number[] {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / (n - 1);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / pow;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * pow;
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

export type ChartLine = { name: string; values: (number | null)[]; color?: string; dashed?: boolean; width?: number; label?: boolean };
export type ChartBand = { name: string; lo: (number | null)[]; hi: (number | null)[]; color?: string; opacity?: number };

/**
 * Time series with optional bands (forecast fans, cones), reference lines, and a hover readout.
 * The y axis fits the data (it does not force zero unless asked).
 */
export function SeriesChart({ x, lines, bands = [], format, height = 220, zero = false, refs = [], xLabel, title }: {
  x: string[]; lines: ChartLine[]; bands?: ChartBand[]; format: (v: number) => string; height?: number; zero?: boolean;
  refs?: { value: number; label: string }[]; xLabel?: (x: string, i: number, all: string[]) => string; title?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, padL = 54, padR = 74, padT = 10, padB = 22;
  const plotW = W - padL - padR, plotH = height - padT - padB;
  const vals = [...lines.flatMap((l) => l.values), ...bands.flatMap((b) => [...b.lo, ...b.hi]), ...refs.map((r) => r.value)].filter(ok);
  if (!x.length || !vals.length) return <div className="py-6 text-center text-[11px] text-muted">No data</div>;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.05 || 1;
  lo -= pad; hi += pad;
  const ticks = niceTicks(lo, hi);
  const X = (i: number) => padL + (x.length === 1 ? plotW / 2 : (i / (x.length - 1)) * plotW);
  const Y = (v: number) => padT + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const path = (vs: (number | null)[]) => vs.map((v, i) => (ok(v) ? `${i === 0 || !ok(vs[i - 1]) ? "M" : "L"}${X(i).toFixed(1)},${Y(v).toFixed(1)}` : "")).join(" ");
  const bandPath = (b: ChartBand) => {
    const idx = x.map((_, i) => i).filter((i) => ok(b.lo[i]) && ok(b.hi[i]));
    if (idx.length < 2) return "";
    return `M${idx.map((i) => `${X(i).toFixed(1)},${Y(b.hi[i] as number).toFixed(1)}`).join(" L")} L${[...idx].reverse().map((i) => `${X(i).toFixed(1)},${Y(b.lo[i] as number).toFixed(1)}`).join(" L")} Z`;
  };
  const labelEvery = Math.max(1, Math.ceil(x.length / 7));
  const xl = xLabel ?? ((s: string) => s);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - padL) / plotW) * (x.length - 1));
    setHover(i >= 0 && i < x.length ? i : null);
  };
  // End labels, nudged apart so they do not overlap.
  const ends = lines.filter((l) => l.label !== false).map((l, li) => { const i = l.values.map(ok).lastIndexOf(true); return i >= 0 ? { l, li, i, y: Y(l.values[i] as number) } : null; }).filter((e): e is NonNullable<typeof e> => !!e).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 11) ends[k].y = ends[k - 1].y + 11;
  return (
    <figure className="m-0 min-w-0">
      {title && <figcaption className="mb-1 text-[10.5px] text-muted">{title}</figcaption>}
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={title ?? lines.map((l) => l.name).join(", ")} className="block touch-none select-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={Y(t)} y2={Y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={padL - 6} y={Y(t) + 3} textAnchor="end" fontSize={9.5} fill="var(--muted)">{format(t)}</text>
          </g>
        ))}
        {refs.map((r) => (
          <g key={r.label}>
            <line x1={padL} x2={W - padR} y1={Y(r.value)} y2={Y(r.value)} stroke="var(--muted)" strokeDasharray="3 3" strokeWidth={1} />
            <text x={padL + 4} y={Y(r.value) - 3} fontSize={9} fill="var(--muted)">{r.label}</text>
          </g>
        ))}
        {x.map((s, i) => ((i % labelEvery === 0 && x.length - 1 - i >= labelEvery / 2) || i === x.length - 1) && <text key={`${s}-${i}`} x={X(i)} y={height - 6} textAnchor="middle" fontSize={9.5} fill="var(--muted)">{xl(s, i, x)}</text>)}
        {bands.map((b, bi) => <path key={b.name} d={bandPath(b)} fill={b.color ?? PALETTE[bi % PALETTE.length]} opacity={b.opacity ?? 0.16} />)}
        {lines.map((l, li) => <path key={l.name} d={path(l.values)} fill="none" stroke={l.color ?? PALETTE[li % PALETTE.length]} strokeWidth={l.width ?? 1.75} strokeDasharray={l.dashed ? "4 3" : undefined} strokeLinejoin="round" strokeLinecap="round" />)}
        {ends.map(({ l, li, i, y }) => (
          <g key={l.name}>
            <circle cx={X(i)} cy={Y(l.values[i] as number)} r={3} fill={l.color ?? PALETTE[li % PALETTE.length]} stroke="var(--panel)" strokeWidth={1.5} />
            <text x={W - padR + 6} y={y + 3} fontSize={9.5} fill="var(--fg)"><tspan fill={l.color ?? PALETTE[li % PALETTE.length]}>●</tspan> {format(l.values[i] as number)}</text>
          </g>
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={X(hover)} x2={X(hover)} y1={padT} y2={padT + plotH} stroke="var(--muted)" strokeDasharray="2 3" />
            {(() => {
              type Row = { name: string; c: string; text: string };
              const rows: Row[] = [
                ...lines.map((l, li) => ({ name: l.name, c: l.color ?? PALETTE[li % PALETTE.length], v: l.values[hover] })).filter((r) => ok(r.v)).map((r) => ({ name: r.name, c: r.c, text: format(r.v as number) })),
                ...bands.map((b, bi) => ({ name: b.name, c: b.color ?? PALETTE[bi % PALETTE.length], lo: b.lo[hover], hi: b.hi[hover] })).filter((r) => ok(r.lo) && ok(r.hi)).map((r) => ({ name: r.name, c: r.c, text: `${format(r.lo as number)} to ${format(r.hi as number)}` })),
              ];
              const bw = 170, bx = X(hover) + 8 + bw > W - padR ? X(hover) - bw - 8 : X(hover) + 8;
              return (
                <g>
                  <rect x={bx} y={padT + 2} width={bw} height={14 + rows.length * 12} rx={3} fill="var(--elevated)" stroke="var(--line)" />
                  <text x={bx + 6} y={padT + 13} fontSize={9.5} fill="var(--muted)">{x[hover]}</text>
                  {rows.map((r, k) => (
                    <text key={r.name} x={bx + 6} y={padT + 25 + k * 12} fontSize={9.5} fill="var(--fg)">
                      <tspan fill={r.c}>●</tspan> {r.name}: {r.text}
                    </text>
                  ))}
                </g>
              );
            })()}
          </g>
        )}
      </svg>
      {(lines.length > 1 || bands.length > 0) && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-[8%] text-[10px] text-muted">
          {lines.map((l, li) => <span key={l.name} className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3" style={{ background: l.color ?? PALETTE[li % PALETTE.length] }} />{l.name}</span>)}
          {bands.map((b, bi) => <span key={b.name} className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: b.color ?? PALETTE[bi % PALETTE.length], opacity: 0.35 }} />{b.name}</span>)}
        </div>
      )}
    </figure>
  );
}

/** Volume (or any non-negative series) as thin columns under a price chart. */
export function VolumeBars({ values, height = 44 }: { values: number[]; height?: number }) {
  const W = 640, padL = 54, padR = 74;
  const max = Math.max(...values, 1);
  const w = (W - padL - padR) / Math.max(values.length, 1);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" aria-hidden className="block">
      {values.map((v, i) => <rect key={i} x={padL + i * w} y={height - (v / max) * (height - 2)} width={Math.max(0.6, w - 0.4)} height={(v / max) * (height - 2)} fill="var(--chart-1)" opacity={0.35} />)}
    </svg>
  );
}

/** A distribution from a simulation, with markers (the point estimate, the current price). */
export function Histogram({ bins, format, markers = [], height = 150, title }: { bins: { lo: number; hi: number; count: number }[]; format: (v: number) => string; markers?: { value: number; label: string; color?: string }[]; height?: number; title?: string }) {
  if (!bins.length) return null;
  const W = 560, padL = 10, padR = 10, padT = 16, padB = 22;
  const lo = Math.min(bins[0].lo, ...markers.map((m) => m.value)), hi = Math.max(bins[bins.length - 1].hi, ...markers.map((m) => m.value));
  const X = (v: number) => padL + ((v - lo) / (hi - lo || 1)) * (W - padL - padR);
  const max = Math.max(...bins.map((b) => b.count), 1);
  const H = height - padT - padB;
  const ticks = niceTicks(lo, hi, 6).filter((t) => t >= lo && t <= hi);
  return (
    <figure className="m-0 min-w-0">
      {title && <figcaption className="mb-1 text-[10.5px] text-muted">{title}</figcaption>}
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={title ?? "Distribution"} className="block">
        {bins.map((b, i) => <rect key={i} x={X(b.lo) + 0.5} y={padT + H - (b.count / max) * H} width={Math.max(0.5, X(b.hi) - X(b.lo) - 1)} height={(b.count / max) * H} rx={1.5} fill="var(--chart-1)" opacity={0.75} />)}
        <line x1={padL} x2={W - padR} y1={padT + H} y2={padT + H} stroke="var(--line)" />
        {ticks.map((t) => <text key={t} x={X(t)} y={height - 6} textAnchor="middle" fontSize={9.5} fill="var(--muted)">{format(t)}</text>)}
        {markers.map((m, i) => (
          <g key={m.label}>
            <line x1={X(m.value)} x2={X(m.value)} y1={padT - 4} y2={padT + H} stroke={m.color ?? "var(--chart-emphasis)"} strokeWidth={1.5} strokeDasharray={i ? "3 2" : undefined} />
            <text x={X(m.value)} y={padT - 6 + (i % 2) * 0} textAnchor={X(m.value) > W * 0.8 ? "end" : X(m.value) < W * 0.2 ? "start" : "middle"} fontSize={9.5} fill={m.color ?? "var(--chart-emphasis)"}>{m.label} {format(m.value)}</text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

/** One-at-a-time sensitivity: the output at each input's low and high case, widest swing first. */
export function Tornado({ rows, base, format, title }: { rows: { input: string; low: number; high: number }[]; base: number; format: (v: number) => string; title?: string }) {
  if (!rows.length) return null;
  const W = 560, labelW = 130, padR = 64, rowH = 20;
  const lo = Math.min(base, ...rows.map((r) => r.low)), hi = Math.max(base, ...rows.map((r) => r.high));
  const X = (v: number) => labelW + ((v - lo) / (hi - lo || 1)) * (W - labelW - padR);
  const height = rows.length * rowH + 14;
  return (
    <figure className="m-0 min-w-0">
      {title && <figcaption className="mb-1 text-[10.5px] text-muted">{title}</figcaption>}
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={title ?? "Sensitivity"} className="block">
        <line x1={X(base)} x2={X(base)} y1={0} y2={height - 10} stroke="var(--muted)" strokeDasharray="2 2" />
        {rows.map((r, i) => {
          const y = i * rowH + 4;
          return (
            <g key={r.input}>
              <text x={labelW - 6} y={y + 11} textAnchor="end" fontSize={10} fill="var(--fg)">{r.input}</text>
              <rect x={X(r.low)} y={y} width={Math.max(1, X(base) - X(r.low))} height={13} rx={2} fill="var(--neg)" opacity={0.55} />
              <rect x={X(base)} y={y} width={Math.max(1, X(r.high) - X(base))} height={13} rx={2} fill="var(--pos)" opacity={0.55} />
              <text x={X(r.high) + 4} y={y + 10} fontSize={9} fill="var(--muted)">{format(r.low)} – {format(r.high)}</text>
            </g>
          );
        })}
        <text x={X(base)} y={height - 1} textAnchor="middle" fontSize={9} fill="var(--muted)">base {format(base)}</text>
      </svg>
    </figure>
  );
}

/** Signed horizontal bars (returns, contributions), zero in the middle when values straddle it. */
export function BarList({ rows, format, title, max: maxRows }: { rows: { label: string; value: number | null; sub?: string; onClick?: () => void }[]; format: (v: number) => string; title?: string; max?: number }) {
  const shown = maxRows ? rows.slice(0, maxRows) : rows;
  const vals = shown.map((r) => r.value).filter(ok);
  const mx = Math.max(...vals.map(Math.abs), 1e-9);
  const signed = vals.some((v) => v < 0);
  return (
    <div className="min-w-0">
      {title && <div className="mb-1 text-[10.5px] text-muted">{title}</div>}
      <div className="space-y-0.5">
        {shown.map((r) => {
          const v = r.value;
          const w = ok(v) ? (Math.abs(v) / mx) * (signed ? 50 : 100) : 0;
          return (
            <div key={r.label} onClick={r.onClick} className={`grid grid-cols-[minmax(90px,34%)_1fr_64px] items-center gap-2 text-[11px] ${r.onClick ? "cursor-pointer hover:bg-elevated/60" : ""}`}>
              <span className="truncate text-fg/90" title={r.sub ? `${r.label} · ${r.sub}` : r.label}>{r.label}</span>
              <span className="relative h-3 rounded-sm bg-elevated/60">
                {signed && <span className="absolute left-1/2 top-0 h-full w-px bg-line-strong" />}
                {ok(v) && <span className={`absolute top-0 h-full rounded-sm ${v >= 0 ? "bg-pos/70" : "bg-neg/70"}`} style={signed ? (v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }) : { left: 0, width: `${w}%` }} />}
              </span>
              <span className={`num text-right ${tone(signed ? v : null)}`}>{ok(v) ? format(v) : DASH}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A probability on a 0-100% track with coloured zones. */
export function Meter({ value, label, zones = [0.15, 0.35], invert = false, detail }: { value: number | null; label: string; zones?: [number, number]; invert?: boolean; detail?: string }) {
  const v = ok(value) ? Math.max(0, Math.min(1, value)) : null;
  const bad = v === null ? false : invert ? v < zones[0] : v >= zones[1];
  const mid = v === null ? false : invert ? v >= zones[0] && v < zones[1] : v >= zones[0] && v < zones[1];
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between text-[11px]"><span className="text-muted">{label}</span><span className={`num font-semibold ${bad ? "text-neg" : mid ? "text-chart-emphasis" : "text-pos"}`}>{v === null ? DASH : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`}</span></div>
      <div className="relative mt-1 h-2 rounded-full bg-elevated">
        {v !== null && <div className={`absolute left-0 top-0 h-full rounded-full ${bad ? "bg-neg" : mid ? "bg-chart-emphasis" : "bg-pos"}`} style={{ width: `${Math.max(1.5, v * 100)}%` }} />}
      </div>
      {detail && <div className="mt-1 text-[10px] text-faint">{detail}</div>}
    </div>
  );
}

/** A correlation matrix: blue for positive, red for negative, stronger colour for stronger links. */
export function Heatmap({ labels, matrix, format = (v: number) => v.toFixed(2) }: { labels: string[]; matrix: number[][]; format?: (v: number) => string }) {
  return (
    <div className="table-scroll min-w-0 overflow-x-auto">
      <table className="num border-separate border-spacing-0.5 text-[10px]">
        <thead><tr><th />{labels.map((l) => <th key={l} className="px-1 font-semibold text-muted">{l}</th>)}</tr></thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={labels[i]}>
              <th className="pr-1 text-right font-semibold text-muted">{labels[i]}</th>
              {row.map((v, j) => (
                <td key={j} className="h-6 min-w-9 rounded-sm px-1 text-center" title={`${labels[i]} / ${labels[j]}: ${format(v)}`}
                  style={{ background: i === j ? "var(--elevated)" : v >= 0 ? `color-mix(in oklab, var(--info) ${Math.round(Math.abs(v) * 70)}%, transparent)` : `color-mix(in oklab, var(--neg) ${Math.round(Math.abs(v) * 70)}%, transparent)` }}>
                  {format(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A heat-coloured cell for a return or a z-score. */
export function Heat({ v, scale = 0.03, format = fsp }: { v: number | null | undefined; scale?: number; format?: (v: number | null | undefined) => string }) {
  if (!ok(v)) return <span className="text-faint">{DASH}</span>;
  const a = Math.min(1, Math.abs(v) / scale);
  return <span className="inline-block min-w-[54px] rounded-sm px-1 text-right" style={{ background: `color-mix(in oklab, ${v >= 0 ? "var(--pos)" : "var(--neg)"} ${Math.round(a * 45)}%, transparent)` }}>{format(v)}</span>;
}

/** Range selector for time-series screens. */
export function Ranges<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-line">
      {options.map((o) => <button key={o} type="button" onClick={() => onChange(o)} className={`num px-1.5 py-0.5 text-[10.5px] ${o === value ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{o}</button>)}
    </div>
  );
}

/** The analytics endpoint behind each function, for prefetching on hover. */
const API_FOR: Record<string, { fn: string; ticker: boolean }> = {
  GP: { fn: "price", ticker: true }, HP: { fn: "price", ticker: true }, BETA: { fn: "price", ticker: true }, RISK: { fn: "price", ticker: true },
  IRAT: { fn: "credit", ticker: true }, QUAL: { fn: "quality", ticker: true }, FCST: { fn: "forecast", ticker: true }, DDIS: { fn: "debt", ticker: true },
  EE: { fn: "earnings", ticker: true }, ANR: { fn: "analysts", ticker: true }, DVD: { fn: "dividends", ticker: true },
  WEI: { fn: "indices", ticker: false }, FXC: { fn: "fx", ticker: false }, CMDTY: { fn: "commodities", ticker: false }, MOST: { fn: "movers", ticker: false },
  SECT: { fn: "sectors", ticker: false }, MA: { fn: "deals", ticker: false }, GC: { fn: "curve", ticker: false }, ECO: { fn: "macro", ticker: false },
};

/** Warm the data for a function code before its panel opens (hover on the strip). */
export function prefetchFunction(code: string, ticker: string) {
  const a = API_FOR[code];
  if (a) prefetchTerminal(a.fn, a.ticker ? { ticker } : {});
}
