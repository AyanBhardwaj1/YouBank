/**
 * What a strategy needs before it may trade for real, decided in one pure function so the server, the UI's
 * checklist and the tests agree (scripts/test-algo.ts). The server calls it when a mode is switched and
 * again before every live order; anything unmet stops the order, whatever the stored mode says.
 *
 * Live with approval (each batch tapped): ALGO_LIVE_ENABLED=1 on the server, the `algo.live` feature (Pro),
 * both consents (algo trading, real orders), a connected account whose broker allows trading through its
 * API, every risk limit saved explicitly, long-only, no kill switch on, and Quant's integrity grade not D or
 * F unless the person typed the override (contract rule 6).
 * Live autonomous adds: the `algo.autonomous` feature (Deal Team), at least ALGO_MIN_PAPER_DAYS (14) days of
 * paper trading, and the per-strategy consent with the typed phrase. A broker's own paper account (Alpaca
 * paper) satisfies the connection, so the live wiring can be practised end to end without real money.
 */
import { autonomousPhrase } from "./disclosures";
import { gradeOverridePhrase, needsGradeOverride, type IntegrityReport } from "./signals";
import type { StrategySpec } from "./strategy";

export type LiveMode = "live_approval" | "live_auto";
export type Unmet = { key: string; message: string };

export type LiveGateInput = {
  mode: LiveMode;
  spec: StrategySpec;
  envEnabled: boolean;
  plan: { live: boolean; autonomous: boolean };
  consents: { terms: boolean; live: boolean; autonomous: boolean };
  connection: { connected: boolean; tradingAllowed: boolean; supportsAsset: string | null };
  paperStartedAt: Date | null;
  minPaperDays: number;
  riskConfirmed: boolean;
  kill: { global: boolean; user: boolean; strategy: boolean };
  integrity: IntegrityReport | null;
  gradeOverride: string | null;
  /** The phrase typed now (switching to autonomous). Null when re-checking before an order (the stored consent counts). */
  typed: string | null;
  now: Date;
};

export function liveRequirements(i: LiveGateInput): { ok: boolean; unmet: Unmet[] } {
  const u: Unmet[] = [];
  const add = (key: string, message: string) => u.push({ key, message });
  if (!i.envEnabled) add("server", "Real trading is switched off on this server (ALGO_LIVE_ENABLED). Backtests and paper trading keep working.");
  if (!i.plan.live) add("plan", "Live trading with approval is part of the Pro plan.");
  if (i.mode === "live_auto" && !i.plan.autonomous) add("plan_auto", "Autonomous trading is part of the Deal Team plan.");
  if (!i.consents.terms) add("consent_terms", "Accept how algo trading works first.");
  if (!i.consents.live) add("consent_live", "Accept the risks of real orders first.");
  if (!i.connection.connected) add("connection", "Choose a connected brokerage account for this strategy.");
  else if (!i.connection.tradingAllowed) add("connection_trading", "That broker does not allow trading through its API for this account.");
  if (i.connection.supportsAsset) add("asset", i.connection.supportsAsset);
  if (!i.riskConfirmed) add("risk", "Review and save every risk limit for this strategy (per order, per day, position, exposure, daily loss, drawdown, throttles, fat-finger).");
  if (i.spec.risk.allowShort) add("short", "Live strategies are long-only: turn short selling off.");
  if (i.kill.global) add("kill_global", "Trading is paused for everyone by YouBank's administrators.");
  if (i.kill.user) add("kill_user", "Your kill switch is on.");
  if (i.kill.strategy) add("kill_strategy", "This strategy's kill switch is on: review it first.");
  if (needsGradeOverride(i.integrity) && (i.gradeOverride ?? "").trim().toUpperCase() !== gradeOverridePhrase(i.integrity!)) add("integrity", `Quant's integrity check grades this strategy ${i.integrity!.grade}. To trade it live anyway, type "${gradeOverridePhrase(i.integrity!)}" (it is logged).`);
  if (i.mode === "live_auto") {
    const days = i.paperStartedAt ? (i.now.getTime() - i.paperStartedAt.getTime()) / 86_400_000 : 0;
    if (days < i.minPaperDays) add("paper_days", `Run it on paper for ${i.minPaperDays} days first (${Math.floor(days)} so far).`);
    if (i.typed === null ? !i.consents.autonomous : i.typed.trim().toUpperCase().replace(/\s+/g, " ") !== autonomousPhrase(i.spec.name)) add("typed", `Type "${autonomousPhrase(i.spec.name)}" to let it trade without asking.`);
  }
  return { ok: u.length === 0, unmet: u };
}
