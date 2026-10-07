/**
 * What Calibrated Claims (E2) adds to an answer or a memo, as stored in `edge_answers.answer` and sent to
 * the page. Types only, safe on the client.
 */
export type ClaimSupport = {
  /** Calibrated probability that the cited passages support the claim. */
  p: number;
  dot: "high" | "mid" | "low";
  /** The checks in words: "quote exact", "numbers match", "NLI 0.97". */
  reasons: string[];
  /** A second provider's verdict (premium, asked for on this answer). */
  crosscheck?: { verdict: "supported" | "unsupported" | "unclear"; note: string; model: string };
};

export type VerifierInfo = {
  version: string;
  set: string;
  mode: "strict" | "balanced";
  alpha: number;
  tau: number | null;
  /** Shown under every Strict answer: the target and what it achieved on held-out claims. */
  footer: string;
  nli: boolean;
  /** Claims held back below Strict's line (or rejected by the cross-check), revealable. */
  held: number;
  crosscheck?: string;
  /** For memos: calibrated on answer claims, so read as indicative. */
  note?: string;
};
