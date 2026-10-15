/**
 * QF4 on the server: the nightly factor build over the point-in-time store.
 *
 *   refreshFactsSlice(n, deadline)  point-in-time fundamentals for `n` universe members (oldest first) from SEC
 *                                   company facts, compacted to the concepts the engine reads, kept in R2
 *   buildFactors(deadline)          factor returns (quant_factor_returns, universe us-top1000), the cross-
 *                                   sectional model's exposures and specific risk, crowding readings and this
 *                                   year's return panel
 * Background work: free data only, never a premium scope. Without R2 the store cannot hold bars or facts, and
 * the build says so (Factor Lab then uses the ETF-proxy tier).
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { getCompanyFacts } from "@/lib/edgar/facts";
import { getJson, putJson, putObject, r2Ready } from "@/lib/edge/infra/r2";
import { CURATED } from "@/lib/copytrade/funds";
import { barReturns, storedBars, sliceBars } from "../pit/bars";
import { CONCEPTS, firstFacts, sharesFacts, type PitFact } from "../pit/fundamentals";
import { buildPanel, encodePanel, panelKey } from "../pit/panel";
import { members, UNIVERSE } from "../pit/universe";
import { comovement, ownershipShare, valuationSpread, weeklyExcess, type CrowdingPoint } from "./crowding";
import { characteristics, crossSection, ENGINE_VERSION, factorReturns, FACTOR_KEYS, monthEnds, SORTS, sort2x3, type Chars, type StockInput } from "./engine";

type Facts = StockInput["facts"];
const factsKey = (cik: string) => `quant/facts/${cik.padStart(10, "0")}.json`;

async function jobState<T>(name: string): Promise<T | null> {
  const [r] = await requireDb().select().from(schema.edgeJobState).where(eq(schema.edgeJobState.name, name));
  return (r?.state as T) ?? null;
}
async function setJobState(name: string, state: Record<string, unknown>) {
  await requireDb().insert(schema.edgeJobState).values({ name, state }).onConflictDoUpdate({ target: schema.edgeJobState.name, set: { state, updatedAt: new Date() } });
}

/** Keep only what the engine reads (and only fields it uses), to keep each object small. */
const compact = (fs: PitFact[]) => fs.map((f) => ({ end: f.end, val: f.val, filed: f.filed, form: f.form, accn: f.accn, knownAt: f.knownAt, days: f.days }));

export async function refreshFactsSlice(n: number, deadline: number): Promise<{ refreshed: number; failed: number; reason?: string }> {
  if (!r2Ready()) return { refreshed: 0, failed: 0, reason: "R2 is not configured, so fundamentals cannot be stored." };
  const ms = await members();
  const st = (await jobState<{ done: Record<string, string> }>("quant.facts")) ?? { done: {} };
  const order = [...ms].filter((m) => m.cik).sort((a, b) => (st.done[a.cik!] ?? "").localeCompare(st.done[b.cik!] ?? ""));
  let refreshed = 0, failed = 0;
  for (const m of order.slice(0, n)) {
    if (Date.now() > deadline) break;
    try {
      const cf = await getCompanyFacts(m.cik!);
      const gp = firstFacts(cf, CONCEPTS.grossProfit);
      const facts: Facts = { shares: compact(sharesFacts(cf)), equity: compact(firstFacts(cf, CONCEPTS.equity)), assets: compact(firstFacts(cf, CONCEPTS.assets)), grossProfit: compact(gp.length ? gp : derivedGrossProfit(cf)), netIncome: compact(firstFacts(cf, CONCEPTS.netIncome)) };
      await putJson(factsKey(m.cik!), facts);
      st.done[m.cik!] = new Date().toISOString();
      refreshed++;
    } catch { failed++; st.done[m.cik!] = new Date().toISOString(); }
  }
  await setJobState("quant.facts", st as unknown as Record<string, unknown>);
  return { refreshed, failed };
}

/** Revenue minus cost of revenue for the same period and filing, where gross profit is not tagged. */
function derivedGrossProfit(cf: Parameters<typeof firstFacts>[0]): PitFact[] {
  const rev = firstFacts(cf, CONCEPTS.revenue), cost = firstFacts(cf, CONCEPTS.costOfRevenue);
  const byKey = new Map(cost.map((c) => [`${c.accn}|${c.end}|${c.days}`, c]));
  return rev.map((r) => { const c = byKey.get(`${r.accn}|${r.end}|${r.days}`); return c ? { ...r, val: r.val - c.val } : null; }).filter((x): x is PitFact => !!x);
}

/** Every member's bars (from `from`) and facts, six reads at a time, within the deadline. */
async function inputs(from: string, deadline: number): Promise<{ stocks: StockInput[]; missingBars: number; missingFacts: number }> {
  const ms = await members();
  const stocks: StockInput[] = [];
  let missingBars = 0, missingFacts = 0, i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < ms.length && Date.now() < deadline) {
      const m = ms[i++];
      const [b, f] = await Promise.all([storedBars(m.symbol).catch(() => null), m.cik ? getJson<Facts>(factsKey(m.cik)).catch(() => null) : Promise.resolve(null)]);
      if (!b?.c.length) { missingBars++; continue; }
      if (!f) { missingFacts++; continue; }
      const s = sliceBars(b, from);
      stocks.push({ symbol: m.symbol, dates: s.d, close: s.c, facts: f });
    }
  }));
  return { stocks, missingBars, missingFacts };
}

/** Hedge funds' 13F market value by ticker, from the latest stored filing of each tracked fund. */
async function hedgeFundHoldings(): Promise<Map<string, number>> {
  const db = requireDb();
  const ciks = CURATED.map((f) => f.cik);
  const rows = (await db.execute(sql`select distinct on (cik) cik, holdings from copy_filings where cik in (${sql.join(ciks.map((c) => sql`${c}`), sql`, `)}) and report_type <> 'NOTICE' order by cik, filed_on desc`)).rows as { cik: string; holdings: { cusip: string; value: number; putCall: string | null }[] }[];
  const cusips = [...new Set(rows.flatMap((r) => r.holdings.filter((h) => !h.putCall).map((h) => h.cusip)))];
  const map = new Map<string, string>();
  for (let k = 0; k < cusips.length; k += 500) {
    const sec = await db.select({ cusip: schema.copySecurities.cusip, ticker: schema.copySecurities.ticker }).from(schema.copySecurities).where(inArray(schema.copySecurities.cusip, cusips.slice(k, k + 500)));
    for (const s of sec) if (s.ticker) map.set(s.cusip, s.ticker.toUpperCase().replace(/\./g, "-"));
  }
  const held = new Map<string, number>();
  for (const r of rows) for (const h of r.holdings) { const t = map.get(h.cusip); if (t && !h.putCall) held.set(t, (held.get(t) ?? 0) + h.value); }
  return held;
}

export type BuildResult = { ok: boolean; reason?: string; stocks?: number; days?: number; from?: string; to?: string; written?: number; missingBars?: number; missingFacts?: number; crowding?: number };

/** The build: needs R2 and at least 100 members with bars and facts. */
export async function buildFactors(deadline: number, years = 6): Promise<BuildResult> {
  if (!r2Ready()) return { ok: false, reason: "R2 is not configured: the point-in-time store has no bars or facts to build from." };
  const from = new Date(Date.now() - years * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const { stocks, missingBars, missingFacts } = await inputs(from, deadline - 60_000);
  if (stocks.length < 100) return { ok: false, reason: `Only ${stocks.length} members have both bars and facts stored; the build waits for 100.`, missingBars, missingFacts };
  const spy = await storedBars("SPY");
  const bil = await storedBars("BIL");
  if (!spy) return { ok: false, reason: "SPY's bars are not stored yet." };
  const market = barReturns(sliceBars(spy, from));
  const rfr = bil ? barReturns(sliceBars(bil, from)) : { dates: [], ret: [] };
  const rf = new Map(rfr.dates.map((d, i) => [d, rfr.ret[i]]));
  const dates = market.dates;
  const fr = factorReturns(stocks, dates, market, rf);
  // Replace this version's rows over the built span, in chunks.
  const db = requireDb();
  if (fr.dates.length) await db.delete(schema.quantFactorReturns).where(and(eq(schema.quantFactorReturns.universe, UNIVERSE), eq(schema.quantFactorReturns.version, ENGINE_VERSION), gte(schema.quantFactorReturns.date, fr.dates[0])));
  const rows = fr.dates.flatMap((d, t) => FACTOR_KEYS.map((f) => ({ date: d, factor: f, universe: UNIVERSE, version: ENGINE_VERSION, ret: fr.factors[f][t] }))).filter((r) => Number.isFinite(r.ret));
  for (let k = 0; k < rows.length; k += 2_000) await db.insert(schema.quantFactorReturns).values(rows.slice(k, k + 2_000)).onConflictDoNothing();
  // The risk model's exposures and specific risk.
  const cs = crossSection(stocks, dates.slice(-400), market);
  await putJson(`quant/exposures/${UNIVERSE}/latest.json`, cs.exposures);
  await setJobState("quant.exposures", { asOf: cs.exposures.asOf, keys: cs.exposures.keys, version: cs.exposures.version, symbols: Object.keys(cs.exposures.bySymbol).length });
  // Crowding at each of the last 36 month ends.
  const held = await hedgeFundHoldings().catch(() => new Map<string, number>());
  const mm = new Map(market.dates.map((d, i) => [d, market.ret[i]]));
  const points: CrowdingPoint[] = [];
  const ends = monthEnds(dates).slice(-36);
  for (const end of ends) {
    if (Date.now() > deadline - 15_000) break;
    const chars = stocks.map((s) => characteristics(s, end, mm)).filter((c): c is Chars => !!c);
    if (chars.length < 50) continue;
    const bySym = new Map(chars.map((c) => [c.symbol, c]));
    for (const s of SORTS) {
      const p = sort2x3(chars, s.char);
      const hi = [...p.SH, ...p.BH], lo = [...p.SL, ...p.BL];
      const longL = (s.long === "high" ? hi : lo).map((x) => bySym.get(x)!), shortL = (s.long === "high" ? lo : hi).map((x) => bySym.get(x)!);
      const weekly = longL.slice(0, 60).map((c) => {
        const st = stocks.find((x) => x.symbol === c.symbol)!;
        const i1 = st.dates.findIndex((d) => d > end);
        const lo52 = Math.max(1, (i1 < 0 ? st.dates.length : i1) - 260);
        const daily: number[] = [], mk: number[] = [];
        for (let k = lo52; k < (i1 < 0 ? st.dates.length : i1); k++) { const m = mm.get(st.dates[k]); if (m !== undefined) { daily.push(st.close[k] / st.close[k - 1] - 1); mk.push(m); } }
        return weeklyExcess(daily, mk);
      }).filter((w) => w.length >= 40);
      const n = Math.min(...weekly.map((w) => w.length));
      points.push({ date: end, factor: s.key, spread: valuationSpread(longL, shortL), comove: weekly.length >= 2 ? comovement(weekly.map((w) => w.slice(-n))) : null, ownership: end === ends[ends.length - 1] ? ownershipShare(longL, held) : null });
    }
  }
  await setJobState("quant.crowding", { points, version: ENGINE_VERSION } as unknown as Record<string, unknown>);
  // This year's return panel (QF3).
  const year = new Date().getUTCFullYear();
  const yd = dates.filter((d) => d.startsWith(String(year)));
  if (yd.length) {
    const series: Record<string, Map<string, number>> = {};
    for (const s of stocks) series[s.symbol] = new Map(s.dates.slice(1).map((d, k) => [d, s.close[k + 1] / s.close[k] - 1]));
    await putObject(panelKey(year, UNIVERSE), encodePanel(buildPanel(year, series, yd)), "application/octet-stream");
  }
  return { ok: true, stocks: stocks.length, days: fr.dates.length, from: fr.dates[0], to: fr.dates.at(-1), written: rows.length, missingBars, missingFacts, crowding: points.length };
}
