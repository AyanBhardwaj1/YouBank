/**
 * Scoring for the finance eval harness and the real-answer audit (sleep-research/EXPERIMENT_PLAN.md, B0 and
 * B1). Pure: no model calls, no database.
 *
 * A question names its period and the figures a right answer states, each with its unit. An answer passes
 * when every expected figure appears in it, read at the precision the answer wrote it (as figures.ts reads
 * figures), or within the question's own tolerance. Reliability is reported as pass^k: the share of
 * questions answered right in every one of k runs, next to pass@1.
 */
import { extractNumbers, type Unit } from "@/lib/edge/claims/numbers";
import { close } from "@/lib/ai/figures";

export type Expected = { label: string; value: number; unit: Unit; /** Relative tolerance, e.g. 0.005 for 0.5%. */ tol?: number };
export type Question = {
  id: string; kind: "xbrl" | "hand" | "lookup" | "quote" | "audit"; ticker: string; question: string;
  /** The fiscal period and filing the answer must come from, e.g. "FY2025, 10-K 0000320193-25-000079". */
  period?: string;
  expected: Expected[];
  /** Where the expected figures came from: "hand" (a person checked the filing) or "xbrl:<accession>". */
  provenance: string;
};

/** Whether one expected figure is stated in the answer. */
export function states(answer: string, e: Expected): boolean {
  return extractNumbers(answer).some((n) => {
    if (n.unit !== e.unit && !(e.unit === "usd" && n.unit === "count" && n.value >= 1e6)) return false;
    if (e.tol !== undefined && Math.abs(n.value - e.value) <= Math.abs(e.value) * e.tol) return true;
    return close(n, e.value);
  });
}

/** An answer passes when it states every expected figure. */
export function passes(answer: string, q: Pick<Question, "expected">): { pass: boolean; missing: string[] } {
  const missing = q.expected.filter((e) => !states(answer, e)).map((e) => e.label);
  return { pass: missing.length === 0 && q.expected.length > 0, missing };
}

/** Wilson 95% interval for a proportion. */
export function wilson(k: number, n: number, z = 1.96): { p: number; lo: number; hi: number } {
  if (!n) return { p: 0, lo: 0, hi: 0 };
  const p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

export type RunScore = { id: string; runs: boolean[] };

/** pass@1 (first run), pass^k (every run) and the mean pass rate over all runs. */
export function summarize(scores: RunScore[]): { n: number; k: number; pass1: number; passK: number; mean: number } {
  const n = scores.length;
  const k = Math.min(...scores.map((s) => s.runs.length));
  if (!n || !Number.isFinite(k) || k < 1) return { n, k: 0, pass1: 0, passK: 0, mean: 0 };
  const pass1 = scores.filter((s) => s.runs[0]).length / n;
  const passK = scores.filter((s) => s.runs.slice(0, k).every(Boolean)).length / n;
  const mean = scores.reduce((t, s) => t + s.runs.slice(0, k).filter(Boolean).length / k, 0) / n;
  return { n, k, pass1, passK, mean };
}

/**
 * Whether two nightly runs of the same set agree within binomial noise (the K1 falsifier): the gap in pass
 * rate should be inside about two standard errors of a difference of proportions.
 */
export function stable(a: { pass: number; n: number }, b: { pass: number; n: number }): { gap: number; limit: number; ok: boolean } {
  const p = (a.pass * a.n + b.pass * b.n) / Math.max(1, a.n + b.n);
  const limit = 1.96 * Math.sqrt(p * (1 - p) * (1 / Math.max(1, a.n) + 1 / Math.max(1, b.n)));
  const gap = Math.abs(a.pass - b.pass);
  return { gap, limit, ok: gap <= limit };
}
