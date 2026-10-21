"use client";

/**
 * A fund's page: its latest 13F (as a treemap and a table), what changed since the quarter before, its
 * concentration, turnover and sectors, top ideas, the lag-aware clone backtest with its disclosure, and
 * every filing with its lag. Free. Every number cites SEC EDGAR, and the backtest names its price sources.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HBar } from "@/components/charts/HBar";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import type { Backtest, FundView } from "@/lib/copytrade/analytics";
import type { IntegrityReport } from "@/lib/quant/contracts";
import { GradeBadge } from "@/components/quant/ui";
import { HYPOTHETICAL, NO_LAG_NOTE, NOT_ADVICE_SHORT, TIMING } from "@/lib/copytrade/disclosures";
import { ChangeBars, LinesChart, Treemap } from "./charts";
import { json, num, pct, shortCik, usd } from "./client";
import { ConsentProvider } from "./Consent";
import { CopyEditor, newDraft, type Plan } from "./CopyEditor";

type View = FundView & { following: boolean };
type BT = Backtest & { disclosure: string; noLagNote: string; integrity?: IntegrityReport | null };

const CHANGE_STYLE: Record<string, string> = { new: "bg-accent-soft text-accent", added: "bg-pos/15 text-pos", trimmed: "bg-neg/10 text-neg", exited: "bg-neg/10 text-neg", unchanged: "text-muted" };
const CHANGE_WORD: Record<string, string> = { new: "New", added: "Added", trimmed: "Trimmed", exited: "Exited", unchanged: "Same" };

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel p-3">
      <div className="text-[10.5px] uppercase tracking-wider text-muted">{label}</div>
      <div className="num mt-1 text-[19px] font-semibold text-fg">{value}</div>
      {sub && <div className="mt-0.5 text-[10.5px] text-muted">{sub}</div>}
    </div>
  );
}

function Section({ title, icon, children, right }: { title: string; icon: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="panel p-3.5 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-fg"><Icon name={icon} className="h-4 w-4 text-accent" />{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function FundPage({ cik }: { cik: string }) {
  return <ConsentProvider><FundInner cik={cik} /></ConsentProvider>;
}

function FundInner({ cik }: { cik: string }) {
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bt, setBt] = useState<BT | null>(null);
  const [btErr, setBtErr] = useState<string | null>(null);
  const [btLoading, setBtLoading] = useState(false);
  const [top, setTop] = useState(20);
  const [years, setYears] = useState(5);
  const [showAll, setShowAll] = useState(false);
  const [editor, setEditor] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const router = useRouter();

  const load = useCallback(() => {
    setError(null);
    fetchJson<View>(`/api/copy/funds/${cik}`).then(setV).catch((e) => setError(errorMessage(e)));
  }, [cik]);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => { fetchJson<{ plan: Plan }>("/api/copy/copies").then((r) => setPlan(r.plan)).catch(() => undefined); }, []);
  const ready = !!v?.latest;
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setBtLoading(true); setBtErr(null);
      fetchJson<BT>(`/api/copy/funds/${cik}/backtest?top=${top}&years=${years}`, { signal: ctrl.signal }).then(setBt).catch((e) => { if ((e as Error).name !== "AbortError") setBtErr(errorMessage(e)); }).finally(() => setBtLoading(false));
    }, 0);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [cik, top, years, ready]);

  const follow = async () => {
    if (!v) return;
    try { await fetchJson("/api/copy/follows", json(v.following ? "DELETE" : "POST", { cik })); setV({ ...v, following: !v.following }); } catch (e) { setError(errorMessage(e)); }
  };

  const treemap = useMemo(() => (v?.holdings ?? []).map((h) => ({ key: h.cusip, label: h.ticker ?? h.name.split(" ")[0], sub: h.name, value: h.value, kind: h.change })), [v]);

  if (error && !v) return <div className="mx-auto max-w-6xl p-4"><p className="panel p-4 text-[12.5px] text-neg">{error}</p></div>;
  if (!v) return <div className="mx-auto max-w-6xl space-y-3 p-4"><div className="shimmer h-24 rounded-md" /><div className="shimmer h-72 rounded-md" /><p className="text-[11.5px] text-muted">Reading this fund&apos;s 13F filings from SEC EDGAR…</p></div>;

  const rows = showAll ? v.holdings : v.holdings.slice(0, 25);
  const m = (k: "lagged" | "noLag" | "spy") => bt?.[k].metrics ?? null;
  return (
    // The page scrolls inside itself, as every workspace does: the frame around it never scrolls.
    <div className="h-full overflow-auto">
    <div className="mx-auto max-w-6xl space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/app/copy" className="text-[11px] text-muted hover:text-fg">← Fund copies</Link>
          <h1 className="display mt-0.5 text-[24px] leading-tight text-fg sm:text-[28px]">{v.curated?.name ?? v.name}</h1>
          <p className="mt-0.5 text-[12px] text-muted">{[v.curated?.manager, v.curated?.style, `${v.name} · CIK ${shortCik(v.cik)}`].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={follow} className={`ctl flex items-center gap-1.5 border px-3 py-2 text-[12.5px] ${v.following ? "border-accent text-accent" : "border-line text-fg hover:border-line-strong"}`}><Icon name="Bell" className="h-3.5 w-3.5" />{v.following ? "Following" : "Follow"}</button>
          <button onClick={() => setEditor(true)} disabled={!v.latest} className="ctl flex items-center gap-1.5 bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50"><Icon name="Copy" className="h-3.5 w-3.5" />Copy this fund</button>
        </div>
      </div>

      <p className="flex gap-2 rounded-md border border-line bg-elevated p-2.5 text-[11.5px] leading-relaxed text-muted"><Icon name="Hourglass" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" /><span>{TIMING} {v.latest && <>This page shows the quarter ended <b className="text-fg">{v.latest.period}</b>, filed <b className="text-fg">{v.latest.filedOn}</b> ({v.latest.lagDays} days later). The next 13F is due by <b className="text-fg">{v.nextDeadline}</b>.</>}</span></p>
      {v.curated?.note && <p className="flex gap-2 text-[11.5px] text-muted"><Icon name="AlertTriangle" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{v.curated.note}</p>}
      {v.latest?.confidentialOmitted && <p className="flex gap-2 text-[11.5px] text-muted"><Icon name="Lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />This filing left out some holdings under a request for confidential treatment. They appear later in a 13F/A (NEW HOLDINGS) if SEC denies the request or it expires.</p>}
      {v.latest?.restated && <p className="flex gap-2 text-[11.5px] text-muted"><Icon name="RefreshCw" className="mt-0.5 h-3.5 w-3.5 shrink-0" />This quarter was restated by an amendment; the figures here are the restated ones.</p>}
      {v.pending > 0 && <p className="text-[11.5px] text-muted">{v.pending} older filings are still being read from EDGAR; history and backtests fill in as they arrive.</p>}
      {!v.latest && v.filings.length > 0 && <p className="panel p-4 text-[12.5px] text-muted">No 13F holdings report from this filer in the last six years{v.filings.some((f) => f.notice) ? " (it files notices: another manager reports its holdings)" : ""}.</p>}
      {/* No filings at all is what an unreachable EDGAR looks like too: say so and offer a retry rather than assert the fund files nothing. */}
      {!v.latest && v.filings.length === 0 && (
        <div className="panel p-4 text-[12.5px] text-muted">
          <p>No 13F filings from this filer could be read from SEC EDGAR. If it does file 13Fs, EDGAR may be slow to answer right now; try again in a few minutes.</p>
          <button type="button" onClick={load} className="ctl mt-2 border border-line px-2.5 py-1 text-[12px] text-fg hover:border-accent/50">Try again</button>
        </div>
      )}

      {v.latest && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Reported value" value={usd(v.stats.equityValue)} sub="Long US equities" />
            <Tile label="Positions" value={num(v.stats.positions)} sub={`${v.options.length} option and note lines`} />
            <Tile label="Top 10" value={pct(v.stats.top10, 0)} sub="Share of value" />
            <Tile label="Effective positions" value={num(v.stats.effectiveN, 1)} sub="1 ÷ Herfindahl" />
            <Tile label="Turnover" value={v.stats.turnover === null ? "–" : pct(v.stats.turnover, 0)} sub="Weight changed vs prior quarter" />
            <Tile label="Mapped to tickers" value={pct(v.coverage.mappedPct, 0)} sub="Of reported value" />
          </div>

          <Section title="Holdings" icon="PieChart" right={<span className="text-[11px] text-muted">Area is weight; colour is this quarter&apos;s change</span>}>
            <Treemap items={treemap} title={`Quarter ended ${v.latest.period}, by reported value`} />
          </Section>

          <div className="grid gap-3 lg:grid-cols-2">
            <Section title="What changed" icon="ArrowLeftRight" right={<span className="flex flex-wrap gap-1.5 text-[11px]">{(["new", "added", "trimmed", "exited"] as const).map((k) => <span key={k} className={`rounded-full px-2 py-0.5 ${CHANGE_STYLE[k]}`}>{v.changes.counts[k]} {CHANGE_WORD[k].toLowerCase()}</span>)}</span>}>
              <ChangeBars title="Change in portfolio weight, percentage points" rows={v.changes.list.map((c) => ({ key: c.cusip, label: c.ticker ?? c.name.slice(0, 10), before: c.weightBefore, after: c.weight, note: c.split ? `${c.split}-for-1 split adjusted` : undefined }))} />
              <p className="mt-2 text-[10.5px] text-muted">Share counts are compared on the same basis when a stock split between the two filings.</p>
            </Section>
            <Section title="Biggest ideas" icon="Lightbulb">
              <ul className="space-y-2">
                {v.conviction.map((c) => (
                  <li key={`${c.name}-${c.why}`} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                    <span className="min-w-0"><b className="text-fg">{c.ticker ?? c.name}</b> <span className="text-muted">{c.ticker ? c.name : ""}</span><br /><span className="text-[11px] text-muted">{c.why}</span></span>
                    <span className="num shrink-0 text-fg">{pct(c.weight)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[10.5px] text-muted">Largest by reported weight and the biggest increases. What a fund held, not a view on whether anyone should hold it.</p>
            </Section>
          </div>

          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            <Section title="Positions" icon="Table" right={v.holdings.length > 25 && <button onClick={() => setShowAll((s) => !s)} className="text-[11.5px] text-accent hover:underline">{showAll ? "Top 25" : `All ${v.holdings.length}`}</button>}>
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[520px] text-[11.5px]">
                  <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted"><th className="px-1 py-1.5 font-medium">Company</th><th className="px-1 font-medium">Ticker</th><th className="px-1 text-right font-medium">Weight</th><th className="px-1 text-right font-medium">Value</th><th className="px-1 text-right font-medium">Shares</th><th className="px-1 text-right font-medium">Change</th></tr></thead>
                  <tbody>
                    {rows.map((h) => (
                      <tr key={h.cusip} className="border-t border-line">
                        <td className="max-w-[200px] truncate px-1 py-1.5 font-sans text-fg" title={`${h.name} · ${h.title} · CUSIP ${h.cusip}`}>{h.name}</td>
                        <td className="px-1 text-fg">{h.ticker ?? <span className="text-muted" title="No ticker found for this CUSIP">–</span>}</td>
                        <td className="px-1 text-right text-fg">{pct(h.weight)}</td>
                        <td className="px-1 text-right text-muted">{usd(h.value)}</td>
                        <td className="px-1 text-right text-muted">{num(h.shares)}</td>
                        <td className="px-1 text-right">{h.change && <span className={`rounded px-1.5 py-0.5 font-sans text-[10.5px] ${CHANGE_STYLE[h.change]}`}>{CHANGE_WORD[h.change]}{h.sharesChangePct !== null && h.change !== "new" && h.change !== "unchanged" ? ` ${pct(h.sharesChangePct, 0, true)}` : ""}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {v.options.length > 0 && (
                <details className="mt-3 text-[11.5px]">
                  <summary className="cursor-pointer text-muted">Options and notes ({v.options.length}) — listed, never copied</summary>
                  <p className="mt-1.5 text-[11px] text-muted">A 13F gives an option&apos;s underlying value, not its strike, expiry or premium, so no copy can rebuild it. Values are of the underlying shares.</p>
                  <ul className="mt-1.5 space-y-1">{v.options.map((o) => <li key={`${o.cusip}${o.putCall}${o.shareType}`} className="flex justify-between gap-2"><span className="truncate text-fg">{o.ticker ?? o.name} <span className="text-muted">{o.putCall ? o.putCall.toLowerCase() + "s" : "principal amount"}</span></span><span className="num text-muted">{usd(o.value)}</span></li>)}</ul>
                </details>
              )}
            </Section>
            <Section title="Sectors" icon="Layers">
              <HBar title="Share of reported value" data={v.stats.sectors.map((s, i) => ({ key: s.sector, label: /^not yet/i.test(s.label) ? "Unclassified" : s.label.split(" ")[0], value: s.weight, emphasis: i === 0, note: s.label }))} format={(x) => (x === null ? "–" : `${(x * 100).toFixed(0)}%`)} maxBars={9} />
              <p className="mt-2 text-[10.5px] text-muted">From each issuer&apos;s SIC code at SEC. &quot;Not yet classified&quot; fills in over the next visits.</p>
            </Section>
          </div>

          <Section title="Copy backtest" icon="LineChart" right={
            <span className="flex gap-2">
              <select value={top} onChange={(e) => setTop(Number(e.target.value))} className="ctl border border-line bg-bg px-2 py-1 text-[11.5px] text-fg" aria-label="Positions">{[5, 10, 20, 30, 50].map((n) => <option key={n} value={n}>Top {n}</option>)}<option value={0}>All</option></select>
              <select value={years} onChange={(e) => setYears(Number(e.target.value))} className="ctl border border-line bg-bg px-2 py-1 text-[11.5px] text-fg" aria-label="Years">{[1, 3, 5].map((n) => <option key={n} value={n}>{n} year{n > 1 ? "s" : ""}</option>)}</select>
            </span>
          }>
            <p className="mb-2 rounded-md border border-accent/40 bg-accent-soft p-2.5 text-[11.5px] leading-relaxed text-fg"><b>Hypothetical.</b> {HYPOTHETICAL.replace(/^Hypothetical performance: /, "")}</p>
            {btLoading && !bt && <div className="shimmer h-64 rounded-md" />}
            {btErr && <p className="text-[12px] text-muted">{btErr}</p>}
            {bt && (
              <div className={btLoading ? "opacity-60" : ""}>
                <LinesChart title={`Growth of 100, ${bt.from} to ${bt.to}`} lines={[
                  { name: "Clone (as filed)", points: bt.lagged.curve, color: "var(--chart-1)" },
                  { name: "SPY", points: bt.spy.curve, color: "var(--chart-emphasis)" },
                  { name: "Quarter-end, no lag", points: bt.noLag.curve, color: "var(--muted)", dashed: true },
                ]} />
                <div className="-mx-1 mt-3 overflow-x-auto">
                  <table className="w-full min-w-[480px] text-[11.5px]">
                    <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted"><th className="px-1 py-1 font-medium">Line</th><th className="px-1 text-right font-medium">CAGR</th><th className="px-1 text-right font-medium">Volatility</th><th className="px-1 text-right font-medium">Max drawdown</th><th className="px-1 text-right font-medium">Sharpe</th><th className="px-1 text-right font-medium">Beta to SPY</th></tr></thead>
                    <tbody>
                      {([["Clone, as filed (what a copy could do)", m("lagged")], ["Quarter-end, no lag (impossible)", m("noLag")], ["SPY", m("spy")]] as const).map(([name, x]) => (
                        <tr key={name} className="border-t border-line"><td className="px-1 py-1.5 font-sans text-fg">{name}</td><td className="px-1 text-right text-fg">{pct(x?.cagr)}</td><td className="px-1 text-right text-muted">{pct(x?.volatility)}</td><td className="px-1 text-right text-muted">{pct(x?.maxDrawdown)}</td><td className="px-1 text-right text-muted">{x?.sharpe === null || x?.sharpe === undefined ? "–" : x.sharpe.toFixed(2)}</td><td className="px-1 text-right text-muted">{x?.beta === null || x?.beta === undefined ? "–" : x.beta.toFixed(2)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 grid gap-3 text-[11px] text-muted md:grid-cols-2">
                  <div>
                    {bt.integrity && <p className="mb-1.5 flex flex-wrap items-center gap-1.5"><GradeBadge report={bt.integrity} /> <span>Backtest integrity across {bt.integrity.trials} clone variants tried ({bt.integrity.warnings[0] ?? "no warnings"}). <Link href="/app/quant?tab=integrity" className="text-accent hover:underline">How grades work</Link></span></p>}
                    <p><b className="text-fg">Filing lag:</b> on average {bt.avgLagDays} days from quarter end to filing, over {bt.rebalances.length} rebalances. {NO_LAG_NOTE}</p>
                    <p className="mt-1.5"><b className="text-fg">Priced:</b> {pct(bt.pricedPct, 0)} of target weight had a daily price on each rebalance day{bt.missing.length ? `; no prices for ${bt.missing.slice(0, 8).join(", ")}${bt.missing.length > 8 ? "…" : ""}` : ""}.</p>
                  </div>
                  <div>
                    <b className="text-fg">Assumptions</b>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">{bt.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                    <p className="mt-1.5">Sources: holdings from SEC EDGAR 13F filings; daily prices from {bt.providers.filter((p) => p !== "SEC EDGAR").join(", ") || "the market data layer"}{bt.notes.length ? ` (${bt.notes.slice(0, 2).join("; ")})` : ""}.</p>
                  </div>
                </div>
              </div>
            )}
          </Section>
        </>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Quarters" icon="BarChart3">
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[380px] text-[11.5px]">
              <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted"><th className="px-1 py-1 font-medium">Quarter</th><th className="px-1 font-medium">Filed</th><th className="px-1 text-right font-medium">Value</th><th className="px-1 text-right font-medium">Positions</th><th className="px-1 text-right font-medium">Turnover</th></tr></thead>
              <tbody>{[...v.history].reverse().map((h) => <tr key={h.period} className="border-t border-line"><td className="px-1 py-1.5 text-fg">{h.period}</td><td className="px-1 text-muted">{h.filedOn}</td><td className="px-1 text-right text-fg">{usd(h.value)}</td><td className="px-1 text-right text-muted">{h.positions}</td><td className="px-1 text-right text-muted">{h.turnover === null ? "–" : pct(h.turnover, 0)}</td></tr>)}</tbody>
            </table>
          </div>
        </Section>
        <Section title="Filings" icon="ScrollText">
          <ul className="max-h-72 space-y-1 overflow-y-auto text-[11.5px]">
            {v.filings.map((f) => (
              <li key={f.accession} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line py-1.5 first:border-t-0">
                <a href={f.url} target="_blank" rel="noreferrer" className="text-fg hover:text-accent">{f.form} · {f.period}</a>
                <span className="text-muted">filed {f.filedOn} ({f.lagDays} days){f.amendmentType ? ` · ${f.amendmentType.toLowerCase()}` : ""}{f.confidentialOmitted ? " · some holdings confidential" : ""}{f.notice ? " · notice only" : ""}{f.unitCorrected ? " · values read in the filer's actual unit" : ""}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Data and coverage" icon="Database">
        <div className="grid gap-3 text-[11.5px] text-muted md:grid-cols-2">
          <div>
            {v.latest && <p><b className="text-fg">{pct(v.coverage.mappedPct, 1)}</b> of reported value has a ticker: {Object.entries(v.coverage.bySource).sort((a, b) => b[1] - a[1]).map(([k, w]) => `${({ manual: "owner's corrections", builtin: "built-in list", openfigi: "OpenFIGI", name: "SEC name match", unmapped: "no ticker" } as Record<string, string>)[k] ?? k} ${pct(w, 0)}`).join(", ")}.{v.coverage.onListPct !== null ? ` ${pct(v.coverage.onListPct, 0)} of value is on SEC's current 13(f) list.` : ""}</p>}
            {v.coverage.unmapped.length > 0 && <p className="mt-1.5">Without a ticker (left out of copies): {v.coverage.unmapped.slice(0, 8).map((u) => `${u.name} (${u.cusip})`).join(", ")}.</p>}
          </div>
          <ul className="space-y-1">{v.sources.map((s) => <li key={s.name}><a href={s.url} target="_blank" rel="noreferrer" className="text-fg hover:text-accent">{s.name}</a>: {s.note}</li>)}</ul>
        </div>
        <p className="mt-3 text-[11px] text-muted">{NOT_ADVICE_SHORT}</p>
      </Section>

      {editor && v.latest && <CopyEditor draft={newDraft([{ cik: v.cik, name: v.curated?.name ?? v.name, weight: 1 }])} plan={plan} onClose={() => setEditor(false)} onSaved={(id) => router.push(`/app/copy?copy=${id}`)} />}
    </div>
    </div>
  );
}
