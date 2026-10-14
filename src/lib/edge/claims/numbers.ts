/**
 * The number check behind Calibrated Claims (E2): every number in a claim must appear in a passage it
 * cites, or follow from numbers there by simple arithmetic (a sum, a difference, a ratio, a growth rate),
 * worked out here deterministically rather than trusted to a model. A real quote can still fail to support
 * its claim through a number that was changed in the retelling; this is where that shows.
 *
 * Numbers carry their unit and scale ("$1.2 billion" is 1.2e9 dollars, "12%" is a percentage, "150 bps"
 * is 1.5 points) and match within the claim's own rounding ("$1.2 billion" matches "$1,213 million").
 * Years, dates and ordinals ("Q3", "2025", "March 4") are not numbers to check. Pure.
 */

export type Unit = "usd" | "pct" | "x" | "count";
export type Num = { value: number; unit: Unit; raw: string; /** Significant decimals as written, for rounding tolerance. */ dp: number; index: number };

const SCALE: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, mm: 1e6, mn: 1e6, m: 1e6, billion: 1e9, bn: 1e9, b: 1e9, trillion: 1e12, tn: 1e12 };
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/** Every number in a text with its unit, in USD units for money. Pure. */
export function extractNumbers(text: string): Num[] {
  const out: Num[] = [];
  // Blank out what looks like a number but is a date, a period or an ordinal, keeping positions.
  const masked = text
    .replace(new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,\\s*(?:19|20)\\d{2})?`, "gi"), (m) => " ".repeat(m.length))
    .replace(/\b(?:q[1-4]|h[12]|fy|fiscal(?: year)?|cy)\s*'?\d{2,4}\b/gi, (m) => " ".repeat(m.length))
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, (m) => " ".repeat(m.length))
    .replace(/\b(?:19|20)\d{2}(?!\s*(?:%|percent|bps|basis|x\b|times|million|billion|thousand|mm|bn))\b/gi, (m) => " ".repeat(m.length))
    .replace(/\b\d+(?:st|nd|rd|th)\b/gi, (m) => " ".repeat(m.length));
  const re = /(\$|usd\s*|us\$)?\s?(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(%|percent\b|per cent\b|bps\b|basis points?\b|x\b|times\b|thousand\b|million\b|billion\b|trillion\b|mm\b|mn\b|bn\b|tn\b|k\b|m\b|b\b)?/gi;
  for (const m of masked.matchAll(re)) {
    const [raw, cur, num, sufRaw] = m;
    if (!/\d/.test(num)) continue;
    const suf = (sufRaw ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    let value = Number(num.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const dp = (num.split(".")[1] ?? "").length;
    let unit: Unit = cur ? "usd" : "count";
    if (suf === "%" || suf.startsWith("percent") || suf.startsWith("per cent")) unit = "pct";
    else if (suf === "bps" || suf.startsWith("basis")) { unit = "pct"; value /= 100; }
    else if (suf === "x" || suf === "times") unit = "x";
    else if (SCALE[suf] && (cur || suf.length > 1)) value *= SCALE[suf];
    // A bare single-letter scale ("5 m") is too ambiguous without a currency; it is kept as a count.
    // "dollars" after the figure makes it money.
    if (unit === "count" && /^\s*(?:dollars|usd)\b/i.test(masked.slice((m.index ?? 0) + raw.length, (m.index ?? 0) + raw.length + 10))) unit = "usd";
    if (unit === "count" && /\b(?:million|billion|thousand)\s+(?:dollars|usd)\b/i.test(raw + masked.slice((m.index ?? 0) + raw.length, (m.index ?? 0) + raw.length + 10))) unit = "usd";
    out.push({ value, unit, raw: raw.trim(), dp, index: m.index ?? 0 });
  }
  return out;
}

/** The scale a number was written at ("$1.2 billion" is billions), from its own words. Pure. */
function writtenScale(raw: string): number {
  const m = /(thousand|million|billion|trillion|mm|mn|bn|tn|\bk|\bm|\bb)\b/i.exec(raw);
  return m ? SCALE[m[1].toLowerCase()] ?? 1 : 1;
}

/**
 * Whether a passage number backs a claim number: the same unit (money written without a currency in a
 * table counts as money, and table figures in thousands or millions are tried at those scales), within
 * half a unit of the claim's last written digit at its own scale. "$1.2 billion" is backed by "$1,213
 * million"; "12%" by 11.6% or 12.4%. Pure.
 */
export function sameNumber(claim: Num, found: { value: number; unit: Unit }): boolean {
  const money = (u: Unit) => u === "usd" || u === "count";
  if (claim.unit !== found.unit && !(money(claim.unit) && money(found.unit))) return false;
  const tol = Math.max(0.5 * Math.pow(10, -claim.dp) * writtenScale(claim.raw), Math.abs(claim.value) * 0.001, 1e-9);
  const scales = claim.unit === "usd" && found.unit === "count" ? [1, 1e3, 1e6] : [1];
  return scales.some((k) => Math.abs(claim.value - found.value * k) <= tol);
}

export type NumberCheck = {
  /** Numbers in the claim that were checked. */
  checked: number;
  /** Found as written in a passage. */
  found: number;
  /** Not written there, but derived from passage numbers (with how). */
  derived: { raw: string; how: string }[];
  /** Neither found nor derivable: the claim's numbers the passages do not back. */
  missing: string[];
  /** Share backed (1 when the claim has no numbers). */
  share: number;
};

/** The derivations tried, from pairs of passage numbers of the same unit. Pure. */
function derivations(nums: Num[]): { value: number; unit: Unit; how: string }[] {
  const out: { value: number; unit: Unit; how: string }[] = [];
  const list = nums.slice(0, 40);
  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      const a = list[i], b = list[j];
      if (a.unit === b.unit && a.unit !== "pct") {
        if (a.value !== 0) out.push({ value: ((b.value - a.value) / Math.abs(a.value)) * 100, unit: "pct", how: `growth from ${a.raw} to ${b.raw}` });
        if (b.value !== 0) out.push({ value: a.value / b.value, unit: "x", how: `${a.raw} divided by ${b.raw}` });
        if (b.value !== 0) out.push({ value: (a.value / b.value) * 100, unit: "pct", how: `${a.raw} as a share of ${b.raw}` });
        if (i < j) out.push({ value: a.value + b.value, unit: a.unit, how: `${a.raw} plus ${b.raw}` });
        out.push({ value: a.value - b.value, unit: a.unit, how: `${a.raw} less ${b.raw}` });
      }
      if (a.unit === "pct" && b.unit === "pct") out.push({ value: a.value - b.value, unit: "pct", how: `${a.raw} less ${b.raw} (points)` });
    }
  }
  return out;
}

/**
 * Check a claim's numbers against the passages it cites. A growth claim ("up 12%") also matches its
 * absolute value when the sign is in the words ("fell 12%" against -12%). Pure.
 */
export function checkNumbers(claim: string, passages: string[]): NumberCheck {
  const nums = extractNumbers(claim);
  if (!nums.length) return { checked: 0, found: 0, derived: [], missing: [], share: 1 };
  const pool = passages.flatMap((p) => extractNumbers(p));
  const derived = derivations(pool);
  const out: NumberCheck = { checked: nums.length, found: 0, derived: [], missing: [], share: 1 };
  for (const n of nums) {
    const signed = /\b(fell|down|declin|decreas|lower|drop)/i.test(claim.slice(Math.max(0, n.index - 30), n.index)) && n.value > 0 ? { ...n, value: -n.value } : n;
    if (pool.some((p) => sameNumber(n, p))) { out.found++; continue; }
    const d = derived.find((x) => sameNumber(signed, x) || sameNumber(n, x));
    if (d) out.derived.push({ raw: n.raw, how: d.how });
    else out.missing.push(n.raw);
  }
  out.share = (out.found + out.derived.length) / out.checked;
  return out;
}
