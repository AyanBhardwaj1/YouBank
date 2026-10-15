/**
 * QF1 adapter `copy.13f`: copy trading's 13F clones as TargetPortfolios the algo engine can follow, and copy
 * trading's lag-aware clone backtests as trials with an integrity grade (Q3 grades the existing clones too).
 *
 * - A person's copy (copy_portfolios) becomes key `copy:<id>`, owned by them. A curated fund's default clone
 *   (top 20) becomes the impersonal key `copy:fund:<cik>`.
 * - asOf is the end of the latest 13F's filing date (EDGAR's daily index gives the date, not the acceptance
 *   time, so the conservative end of that day); notBefore is the next session's open. The backtest buys at the
 *   first close after the filing date, so the window is "close".
 * - Disclosures: hypothetical, not advice, and the 13F timing note.
 */
import { createHash } from "node:crypto";
import { copyTargets, type Backtest } from "@/lib/copytrade/analytics";
import { storedFilings } from "@/lib/copytrade/edgar13f";
import { curatedByCik, padCik } from "@/lib/copytrade/funds";
import { getCopy } from "@/lib/copytrade/portfolios";
import { DEFAULT_RULES, cleanRules, type CloneRules } from "@/lib/copytrade/targets";
import { CONTRACT_VERSION, type IntegrityReport, type TargetPortfolio, type TargetWeight } from "../contracts";
import { assess } from "../integrity/assess";
import { newYorkTime, nextOpenAfter, prevSession, sessionClose } from "../pit/calendar";
import { saveTarget, type SaveResult } from "../targets";
import { familyTrials, logTrial } from "../trials";
import { T } from "../words";

export const COPY_PRODUCER_VERSION = "2026-10-15.1";

const DAY = 86_400_000;
const sym = (t: string) => t.toUpperCase().replace(/\./g, "-");

/** The latest filing date among the funds' latest accessions (a copy of several funds follows the newest). */
async function latestFiled(funds: { cik: string; accession: string | null }[]): Promise<string | null> {
  let best: string | null = null;
  for (const f of funds) {
    if (!f.accession) continue;
    const filed = (await storedFilings(f.cik)).find((x) => x.accession === f.accession)?.filedOn ?? null;
    if (filed && (!best || filed > best)) best = filed;
  }
  return best;
}

/** Build a TargetPortfolio from clone targets. Pure apart from the inputs. */
export function cloneToTarget(o: {
  key: string; ownerId: string | null; name: string; filedOn: string; periods: string[]; accessions: string[];
  targets: { ticker: string; weight: number; name: string }[]; rules: CloneRules; integrity?: IntegrityReport | null;
}): Omit<TargetPortfolio, "version"> {
  // The end of the filing date in New York: a 13F filed that day is public by then.
  const asOf = newYorkTime(o.filedOn, "23:59");
  const weights: TargetWeight[] = o.targets.filter((t) => t.weight > 0).map((t, i) => ({
    instrument: { symbol: sym(t.ticker), assetClass: "equity", currency: "USD" },
    weight: Math.round(t.weight * 1e8) / 1e8, reason: T.cloneWeight(i + 1),
  }));
  const net = weights.reduce((s, w) => s + w.weight, 0);
  const maxW = Math.max(0, ...weights.map((w) => w.weight));
  return {
    contract: CONTRACT_VERSION, key: o.key, producer: "copy.13f", producerVersion: COPY_PRODUCER_VERSION, ownerId: o.ownerId, name: o.name,
    asOf, validUntil: new Date(Date.parse(asOf) + 140 * DAY).toISOString(), weights, cashWeight: Math.round((1 - net) * 1e8) / 1e8,
    constraints: { longOnly: true, maxWeight: Math.min(1, maxW + 1e-9), maxNames: o.rules.topN > 0 ? o.rules.topN : undefined, maxGross: 1 + 1e-9, netRange: [0, 1 + 1e-9], excluded: o.rules.excludeTickers.map(sym) },
    rebalance: { policy: "on_change", window: "close", notBefore: nextOpenAfter(asOf) },
    sizing: { method: "fixed" },
    risk: { exAnteVol: 0, model: "not estimated here: run Risk on the target for its volatility" },
    ...(o.integrity ? { integrity: o.integrity } : {}),
    disclosures: ["hypothetical", "not_advice", "timing_13f"],
    provenance: { signalIds: [], inputsHash: createHash("sha256").update(JSON.stringify([o.accessions, o.rules])).digest("hex").slice(0, 32), recipe: `copytrade/targets.ts cloneTargets: top ${o.rules.topN || "all"} long equity positions of the 13F for ${o.periods.join(", ")}, share classes merged, rescaled to 100%` },
  };
}

/** A person's copy as a target, saved as the next version when it changed. */
export async function syncCopyTarget(userId: string, copyId: number): Promise<SaveResult | null> {
  const row = await getCopy(userId, copyId);
  const rules = cleanRules(row.rules as Record<string, unknown>);
  const funds = row.funds.map((f) => ({ cik: padCik(f.cik), weight: f.weight }));
  const t = await copyTargets(funds, rules, false);
  const filedOn = await latestFiled(t.funds);
  if (!filedOn || !t.targets.length) return null;
  const integrity = funds.length === 1 ? await cloneIntegrity(funds[0].cik).catch(() => null) : null;
  return saveTarget(cloneToTarget({
    key: `copy:${row.id}`, ownerId: userId, name: row.name, filedOn, periods: t.funds.map((f) => f.period ?? "").filter(Boolean), accessions: t.funds.map((f) => f.accession ?? "").filter(Boolean),
    targets: t.targets, rules, integrity,
  }));
}

/** A curated fund's default clone (top 20) as an impersonal target. */
export async function syncFundTarget(cik: string): Promise<SaveResult | null> {
  const c = padCik(cik);
  const t = await copyTargets([{ cik: c, weight: 1 }], DEFAULT_RULES, false);
  const filedOn = await latestFiled(t.funds);
  if (!filedOn || !t.targets.length) return null;
  const name = curatedByCik(c)?.name ?? `Fund ${Number(c)}`;
  return saveTarget(cloneToTarget({ key: `copy:fund:${c}`, ownerId: null, name: `${name}: 13F clone, top 20`, filedOn, periods: t.funds.map((f) => f.period ?? "").filter(Boolean), accessions: t.funds.map((f) => f.accession ?? "").filter(Boolean), targets: t.targets, rules: DEFAULT_RULES, integrity: await cloneIntegrity(c).catch(() => null) }));
}

/* ---------------- Clone backtests as trials ---------------- */

export const cloneFamily = (cik: string) => `copy:fund:${padCik(cik)}`;

/** The clone backtest's hygiene: point in time by construction (each filing used after its filing date). */
export function cloneHygiene(bt: Pick<Backtest, "rebalances">, turnover: number) {
  return {
    executionLagBars: 1, survivorshipSafe: false, universe: "the fund's 13F holdings mapped to today's tickers", fundamentals: "none" as const,
    // Each rebalance trades at the first close after the filing date, so the filing was public by the end of the
    // previous session's day at the latest (a conservative knownAt).
    reads: bt.rebalances.map((r) => ({ key: `13F ${r.period}`, knownAt: newYorkTime(prevSession(r.date, false), "23:59"), usedAt: sessionClose(r.date) })),
    costBpsAssumed: 0, turnover,
  };
}

/**
 * Log a clone backtest as a trial of the fund's family (each top-N someone tries is a variant) and grade it.
 * `daily` is the lagged clone's daily return series with dates. Returns the contract report.
 */
export async function gradeCloneBacktest(cik: string, bt: Pick<Backtest, "rebalances" | "topN">, daily: { dates: string[]; returns: number[] }, turnoverPerYear: number): Promise<IntegrityReport | null> {
  if (daily.returns.length < 60) return null;
  const family = cloneFamily(cik);
  const hygiene = { ...cloneHygiene(bt, turnoverPerYear), dates: daily.dates };
  await logTrial({ family, params: { topN: bt.topN }, returns: daily.returns, ownerId: null, source: "copy", periodsPerYear: 252, startDate: daily.dates[0], endDate: daily.dates.at(-1), hygiene }).catch(() => null);
  const rows = await familyTrials(family, { ownerId: null, limit: 200 }).catch(() => []);
  const a = assess({ returns: daily.returns, dates: daily.dates, periodsPerYear: 252, trialSharpes: rows.length ? rows.map((r) => r.sharpe ?? NaN) : [NaN], hygiene, pro: false });
  return a.report;
}

/** The latest grade of a fund's clone family, from its logged trials. */
export async function cloneIntegrity(cik: string): Promise<IntegrityReport | null> {
  const { integrityCheck } = await import("../integrity/check");
  const r = await integrityCheck(cloneFamily(cik), { ownerId: null, save: false }).catch(() => null);
  return r?.report ?? null;
}

/** Annual turnover of a clone from its rebalance weights (in copytrade/backtest.ts, where the backtest uses it). */
export { annualTurnover as cloneTurnover } from "@/lib/copytrade/backtest";
