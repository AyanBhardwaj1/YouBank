/**
 * Latency budgets for the data layer, in one place (docs/data-layer.md). Two modes:
 * - "interactive": a person is waiting on a route (the terminal, DES/FA/COMPS). Upstream attempts are
 *   short, the next source starts while a slow one is still running (a hedge), and nothing retries
 *   inside the budget, because the next source is the retry.
 * - "background": crons, Inngest jobs and scripts. They keep the longer timeouts and retries they had,
 *   and fall back only after the primary has failed (no hedge, so no extra calls).
 * Background is the default: code reached from a job never inherits interactive budgets by accident.
 * Routes opt in with `withMode("interactive", fn)`.
 *
 * Anchors: Nielsen's 1 s / 10 s limits (flow of thought, attention) and the route limit (maxDuration 60 s
 * on /api/terminal). Every interactive worst case below must stay well under 60 s; `worstCase()` derives
 * the table from these numbers and scripts/test-datalayer.ts checks it with stubbed sources.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type BudgetMode = "interactive" | "background";

const S = 1_000, MIN = 60 * S, HOUR = 60 * MIN, DAY = 24 * HOUR;

/* ---------------- Interactive ---------------- */

/** Start the next source when the first has not answered in this long. 2.5 s: above a healthy provider's
 *  usual answer (FMP and Nasdaq answer in well under a second when well), so at most a few percent of
 *  calls are hedged, and early enough that a person sees an answer before the 10 s attention limit. */
export const HEDGE_DELAY_MS = 2_500;
/** FMP's hard timeout per attempt on interactive paths, no retry. A hang costs at most this. */
export const FMP_INTERACTIVE_TIMEOUT_MS = 6_000;
/** Nasdaq (backup) per attempt on interactive paths. */
export const NASDAQ_INTERACTIVE_TIMEOUT_MS = 6_000;
/** ECB rates and CoinGecko (backups) per attempt on interactive paths. */
export const FREE_INTERACTIVE_TIMEOUT_MS = 6_000;
/** SEC EDGAR per attempt on interactive paths: companyfacts can be several MB, so longer than a quote. */
export const SEC_INTERACTIVE_TIMEOUT_MS = 12_000;
/** Treasury, FRED and BLS per attempt on interactive paths (a stale copy stands in when they fail). */
export const MACRO_INTERACTIVE_TIMEOUT_MS = 8_000;
/** Tries for a slot in FMP's shared per-second budget (300–700 ms apart): about 2 s before "busy". */
export const FMP_SLOT_TRIES_INTERACTIVE = 4;
/** AI web research on the request path, both lookups together, enforced with an abort. 25 s keeps a
 *  feed hedge (≤ 8.5 s) plus research inside the terminal's 60 s limit with room to render. */
export const RESEARCH_BUDGET_MS = 25_000;

/* ---------------- Background (what the code used before this module) ---------------- */

export const FMP_BACKGROUND_TIMEOUT_MS = 10_000;
export const NASDAQ_BACKGROUND_TIMEOUT_MS = 12_000;
export const FREE_BACKGROUND_TIMEOUT_MS = 12_000;
export const SEC_BACKGROUND_TIMEOUT_MS = 25_000;
export const MACRO_BACKGROUND_TIMEOUT_MS = 15_000;
export const FMP_SLOT_TRIES_BACKGROUND = 10;

/* ---------------- Parallel work ---------------- */

/** SECT: snapshot dates tried at once (newest wins): weekends and holidays need up to six. */
export const SECT_DATE_CONCURRENCY = 3;
/** WEI/FXC/CMDTY: board quotes at once (a board has at most 15 rows; FMP's per-second budget is 21). */
export const BOARD_QUOTE_CONCURRENCY = 15;
/** PULSE: state WARN files read at once on the first request of the day (6 states, 30 s each). */
export const PULSE_STATE_CONCURRENCY = 3;
/** PULSE: one WARN file's timeout (unchanged). */
export const PULSE_STATE_TIMEOUT_MS = 30_000;

/* ---------------- Circuit breakers (breaker.ts) ---------------- */

/** Failures within the window that open a source's breaker for everyone. Ten in a minute is an outage,
 *  not a blip: at FMP's 250 calls a minute a 2 % error rate stays below it. */
export const BREAKER_FAILURES = 10;
export const BREAKER_WINDOW_MS = MIN;
/** How long an open breaker answers "skip" before one probe is let through (half-open). */
export const BREAKER_COOLDOWN_MS = 30 * S;
/** The half-open probe's lease: one probe at a time, across instances. */
export const BREAKER_PROBE_LEASE_MS = 20 * S;
/** How long an instance trusts its copy of a breaker before reading the shared row again. */
export const BREAKER_MEMORY_MS = 5 * S;

/* ---------------- Hedging needs a reason (cap on extra calls) ---------------- */

/** With at least this many recent calls whose p95 is under the hedge delay, a closed breaker and an error
 *  rate under HEDGE_HEALTHY_ERROR_RATE, the primary is not hedged: a slow call waits for its timeout. */
export const HEDGE_MIN_SAMPLES = 20;
export const HEDGE_HEALTHY_ERROR_RATE = 0.05;
/** The window of recent calls kept per source in memory for that decision. */
export const RECENT_WINDOW_MS = 5 * MIN;

/* ---------------- Stale windows (cache.ts) ---------------- */

/** Market data may stand in, flagged stale, for a day when every source fails. */
export const MARKET_STALE_IF_ERROR_MS = DAY;
/** SEC documents and the assembled company record: a week (statements change quarterly). */
export const SEC_STALE_IF_ERROR_MS = 7 * DAY;
/** Macro series and the yield curve: three days (they publish daily at most). */
export const MACRO_STALE_IF_ERROR_MS = 3 * DAY;

/* ---------------- Telemetry (stats.ts) ---------------- */

/** Per-minute rollups are written at most this often per instance, in one statement. */
export const STATS_FLUSH_MS = 10 * S;

/* ---------------- The mode, per request ---------------- */

const modeStore = new AsyncLocalStorage<BudgetMode>();

/** Run `fn` with `mode` budgets (routes: "interactive"). */
export const withMode = <T>(mode: BudgetMode, fn: () => Promise<T>): Promise<T> => modeStore.run(mode, fn);
/** The current mode: background unless a route said otherwise. */
export const currentMode = (): BudgetMode => modeStore.getStore() ?? "background";

export type Budget = {
  hedgeDelayMs: number | null; fmpTimeoutMs: number; fmpRetries: number; fmpSlotTries: number;
  nasdaqTimeoutMs: number; nasdaqRetries: number; freeTimeoutMs: number; secTimeoutMs: number; macroTimeoutMs: number; researchMs: number;
};

const INTERACTIVE: Budget = {
  hedgeDelayMs: HEDGE_DELAY_MS, fmpTimeoutMs: FMP_INTERACTIVE_TIMEOUT_MS, fmpRetries: 0, fmpSlotTries: FMP_SLOT_TRIES_INTERACTIVE,
  nasdaqTimeoutMs: NASDAQ_INTERACTIVE_TIMEOUT_MS, nasdaqRetries: 0, freeTimeoutMs: FREE_INTERACTIVE_TIMEOUT_MS, secTimeoutMs: SEC_INTERACTIVE_TIMEOUT_MS,
  macroTimeoutMs: MACRO_INTERACTIVE_TIMEOUT_MS, researchMs: RESEARCH_BUDGET_MS,
};
const BACKGROUND: Budget = {
  hedgeDelayMs: null, fmpTimeoutMs: FMP_BACKGROUND_TIMEOUT_MS, fmpRetries: 1, fmpSlotTries: FMP_SLOT_TRIES_BACKGROUND,
  nasdaqTimeoutMs: NASDAQ_BACKGROUND_TIMEOUT_MS, nasdaqRetries: 1, freeTimeoutMs: FREE_BACKGROUND_TIMEOUT_MS, secTimeoutMs: SEC_BACKGROUND_TIMEOUT_MS,
  macroTimeoutMs: MACRO_BACKGROUND_TIMEOUT_MS, researchMs: RESEARCH_BUDGET_MS,
};

/** Test hook: scaled-down budgets (scripts/test-datalayer.ts), so a hang costs milliseconds, not seconds. */
const overrides: { interactive: Partial<Budget>; background: Partial<Budget> } = { interactive: {}, background: {} };
export function overrideBudgets(mode: BudgetMode, b: Partial<Budget>) { overrides[mode] = { ...overrides[mode], ...b }; }

/** The numbers for `mode` (default: the current one). */
export function budget(mode: BudgetMode = currentMode()): Budget {
  return { ...(mode === "interactive" ? INTERACTIVE : BACKGROUND), ...overrides[mode] };
}

/**
 * Worst case before a person sees an answer when the primary hangs and the backups answer in
 * `backupMs` per call, derived from the budgets (interactive mode). Pure. `before` is the same derivation
 * for the code before this module (docs/data-layer.md has both tables).
 */
export function worstCase(backupMs: number, b: Budget = budget("interactive")) {
  const hedge = b.hedgeDelayMs ?? b.fmpTimeoutMs;
  return {
    /** GP/HP/BETA/RISK: hedge, then Nasdaq's asset-class probe (both classes at once) and history. */
    history: hedge + 2 * backupMs,
    /** DES price: hedge, then Nasdaq quote and summary (probe first, then both at once). */
    profile: hedge + 2 * backupMs,
    /** WEI/FXC/CMDTY: quotes and histories at once; rows with no backup quote wait for FMP's timeout. */
    board: Math.max(b.fmpTimeoutMs, hedge + 2 * backupMs),
    /** SECT: the FMP path hedged by the sector ETFs (probe and history per ETF, all at once). */
    sectors: hedge + 2 * backupMs,
    /** MA: FMP hedged by EDGAR full-text search and the ticker map. */
    deals: hedge + backupMs,
    /** PULSE first request of the day: states in waves of PULSE_STATE_CONCURRENCY. */
    pulse: Math.ceil(6 / PULSE_STATE_CONCURRENCY) * PULSE_STATE_TIMEOUT_MS,
    /** AI research on the request path. */
    research: b.researchMs,
  };
}
