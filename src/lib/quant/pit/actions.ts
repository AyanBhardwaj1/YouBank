/**
 * QF3: corporate actions. Splits from the price vendor are checked against EDGAR (edgar/splits.ts finds them
 * from the cover-page share count jumping by a split ratio): a one-day price move that matches a known split
 * ratio means the series was not adjusted, and the check says so instead of letting a backtest see a fake
 * crash or rally. Ticker changes come from the universe's `successor`. Pure.
 */
export type SplitEvent = { date: string; ratio: number };
export type ActionIssue = { date: string; kind: "unadjusted_split" | "unexplained_jump"; move: number; ratio?: number };

/** Multiply prices before each split date by 1/ratio (a 4-for-1 split divides earlier prices by 4). Pure. */
export function adjustForSplits(dates: string[], closes: number[], splits: SplitEvent[]): number[] {
  return closes.map((c, i) => splits.reduce((v, s) => (dates[i] < s.date ? v / s.ratio : v), c));
}

const COMMON_RATIOS = [2, 3, 4, 5, 10, 20, 1 / 2, 1 / 3, 1 / 5, 1 / 10];

/**
 * Days where the close moved by close to a split ratio. With `splits` (from the vendor or EDGAR), a move that
 * matches a known split on its date is an unadjusted split; any other move beyond `jump` (60% down or 150% up)
 * is listed as unexplained, for a person to look at.
 */
export function auditSplits(dates: string[], closes: number[], splits: SplitEvent[] = [], jump = 0.6): ActionIssue[] {
  const out: ActionIssue[] = [];
  const known = new Map(splits.map((s) => [s.date, s.ratio]));
  for (let i = 1; i < closes.length; i++) {
    const r = closes[i - 1] / closes[i];
    if (!(r > 0)) continue;
    const ratio = known.get(dates[i]);
    if (ratio && Math.abs(r / ratio - 1) < 0.15) { out.push({ date: dates[i], kind: "unadjusted_split", move: closes[i] / closes[i - 1] - 1, ratio }); continue; }
    const move = closes[i] / closes[i - 1] - 1;
    if (move < -jump || move > jump * 2.5) {
      const near = COMMON_RATIOS.find((q) => Math.abs(r / q - 1) < 0.05);
      out.push({ date: dates[i], kind: near ? "unadjusted_split" : "unexplained_jump", move, ...(near ? { ratio: near } : {}) });
    }
  }
  return out;
}
