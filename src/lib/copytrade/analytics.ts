/**
 * Fund pages and clone backtests, assembled from stored filings, the CUSIP map and daily prices. Server
 * only; all free work (SEC EDGAR, OpenFIGI, the market data layer's free sources).
 */
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheJson } from "@/lib/cache";
import { DAY } from "@/lib/edgar/client";
import type { Provider } from "@/lib/market/provenance";
import { annualTurnover, dailyReturns, indexFrom, metrics, simulate, thin, type CurvePoint, type Metrics, type RebalanceEvent } from "./backtest";
import { filingIndexUrl, storedFilings, syncFund } from "./edgar13f";
import { curatedByCik, padCik, type CuratedFund } from "./funds";
import { dailyCloses } from "./prices";
import { resolveSecurities, SECTOR_LABEL, type Security } from "./securities";
import { blendTargets, cloneTargets, DEFAULT_RULES, type CloneRules, type Left, type Target } from "./targets";
import { compareQuarters, concentration, equityWeights, filingDeadline, lagDays, latestKnown, portfolioAsOf, turnover, type ChangeKind, type FilingRecord, type Holding } from "./thirteenf";

type Stored = Awaited<ReturnType<typeof storedFilings>>;

/** Stored filings for a fund, reading new ones from EDGAR first when asked (a few per call). */
export async function fundFilings(cik: string, sync: boolean): Promise<{ name: string | null; filings: Stored; pending: number }> {
  const c = padCik(cik);
  if (!c) throw Object.assign(new Error("That is not a CIK."), { status: 400 });
  let name: string | null = null, pending = 0;
  if (sync) {
    const s = await syncFund(c, { max: 6, deadline: Date.now() + 20_000 }).catch((e) => { if ((e as { status?: number }).status === 404) throw e; return null; });
    if (s) { name = s.name; pending = s.pending; }
  }
  return { name, filings: await storedFilings(c), pending };
}

async function filerRow(cik: string) {
  const [r] = await requireDb().select({ name: schema.copyFilers.name }).from(schema.copyFilers).where(eq(schema.copyFilers.cik, cik));
  return r ?? null;
}

const wantsOf = (hs: Holding[]) => hs.map((h) => ({ cusip: h.cusip, name: h.name, title: h.titleOfClass }));

export type HoldingRow = { cusip: string; name: string; title: string; ticker: string | null; sector: string | null; value: number; weight: number; shares: number; putCall: string | null; shareType: string; change: ChangeKind | null; sharesChangePct: number | null; split: number | null; source: string };

export type FundView = {
  cik: string; name: string; curated: CuratedFund | null;
  latest: { period: string; filedOn: string; lagDays: number; restated: boolean; confidentialOmitted: boolean; accessions: string[] } | null;
  holdings: HoldingRow[]; options: HoldingRow[];
  changes: { counts: Record<ChangeKind, number>; list: (HoldingRow & { weightBefore: number })[] };
  stats: { positions: number; equityValue: number; top10: number; effectiveN: number; turnover: number | null; sectors: { sector: string; label: string; weight: number }[] };
  conviction: { ticker: string | null; name: string; weight: number; why: string }[];
  history: { period: string; filedOn: string; value: number; positions: number; turnover: number | null }[];
  filings: { accession: string; form: string; filedOn: string; period: string; lagDays: number; amendmentType: string | null; confidentialOmitted: boolean; notice: boolean; url: string; unitCorrected: boolean }[];
  coverage: { mappedPct: number; bySource: Record<string, number>; unmapped: { name: string; cusip: string; value: number }[]; onListPct: number | null };
  nextDeadline: string; pending: number;
  sources: { name: string; url: string; note: string }[];
};

/** Everything the fund page shows. */
export async function fundView(cik: string, opts: { sync?: boolean } = {}): Promise<FundView> {
  const c = padCik(cik);
  const { name, filings, pending } = await fundFilings(c, opts.sync ?? true);
  const curated = curatedByCik(c) ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const latest = latestKnown(filings, today);
  const periods = [...new Set(filings.filter((f) => f.reportType !== "NOTICE").map((f) => f.period))].sort();
  const prevPeriod = latest ? periods.filter((p) => p < latest.period).at(-1) : undefined;
  const prev = prevPeriod ? portfolioAsOf(filings, prevPeriod, today) : null;
  const cur = latest?.portfolio.holdings ?? [];
  const sec = await resolveSecurities(wantsOf([...cur, ...(prev?.holdings ?? [])]), { lookup: true, budgetMs: 12_000 });
  const info = (cusip: string): Security | undefined => sec.get(cusip);
  const eq = cur.filter((h) => !h.putCall && h.shareType === "SH");
  const eqTotal = eq.reduce((s, h) => s + h.value, 0);
  const allTotal = cur.reduce((s, h) => s + h.value, 0) || 1;
  const changes = prev ? compareQuarters(prev.holdings, cur) : [];
  const chBy = new Map(changes.map((x) => [x.cusip, x]));
  const row = (h: Holding, total: number): HoldingRow => {
    const s = info(h.cusip), ch = chBy.get(h.cusip);
    return { cusip: h.cusip, name: h.name, title: h.titleOfClass, ticker: s?.ticker ?? null, sector: s?.sector ?? null, value: h.value, weight: total > 0 ? h.value / total : 0, shares: h.shares, putCall: h.putCall, shareType: h.shareType, change: h.putCall ? null : ch?.kind ?? null, sharesChangePct: ch?.sharesChangePct ?? null, split: ch?.split ?? null, source: s?.source ?? "none" };
  };
  const holdings = eq.map((h) => row(h, eqTotal));
  const options = cur.filter((h) => h.putCall || h.shareType === "PRN").map((h) => row(h, allTotal));
  const conc = concentration(eq.map((h) => h.value));
  const sectors = new Map<string, number>();
  for (const h of holdings) sectors.set(h.sector ?? "unknown", (sectors.get(h.sector ?? "unknown") ?? 0) + h.weight);
  const counts: Record<ChangeKind, number> = { new: 0, added: 0, trimmed: 0, exited: 0, unchanged: 0 };
  for (const x of changes) counts[x.kind]++;
  const changeList = changes.filter((x) => x.kind !== "unchanged").slice(0, 60).map((x) => {
    const h = cur.find((y) => y.cusip === x.cusip && !y.putCall && y.shareType === "SH") ?? prev?.holdings.find((y) => y.cusip === x.cusip && !y.putCall);
    const r = h ? row(h, eqTotal) : null;
    return { ...(r ?? { cusip: x.cusip, name: x.name, title: "", ticker: info(x.cusip)?.ticker ?? null, sector: null, value: 0, weight: 0, shares: 0, putCall: null, shareType: "SH", change: x.kind, sharesChangePct: x.sharesChangePct, split: x.split, source: "none" }), change: x.kind, sharesChangePct: x.sharesChangePct, weight: x.weightAfter, weightBefore: x.weightBefore };
  });
  // History: each quarter as it stands now, and turnover against the quarter before.
  const history: FundView["history"] = [];
  let prevW: Record<string, number> | null = null;
  for (const p of periods.slice(-12)) {
    const port = portfolioAsOf(filings, p, today);
    if (!port || !port.holdings.length) continue;
    const w = equityWeights(port.holdings);
    const first = filings.filter((f) => f.period === p).map((f) => f.filedOn).sort()[0];
    history.push({ period: p, filedOn: first, value: port.holdings.filter((h) => !h.putCall).reduce((s, h) => s + h.value, 0), positions: Object.keys(w).length, turnover: prevW ? turnover(prevW, w) : null });
    prevW = w;
  }
  const bySource: Record<string, number> = {};
  let mapped = 0, onList = 0, listKnown = 0;
  for (const h of eq) {
    const s = info(h.cusip);
    const src = s?.ticker ? s.source : "unmapped";
    bySource[src] = (bySource[src] ?? 0) + (eqTotal > 0 ? h.value / eqTotal : 0);
    if (s?.ticker) mapped += h.value;
    if (s?.onList !== null && s?.onList !== undefined) { listKnown += h.value; if (s.onList) onList += h.value; }
  }
  const conviction = [
    ...holdings.slice(0, 5).map((h) => ({ ticker: h.ticker, name: h.name, weight: h.weight, why: `${(h.weight * 100).toFixed(1)}% of the reported portfolio${h.change === "added" ? ", and added to this quarter" : h.change === "new" ? ", new this quarter" : ""}` })),
    ...changeList.filter((x) => (x.change === "new" || x.change === "added") && !holdings.slice(0, 5).some((h) => h.cusip === x.cusip)).sort((a, b) => (b.weight - b.weightBefore) - (a.weight - a.weightBefore)).slice(0, 3)
      .map((x) => ({ ticker: x.ticker, name: x.name, weight: x.weight, why: x.change === "new" ? `New position at ${(x.weight * 100).toFixed(1)}%` : `Raised from ${(x.weightBefore * 100).toFixed(1)}% to ${(x.weight * 100).toFixed(1)}%` })),
  ];
  const latestFiled = latest ? filings.filter((f) => latest.portfolio.accessions.includes(f.accession)).map((f) => f.filedOn).sort()[0] ?? "" : "";
  const filerName = name ?? (await filerRow(c))?.name ?? curated?.name ?? `CIK ${c}`;
  return {
    cik: c, name: filerName, curated,
    latest: latest ? { period: latest.period, filedOn: latestFiled, lagDays: latestFiled ? lagDays(latest.period, latestFiled) : 0, restated: latest.portfolio.restated, confidentialOmitted: latest.portfolio.confidentialOmitted, accessions: latest.portfolio.accessions } : null,

    holdings, options,
    changes: { counts, list: changeList },
    stats: { positions: holdings.length, equityValue: eqTotal, top10: conc.top10, effectiveN: conc.effectiveN, turnover: history.at(-1)?.turnover ?? null, sectors: [...sectors].map(([s, w]) => ({ sector: s, label: SECTOR_LABEL[s] ?? "Not yet classified", weight: w })).sort((a, b) => b.weight - a.weight) },
    conviction,
    history,
    filings: [...filings].reverse().map((f) => ({ accession: f.accession, form: f.form, filedOn: f.filedOn, period: f.period, lagDays: lagDays(f.period, f.filedOn), amendmentType: f.amendmentType, confidentialOmitted: f.confidentialOmitted, notice: f.reportType === "NOTICE", url: filingIndexUrl(c, f.accession), unitCorrected: f.unitCorrected })),
    coverage: { mappedPct: eqTotal > 0 ? mapped / eqTotal : 0, bySource, unmapped: holdings.filter((h) => !h.ticker).slice(0, 25).map((h) => ({ name: h.name, cusip: h.cusip, value: h.value })), onListPct: listKnown > 0 ? onList / listKnown : null },
    nextDeadline: filingDeadline(nextQuarterEnd(latest?.period ?? today)),
    pending,
    sources: SOURCES,
  };
}

const SOURCES = [
  { name: "SEC EDGAR, Form 13F-HR and 13F-HR/A", url: "https://www.sec.gov/edgar/search/", note: "Holdings, values and amendments as filed. Public records." },
  { name: "SEC Official List of Section 13(f) Securities", url: "https://www.sec.gov/rules-regulations/staff-guidance/division-investment-management-frequently-asked-questions/official-list-section-13f-securities", note: "Which CUSIPs are 13(f) securities, and SEC's issuer names." },
  { name: "SEC company_tickers.json", url: "https://www.sec.gov/files/company_tickers.json", note: "Tickers by company name, for CUSIPs OpenFIGI did not map." },
  { name: "OpenFIGI", url: "https://www.openfigi.com/api", note: "CUSIP to ticker, US composite listing." },
];

/** Whether a trade on `trade` could be the one for an event filed on `filed` (the first close after it). */
const tradingAfter = (filed: string, trade: string) => trade > filed && Date.parse(trade) - Date.parse(filed) < 8 * DAY;

function nextQuarterEnd(after: string): string {
  const y = Number(after.slice(0, 4)), m = Number(after.slice(5, 7));
  const qm = Math.ceil(m / 3) * 3 + 3;
  return new Date(Date.UTC(y, qm, 0)).toISOString().slice(0, 10);
}

/* ---------------- Clone targets for copies ---------------- */

/** A fund's clone today under the rules: targets, what was left out and coverage. */
export async function fundClone(filings: FilingRecord[], rules: CloneRules, lookup = false): Promise<{ period: string | null; accessions: string[]; targets: Target[]; left: Left[]; coverage: ReturnType<typeof cloneTargets>["coverage"] | null }> {
  const latest = latestKnown(filings, new Date().toISOString().slice(0, 10));
  if (!latest) return { period: null, accessions: [], targets: [], left: [], coverage: null };
  const sec = await resolveSecurities(wantsOf(latest.portfolio.holdings), { lookup, budgetMs: 10_000, sectors: lookup ? 25 : 0 });
  const r = cloneTargets(latest.portfolio.holdings, rules, (c) => sec.get(c));
  return { period: latest.period, accessions: latest.portfolio.accessions, ...r };
}

/** Targets for a copy of one fund or a blend, with the latest accession of each fund (to spot new filings). */
export async function copyTargets(funds: { cik: string; weight: number }[], rules: CloneRules, lookup = false): Promise<{ targets: { ticker: string; weight: number; name: string; sector: string | null }[]; funds: { cik: string; period: string | null; accession: string | null; coverage: number | null }[] }> {
  const parts = await Promise.all(funds.map(async (f) => ({ f, clone: await fundClone(await storedFilings(f.cik), funds.length > 1 ? { ...rules, topN: 0 } : rules, lookup) })));
  const targets = funds.length > 1 ? blendTargets(parts.map((p) => ({ weight: p.f.weight, targets: p.clone.targets })), rules.topN) : parts[0]?.clone.targets.map((t) => ({ ticker: t.ticker, weight: t.weight, name: t.name, sector: t.sector })) ?? [];
  return { targets, funds: parts.map((p) => ({ cik: padCik(p.f.cik), period: p.clone.period, accession: p.clone.accessions.at(-1) ?? null, coverage: p.clone.coverage?.mappedPct ?? null })) };
}

/* ---------------- Backtest ---------------- */

export type Backtest = {
  cik: string; topN: number; from: string; to: string;
  lagged: { curve: CurvePoint[]; metrics: Metrics | null };
  noLag: { curve: CurvePoint[]; metrics: Metrics | null };
  spy: { curve: CurvePoint[]; metrics: Metrics | null };
  rebalances: { date: string; period: string; lagDays: number; held: number; missing: string[] }[];
  avgLagDays: number; pricedPct: number; providers: Provider[]; notes: string[]; missing: string[];
  assumptions: string[];
  /** The lagged clone's daily returns and annual turnover, for Quant Edge's integrity grade (not sent to the page). */
  daily?: { dates: string[]; returns: number[] }; turnoverPerYear?: number;
};

/** The lag-aware clone backtest for one fund over up to `years`, cached for half a day per filing set. */
export async function fundBacktest(cik: string, topN = DEFAULT_RULES.topN, years = 5): Promise<Backtest> {
  const c = padCik(cik);
  const filings = (await storedFilings(c)).filter((f) => f.reportType !== "NOTICE");
  if (!filings.length) throw Object.assign(new Error("No 13F holdings reports are stored for this fund yet. Open its page to read them from EDGAR."), { status: 404 });
  const key = `copy:backtest:${c}:${topN}:${years}:${filings.at(-1)!.accession}:${filings.length}`;
  return cacheJson(key, 12 * 3_600_000, () => runBacktest(c, filings, topN, years));
}

/**
 * The lagged clone's events: every filing date, the latest quarter as then known (amendments change it on
 * the day they were filed), as clone weights. Shared with algo trading's 13F-copy strategies.
 */
async function lagEventsOf(filings: FilingRecord[], topN: number, years: number): Promise<{ events: (RebalanceEvent & { period: string })[]; weightsOf: (hs: Holding[]) => Record<string, number> }> {
  const floor = new Date(Date.now() - years * 365.25 * DAY).toISOString().slice(0, 10);
  const rules: CloneRules = { ...DEFAULT_RULES, topN };
  const allHoldings = filings.flatMap((f) => f.holdings);
  const sec = await resolveSecurities(wantsOf(allHoldings), { lookup: true, budgetMs: 15_000, sectors: 0 });
  const weightsOf = (hs: Holding[]) => Object.fromEntries(cloneTargets(hs, rules, (x) => sec.get(x)).targets.map((t) => [t.ticker, t.weight]));
  const events: (RebalanceEvent & { period: string })[] = [];
  let lastSig = "";
  for (const d of [...new Set(filings.map((f) => f.filedOn))].sort()) {
    if (d < floor) continue;
    const k = latestKnown(filings, d);
    if (!k) continue;
    const w = weightsOf(k.portfolio.holdings);
    const sig = `${k.period}:${JSON.stringify(w)}`;
    if (sig === lastSig || !Object.keys(w).length) continue;
    lastSig = sig;
    events.push({ date: d, weights: w, label: k.period, period: k.period });
  }
  return { events, weightsOf };
}

/** A fund's clone weights by filing date (only after each filing was public), for algo trading's 13F-copy strategies. */
export async function cloneEvents(cik: string, topN = DEFAULT_RULES.topN, years = 5): Promise<{ date: string; period: string; weights: Record<string, number> }[]> {
  const filings = (await storedFilings(padCik(cik))).filter((f) => f.reportType !== "NOTICE");
  return (await lagEventsOf(filings, topN, years)).events.map((e) => ({ date: e.date, period: e.period, weights: e.weights }));
}

async function runBacktest(cik: string, filings: FilingRecord[], topN: number, years: number): Promise<Backtest> {
  const { events: lagEvents, weightsOf } = await lagEventsOf(filings, topN, years);
  if (!lagEvents.length) throw Object.assign(new Error("Not enough filings in the window to backtest this fund."), { status: 404 });
  // The no-lag line: each quarter's holdings as first filed, bought at the quarter-end close.
  const noLagEvents: RebalanceEvent[] = [...new Set(lagEvents.map((e) => e.period))].map((p) => {
    const first = filings.filter((f) => f.period === p).map((f) => f.filedOn).sort()[0];
    return { date: p, weights: weightsOf(portfolioAsOf(filings, p, first)?.holdings ?? []), label: p };
  });
  const tickers = [...new Set([...lagEvents, ...noLagEvents].flatMap((e) => Object.keys(e.weights)))];
  const from = new Date(Date.parse(`${noLagEvents[0]?.date ?? lagEvents[0].date}T00:00:00Z`) - 10 * DAY).toISOString().slice(0, 10);
  const px = await dailyCloses([...tickers, "SPY"], from, { max: 160, deadline: Date.now() + 45_000 });
  const spyCloses = px.prices.SPY ?? [];
  if (spyCloses.length < 30) throw Object.assign(new Error("Daily prices are not available right now, so the backtest cannot run. Try again later."), { status: 503 });
  const calendar = spyCloses.map((x) => x.date);
  const lag = simulate(lagEvents, px.prices, calendar, true);
  const raw = simulate(noLagEvents, px.prices, calendar, false);
  const start = lag.curve[0]?.date ?? calendar[0];
  const rebase = (cv: CurvePoint[]) => { const s = cv.filter((p) => p.date >= start); const b = s[0]?.value || 1; return s.map((p) => ({ date: p.date, value: (100 * p.value) / b })); };
  const noLag = rebase(raw.curve);
  const spy = indexFrom(spyCloses, start);
  const priced = lag.trades.map((t) => t.pricedWeight);
  const daily = dailyReturns(lag.curve);
  return {
    cik, topN, from: start, to: calendar.at(-1) ?? start,
    lagged: { curve: thin(lag.curve), metrics: metrics(lag.curve, spy) },
    noLag: { curve: thin(noLag), metrics: metrics(noLag, spy) },
    spy: { curve: thin(spy), metrics: metrics(spy, spy) },
    rebalances: lag.trades.map((t) => { const e = lagEvents.find((x) => x.label === t.label && tradingAfter(x.date, t.date)); return { date: t.date, period: t.label ?? "", lagDays: e ? lagDays(e.period, e.date) : 0, held: t.held.length, missing: t.missing }; }),
    avgLagDays: Math.round(lagEvents.reduce((s, e) => s + lagDays(e.period, e.date), 0) / lagEvents.length),
    pricedPct: priced.length ? priced.reduce((s, x) => s + x, 0) / priced.length : 0,
    providers: [...new Set(["SEC EDGAR" as Provider, ...px.providers])], notes: px.notes, missing: px.missing.filter((t) => t !== "SPY"),
    assumptions: [
      `Top ${topN || "all"} long equity positions by reported value, share classes merged, rescaled to 100%.`,
      "Bought at the close of the first trading day after each filing date, held until the next filing (13F/A amendments included on the day they were filed).",
      "Price return on split-adjusted daily closes: dividends not reinvested.",
      "No fees, commissions, spreads, slippage or taxes. Long-only; options and holdings without a ticker left out.",
      "Sharpe ratio uses a 0% risk-free rate for both the clone and SPY. Beta is against SPY's daily returns.",
    ],
    daily: { dates: daily.map((d) => d.date), returns: daily.map((d) => d.r) }, turnoverPerYear: annualTurnover(lagEvents),
  };
}
