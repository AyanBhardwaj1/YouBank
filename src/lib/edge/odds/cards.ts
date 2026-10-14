/**
 * When the Deal Radar posts a finding (E4, kind deal_odds): when a company's 12-month odds pass both twice
 * its sector's base rate and 10%, or rise by five points or more in a week with a new dated signal (a 13D,
 * an officer change, a rights plan, a proxy contest filed that week). The wording is always a model
 * probability with its interval, the base rate and a disclaimer; it never says a sale "will" happen. Pure.
 */
import { DISCLAIMER, type Reason } from "./model";
import { FEATURE } from "./features";

export type OddsScore = { nodeId: number; ticker: string; name: string; p: number; low: number | null; high: number | null; base: number; previous: number | null; reasons: (Reason & { url?: string })[]; signals: string[]; history: number[]; version: string; week: string };

const pct = (v: number, dp = 0) => `${(v * 100).toFixed(dp)}%`;

/** Whether a score earns a card, and why. Pure. */
export function cardReason(s: Pick<OddsScore, "p" | "base" | "previous" | "signals">): "level" | "rise" | null {
  const rise = s.previous !== null ? s.p - s.previous : 0;
  if (rise >= 0.05 && s.signals.length) return "rise";
  // A level card when the odds cross the line (not every week they stay above it).
  if (s.p >= Math.max(2 * s.base, 0.1) && (s.previous === null || s.previous < Math.max(2 * s.base, 0.1))) return "level";
  return null;
}

/** The card for a score: title, summary and the visual the feed and alerts read. Pure. */
export function oddsCard(s: OddsScore, why: "level" | "rise") {
  const rise = s.previous !== null ? s.p - s.previous : null;
  const top = s.reasons.filter((r) => r.direction === "up").slice(0, 2).map((r) => r.label);
  const signalWords = s.signals.map((k) => FEATURE[k]?.up ?? k);
  const interval = s.low !== null && s.high !== null ? ` (interval ${pct(s.low)} to ${pct(s.high)})` : "";
  return {
    key: `odds:${s.nodeId}:${s.week}`,
    title: why === "rise"
      ? `Deal Radar: ${s.name}'s 12-month sale odds rose to ${pct(s.p)}${signalWords.length ? `: ${signalWords.slice(0, 2).join(", ")}` : ""}`
      : `Deal Radar: the model puts ${s.name}'s 12-month sale odds at ${pct(s.p)}, ${(s.p / Math.max(1e-6, s.base)).toFixed(1)}x its sector's base rate`,
    summary: `Model probability of an announced agreement to be acquired within 12 months: ${pct(s.p, 1)}${interval}, against a ${pct(s.base, 1)} base rate for its sector${rise !== null ? `; ${rise >= 0 ? "up" : "down"} ${Math.abs(rise * 100).toFixed(1)} points on the week` : ""}.${top.length ? ` Main reasons: ${top.join("; ")}.` : ""} ${DISCLAIMER}`,
    why: `Discrete-time hazard model on public filings (XBRL as filed, 13D and 8-K filings, the industry's deal wave), calibrated with Venn-Abers; every probability is logged in the forecast ledger and scored when its window closes (Track record).`,
    confidence: Math.max(0.3, 1 - ((s.high ?? s.p) - (s.low ?? s.p))),
    magnitude: Math.min(1, s.p / 0.4),
    visual: { type: "deal_odds", ticker: s.ticker, name: s.name, p: s.p, low: s.low, high: s.high, base: s.base, rise, reasons: s.reasons.slice(0, 3).map((r) => ({ label: r.label, direction: r.direction, url: r.url })), history: s.history.slice(-26), version: s.version, disclaimer: DISCLAIMER },
  };
}

/** The forecast ledger's question for a company's odds. Pure. */
export function oddsQuestion(name: string, ticker: string, closes: Date): string {
  return `${name}${ticker ? ` (${ticker})` : ""} announces an agreement to be acquired by ${closes.toISOString().slice(0, 10)}`;
}
