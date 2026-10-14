/**
 * The Precedent Engine's number readers (E1): every value Edge stores for a deal is read again from the
 * verbatim quote by one of these, never taken from a model's say-so. Money becomes USD millions (or USD per
 * share when the quote says "per share"), percentages become fractions, periods become days, and counts of
 * parties come out of words or digits ("twelve", "12", "twelve (12)"). Each returns null rather than guess.
 * Pure, tested in scripts/test-edge-next.ts.
 */

export type Money = { value: number; unit: "usd_mm" | "usd_per_share"; raw: string; scaled?: boolean; at?: number };

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** "forty-five", "one hundred twenty", "twelve" as a number; null when the words are not a number. Pure. */
export function wordsToNumber(words: string): number | null {
  const parts = words.toLowerCase().replace(/[-–]/g, " ").replace(/\band\b/g, " ").split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  let total = 0, cur = 0;
  for (const w of parts) {
    if (w in SMALL) cur += SMALL[w];
    else if (w in TENS) cur += TENS[w];
    else if (w === "hundred") cur = (cur || 1) * 100;
    else if (w === "thousand") { total += (cur || 1) * 1000; cur = 0; }
    else return null;
  }
  return total + cur;
}

const NUMBER_WORD = `(?:${[...Object.keys(SMALL), ...Object.keys(TENS), "hundred", "thousand"].join("|")})`;
const WORDS_RE = new RegExp(`\\b(${NUMBER_WORD}(?:[\\s-]+(?:and\\s+)?${NUMBER_WORD})*)\\b`, "i");

const num = (s: string) => Number(s.replace(/,/g, ""));
const SCALE: Record<string, number> = { trillion: 1e6, tn: 1e6, billion: 1e3, bn: 1e3, b: 1e3, million: 1, mm: 1, mn: 1, m: 1, thousand: 1e-3, k: 1e-3 };

/**
 * The first dollar amount in a text. "$1.2 billion" is 1,200 (USD millions); "$950 million" 950; "$1,234,567"
 * 1.234567; "approximately $3.10 per share" is 3.10 USD per share (also "per Share", "per share of common
 * stock", "for each share"). Pure.
 */
export function parseMoney(text: string): Money | null {
  return moneyAll(text)[0] ?? null;
}

/**
 * Every dollar amount in a text, in order. In a range ("between $36.00 and $41.00 per share") the per-share
 * words after the second figure apply to the first too. Pure.
 */
export function moneyAll(text: string): Money[] {
  const out: Money[] = [];
  const re = /(?:US)?\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*(trillion|billion|million|thousand|bn|tn|mm|mn|[bmk])\b)?(\s*(?:in\s+cash\s+)?(?:per\s+(?:share|unit|common\s+unit|ads)|for\s+each\s+(?:share|unit|outstanding\s+share))\b)?/gi;
  for (const m of text.matchAll(re)) {
    const v = num(m[1]);
    if (!Number.isFinite(v)) continue;
    const scale = m[2] ? SCALE[m[2].toLowerCase()] : undefined;
    if (m[3] && !scale) { out.push({ value: v, unit: "usd_per_share", raw: m[0].trim(), scaled: false, at: m.index }); continue; }
    out.push({ value: scale !== undefined ? v * scale : v / 1e6, unit: "usd_mm", raw: m[0].trim(), scaled: scale !== undefined, at: m.index });
  }
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i], b = out[i + 1];
    if (a.unit === "usd_mm" && !a.scaled && b.unit === "usd_per_share" && a.at !== undefined && b.at !== undefined && /^\s*(?:to|and|or|-|–|—)\s*$/i.test(text.slice(a.at + a.raw.length, b.at))) out[i] = { ...a, value: a.value * 1e6, unit: "usd_per_share" };
  }
  return out;
}

/**
 * A price per share from words that say so anywhere ("each share ... will be converted into the right to
 * receive $42.50 in cash"): the per-share amount, or the one unscaled dollar figure when the text speaks of
 * each share. Pure.
 */
export function perShareOf(text: string): number | null {
  const all = moneyAll(text);
  const ps = all.find((m) => m.unit === "usd_per_share");
  if (ps) return ps.value;
  if (!/\b(?:each|per|every)\s+(?:outstanding\s+)?(?:share|unit)s?\b/i.test(text)) return null;
  const plain = all.filter((m) => !m.scaled && m.value * 1e6 < 100_000);
  return plain.length === 1 ? Math.round(plain[0].value * 1e6 * 100) / 100 : null;
}

/** The first percentage: "31.4%", "approximately 31 percent", "3.1 per cent". As a fraction (0.314). Pure. */
export function parsePercent(text: string): number | null {
  const m = /(-?\d+(?:\.\d+)?)\s*(?:%|percent\b|per\s+cent\b)/i.exec(text);
  return m ? Number(m[1]) / 100 : null;
}

/**
 * A number of days: "45 days", "forty-five (45) days", "thirty days", "35 calendar days". When words and a
 * parenthetical figure are both given, they must agree. Pure.
 */
export function parseDays(text: string): number | null {
  const both = new RegExp(`\\b(${NUMBER_WORD}(?:[\\s-]+${NUMBER_WORD})*)\\s*\\((\\d{1,4})\\)\\s*(?:calendar\\s+|business\\s+)?days?\\b`, "i").exec(text);
  if (both) { const w = wordsToNumber(both[1]); const d = Number(both[2]); return w === null || w === d ? d : null; }
  const digits = /\b(\d{1,4})\s*(?:calendar\s+|business\s+)?days?\b/i.exec(text);
  if (digits) return Number(digits[1]);
  const words = new RegExp(`\\b(${NUMBER_WORD}(?:[\\s-]+${NUMBER_WORD})*)\\s+(?:calendar\\s+|business\\s+)?days?\\b`, "i").exec(text);
  return words ? wordsToNumber(words[1]) : null;
}

/**
 * A count of parties ("contacted 25 potential buyers", "twelve parties", "eight (8) parties", "none of the
 * parties" is not a count). The first number in the text, in digits or words. Pure.
 */
export function parseCount(text: string): number | null {
  const both = new RegExp(`\\b(${NUMBER_WORD}(?:[\\s-]+${NUMBER_WORD})*)\\s*\\((\\d{1,4})\\)`, "i").exec(text);
  if (both) { const w = wordsToNumber(both[1]); const d = Number(both[2]); return w === null || w === d ? d : null; }
  const plain = text.replace(new RegExp(`\\b(?:${MONTHS.join("|")})\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "gi"), " ").replace(/\b(19|20)\d{2}\b/g, " ").replace(/\$\s?\d[\d,.]*/g, " ");
  const d = /\b(\d{1,4})\b(?!\s*(?:%|percent|\/))/.exec(plain);
  if (d) return Number(d[1]);
  const w = WORDS_RE.exec(text);
  return w ? wordsToNumber(w[1]) : null;
}

/** An exchange ratio: "0.4125 shares of Parent common stock", "1.0 share", "an exchange ratio of 0.725". Pure. */
export function parseRatio(text: string): number | null {
  const m = /\b(\d+\.\d{2,6}|\d)\s+(?:of\s+a\s+)?(?:shares?|units?|common\s+units?)\s+of\b/i.exec(text) ?? /exchange\s+ratio\s+(?:of\s+)?(\d+\.\d+)/i.exec(text);
  if (!m) return null;
  const v = Number(m[1]);
  return v > 0 && v < 100 ? v : null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** A calendar date, "March 3, 2024" or "3 March 2024" or "2024-03-03", as YYYY-MM-DD. Pure. */
export function parseDate(text: string): string | null {
  const iso = /\b(20\d{2}|19\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2}),?\\s+((?:19|20)\\d{2})\\b`, "i").exec(text);
  const dmy = new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.join("|")}),?\\s+((?:19|20)\\d{2})\\b`, "i").exec(text);
  const hit = mdy ? { m: mdy[1], d: mdy[2], y: mdy[3] } : dmy ? { m: dmy[2], d: dmy[1], y: dmy[3] } : null;
  if (!hit) return null;
  const month = MONTHS.indexOf(hit.m.toLowerCase()) + 1, day = Number(hit.d);
  if (day < 1 || day > 31) return null;
  return `${hit.y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Two dollar amounts a range is drawn between ("$45.10 to $58.20", "$45.10 - $58.20"), low first. Pure. */
export function parseRange(text: string): { low: number; high: number; unit: Money["unit"] } | null {
  const all = moneyAll(text);
  const ranged = /\$\s?[\d,.]+\s*(?:to|-|–|—|and)\s*\$?\s?[\d,.]+/.exec(text);
  if (all.length < 2 && !ranged) return null;
  let a = all[0], b = all[1];
  if (ranged && (!b || all.length < 2)) {
    const nums = ranged[0].match(/[\d,]+(?:\.\d+)?/g) ?? [];
    const [x, y] = nums;
    if (x !== undefined && y !== undefined) { a = { value: num(x), unit: "usd_per_share", raw: ranged[0] }; b = { value: num(y), unit: "usd_per_share", raw: ranged[0] }; }
  }
  if (!a || !b) return null;
  // "$45.10 to $58.20 per share": the per-share words come after the second figure only.
  const unit = a.unit === "usd_per_share" || b.unit === "usd_per_share" || /per\s+share/i.test(text) ? "usd_per_share" : "usd_mm";
  const va = unit === "usd_per_share" && a.unit === "usd_mm" ? a.value * 1e6 : a.value, vb = unit === "usd_per_share" && b.unit === "usd_mm" ? b.value * 1e6 : b.value;
  return { low: Math.min(va, vb), high: Math.max(va, vb), unit };
}

/** What the buyer pays with, from the words of the consideration: cash, stock or both. Pure. */
export function considerationOf(text: string): "cash" | "stock" | "mixed" | null {
  const t = text.toLowerCase();
  const cash = /\bin cash\b|\bcash consideration\b|\ball[- ]cash\b|\$\s?\d[\d,.]*\s*(?:in cash|per share in cash)|cash, without interest/.test(t);
  const stock = /\bshares? of (?:parent|acquirer|[a-z]+ )?(?:class [a-z] )?common stock\b|\bexchange ratio\b|\bstock consideration\b|\ball[- ]stock\b|\bcommon units? of\b/.test(t);
  if (cash && stock) return "mixed";
  if (cash) return "cash";
  if (stock) return "stock";
  return null;
}

/** Who is buying, from how the filing describes the buyer: a sponsor's fund, a company a sponsor owns, or an operating company. Pure. */
export function buyerTypeOf(text: string): "sponsor" | "sponsor_backed" | "strategic" | null {
  const t = text.toLowerCase();
  if (/portfolio company of|controlled by (?:funds|investment funds|affiliates of)|backed by (?:funds|investment funds)/.test(t)) return "sponsor_backed";
  if (/(?:investment )?funds (?:managed|advised|sponsored) by|affiliates? of [a-z&.\s]+(?:capital|partners|equity|private equity)|private equity|sponsor/.test(t)) return "sponsor";
  if (/\b(?:inc|corporation|company|plc|n\.v\.|s\.a\.|ltd)\b|\bnyse\b|\bnasdaq\b|publicly traded/.test(t)) return "strategic";
  return null;
}

/** USD millions as people read it: "$1.2bn", "$950m", "$3.10/share". Pure. */
export function fmtMoney(m: Money | { value: number; unit: Money["unit"] } | null | undefined): string {
  if (!m || !Number.isFinite(m.value)) return "—";
  if (m.unit === "usd_per_share") return `$${m.value.toFixed(2)}/share`;
  return m.value >= 1000 ? `$${(m.value / 1000).toFixed(m.value >= 10_000 ? 1 : 2)}bn` : `$${m.value >= 100 ? Math.round(m.value) : m.value.toFixed(1)}m`;
}
