/**
 * What Calibrated Claims (E2) measures about each claim and the passages it cites, before the combiner
 * turns it into a support probability:
 * - quote: whether the claim's quote was found in its passage (1 exact, 0.5 found only on the second
 *   reading or with soft differences, 0 not found);
 * - rank: how high the cited passage ranked for the question (1 for the first, falling with rank), the
 *   free reranker's verdict in a scale-free form;
 * - nli: the entailment probability from the ML service's NLI checker (`docs.verify`), when it ran;
 * - numbers: the share of the claim's numbers found in, or derived from, the cited passages, and whether it
 *   has any (a claim without numbers cannot fail this check, so the combiner must know);
 * - entity and period: whether the company and the fiscal period the claim names match the passage's
 *   header line (Edge embeds "Company (TICKER) · form · period" with every passage), 0.5 when it names none;
 * - agree: how many independent passages back it;
 * - analysis: the writer marked it as inference.
 * Pure: the same functions build the calibration fixture's features and a live answer's.
 */
import { checkNumbers, type NumberCheck } from "./numbers";
import { normEntity } from "../entities/crosswalk";

export const FEATURES = ["quote", "rank", "nli", "numbers", "hasNumbers", "entity", "period", "agree", "analysis"] as const;
export type FeatureName = (typeof FEATURES)[number];
export type Features = Record<FeatureName, number>;

export type CitedPassage = { text: string; header: string; quote: "exact" | "near" | "failed"; rank: number; nli?: number | null };
export type ClaimInput = { text: string; analysis?: boolean; cites: CitedPassage[] };

const MONTH: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4 };

/** The periods a text names, as "2025" and "2025Q3" tokens: quarters by name or code, and years. Pure. */
export function periodsIn(text: string): Set<string> {
  const out = new Set<string>();
  const t = text.toLowerCase();
  for (const m of t.matchAll(/\bq([1-4])\s*'?\s*(?:fy\s*)?((?:19|20)?\d{2})\b/g)) { const y = m[2].length === 2 ? `20${m[2]}` : m[2]; out.add(y); out.add(`${y}Q${m[1]}`); }
  for (const m of t.matchAll(/\b(first|second|third|fourth|1st|2nd|3rd|4th) quarter(?: of)?(?: fiscal)?(?: year)? ((?:19|20)\d{2})\b/g)) { out.add(m[2]); out.add(`${m[2]}Q${ORD[m[1]]}`); }
  for (const m of t.matchAll(/\b(?:three|six|nine|twelve) months ended (january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2},? ((?:19|20)\d{2})\b/g)) { out.add(m[2]); out.add(`${m[2]}Q${Math.ceil(MONTH[m[1]] / 3)}`); }
  for (const m of t.matchAll(/\bquarter ended (january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2},? ((?:19|20)\d{2})\b/g)) { out.add(m[2]); out.add(`${m[2]}Q${Math.ceil(MONTH[m[1]] / 3)}`); }
  for (const m of t.matchAll(/\b(?:fy|fiscal(?: year)?|year ended [a-z]+ \d{1,2},?|calendar)\s*'?((?:19|20)\d{2})\b/g)) out.add(m[1]);
  for (const m of t.matchAll(/\b((?:19|20)\d{2})\b/g)) out.add(m[1]);
  return out;
}

/**
 * Whether the periods a claim names agree with the passages: 1 when every year (and quarter) it names is
 * in a cited passage's header or text, 0 when it names one that none of them has, 0.5 when it names none.
 * A quarter counts as agreeing when its year does and the passage names no quarter (fiscal and calendar
 * quarters differ). Pure.
 */
export function periodAgreement(claim: string, cites: Pick<CitedPassage, "text" | "header">[]): number {
  const want = periodsIn(claim);
  if (!want.size) return 0.5;
  const have = new Set(cites.flatMap((c) => [...periodsIn(`${c.header} ${c.text}`)]));
  const quartersHave = [...have].some((p) => p.includes("Q"));
  for (const p of want) {
    if (have.has(p)) continue;
    if (p.includes("Q") && !quartersHave && have.has(p.slice(0, 4))) continue;
    return 0;
  }
  return 1;
}

/** The company a passage header names: "Energy Transfer LP (ET) · 10-K · year ended …" gives its name and ticker. Pure. */
export function headerCompany(header: string): { name: string; ticker: string } {
  const first = header.split(" · ")[0] ?? "";
  const ticker = /\(([A-Z][A-Z0-9.\-]{0,9})\)/.exec(first)?.[1] ?? "";
  return { name: first.replace(/\([^)]*\)/g, "").trim(), ticker };
}

/**
 * Whether the company a claim is about matches its passages: among the companies in the answer's scope
 * (every cited header), the ones the claim names must include one its own passages are about (by name or
 * ticker, or named in a passage's text). 1 agree, 0 the claim names only other companies, 0.5 it names
 * none. Pure.
 */
export function entityAgreement(claim: string, cites: Pick<CitedPassage, "text" | "header">[], scope: { name: string; ticker: string }[]): number {
  const words = ` ${normEntity(claim)} `;
  const named = scope.filter((c) => (c.ticker && new RegExp(`\\b${c.ticker.replace(/[.\-]/g, "\\$&")}\\b`).test(claim)) || (normEntity(c.name).length >= 3 && words.includes(` ${normEntity(c.name)} `)));
  if (!named.length) return 0.5;
  const mine = cites.map((c) => headerCompany(c.header));
  const texts = cites.map((c) => ` ${normEntity(c.text)} `).join(" ");
  return named.some((n) => mine.some((m) => (n.ticker && n.ticker === m.ticker) || normEntity(n.name) === normEntity(m.name)) || (normEntity(n.name).length >= 3 && texts.includes(` ${normEntity(n.name)} `))) ? 1 : 0;
}

/** Every feature of one claim, and the number check behind it (shown to the reader). Pure. */
export function claimFeatures(c: ClaimInput, scope: { name: string; ticker: string }[]): { features: Features; numbers: NumberCheck } {
  const cites = c.cites;
  const numbers = checkNumbers(c.text, cites.map((p) => `${p.header} ${p.text}`));
  const quote = cites.length ? Math.max(...cites.map((p) => (p.quote === "exact" ? 1 : p.quote === "near" ? 0.5 : 0))) : 0;
  const rank = cites.length ? Math.max(...cites.map((p) => 1 / Math.sqrt(Math.max(1, p.rank)))) : 0;
  const nlis = cites.map((p) => p.nli).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return {
    numbers,
    features: {
      quote, rank, nli: nlis.length ? Math.max(...nlis) : NaN,
      numbers: numbers.share, hasNumbers: numbers.checked ? 1 : 0,
      entity: entityAgreement(c.text, cites, scope), period: periodAgreement(c.text, cites),
      agree: Math.min(3, cites.filter((p) => p.quote !== "failed").length), analysis: c.analysis ? 1 : 0,
    },
  };
}

/** The reasons behind a probability in words, for the hover and the bottom sheet. Pure. */
export function reasonsOf(f: Features, n: NumberCheck): string[] {
  const out: string[] = [];
  out.push(f.quote === 1 ? "quote exact" : f.quote === 0.5 ? "quote found on a second reading" : "no quote found");
  if (n.checked) out.push(n.missing.length ? `${n.missing.length} of ${n.checked} number${n.checked === 1 ? "" : "s"} not in the passages (${n.missing.slice(0, 2).join(", ")})` : n.derived.length ? `numbers match (${n.derived[0].how})` : "numbers match");
  if (Number.isFinite(f.nli)) out.push(`NLI ${f.nli.toFixed(2)}`);
  if (f.period === 0) out.push("a period the passages do not name");
  if (f.entity === 0) out.push("names a different company than its passages");
  if (f.agree >= 2) out.push(`${f.agree} passages agree`);
  if (f.analysis) out.push("marked as analysis");
  return out;
}
