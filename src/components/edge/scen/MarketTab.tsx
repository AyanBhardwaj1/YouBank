"use client";

/**
 * Market scenarios: tickers, a driver (the base case, a history replay, a written shock, a scenario
 * proposed from live events, or an AI-imagined tail risk), a horizon and a method. A thousand paths
 * come back in seconds; "Refine" runs ten thousand (or the diffusion model) in the background.
 */
import { Loader2, Play, Sparkles, Wand2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Select } from "@/components/ui/Select";
import { api, post, useApi } from "@/components/news/client";
import type { Proposal } from "@/lib/edge/scen/drivers";
import type { MarketResult } from "@/lib/edge/scen/market";
import { FanChart, Histogram, pct, RealismPanel, SyntheticTag } from "./parts";

const FACTOR_NAME: Record<string, string> = { market: "Market", energy: "Oil & gas stocks", oil: "WTI", gas: "Henry Hub", rates: "10y yield" };

export function MarketResultView({ r, id, status, onRefined }: { r: MarketResult; id: number | null; status: string; onRefined?: () => void }) {
  const [series, setSeries] = useState("Portfolio");
  const [refining, setRefining] = useState(status === "refining");
  const fan = r.summary.fans.find((f) => f.series === series) ?? r.summary.fans[r.summary.fans.length - 1];
  const port = r.summary.finals.find((f) => f.series === "Portfolio")!;
  const refine = async () => { if (!id) return; setRefining(true); try { await post(`/api/edge/scenarios/${id}/refine`, {}); onRefined?.(); } catch { setRefining(false); } };
  return (
    <div className="space-y-3">
      <SyntheticTag recipe={r.recipe} seed={r.seed} paths={r.paths} />
      {r.missing.length > 0 && <p className="text-[11.5px] text-muted">No price history for {r.missing.join(", ")}; left out.</p>}
      {r.shock?.reasoning && <p className="rounded-md bg-elevated/50 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-muted">{r.shock.reasoning}{r.shock.sources?.length ? <span> Sources: {r.shock.sources.map((s, i) => <a key={i} href={s.url} className="text-accent hover:underline" target={/^https?:/.test(s.url) ? "_blank" : undefined} rel="noreferrer">{i ? ", " : ""}{s.label.slice(0, 60)}</a>)}</span> : null}</p>}
      {r.replay && <p className="text-[11.5px] text-muted">{r.replay.note}. Over the window: {Object.entries(r.replay.factorMoves).map(([k, v]) => `${FACTOR_NAME[k]} ${k === "rates" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)} pts` : pct(v, 0)}`).join(" · ")}.</p>}
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[["Median", pct(port.p50)], ["5th percentile", pct(port.p5)], ["Chance of a loss", `${Math.round(port.probLoss * 100)}%`], ["Value at risk (95%)", pct(-port.var95)], ["Expected shortfall", pct(-port.cvar95)], ["Drawdown, 1 in 20", pct(r.summary.drawdown.p95)]].map(([k, v]) => (
          <div key={k} className="rounded-md border border-line px-2 py-1.5"><div className="text-[10px] uppercase tracking-wider text-muted">{k}</div><div className="num text-[14px] font-semibold">{v}</div></div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-lg border border-line p-2">
          <div className="mb-1 flex flex-wrap gap-1">{r.summary.fans.map((f) => <button key={f.series} type="button" onClick={() => setSeries(f.series)} aria-pressed={series === f.series} className={`rounded-full border px-2 py-0.5 text-[11px] ${series === f.series ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{f.series === "Portfolio" ? "Portfolio" : f.series}</button>)}</div>
          <FanChart fan={fan} checkpoints={r.summary.checkpoints} samples={series === "Portfolio" ? r.summary.samples : undefined} label={series === "Portfolio" ? `Portfolio (${r.names.length > 1 ? "weighted, rebalanced daily" : r.names[0]})` : series} />
        </div>
        <div className="space-y-3">
          <div className="rounded-lg border border-line p-2"><div className="mb-1 text-[11px] font-semibold">Portfolio at the horizon</div><Histogram edges={r.summary.histogram.edges} counts={r.summary.histogram.counts} p5={port.p5} /></div>
          <RealismPanel r={r.realism} note={r.driver === "none" ? undefined : "The scenario's own machinery on ordinary days (no shock) against the real last three years; the scenario itself is meant to be unusual."} />
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-[11.5px]">
          <thead className="bg-elevated/50"><tr className="text-left"><th className="px-2 py-1 font-sans font-semibold">Ticker</th>{Object.keys(FACTOR_NAME).map((k) => <th key={k} className="px-2 py-1 text-right font-sans font-normal text-muted">β {FACTOR_NAME[k]}</th>)}<th className="px-2 py-1 text-right font-sans font-normal text-muted">Own vol</th><th className="px-2 py-1 text-right font-sans font-normal text-muted">R²</th><th className="px-2 py-1 text-right font-sans font-normal text-muted">Median</th><th className="px-2 py-1 text-right font-sans font-normal text-muted">5th pct</th></tr></thead>
          <tbody>{r.exposures.map((e) => { const f = r.summary.finals.find((x) => x.series === e.ticker); return (
            <tr key={e.ticker} className="border-t border-line"><td className="px-2 py-1 font-sans font-medium">{e.ticker}</td>{Object.keys(FACTOR_NAME).map((k) => <td key={k} className="px-2 py-1 text-right">{e.betas[k as keyof typeof e.betas].toFixed(2)}</td>)}<td className="px-2 py-1 text-right">{(e.residVol * 100).toFixed(0)}%</td><td className="px-2 py-1 text-right">{e.r2.toFixed(2)}</td><td className="px-2 py-1 text-right">{f ? pct(f.p50) : ""}</td><td className="px-2 py-1 text-right">{f ? pct(f.p5) : ""}</td></tr>
          ); })}</tbody>
        </table>
        <p className="px-2 py-1 text-[10.5px] text-faint">Betas from daily returns over {r.history.days} days ({r.history.from} to {r.history.to}) against the factors; the 10-year yield beta is per percentage point.</p>
      </div>
      {id && r.paths < 5000 && (
        <button type="button" disabled={refining} onClick={() => void refine()} className="ctl flex items-center gap-1.5 border border-line px-3 py-1 text-[12px] hover:border-accent/50 disabled:opacity-60">{refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}{refining ? "Refining in the background…" : "Refine: 10,000 paths"}</button>
      )}
    </div>
  );
}

export function MarketTab({ suggest, onSaved }: { suggest: string[]; onSaved: () => void }) {
  const [tickers, setTickers] = useState<string[]>(suggest.slice(0, 3));
  const [text, setText] = useState("");
  const [driver, setDriver] = useState("none");
  const [replay, setReplay] = useState("2022");
  const [shock, setShock] = useState("oil -30%, rates +150bp");
  const [horizon, setHorizon] = useState("60");
  const [method, setMethod] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: number; status: string; result: MarketResult } | null>(null);
  const [picked, setPicked] = useState<Proposal | null>(null);
  const proposals = useApi<{ proposals: Proposal[] }>((driver === "event" || driver === "tail") && tickers.length ? `/api/edge/scenarios/proposals?kind=${driver}&tickers=${tickers.join(",")}` : null);

  // While a refinement runs, check back every few seconds.
  useEffect(() => {
    if (!result || result.status !== "refining") return;
    let live = true;
    const t = setInterval(() => { api<{ status: string; result: MarketResult }>(`/api/edge/scenarios/${result.id}`).then((s) => { if (live && s.status !== "refining") { setResult({ id: result.id, status: s.status, result: s.result }); onSaved(); } }).catch(() => undefined); }, 5000);
    return () => { live = false; clearInterval(t); };
  }, [result, onSaved]);

  const add = () => { const t = text.toUpperCase().split(/[\s,;]+/).filter((x) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(x)); if (t.length) setTickers((c) => [...new Set([...c, ...t])].slice(0, 12)); setText(""); };
  const run = async () => {
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = { kind: "market", tickers, driver, replay, horizon: Number(horizon), method };
      if (driver === "shock") body.shockText = shock;
      if ((driver === "event" || driver === "tail") && picked) { body.shock = { ...picked.shock, reasoning: picked.reasoning, sources: picked.sources }; body.horizon = picked.horizon; body.title = `${driver === "tail" ? "AI-imagined: " : ""}${picked.title}`; }
      const r = await post<{ id: number; status: string; result: MarketResult }>("/api/edge/scenarios", body);
      setResult(r); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const needsPick = (driver === "event" || driver === "tail") && !picked;

  return (
    <div className="space-y-3">
      <div className="panel space-y-2.5 p-3 text-[12px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-[70px] shrink-0 text-muted">Tickers</span>
          {tickers.map((t) => <span key={t} className="num inline-flex items-center gap-1 rounded-full border border-line bg-elevated/60 px-2 py-0.5 text-[11.5px]">{t}<button type="button" onClick={() => setTickers((c) => c.filter((x) => x !== t))} aria-label={`Remove ${t}`}><X className="h-3 w-3" /></button></span>)}
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} onBlur={add} placeholder="Add, e.g. ET KMI" className="ctl w-[130px] border border-line bg-bg px-2 py-0.5 uppercase outline-none placeholder:normal-case placeholder:text-faint focus:border-accent/60" aria-label="Add tickers" />
          {suggest.filter((t) => !tickers.includes(t)).slice(0, 5).map((t) => <button key={t} type="button" onClick={() => setTickers((c) => [...c, t].slice(0, 12))} className="num rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] text-muted hover:text-fg">+ {t}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-[70px] shrink-0 text-muted">Driver</span>
          <Select value={driver} onChange={(v) => { setDriver(v); setPicked(null); }} aria-label="Driver" className="ctl border border-line bg-bg px-2 py-1 text-left">
            <option value="none">Base case (no shock)</option><option value="replay">Replay history</option><option value="shock">My shock</option><option value="event">From live events</option><option value="tail">AI-imagined tail risk</option>
          </Select>
          {driver === "replay" && <Select value={replay} onChange={setReplay} aria-label="History" className="ctl border border-line bg-bg px-2 py-1 text-left"><option value="2008">2008 financial crisis</option><option value="2020">2020 pandemic</option><option value="2022">2022 rate shock</option><option value="oil2014">Oil collapse, 2014-16</option></Select>}
          {driver === "shock" && <input value={shock} onChange={(e) => setShock(e.target.value)} placeholder="oil -30%, rates +150bp, KMI -10%, or a sentence" className="ctl min-w-[260px] flex-1 border border-line bg-bg px-2 py-1 outline-none placeholder:text-faint focus:border-accent/60" aria-label="Shock" />}
          {driver !== "replay" && (
            <label className="flex items-center gap-1.5 text-muted">Horizon<Select value={horizon} onChange={setHorizon} aria-label="Horizon" className="ctl border border-line bg-bg px-2 py-1 text-left text-fg"><option value="20">1 month</option><option value="60">3 months</option><option value="126">6 months</option><option value="252">1 year</option></Select></label>
          )}
          {driver === "none" && (
            <label className="flex items-center gap-1.5 text-muted">Method<Select value={method} onChange={setMethod} aria-label="Method" className="ctl border border-line bg-bg px-2 py-1 text-left text-fg"><option value="auto">Chosen by horizon</option><option value="garch">GARCH with a copula</option><option value="regimes">Two regimes</option><option value="bootstrap">Block bootstrap</option><option value="diffusion">Diffusion (refine on the ML service)</option></Select></label>
          )}
        </div>
        {(driver === "event" || driver === "tail") && (
          <div className="rounded-md border border-line p-2">
            <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold">{driver === "tail" ? <Sparkles className="h-3.5 w-3.5 text-accent" /> : null}{driver === "tail" ? "AI-imagined tail risks (imagined, not forecast)" : "Scenarios proposed from the Newsroom, Earth and the graph"}</div>
            {!proposals.data ? <div className="flex items-center gap-2 text-[11.5px] text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Thinking about {tickers.join(", ")}…</div> : !proposals.data.proposals.length ? <p className="text-[11.5px] text-muted">{driver === "event" ? "Nothing recent about these companies to build a scenario from." : "No tail risks came back; try again."}</p> : (
              <ul className="space-y-1">{proposals.data.proposals.map((p, i) => (
                <li key={i}><button type="button" onClick={() => setPicked(p)} aria-pressed={picked === p} className={`w-full rounded-md border px-2 py-1.5 text-left ${picked === p ? "border-accent/60 bg-accent-soft/30" : "border-line hover:border-accent/40"}`}>
                  <div className="text-[12px] font-medium">{p.title}{p.probability ? <span className="ml-1 text-[10.5px] font-normal text-muted">({p.probability})</span> : null}</div>
                  <div className="mt-0.5 line-clamp-3 text-[11px] text-muted">{p.reasoning}</div>
                </button></li>
              ))}</ul>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy || !tickers.length || needsPick} onClick={() => void run()} className="ctl flex items-center gap-1.5 bg-accent px-3 py-1.5 font-semibold text-accent-fg disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}Run 1,000 paths</button>
          {needsPick && <span className="text-[11px] text-muted">Pick a scenario above.</span>}
          {error && <span className="text-[12px] text-neg">{error}</span>}
        </div>
      </div>
      {result && <MarketResultView r={result.result} id={result.id} status={result.status} onRefined={() => setResult({ ...result, status: "refining" })} />}
    </div>
  );
}
