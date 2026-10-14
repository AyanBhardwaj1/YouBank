/**
 * The entity crosswalk's pure parts (F1): making names comparable, scoring a name match, reading a
 * company's job boards out of its careers page, and the rule for what a match may be used for. Every new
 * source names a company its own way (a CIK at the SEC, a board token at Greenhouse, a recipient at
 * USAspending, an assignee at PatentsView), and this is where those names are judged.
 *
 * Name matching is Jaro-Winkler on the normalised names plus token overlap, with one rule that matters
 * more than the arithmetic: a name that adds a distinctive word ("Energy Transfer Equity" against "Energy
 * Transfer", "Apple Hospitality" against "Apple") is a different company until a person says otherwise,
 * so it can never score above the review line. Below 0.9 a link waits in the review queue and is not used.
 * Pure, tested on 40 fixture pairs and saved careers pages (scripts/test-edge-next.ts).
 */

export const SCHEMES = ["cik", "ticker", "lei", "uei", "domain", "wikidata", "wikipedia", "greenhouse", "lever", "ashby", "smartrecruiters", "patentsview", "github", "naics", "crux_origin"] as const;
export type Scheme = (typeof SCHEMES)[number];
export const isScheme = (s: string): s is Scheme => (SCHEMES as readonly string[]).includes(s);

/** Links at or above this are used; below it they wait for a person in the review queue. */
export const ACCEPT = 0.9;

/** Words that say what kind of entity it is, not which one: dropped before comparing. */
const GENERIC = new Set(["inc", "incorporated", "corp", "corporation", "co", "company", "companies", "llc", "lp", "llp", "ltd", "limited", "plc", "nv", "sa", "ag", "se", "the", "holdings", "holding", "group", "intl", "international", "usa", "us", "of", "and", "partners", "lllp", "pc", "pllc", "trust"]);

/** A company name made comparable: accents and punctuation set aside, "&" as "and", legal and generic words dropped. Pure. */
export function normEntity(name: string): string {
  return tokens(name).join(" ");
}

/** The distinctive words of a name, in order. Pure. */
export function tokens(name: string): string[] {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    // SEC's registrant suffixes ("KINDER MORGAN INC /DE/", "ONEOK INC /NEW/") name a state or a re-filing, not the company.
    .replace(/\s\/[a-z]{2,4}\/?(?=\s|$)/g, " ")
    .replace(/&/g, " and ").replace(/\b([a-z])\.(?=[a-z]\.)/g, "$1").replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/).filter((w) => w && !GENERIC.has(w));
}

/** Jaro-Winkler similarity (prefix scale 0.1, up to four characters). Pure. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false), bm = new Array<boolean>(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true; m++; break;
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let p = 0;
  while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

/** Two words are the same word when equal, or when both are five letters or more and differ by a typo (Jaro-Winkler 0.93). Pure. */
export const sameWord = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && jaroWinkler(a, b) >= 0.93);
const has = (words: string[], w: string) => words.some((x) => sameWord(x, w));

/** Shared words over all words (Jaccard), on distinctive words, typos forgiven. Pure. */
export function tokenOverlap(a: string, b: string): number {
  const A = [...new Set(tokens(a))], B = [...new Set(tokens(b))];
  if (!A.length || !B.length) return 0;
  const both = A.filter((w) => has(B, w)).length;
  return both / (A.length + B.length - both);
}

export type NameScore = { score: number; jw: number; overlap: number; extra: string[]; method: string };

/**
 * How likely two names are the same company, 0 to 1. Identical distinctive words score 1. Otherwise the
 * score blends Jaro-Winkler on the joined words (0.6) with word overlap (0.4); when one name holds every
 * word of the other plus more (an "extra" word), the score is capped just under the review line, because
 * that pattern is how affiliates, parents and namesakes are named. Pure.
 */
export function nameScore(a: string, b: string): NameScore {
  const ta = tokens(a), tb = tokens(b);
  const ja = ta.join(" "), jb = tb.join(" ");
  if (!ja || !jb) return { score: 0, jw: 0, overlap: 0, extra: [], method: "name match (empty)" };
  // Spacing differences ("ExxonMobil" and "Exxon Mobil") are the same words.
  if (ja === jb || ja.replace(/ /g, "") === jb.replace(/ /g, "")) return { score: 1, jw: 1, overlap: 1, extra: [], method: "name match (same words)" };
  const jw = jaroWinkler(ja, jb), overlap = tokenOverlap(a, b);
  const aInB = ta.every((w) => has(tb, w)), bInA = tb.every((w) => has(ta, w));
  const extra = aInB ? tb.filter((w) => !has(ta, w)) : bInA ? ta.filter((w) => !has(tb, w)) : [];
  let score = 0.6 * jw + 0.4 * overlap;
  if (extra.length) score = Math.min(score, ACCEPT - 0.05);
  const r = Math.round(score * 1000) / 1000;
  return { score: r, jw: Math.round(jw * 1000) / 1000, overlap: Math.round(overlap * 1000) / 1000, extra, method: `name match (Jaro-Winkler ${jw.toFixed(2)}, overlap ${overlap.toFixed(2)}${extra.length ? `, extra word "${extra.join(" ")}"` : ""})` };
}

/** What a link of this confidence may do: be used, or wait for a person. Pure. */
export const statusFor = (confidence: number): "active" | "review" => (confidence >= ACCEPT ? "active" : "review");

/* ---------------- Domains and careers pages ---------------- */

const TWO_LEVEL = new Set(["co.uk", "com.au", "co.jp", "com.br", "co.in", "com.cn", "co.nz", "com.mx", "co.za", "com.sg"]);

/** A web address's registrable domain: "https://careers.energytransfer.com/x" is "energytransfer.com". Pure. */
export function domainOf(url: string): string | null {
  let host: string;
  try { host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase(); } catch { return null; }
  host = host.replace(/^www\d?\./, "");
  if (!/\./.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  const parts = host.split(".");
  const last2 = parts.slice(-2).join(".");
  return TWO_LEVEL.has(last2) && parts.length >= 3 ? parts.slice(-3).join(".") : last2;
}

export type BoardHit = { scheme: Scheme | "workday" | "successfactors"; value: string; evidence: string };

const BOARD_PATTERNS: { scheme: BoardHit["scheme"]; re: RegExp }[] = [
  { scheme: "greenhouse", re: /(?:job-)?boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/|embed\/job_board(?:\/js)?\?for=)?([a-z0-9_-]{2,60})/gi },
  { scheme: "greenhouse", re: /greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([a-z0-9_-]{2,60})/gi },
  { scheme: "lever", re: /(?:jobs|api)\.lever\.co\/(?:v0\/postings\/)?([a-z0-9_.-]{2,60})/gi },
  { scheme: "ashby", re: /(?:jobs\.ashbyhq\.com|api\.ashbyhq\.com\/posting-api\/job-board)\/([a-z0-9_.%-]{2,60})/gi },
  { scheme: "smartrecruiters", re: /(?:careers|jobs)\.smartrecruiters\.com\/([a-z0-9_-]{2,60})/gi },
  { scheme: "workday", re: /([a-z0-9-]+)\.(?:wd\d+\.)?myworkdayjobs\.com/gi },
  { scheme: "successfactors", re: /(?:career\d*\.successfactors\.(?:com|eu)|jobs\.sap\.com)\/[^"'\s]*company=([a-z0-9_-]{2,60})/gi },
];
/** Path words that are part of the platforms' own pages, never a company's token. */
const NOT_TOKENS = new Set(["embed", "v1", "boards", "jobs", "job_board", "js", "api", "postings", "posting-api", "job-board", "careers", "static", "assets", "include", "for"]);

/**
 * The job boards a page links or embeds: Greenhouse, Lever, Ashby and SmartRecruiters (which Edge reads),
 * and Workday or SuccessFactors (which it may not: no public API, and their terms forbid scraping), so the
 * coverage note can say why a large company's hiring is not counted. Pure.
 */
export function atsBoardsIn(html: string, pageUrl: string): BoardHit[] {
  const out = new Map<string, BoardHit>();
  const text = html.replace(/&amp;/g, "&").replace(/\\\//g, "/");
  for (const { scheme, re } of BOARD_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const value = decodeURIComponent(m[1]).toLowerCase().replace(/[.,;]+$/, "");
      if (!value || NOT_TOKENS.has(value)) continue;
      const key = `${scheme}:${value}`;
      if (!out.has(key)) out.set(key, { scheme, value, evidence: pageUrl });
    }
  }
  return [...out.values()];
}

/** Links on a page that lead to its careers or jobs page, made absolute, best first. Pure. */
export function careersLinks(html: string, base: string): string[] {
  const out: { url: string; rank: number }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const href = m[1].trim(), label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const rank = /\bcareers?\b/.test(label) || /\/careers?\b/i.test(href) ? 0 : /\bjobs?\b|join (us|our team)|work (with|for) us/.test(label) || /\/jobs?\b|\/join-us/i.test(href) ? 1 : -1;
    if (rank < 0 || /^(mailto|tel|javascript):/i.test(href)) continue;
    try { out.push({ url: new URL(href, base).toString(), rank }); } catch { /* not a link */ }
  }
  const seen = new Set<string>();
  return out.sort((a, b) => a.rank - b.rank).map((x) => x.url).filter((u) => !seen.has(u) && !!seen.add(u)).slice(0, 4);
}

/**
 * Whether a board that went quiet has moved: it shows no postings now, it had some before, and the careers
 * page links a different board than the one on record. Then the finding is "jobs board moved", not
 * "hiring stopped". Pure.
 */
export function boardMoved(current: { scheme: string; value: string }, before: number, now: number, onPage: BoardHit[]): BoardHit | null {
  if (now > 0 || before <= 0) return null;
  return onPage.find((b) => (b.scheme === "greenhouse" || b.scheme === "lever" || b.scheme === "ashby") && !(b.scheme === current.scheme && b.value === current.value)) ?? null;
}

/** A company name as a board token guess: "Energy Transfer LP" as "energytransfer". Pure. */
export const tokenGuess = (name: string) => tokens(name).join("").slice(0, 40);
