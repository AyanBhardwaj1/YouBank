/**
 * "Deals like this one" (E1): a deal's meaning (its target's business and the stated rationale, embedded
 * at 512 dimensions) and a structured kernel over what bankers match on (size bucket by log EV, industry by
 * SIC, buyer type, year, geography, consideration), blended as 0.6 x cosine + 0.4 x kernel. The weights are
 * the spec's starting point; scripts/eval-precedents.ts measures recall@10 of the precedents bankers chose in
 * fairness opinions and reports it, and the weights are frozen at what it reports. Every match says why
 * ("same SIC 4922; sponsor buyer; within 0.5x size"). Pure and symmetric.
 */

export type DealLite = {
  id: number; sic: string; evUsdMm: number | null; equityUsdMm: number | null; buyerType: string; year: number | null;
  country: string; consideration: string; embedding?: number[] | null;
};

export const WEIGHTS = { cosine: 0.6, kernel: 0.4 } as const;

/** Cosine similarity of two vectors; 0 when either is missing. Pure. */
export function cosine(a?: number[] | null, b?: number[] | null): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na > 0 && nb > 0 ? d / Math.sqrt(na * nb) : 0;
}

const size = (d: DealLite) => d.evUsdMm ?? d.equityUsdMm;

/** How alike two SIC codes are: same four digits 1, three 0.7, two 0.4, else 0. Pure. */
export function sicMatch(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.slice(0, 3) === b.slice(0, 3)) return 0.7;
  if (a.slice(0, 2) === b.slice(0, 2)) return 0.4;
  return 0;
}

/** The structured kernel, 0 to 1, and its parts. Pure and symmetric. */
export function kernel(a: DealLite, b: DealLite): { score: number; parts: Record<string, number> } {
  const sa = size(a), sb = size(b);
  const sizeK = sa && sb && sa > 0 && sb > 0 ? Math.exp(-Math.abs(Math.log(sa / sb)) / Math.log(3)) : 0.3;
  const sicK = sicMatch(a.sic, b.sic);
  const buyerK = a.buyerType && b.buyerType ? (a.buyerType === b.buyerType ? 1 : (a.buyerType === "strategic") === (b.buyerType === "strategic") ? 0.6 : 0) : 0.4;
  const yearK = a.year && b.year ? Math.exp(-Math.abs(a.year - b.year) / 5) : 0.4;
  const geoK = a.country && b.country ? (a.country === b.country ? 1 : 0.3) : 0.5;
  const consK = a.consideration && b.consideration ? (a.consideration === b.consideration ? 1 : a.consideration === "mixed" || b.consideration === "mixed" ? 0.5 : 0) : 0.4;
  const parts = { size: sizeK, sic: sicK, buyer: buyerK, year: yearK, geo: geoK, consideration: consK };
  const w = { size: 0.25, sic: 0.3, buyer: 0.15, year: 0.12, geo: 0.06, consideration: 0.12 };
  const score = (Object.keys(w) as (keyof typeof w)[]).reduce((s, k) => s + w[k] * parts[k], 0);
  return { score, parts };
}

/** The blended score of a candidate against a query deal: 0.6 cosine + 0.4 kernel (cosine floored at 0). Pure. */
export function similarity(a: DealLite, b: DealLite): number {
  const c = Math.max(0, cosine(a.embedding, b.embedding));
  const k = kernel(a, b).score;
  // Without vectors on both sides, the kernel alone decides (stated in the result's method).
  return a.embedding?.length && b.embedding?.length ? WEIGHTS.cosine * c + WEIGHTS.kernel * k : k;
}

/** Why two deals matched, as short chips. Pure. */
export function whyChips(a: DealLite, b: DealLite): string[] {
  const out: string[] = [];
  if (a.sic && a.sic === b.sic) out.push(`same SIC ${a.sic}`);
  else if (sicMatch(a.sic, b.sic) >= 0.7) out.push(`same SIC group ${b.sic.slice(0, 3)}x`);
  else if (sicMatch(a.sic, b.sic) >= 0.4) out.push(`same industry ${b.sic.slice(0, 2)}xx`);
  const sa = size(a), sb = size(b);
  if (sa && sb && sa > 0 && sb > 0) { const r = sb / sa; out.push(r >= 0.8 && r <= 1.25 ? "similar size" : `${r.toFixed(r >= 10 ? 0 : 1)}x the size`); }
  if (b.buyerType && b.buyerType === a.buyerType) out.push(`${b.buyerType.replace("_", "-")} buyer`);
  if (b.consideration && b.consideration === a.consideration) out.push(`${b.consideration} deal`);
  if (a.year && b.year) out.push(Math.abs(a.year - b.year) <= 1 ? "same period" : `${b.year}`);
  const c = cosine(a.embedding, b.embedding);
  if (c >= 0.8) out.push("very similar business");
  else if (c >= 0.65) out.push("similar business");
  return out.slice(0, 5);
}

/** Recall@k: the share of the bankers' chosen precedents found in the top k retrieved. Pure. */
export function recallAtK(retrieved: number[], chosen: number[], k = 10): number | null {
  if (!chosen.length) return null;
  const top = new Set(retrieved.slice(0, k));
  return chosen.filter((c) => top.has(c)).length / chosen.length;
}
