/**
 * The arithmetic behind the Terminal's Edge monitors, pure and safe in the browser (tested in
 * scripts/test-edge-terminal.ts).
 *
 * Merger arbitrage (MARB), as a risk-arb desk reads a deal: the offer's value today (cash, the exchange
 * ratio times the acquirer's price, or both), the gross spread to the target's price, that spread
 * annualised to the expected close, and the deal odds the market implies between the unaffected price
 * (where the target trades if the deal breaks) and the offer. History (SAT, FLR, ALT): a reading's
 * percentile and z-score against the company's own past, its change against an average, and sparkline
 * geometry. None of it is advice: the screens say how each figure is made.
 */
import { mean, stdev } from "@/lib/edge/sat/score";

const DAY = 86_400_000;
const pos = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/* ---------------- Merger arbitrage ---------------- */

export type Consideration = "cash" | "stock" | "mixed" | "";
/** A deal's terms per target share: the cash, the acquirer's shares (exchange ratio), and the value stated at announcement. */
export type Terms = { consideration: Consideration; cash: number | null; ratio: number | null; stated: number | null };
export type OfferValue = { value: number; basis: "cash" | "stock" | "mixed" | "stated"; note: string };

/**
 * What the offer is worth per target share now. Cash is cash; stock is the exchange ratio at the acquirer's
 * price now; mixed is both. Without the acquirer's price (or the ratio) a stock leg cannot be marked, so the
 * value stated at announcement stands in, and the note says so. Pure.
 */
export function offerValue(t: Terms, acquirerPx: number | null): OfferValue | null {
  const cash = pos(t.cash) ? t.cash : null, ratio = pos(t.ratio) ? t.ratio : null, stated = pos(t.stated) ? t.stated : null;
  const statedValue = (why: string): OfferValue | null => (stated ? { value: stated, basis: "stated", note: `Value stated at announcement: ${why}` } : null);
  if (t.consideration === "cash") {
    const v = cash ?? stated;
    return v ? { value: v, basis: "cash", note: "Cash per share" } : null;
  }
  if (t.consideration === "stock") {
    if (ratio && pos(acquirerPx)) return { value: ratio * acquirerPx, basis: "stock", note: `${ratio} acquirer shares at the acquirer's price now` };
    return statedValue(ratio ? "no acquirer price, so the stock is not marked to market" : "no exchange ratio read yet");
  }
  if (t.consideration === "mixed") {
    if (cash !== null && ratio && pos(acquirerPx)) return { value: cash + ratio * acquirerPx, basis: "mixed", note: `$${cash.toFixed(2)} cash plus ${ratio} acquirer shares at the acquirer's price now` };
    return statedValue("the stock leg is not marked to market");
  }
  return statedValue("the consideration is not read yet");
}

/** The cash leg of a mixed deal: the value stated at signing less the stock at the acquirer's price then. Null when it does not add up. Pure. */
export function cashLeg(stated: number | null, ratio: number | null, acquirerPxAtSigning: number | null): number | null {
  if (!pos(stated) || !pos(ratio) || !pos(acquirerPxAtSigning)) return null;
  const c = stated - ratio * acquirerPxAtSigning;
  return c > 0.005 ? Math.round(c * 100) / 100 : null;
}

/** Gross spread: the offer less the target's price, in dollars and as a share of the price. Pure. */
export function grossSpread(offer: number, targetPx: number): { abs: number; pct: number } | null {
  if (!fin(offer) || !pos(targetPx)) return null;
  return { abs: offer - targetPx, pct: offer / targetPx - 1 };
}

/** A spread earned over `days`, per year: simple (pct × 365 / days) and compounded. Pure. */
export function annualised(pct: number, days: number): { simple: number; compound: number } | null {
  if (!fin(pct) || !fin(days) || days < 1) return null;
  return { simple: (pct * 365) / days, compound: Math.pow(1 + pct, 365 / days) - 1 };
}

/**
 * The deal odds a price implies: where the target trades between its unaffected price (the deal breaks)
 * and the offer (it closes), ignoring time value. Clamped to 0..1; null without a premium. Pure.
 */
export function impliedOdds(targetPx: number, offer: number, unaffected: number | null): number | null {
  if (!pos(targetPx) || !pos(offer) || !pos(unaffected) || offer - unaffected <= 1e-9) return null;
  return Math.max(0, Math.min(1, (targetPx - unaffected) / (offer - unaffected)));
}

/** How long deals usually take, by kind and consideration, from announcement (days). */
const BASE_DAYS: Record<string, number> = { tender: 40, cash: 120, stock: 165, mixed: 165 };
const FOREIGN = /\b(european commission|\beu\b|samr|china|cma|uk\b|competition bureau|accc|foreign|brazil|cade|japan|korea|turkey|mexic)/i;
const SECTOR = /\b(ferc|fcc|puc|public utilit|state (insurance|utility|commission)|nrc|cfius|federal reserve|occ|fdic|bank|insurance|gaming|faa|dot\b|fda|stb|nuclear)/i;
const day = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

export type CloseEstimate = { date: string; days: number; basis: "stated" | "estimate"; overdue: boolean; daysForReturn: number; why: string };

/**
 * When a deal is expected to close. A date the parties stated wins; otherwise an estimate from how long
 * deals of its kind usually take (a tender about six weeks, a cash merger about four months, a stock
 * merger about five and a half), longer with an HSR second request, foreign antitrust or a sector
 * regulator. An estimate already passed is flagged. The annualised return uses at least two weeks, so a
 * deal days from closing (or past its estimate) does not divide by almost nothing. Pure.
 */
export function expectedClose(d: { kind: string; consideration: string; announced: string; approvals: string[]; secondRequest: boolean; stated?: string | null }, now: number): CloseEstimate {
  const today = Date.parse(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z");
  const finish = (date: string, basis: CloseEstimate["basis"], why: string): CloseEstimate => {
    const days = Math.round((day(date) - today) / DAY);
    return { date, days, basis, overdue: days < 0, daysForReturn: Math.max(14, days), why };
  };
  if (d.stated && Number.isFinite(day(d.stated))) return finish(d.stated.slice(0, 10), "stated", "Expected close as the parties stated it");
  const from = d.announced && Number.isFinite(day(d.announced)) ? day(d.announced) : today;
  const key = d.kind === "tender" ? "tender" : d.consideration === "stock" || d.consideration === "mixed" ? d.consideration : "cash";
  let n = BASE_DAYS[key];
  const why = [key === "tender" ? "a tender offer usually closes in about six weeks" : `a ${key} merger usually closes in about ${Math.round(n / 30)} months`];
  const approvals = d.approvals.join("; ");
  if (d.secondRequest) { n += 150; why.push("an HSR second request adds about five months"); }
  if (FOREIGN.test(approvals)) { n += 60; why.push("foreign antitrust review adds about two months"); }
  if (SECTOR.test(approvals)) { n += 90; why.push("a sector regulator adds about three months"); }
  const date = new Date(from + n * DAY).toISOString().slice(0, 10);
  return finish(date, "estimate", `Estimate: ${why.join("; ")}`);
}

export type SpreadRow = { offer: number | null; basis: OfferValue["basis"] | null; note: string; spreadAbs: number | null; spreadPct: number | null; annualised: number | null; annualisedCompound: number | null; implied: number | null };

/** A deal's arbitrage figures from its terms, the prices now and the days to close. Pure. */
export function spreadRow(t: Terms, px: { target: number | null; acquirer: number | null; unaffected: number | null }, days: number): SpreadRow {
  const o = offerValue(t, px.acquirer);
  const s = o && pos(px.target) ? grossSpread(o.value, px.target) : null;
  const a = s ? annualised(s.pct, days) : null;
  return {
    offer: o?.value ?? null, basis: o?.basis ?? null, note: o?.note ?? "Terms not read yet",
    spreadAbs: s?.abs ?? null, spreadPct: s?.pct ?? null, annualised: a?.simple ?? null, annualisedCompound: a?.compound ?? null,
    implied: o && pos(px.target) ? impliedOdds(px.target, o.value, px.unaffected) : null,
  };
}

/**
 * The spread each trading day since announcement: the offer marked at the acquirer's close that day (the
 * last close carried over a gap in its prices) against the target's close. Days before the acquirer's first
 * close, or with no offer value, are skipped. Pure.
 */
export function spreadHistory(t: Terms, target: { date: string; close: number }[], acquirer: { date: string; close: number }[]): { date: string; offer: number; spreadPct: number }[] {
  const acq = [...acquirer].filter((c) => pos(c.close)).sort((a, b) => a.date.localeCompare(b.date));
  // A stock leg is marked each day; a deal whose stock cannot be marked that day has no spread that day.
  const marked = (t.consideration === "stock" || t.consideration === "mixed") && pos(t.ratio);
  const out: { date: string; offer: number; spreadPct: number }[] = [];
  let k = -1;
  for (const c of [...target].sort((a, b) => a.date.localeCompare(b.date))) {
    while (k + 1 < acq.length && acq[k + 1].date <= c.date) k++;
    if (marked && k < 0) continue;
    const o = offerValue(t, marked ? acq[k].close : null);
    const s = o ? grossSpread(o.value, c.close) : null;
    if (o && s && !(marked && o.basis === "stated")) out.push({ date: c.date, offer: o.value, spreadPct: s.pct });
  }
  return out;
}

/* ---------------- Prediction markets on a deal ---------------- */

const DEAL_WORDS = /\b(acqui\w*|merg\w*|deal|takeover|buyout|tender|close[sd]?|closing|complet\w*|approv\w*|block\w*|antitrust|ftc|doj|cma|regulat\w*|sue)\b/i;
const GENERIC = new Set(["the", "inc", "corp", "corporation", "company", "holdings", "group", "resources", "partners", "international", "energy", "global", "technologies"]);
const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).find((w) => w.length >= 4 && !GENERIC.has(w)) ?? "";
const mentions = (text: string, lower: string, name: string, ticker: string) => {
  const k = nameKey(name);
  return (!!k && new RegExp(`\\b${k}\\b`).test(lower)) || (ticker.length >= 2 && new RegExp(`\\b${ticker.replace(/[.\-]/g, "\\$&")}\\b`).test(text));
};

/** Whether a prediction market is about this deal: it names the target and speaks of a deal, a closing or a regulator. Pure. */
export function marketMatchesDeal(m: { title: string; outcome: string; question: string }, deal: { target: string; targetTicker: string; acquirer: string; acquirerTicker: string }): boolean {
  const text = `${m.title} ${m.outcome} ${m.question}`;
  const lower = text.toLowerCase();
  if (!DEAL_WORDS.test(text)) return false;
  // The target must be named: a market that names only the acquirer is usually about its other business.
  return mentions(text, lower, deal.target, deal.targetTicker);
}

/* ---------------- History ---------------- */

/** The share of a history at or below a value (ties count half): 0 is its lowest, 1 its highest. Null without history. Pure. */
export function percentileRank(history: number[], x: number): number | null {
  const h = history.filter(fin);
  if (!h.length || !fin(x)) return null;
  const below = h.filter((v) => v < x).length, equal = h.filter((v) => v === x).length;
  return (below + 0.5 * equal) / h.length;
}

/** A value's z-score against a history (sample standard deviation); null under `minN` points or with no spread. Pure. */
export function zScore(history: number[], x: number, minN = 3): number | null {
  const h = history.filter(fin);
  if (h.length < minN || !fin(x)) return null;
  const sd = stdev(h);
  return sd > 1e-12 ? (x - mean(h)) / sd : null;
}

/** A value against the average of a history, as a fraction (0.5 = 50% above). Null without a positive average. Pure. */
export function vsAverage(current: number, history: number[]): number | null {
  const h = history.filter(fin);
  if (!h.length || !fin(current)) return null;
  const m = mean(h);
  return m > 1e-12 ? current / m - 1 : null;
}

/** A count against its usual rate as a Poisson z: (k - λ) / √λ. Pure. */
export const poissonZ = (k: number, lambda: number): number | null => (fin(k) && fin(lambda) && lambda > 0 ? (k - lambda) / Math.sqrt(lambda) : null);

/** Events per calendar month (UTC), `months` of them ending with the current month, oldest first. Pure. */
export function monthlyCounts(dates: string[], months: number, now: number): number[] {
  const d = new Date(now), y = d.getUTCFullYear(), m = d.getUTCMonth();
  const out = new Array<number>(months).fill(0);
  for (const s of dates) {
    const t = new Date(s);
    if (Number.isNaN(t.getTime())) continue;
    const back = (y - t.getUTCFullYear()) * 12 + (m - t.getUTCMonth());
    if (back >= 0 && back < months) out[months - 1 - back]++;
  }
  return out;
}

/** A sparkline's polyline points in a w×h box: gaps skipped (not drawn as zero), a flat line in the middle. Pure. */
export function sparkPoints(values: (number | null | undefined)[], w: number, h: number, pad = 1): string {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => fin(p[1]));
  if (pts.length < 2 || values.length < 2) return "";
  const vs = pts.map((p) => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo;
  const r = (v: number) => Math.round(v * 10) / 10;
  return pts.map(([i, v]) => `${r((i / (values.length - 1)) * w)},${r(span > 1e-12 ? pad + (h - 2 * pad) * (1 - (v - lo) / span) : h / 2)}`).join(" ");
}
