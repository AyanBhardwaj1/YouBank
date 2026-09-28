/**
 * Stock splits from a company's filings, to restate per-share history that a source did not adjust:
 * Nasdaq's dividend history is as paid, and old 10-K figures are as first reported. A split shows as the
 * cover-page share count (dei:EntityCommonStockSharesOutstanding) jumping between two consecutive filings
 * by a split-like ratio. Buybacks and issuance move it by a few percent, and a merger rarely lands on one.
 */
import type { CompanyFacts } from "./facts";

/** A split of `ratio` new shares per old one (below 1 for a reverse split), between two cover dates. */
export type Split = { ratio: number; after: string; before: string };

const RATIOS = [1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50];
const CANDIDATES = [...RATIOS, ...RATIOS.map((r) => 1 / r)];
const DAY = 86_400_000;

/** Splits seen in the cover-page share counts, oldest first. */
export function splitsOf(cf: CompanyFacts): Split[] {
  const rows = cf.facts.dei?.EntityCommonStockSharesOutstanding?.units?.shares ?? [];
  // One count per filing (the largest, where a filing reports more than one).
  const byFiling = new Map<string, { end: string; shares: number }>();
  for (const r of rows) {
    const x = byFiling.get(r.accn);
    if (r.val > 0 && (!x || r.val > x.shares)) byFiling.set(r.accn, { end: r.end, shares: r.val });
  }
  const counts = [...byFiling.values()].sort((a, b) => (a.end < b.end ? -1 : 1));
  const out: Split[] = [];
  for (let i = 1; i < counts.length; i++) {
    const a = counts[i - 1], b = counts[i];
    if (b.end === a.end || Date.parse(b.end) - Date.parse(a.end) > 400 * DAY) continue;
    const r = b.shares / a.shares;
    if (r < 1.4 && r > 1 / 1.4) continue;
    const ratio = CANDIDATES.find((c) => Math.abs(Math.log(r / c)) <= 0.06);
    if (ratio) out.push({ ratio, after: a.end, before: b.end });
  }
  return out;
}

/**
 * A per-share series (oldest first) restated to today's share basis.
 * - "paid" (amounts as paid, by ex-date): the split is the boundary. Everything before the earlier cover
 *   date is pre-split, and a payment between the two cover dates is pre-split when it sits nearer the
 *   pre-split level. The payments must show the split (a fall of at least a third of its size, which
 *   allows for a raise at the split), or a share-count jump that was not a split would halve history.
 * - "filed" (figures from filings): comparatives are restated for a few years, so the boundary is where
 *   they stop. Walking back from the split, the first step of about the split ratio is where the
 *   unadjusted figures begin; none within `lookbackYears` means nothing to restate.
 * A change that no split explains, such as a cut, is left alone.
 */
export function restate<T extends { date: string; amount: number }>(xs: T[], splits: Split[], basis: "paid" | "filed", lookbackYears = 4): T[] {
  const out = xs.map((x) => ({ ...x }));
  for (const s of [...splits].sort((a, b) => (a.before < b.before ? 1 : -1))) {
    const target = Math.log(s.ratio);
    if (basis === "paid") {
      const prev = out.findLast((x) => x.date <= s.after), next = out.find((x) => x.date >= s.before);
      if (!prev || !next || !(prev.amount > 0 && next.amount > 0)) continue;
      const step = Math.log(prev.amount / next.amount);
      if (Math.sign(step) !== Math.sign(target) || Math.abs(step) < Math.abs(target) / 3) continue;
      const pre = (x: T) => x.date <= s.after || (x.date < s.before && x.amount > 0 && Math.abs(Math.log(x.amount / next.amount) - target) < Math.abs(Math.log(x.amount / next.amount)));
      for (const x of out) if (pre(x)) x.amount /= s.ratio;
      continue;
    }
    const floor = new Date(Date.parse(s.after) - lookbackYears * 365.25 * DAY).toISOString().slice(0, 10);
    for (let i = out.length - 2; i >= 0 && out[i].date >= floor; i--) {
      if (out[i].date >= s.before || !(out[i].amount > 0 && out[i + 1].amount > 0)) continue;
      if (Math.abs(Math.log(out[i].amount / out[i + 1].amount) - target) < 0.35 * Math.abs(target)) {
        for (let j = 0; j <= i; j++) out[j].amount /= s.ratio;
        break;
      }
    }
  }
  return out;
}
