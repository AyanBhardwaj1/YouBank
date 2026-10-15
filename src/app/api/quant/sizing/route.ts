import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { CROSS_SITE, jsonBody, refuse, requireQuantConsent, sameSiteJson } from "@/lib/quant/access";
import { cleanHoldings } from "@/lib/quant/holdings";
import { fundReturns, align } from "@/lib/quant/factors/etf";
import { familyTrials, loadReturns } from "@/lib/quant/trials";
import { bootstrapDrawdowns, buildRiskBudget, governor, inverseVol, kelly, POD_RULES, riskParity, volTarget, type Rule, type Template } from "@/lib/quant/sizing/governor";
import { latestRiskBudget, saveRiskBudget } from "@/lib/quant/sizing/store";
import { ledoitWolf } from "@/lib/quant/stats/shrink";
import { DISCLOSURES } from "@/lib/quant/words";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const n = (v: unknown, lo: number, hi: number, name: string) => { const x = Number(v); if (!Number.isFinite(x) || x < lo || x > hi) throw refuse(`${name} must be between ${lo} and ${hi}.`); return x; };
const ago = (y: number) => new Date(Date.now() - y * 365.25 * 86_400_000).toISOString().slice(0, 10);

/** GET — the person's latest risk budget (the one the algo engine reads). */
export async function GET(req: Request) {
  return guarded(async (user) => NextResponse.json({ budget: await latestRiskBudget(user.id, new URL(req.url).searchParams.get("account")) }));
}

/**
 * POST { mode, ... } — the calculators (free, for the inputs entered, nothing taken from an account balance):
 * - kelly: { kind: "bet", pLow, pHigh, odds, current? } or { kind: "asset", sharpeLow, sharpeHigh, vol, current? }
 * - parity: { holdings } (risk parity and inverse volatility from two years of prices; above five assets is Pro)
 * - voltarget: { symbol | returns, target }
 * - governor: { returns? | symbol? | family? (Pro), template } simulated on that history
 * - budget: { ...choices } saves a RiskBudget for the algo engine (quant.sizing-pro)
 */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const b = await jsonBody(req);
    switch (b.mode) {
      case "kelly": {
        const k = b.kind === "asset"
          ? kelly({ kind: "asset", sharpeLow: n(b.sharpeLow, -3, 5, "The low Sharpe ratio"), sharpeHigh: n(b.sharpeHigh, -3, 5, "The high Sharpe ratio"), vol: n(b.vol, 0.01, 2, "Volatility"), current: b.current === undefined || b.current === "" ? undefined : n(b.current, 0, 10, "Your size") })
          : kelly({ kind: "bet", pLow: n(b.pLow, 0.01, 0.99, "The low probability"), pHigh: n(b.pHigh, 0.01, 0.99, "The high probability"), odds: n(b.odds, 0.01, 100, "The odds"), current: b.current === undefined || b.current === "" ? undefined : n(b.current, 0, 1, "Your stake") });
        return NextResponse.json({ kelly: k });
      }
      case "parity": {
        const holdings = cleanHoldings(b.holdings);
        if (holdings.length > 5) await requireFeature(user, "quant.sizing-pro");
        if (holdings.length < 2) throw refuse("Risk parity needs at least two assets.");
        const series = await fundReturns(holdings.map((h) => h.symbol), ago(2.05));
        const syms = holdings.map((h) => h.symbol).filter((s) => series[s]?.dates.length > 250);
        const a = align(series, syms);
        if (a.rows.length < 250) throw refuse("Not enough common daily history (250 days) for these assets.", 422);
        const cov = ledoitWolf(a.rows).cov;
        const rp = riskParity(cov);
        return NextResponse.json({ symbols: syms, riskParity: rp.weights, contributions: rp.contributions, inverseVol: inverseVol(cov.map((r, i) => Math.sqrt(r[i]))), vols: cov.map((r, i) => Math.sqrt(r[i] * 252)), disclosure: DISCLOSURES.calculator, method: "Equal risk contributions from a Ledoit-Wolf covariance of two years of daily returns" });
      }
      case "voltarget": {
        let r: number[] = Array.isArray(b.returns) ? (b.returns as unknown[]).map(Number).filter(Number.isFinite) : [];
        if (!r.length && typeof b.symbol === "string") r = (await fundReturns([b.symbol.toUpperCase()], ago(1.1)))[b.symbol.toUpperCase()]?.ret ?? [];
        if (r.length < 40) throw refuse("Give a symbol with a year of prices, or at least 40 daily returns.");
        return NextResponse.json({ volTarget: volTarget(r, n(b.target, 0.01, 1, "The target volatility")), disclosure: DISCLOSURES.calculator });
      }
      case "governor": {
        let r: number[] = Array.isArray(b.returns) ? (b.returns as unknown[]).map(Number).filter(Number.isFinite) : [];
        let dates: string[] | undefined;
        if (!r.length && typeof b.family === "string") {
          await requireFeature(user, "quant.sizing-pro");
          const rows = await familyTrials(b.family, { ownerId: user.id, limit: 500 });
          const best = [...rows].sort((x, y) => (y.sharpe ?? -9) - (x.sharpe ?? -9))[0];
          r = best ? (await loadReturns(best)) ?? [] : [];
        } else if (!r.length && typeof b.symbol === "string") {
          const s = (await fundReturns([b.symbol.toUpperCase()], ago(Math.min(Number(b.years) || 10, 20))))[b.symbol.toUpperCase()];
          r = s?.ret ?? []; dates = s?.dates;
        }
        if (r.length < 60) throw refuse("Give a symbol with history, a strategy family, or at least 60 daily returns.");
        const t = b.template as Record<string, unknown> | undefined;
        const template: Template = t?.kind === "floor" ? { kind: "floor", floorPct: n(t.floorPct ?? 0.8, 0.5, 0.99, "The floor"), multiplier: n(t.multiplier ?? 3, 1, 10, "The multiplier") }
          : t?.kind === "custom" ? { kind: "custom", rules: (Array.isArray(t.rules) ? t.rules : []).slice(0, 6).map((x: Record<string, unknown>) => ({ fromPeakPct: n(x.fromPeakPct, 0.005, 0.9, "A rule's level"), action: (["halve", "flatten", "pause_new", "notify"].includes(String(x.action)) ? x.action : "notify") as Rule["action"] })), pauseSessions: Math.round(n(t.pauseSessions ?? 10, 0, 60, "The pause")) } : { kind: "pod" };
        const run = governor(r, template, dates);
        const fractions = [1, 0.5, 0.25].map((f) => ({ fraction: f, y1: bootstrapDrawdowns(r, f, 1, 500), y3: bootstrapDrawdowns(r, f, 3, 300) }));
        return NextResponse.json({ governor: { ...run, exposure: run.exposure.filter((_, i) => i % 5 === 0) }, drawdowns: fractions, disclosure: DISCLOSURES.hypothetical });
      }
      case "budget": {
        await requireQuantConsent(user.id);
        await requireFeature(user, "quant.sizing-pro");
        const rules = (Array.isArray(b.rules) ? (b.rules as Record<string, unknown>[]) : POD_RULES).slice(0, 6).map((x) => ({ fromPeakPct: n(x.fromPeakPct, 0.005, 0.9, "A rule's level"), action: (["halve", "flatten", "pause_new", "notify"].includes(String(x.action)) ? x.action : "notify") as Rule["action"] }));
        const budget = buildRiskBudget({ ownerId: user.id, accountRef: typeof b.accountRef === "string" ? b.accountRef : null, kelly: null, ofKelly: n(b.ofKelly ?? 0.25, 0, 1, "The Kelly fraction"), rules, volTarget: b.volTarget ? n(b.volTarget, 0.01, 1, "The volatility target") : null, maxPositionWeight: n(b.maxPositionWeight ?? 0.1, 0.005, 1, "The largest position"), maxGross: n(b.maxGross ?? 1, 0.05, 4, "Gross exposure"), maxDailyLossPct: n(b.maxDailyLossPct ?? 0.03, 0.001, 1, "The daily loss limit") });
        const saved = await saveRiskBudget(budget, b);
        return NextResponse.json({ budget, ...saved }, { status: 201 });
      }
      default: throw refuse("mode must be kelly, parity, voltarget, governor or budget.");
    }
  });
}
