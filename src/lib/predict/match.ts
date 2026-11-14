/**
 * The same question on two venues: a conservative matcher. Venues word the same contract differently
 * ("Fed decreases interest rates by 25 bps after December 2026 meeting?" against Kalshi's "Fed decision in
 * December 2026?: Cut 25bps"), and nearby contracts differ in one detail that decides everything (above 2.9%
 * against above 3.0%, cut against hold, one candidate against another). So two markets match only when:
 * - every threshold number agrees (a number on one side and not the other costs confidence);
 * - their direction words agree (cut / hike / hold, above / below): opposite directions never match;
 * - the years and months they name agree;
 * - neither names a person or company the other does not mention;
 * - they close within 90 days of each other (further apart costs confidence: the windows differ);
 * - and their remaining words overlap enough.
 * The result carries a confidence from 0 to 1 and the reasons it is not 1. A match is information: two venues'
 * rules can still resolve the "same" question differently (a source, a deadline, a rounding rule). Pure.
 */
import type { Category, Market } from "./types";

export const MATCH_MIN = 0.6;

const MONTHS: Record<string, string> = {
  jan: "january", january: "january", feb: "february", february: "february", mar: "march", march: "march", apr: "april", april: "april", may: "may",
  jun: "june", june: "june", jul: "july", july: "july", aug: "august", august: "august", sep: "september", sept: "september", september: "september",
  oct: "october", october: "october", nov: "november", november: "november", dec: "december", december: "december",
};

/** Phrases folded to one token before splitting, so wording differences do not count. Order matters. */
const PHRASES: [RegExp, string | ((m: string, n: string) => string)][] = [
  [/\bfederal reserve\b|\bfomc\b|\bthe fed\b/g, " fed "],
  [/\binterest rates?\b|\bfed funds rate\b|\bfederal funds( target)?( rate| range)?\b|\brates?\b/g, " rates "],
  [/\bbasis points?\b|\bbps\b|\bbp\b/g, " bps "],
  [/(\d)\s*bps\b/g, "$1 bps "],
  [/\bno change\b|\bunchanged\b|\bholds?\b|\bpause[sd]?\b|\bmaintains?\b|\bkeeps?\b/g, " hold "],
  [/\bdecreases?\b|\bdecreased\b|\blowers?\b|\bcuts?\b|\breduces?\b|\breduction\b/g, " cut "],
  [/\bincreases?\b|\bincreased\b|\bhikes?\b|\braises?\b/g, " hike "],
  [/\bmore than\b|\bgreater than\b|\bhigher than\b|\bover\b|\babove\b|\bexceeds?\b|\bat least\b|\bor more\b|\bor higher\b|>=?/g, " above "],
  [/\bless than\b|\blower than\b|\bunder\b|\bbelow\b|\bor less\b|\bor lower\b|<=?/g, " below "],
  [/\byear[- ]over[- ]year\b|\byoy\b|\bannual\b|\bannually\b|\b12[- ]month\b/g, " yoy "],
  [/\bcpi\b|\bconsumer price index\b|\binflation\b/g, " inflation "],
  [/\bbitcoin\b|\bbtc\b/g, " bitcoin "], [/\bethereum\b|\beth\b/g, " ethereum "],
  [/\brepublicans?\b|\bgop\b/g, " republican "], [/\bdemocrats?\b|\bdemocratic\b/g, " democrat "],
  [/\bunited states\b|\bu\.s\.a?\.?/g, " us "],
  [/(\d),(\d{3})/g, "$1$2"], [/(\d+(?:\.\d+)?)\s*k\b/g, (_m, n) => ` ${Number(n) * 1000} `],
];

const POLARITY = new Set(["cut", "hike", "hold", "above", "below"]);
const STOP = new Set(("will the a an be is are was of in on at by to for after before its their his her this that than what which who how much many there any " +
  "and or with from as it if into than us market meeting end decision happen occur enter take place reach yes no price close closes closing until during within " +
  "win wins won next new does do did vs versus per out up down get").split(" "));
/** Capitalised words that are not names. */
const NOT_NAMES = new Set(["will", "the", "fed", "us", "yes", "no", "cpi", "gdp", "who", "what", "which", "how", "when", "in", "on", "by", "after", "before", "above", "below", "decision", "inflation", "recession", "rates", "nfp", "pce", "q1", "q2", "q3", "q4", "annual", "year", "bps", "cut", "hike", "hold", "no change", "president", "house", "senate", "republican", "democrat", "election", "us", "american", "federal", "reserve", "fomc", "market", "markets"]);

export type Features = { content: Set<string>; nums: Set<number>; polarity: Set<string>; years: Set<number>; months: Set<string>; names: Set<string>; all: Set<string> };

const stem = (w: string) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

function fold(text: string): string {
  let t = ` ${text.toLowerCase().replace(/[’']/g, "")} `;
  for (const [re, to] of PHRASES) t = typeof to === "string" ? t.replace(re, to) : t.replace(re, to);
  return t;
}

/** The parts of a market's wording that decide whether it is the same question. Pure. */
export function features(m: Pick<Market, "title" | "outcome" | "question">): Features {
  const text = [m.title, m.outcome, m.question].filter(Boolean).join(" . ");
  const t = fold(text);
  const tokens = t.split(/[^a-z0-9.%+]+/).map((w) => w.replace(/^[.%+]+|[.]+$/g, "")).filter(Boolean);
  const out: Features = { content: new Set(), nums: new Set(), polarity: new Set(), years: new Set(), months: new Set(), names: new Set(), all: new Set() };
  for (const raw of tokens) {
    const w = raw.replace(/%$/, "").replace(/\+$/, "");
    if (POLARITY.has(w)) { out.polarity.add(w); continue; }
    if (MONTHS[w]) { out.months.add(MONTHS[w]); out.all.add(MONTHS[w]); continue; }
    if (/^\d+(\.\d+)?$/.test(w)) {
      const n = Number(w);
      if (Number.isInteger(n) && n >= 2000 && n <= 2100) out.years.add(n);
      // Day-of-month numbers next to a month are dates, not thresholds: kept out of the numbers.
      else out.nums.add(n);
      continue;
    }
    if (/^\d{2}$/.test(w)) continue;
    const s = stem(w);
    out.all.add(s);
    if (!STOP.has(w) && !STOP.has(s) && s.length > 1) out.content.add(s);
  }
  // Day numbers ("December 9", "Dec 31") are dates; drop them from the thresholds when a month is named.
  if (out.months.size) for (const n of [...out.nums]) if (Number.isInteger(n) && n >= 1 && n <= 31 && new RegExp(`\\b(${Object.keys(MONTHS).join("|")})\\.?\\s+${n}\\b|\\b${n}(st|nd|rd|th)?\\s+(of\\s+)?(${Object.keys(MONTHS).join("|")})\\b`, "i").test(text)) out.nums.delete(n);
  // Names: capitalised words inside the text (not the first word of a sentence), folded like the content.
  for (const sentence of text.split(/[.?!:;]\s+|\s[-–]\s/)) {
    const words = sentence.trim().split(/\s+/);
    words.forEach((w, i) => {
      const clean = w.replace(/[^A-Za-z-]/g, "");
      if (i === 0 || clean.length < 3 || !/^[A-Z][a-z]/.test(clean)) return;
      const f = stem(fold(clean).trim().split(/\s+/)[0] ?? "");
      if (f && !NOT_NAMES.has(f) && !MONTHS[f] && !POLARITY.has(f) && !STOP.has(f)) out.names.add(f);
    });
  }
  return out;
}

const same = <T,>(a: Set<T>, b: Set<T>) => a.size === b.size && [...a].every((x) => b.has(x));
const overlaps = <T,>(a: Set<T>, b: Set<T>) => [...a].some((x) => b.has(x));
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}

/** Categories that can hold the same question (a venue files the Fed under Economics). */
const near = (a: Category, b: Category) => a === b || a === "other" || b === "other" || (["fed", "economy"].includes(a) && ["fed", "economy"].includes(b)) || (["tariffs", "politics", "economy"].includes(a) && ["tariffs", "politics", "economy"].includes(b));

export type MatchResult = { confidence: number; reasons: string[]; rejected?: string };

/** How sure we are that two markets ask the same question. 0 with `rejected` when a hard rule fails. Pure. */
export function matchScore(a: Pick<Market, "title" | "outcome" | "question" | "category" | "closeTime" | "venue">, b: Pick<Market, "title" | "outcome" | "question" | "category" | "closeTime" | "venue">, fa = features(a), fb = features(b)): MatchResult {
  const reject = (why: string): MatchResult => ({ confidence: 0, reasons: [], rejected: why });
  if (!near(a.category, b.category)) return reject("different categories");
  if (fa.polarity.size && fb.polarity.size && !overlaps(fa.polarity, fb.polarity)) return reject("opposite or different outcomes (cut, hike, hold, above, below)");
  if (fa.polarity.size && fb.polarity.size && !same(fa.polarity, fb.polarity)) return reject("the outcomes differ");
  if (fa.nums.size && fb.nums.size && !same(fa.nums, fb.nums)) return reject("different thresholds");
  if (fa.years.size && fb.years.size && !overlaps(fa.years, fb.years)) return reject("different years");
  if (fa.months.size && fb.months.size && !overlaps(fa.months, fb.months)) return reject("different months");
  const onlyA = [...fa.names].filter((n) => !fb.all.has(n) && !fb.names.has(n)), onlyB = [...fb.names].filter((n) => !fa.all.has(n) && !fa.names.has(n));
  if (onlyA.length && onlyB.length) return reject(`names differ (${onlyA[0]} against ${onlyB[0]})`);
  const ta = a.closeTime ? Date.parse(a.closeTime) : NaN, tb = b.closeTime ? Date.parse(b.closeTime) : NaN;
  const days = Number.isFinite(ta) && Number.isFinite(tb) ? Math.abs(ta - tb) / 86_400_000 : null;
  if (days !== null && days > 90) return reject("closing dates more than 90 days apart");

  const reasons: string[] = [];
  let c = jaccard(fa.content, fb.content);
  const dims: [Set<unknown>, Set<unknown>, number, number, string][] = [
    [fa.nums, fb.nums, 0.1, 0.15, "a threshold"], [fa.polarity, fb.polarity, 0.1, 0.15, "an outcome word"],
    [fa.years, fb.years, 0.05, 0.05, "a year"], [fa.months, fb.months, 0.05, 0.05, "a month"],
  ];
  for (const [x, y, bonus, cost, what] of dims) {
    if (x.size && y.size) c += bonus;
    else if (x.size || y.size) { c -= cost; reasons.push(`only one side names ${what}`); }
  }
  if (onlyA.length || onlyB.length) { c -= 0.1; reasons.push(`only one side names ${[...onlyA, ...onlyB][0]}`); }
  if (days !== null && days > 14) { c -= 0.25; reasons.push(`they close ${Math.round(days)} days apart, so the windows differ`); }
  else if (days !== null && days > 2) { c -= 0.1; reasons.push(`they close ${Math.round(days)} days apart`); }
  else if (days === null) { c -= 0.05; reasons.push("one closing date is unknown"); }
  return { confidence: Math.round(Math.max(0, Math.min(1, c)) * 100) / 100, reasons };
}

export type Pair = { a: Market; b: Market; confidence: number; reasons: string[] };

/**
 * The best counterpart of each market on every other venue, one to one, at MATCH_MIN or above. Venues are
 * compared pairwise; within a pair the most confident matches are taken first. Pure.
 */
export function matchAcross(markets: Market[], min = MATCH_MIN): Pair[] {
  const open = markets.filter((m) => m.status === "open" && m.prob !== null);
  const feats = new Map(open.map((m) => [m.key, features(m)]));
  const venues = [...new Set(open.map((m) => m.venue))];
  const out: Pair[] = [];
  for (let i = 0; i < venues.length; i++) for (let j = i + 1; j < venues.length; j++) {
    const A = open.filter((m) => m.venue === venues[i]), B = open.filter((m) => m.venue === venues[j]);
    const cands: Pair[] = [];
    for (const a of A) {
      const fa = feats.get(a.key)!;
      for (const b of B) {
        const fb = feats.get(b.key)!;
        // A cheap gate before the full score: some shared content word.
        if (!overlaps(fa.content, fb.content)) continue;
        const r = matchScore(a, b, fa, fb);
        if (!r.rejected && r.confidence >= min) cands.push({ a, b, confidence: r.confidence, reasons: r.reasons });
      }
    }
    const used = new Set<string>();
    for (const p of cands.sort((x, y) => y.confidence - x.confidence)) {
      if (used.has(p.a.key) || used.has(p.b.key)) continue;
      used.add(p.a.key); used.add(p.b.key);
      out.push(p);
    }
  }
  return out;
}

/** The markets on other venues that match one market, most confident first. Pure. */
export function counterparts(m: Market, markets: Market[], min = MATCH_MIN): { market: Market; confidence: number; reasons: string[] }[] {
  const fm = features(m);
  return markets.filter((x) => x.venue !== m.venue && x.key !== m.key)
    .map((x) => ({ market: x, ...matchScore(m, x, fm, features(x)) }))
    .filter((x) => !x.rejected && x.confidence >= min)
    .sort((a, b) => b.confidence - a.confidence)
    // One per venue.
    .filter((x, i, all) => all.findIndex((y) => y.market.venue === x.market.venue) === i)
    .map(({ market, confidence, reasons }) => ({ market, confidence, reasons }));
}
