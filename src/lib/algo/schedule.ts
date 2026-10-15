/**
 * When each strategy next ticks. Pure, for tests.
 *
 * - Equities: decisions at the open (9:35 ET) or near the close (15:50 ET, so orders can still go in the
 *   session; the decision uses the latest price as the day's close) on trading days, holidays and early
 *   closes from copy trading's exchange calendar. Intraday strategies tick every 60 minutes (every 15 or
 *   30 with `algo.more`) inside the regular session.
 * - Crypto: daily at 20:00 UTC, or every N minutes around the clock for intraday ones.
 * - Free paper strategies decide at most daily; intraday needs `algo.live` (Pro).
 */
import { earlyCloses, isTradingDay, newYorkParts, nextTradingDay } from "@/lib/copytrade/markethours";
import { nyInstant } from "./signals";
import type { StrategySpec } from "./strategy";

export type TickPolicy = { intraday: boolean; minMinutes: number };

/** The first tick strictly after `now`. */
export function nextTickAt(spec: StrategySpec, now: Date, policy: TickPolicy): Date {
  const every = spec.rebalance.every === "intraday" && !policy.intraday ? "daily" : spec.rebalance.every;
  const minutes = Math.max(policy.minMinutes, spec.rebalance.minutes);
  if (spec.assetClass === "crypto") {
    if (every === "intraday") return new Date(Math.floor(now.getTime() / (minutes * 60_000)) * minutes * 60_000 + minutes * 60_000);
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20));
    return d.getTime() > now.getTime() ? d : new Date(d.getTime() + 86_400_000);
  }
  const at = (date: string) => {
    if (every === "intraday") return null;
    if (spec.rebalance.at === "open") return new Date(nyInstant(date, 9, 35));
    const close = earlyCloses(Number(date.slice(0, 4))).has(date) ? 13 * 60 : 16 * 60;
    return new Date(nyInstant(date, Math.floor((close - 10) / 60), (close - 10) % 60));
  };
  let date = newYorkParts(now).date;
  for (let i = 0; i < 10; i++) {
    if (isTradingDay(date)) {
      if (every === "intraday") {
        const close = earlyCloses(Number(date.slice(0, 4))).has(date) ? 13 * 60 : 16 * 60;
        for (let m = 9 * 60 + 30 + minutes; m <= close; m += minutes) {
          const t = new Date(nyInstant(date, Math.floor(Math.min(m, close - 5) / 60), Math.min(m, close - 5) % 60));
          if (t.getTime() > now.getTime()) return t;
        }
      } else {
        const t = at(date)!;
        if (t.getTime() > now.getTime()) return t;
      }
    }
    date = nextTradingDay(date, false);
  }
  return new Date(now.getTime() + 86_400_000);
}
