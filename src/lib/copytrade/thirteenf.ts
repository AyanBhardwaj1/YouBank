/**
 * Form 13F, read from the documents EDGAR publishes. Pure: no network, no database, so every rule here
 * is covered by scripts/test-copytrade.ts.
 *
 * A 13F filing has two XML documents:
 * - the primary document (primary_doc.xml): the period, whether it amends an earlier filing and how
 *   (a RESTATEMENT replaces the earlier report; NEW HOLDINGS adds lines to it, often ones first withheld
 *   under confidential treatment), whether it is a holdings report or a notice that another manager
 *   reports for this one, and whether any holdings were omitted under confidential treatment;
 * - the information table: one line per security, per investment-discretion type and per other
 *   manager, with CUSIP, value, shares or principal, put/call and voting authority.
 *
 * Values: filings made from 3 January 2023 report value in dollars; earlier ones in thousands of dollars.
 * Some filers kept the old unit for a while after the change (and a few used dollars early), so the
 * implied price per share decides when the filing date and the numbers disagree.
 */
import { XMLParser } from "fast-xml-parser";

export type PutCall = "PUT" | "CALL";

/** One line of an information table, values in US dollars. */
export type InfoLine = {
  name: string;
  titleOfClass: string;
  cusip: string;
  figi: string | null;
  value: number;
  shares: number;
  /** SH (shares) or PRN (principal amount, for convertible bonds and the like). */
  shareType: "SH" | "PRN";
  putCall: PutCall | null;
  /** SOLE, DFND (shared-defined) or OTR (shared-other). */
  discretion: string;
  otherManagers: string;
  voting: { sole: number; shared: number; none: number };
};

export type ReportType = "HOLDINGS" | "NOTICE" | "COMBINATION";
export type AmendmentType = "RESTATEMENT" | "NEW HOLDINGS";

/** What the primary document says about a filing. */
export type FilingMeta = {
  filer: string;
  /** Quarter end, YYYY-MM-DD. */
  period: string;
  isAmendment: boolean;
  amendmentNo: number | null;
  amendmentType: AmendmentType | null;
  /** An amendment filed because confidential treatment was denied or expired. */
  confidentialDeniedOrExpired: boolean;
  reportType: ReportType;
  /** Some holdings were left out under a request for confidential treatment. */
  confidentialOmitted: boolean;
  entryTotal: number | null;
  valueTotal: number | null;
  otherManagersIncluded: number;
};

/** Lines for one security (CUSIP, put/call and share type) summed across discretion types and managers. */
export type Holding = {
  cusip: string;
  /** The issuer part of the CUSIP: share classes of one company share it. */
  issuer6: string;
  name: string;
  titleOfClass: string;
  value: number;
  shares: number;
  shareType: "SH" | "PRN";
  putCall: PutCall | null;
  lines: number;
};

/** A filing as stored: its metadata and its holdings. */
export type FilingRecord = {
  accession: string;
  form: string;
  filedOn: string;
  period: string;
  amendmentType: AmendmentType | null;
  reportType: ReportType;
  confidentialOmitted: boolean;
  holdings: Holding[];
};

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true, processEntities: true, htmlEntities: true });
const arr = <T,>(x: T | T[] | undefined | null): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const str = (v: unknown): string => (v == null ? "" : typeof v === "object" ? String((v as Record<string, unknown>)["#text"] ?? "") : String(v)).trim();
const num = (v: unknown): number => { const n = Number(str(v).replace(/[,$\s]/g, "")); return Number.isFinite(n) ? n : 0; };

/** The date filings switched from thousands of dollars to dollars (SEC Release 34-95148). */
export const DOLLAR_VALUES_FROM = "2023-01-03";

/** "12-31-2024" or "2024-12-31" as "2024-12-31"; anything else as given. */
export function isoPeriod(s: string): string {
  const t = s.trim();
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : t;
}

/** Find the first object under `node` that has key `k`, however deep. */
function find(node: unknown, k: string): unknown {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) { for (const x of node) { const f = find(x, k); if (f !== undefined) return f; } return undefined; }
  const o = node as Record<string, unknown>;
  if (k in o) return o[k];
  for (const v of Object.values(o)) { const f = find(v, k); if (f !== undefined) return f; }
  return undefined;
}

const truthy = (v: unknown) => /^(true|y|yes|1)$/i.test(str(v));

/** The primary document (primary_doc.xml) of a 13F-HR or 13F-HR/A. */
export function parsePrimaryDoc(xml: string): FilingMeta {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const rt = str(find(doc, "reportType")).toUpperCase();
  const at = str(find(doc, "amendmentType")).toUpperCase();
  const amendNo = num(find(doc, "amendmentNo"));
  return {
    filer: str(find(find(doc, "filingManager"), "name")),
    period: isoPeriod(str(find(doc, "reportCalendarOrQuarter")) || str(find(doc, "periodOfReport"))),
    isAmendment: truthy(find(doc, "isAmendment")),
    amendmentNo: amendNo || null,
    amendmentType: at.includes("RESTATE") ? "RESTATEMENT" : at.includes("NEW") ? "NEW HOLDINGS" : null,
    confidentialDeniedOrExpired: truthy(find(doc, "confDeniedExpired")),
    reportType: rt.includes("NOTICE") ? "NOTICE" : rt.includes("COMBINATION") ? "COMBINATION" : "HOLDINGS",
    confidentialOmitted: truthy(find(doc, "isConfidentialOmitted")),
    entryTotal: find(doc, "tableEntryTotal") !== undefined ? num(find(doc, "tableEntryTotal")) : null,
    valueTotal: find(doc, "tableValueTotal") !== undefined ? num(find(doc, "tableValueTotal")) : null,
    otherManagersIncluded: num(find(doc, "otherIncludedManagersCount")),
  };
}

/** Raw information-table lines, values as reported (units decided by `valueMultiplier`). */
export function parseInfoTableRaw(xml: string): InfoLine[] {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const table = find(doc, "informationTable") ?? doc;
  const out: InfoLine[] = [];
  for (const r of arr(find(table, "infoTable") as Record<string, unknown> | Record<string, unknown>[])) {
    const amt = (r.shrsOrPrnAmt ?? {}) as Record<string, unknown>;
    const vote = (r.votingAuthority ?? {}) as Record<string, unknown>;
    const pc = str(r.putCall).toUpperCase();
    const cusip = str(r.cusip).toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (!cusip) continue;
    out.push({
      name: str(r.nameOfIssuer), titleOfClass: str(r.titleOfClass), cusip, figi: str(r.figi) || null,
      value: num(r.value), shares: num(amt.sshPrnamt), shareType: str(amt.sshPrnamtType).toUpperCase() === "PRN" ? "PRN" : "SH",
      putCall: pc === "PUT" ? "PUT" : pc === "CALL" ? "CALL" : null,
      discretion: str(r.investmentDiscretion).toUpperCase(), otherManagers: str(r.otherManager),
      voting: { sole: num(vote.Sole ?? vote.sole), shared: num(vote.Shared ?? vote.shared), none: num(vote.None ?? vote.none) },
    });
  }
  return out;
}

const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * What to multiply reported values by to get dollars, and whether the filing date's rule was overridden.
 * By date: 1000 before 3 January 2023, 1 from then. The override reads the median implied price per
 * share of the plain share lines: under $1 in a "dollars" filing means it is really in thousands; over
 * $20,000 in a "thousands" filing means it is really in dollars. Real portfolios' medians sit far from
 * both (even penny-stock books hold a few dollar stocks).
 */
export function valueMultiplier(lines: Pick<InfoLine, "value" | "shares" | "shareType" | "putCall">[], filedOn: string): { multiplier: 1 | 1000; corrected: boolean } {
  const byDate: 1 | 1000 = filedOn >= DOLLAR_VALUES_FROM ? 1 : 1000;
  const prices = lines.filter((l) => l.shareType === "SH" && !l.putCall && l.shares > 0 && l.value > 0).map((l) => (l.value * byDate) / l.shares);
  if (prices.length < 3) return { multiplier: byDate, corrected: false };
  const m = median(prices);
  if (byDate === 1 && m < 1) return { multiplier: 1000, corrected: true };
  if (byDate === 1000 && m > 20_000) return { multiplier: 1, corrected: true };
  return { multiplier: byDate, corrected: false };
}

/** Information-table lines in dollars. */
export function parseInfoTable(xml: string, filedOn: string): { lines: InfoLine[]; unitCorrected: boolean } {
  const raw = parseInfoTableRaw(xml);
  const { multiplier, corrected } = valueMultiplier(raw, filedOn);
  return { lines: multiplier === 1 ? raw : raw.map((l) => ({ ...l, value: l.value * multiplier })), unitCorrected: corrected };
}

const holdingKey = (h: { cusip: string; putCall: PutCall | null; shareType: string }) => `${h.cusip}|${h.putCall ?? ""}|${h.shareType}`;

/** Lines summed per security (one CUSIP may appear once per discretion type and other manager). Largest first. */
export function aggregate(lines: InfoLine[]): Holding[] {
  const by = new Map<string, Holding>();
  for (const l of lines) {
    const k = holdingKey(l);
    const h = by.get(k);
    if (h) { h.value += l.value; h.shares += l.shares; h.lines++; }
    else by.set(k, { cusip: l.cusip, issuer6: l.cusip.slice(0, 6), name: l.name, titleOfClass: l.titleOfClass, value: l.value, shares: l.shares, shareType: l.shareType, putCall: l.putCall, lines: 1 });
  }
  return [...by.values()].sort((a, b) => b.value - a.value);
}

/** Two sets of holdings added together (a NEW HOLDINGS amendment adds to the report it amends). */
export function addHoldings(base: Holding[], extra: Holding[]): Holding[] {
  const by = new Map(base.map((h) => [holdingKey(h), { ...h }]));
  for (const x of extra) {
    const k = holdingKey(x);
    const h = by.get(k);
    if (h) { h.value += x.value; h.shares += x.shares; h.lines += x.lines; }
    else by.set(k, { ...x });
  }
  return [...by.values()].sort((a, b) => b.value - a.value);
}

/** Whether a form is a 13F holdings report or its amendment (13F-NT notices carry no holdings). */
export const is13fHoldingsForm = (form: string) => /^13F-HR(\/A)?$/i.test(form.trim());

/**
 * The portfolio for one quarter as it was publicly known on `asOf`: the original report, replaced by
 * any RESTATEMENT filed by then, plus every NEW HOLDINGS amendment filed by then (holdings first kept
 * confidential appear here, on the day they were disclosed, not before). A NOTICE carries no holdings.
 */
export function portfolioAsOf(filings: FilingRecord[], period: string, asOf: string): { holdings: Holding[]; accessions: string[]; confidentialOmitted: boolean; restated: boolean; notice: boolean } | null {
  const fs = filings.filter((f) => f.period === period && f.filedOn <= asOf).sort((a, b) => (a.filedOn === b.filedOn ? (a.accession < b.accession ? -1 : 1) : a.filedOn < b.filedOn ? -1 : 1));
  if (!fs.length) return null;
  let holdings: Holding[] = [];
  const accessions: string[] = [];
  let restated = false, notice = false, confidentialOmitted = false;
  for (const f of fs) {
    if (f.reportType === "NOTICE") { if (!accessions.length) notice = true; continue; }
    if (f.amendmentType === "NEW HOLDINGS") holdings = addHoldings(holdings, f.holdings);
    else { if (accessions.length) restated = true; holdings = f.holdings.map((h) => ({ ...h })); }
    accessions.push(f.accession);
    confidentialOmitted = f.confidentialOmitted;
    notice = false;
  }
  return { holdings, accessions, confidentialOmitted, restated, notice };
}

/** The most recent quarter with a filing by `asOf`, and its portfolio as known then. */
export function latestKnown(filings: FilingRecord[], asOf: string): { period: string; portfolio: NonNullable<ReturnType<typeof portfolioAsOf>> } | null {
  const periods = [...new Set(filings.filter((f) => f.filedOn <= asOf && f.reportType !== "NOTICE").map((f) => f.period))].sort().reverse();
  for (const p of periods) {
    const portfolio = portfolioAsOf(filings, p, asOf);
    if (portfolio && portfolio.holdings.length) return { period: p, portfolio };
  }
  return null;
}

/* ---------------- Quarter over quarter ---------------- */

const SPLIT_RATIOS = [1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50];
const SPLIT_CANDIDATES = [...SPLIT_RATIOS, ...SPLIT_RATIOS.map((r) => 1 / r)];

/**
 * A stock split between two quarters, seen in a position: the share count changed by a split ratio
 * while the implied price per share moved by about the inverse. Buying or selling changes the count but
 * leaves the price alone; a price that moved without the count is just the market. Returns the ratio
 * (new shares per old, below 1 for a reverse split) or null.
 */
export function splitBetween(prev: { value: number; shares: number }, cur: { value: number; shares: number }, known?: number): number | null {
  if (!(prev.shares > 0 && cur.shares > 0 && prev.value > 0 && cur.value > 0)) return null;
  const r = cur.shares / prev.shares;
  if (known && Math.abs(Math.log(r / known)) <= 0.05) return known;
  if (r < 1.4 && r > 1 / 1.4) return null;
  const ratio = SPLIT_CANDIDATES.find((c) => Math.abs(Math.log(r / c)) <= 0.03);
  if (!ratio) return null;
  const priceDrop = (prev.value / prev.shares) / (cur.value / cur.shares);
  return Math.abs(Math.log(priceDrop / ratio)) < 0.5 ? ratio : null;
}

export type ChangeKind = "new" | "added" | "trimmed" | "exited" | "unchanged";
export type Change = {
  cusip: string; name: string; kind: ChangeKind;
  sharesBefore: number; sharesAfter: number;
  /** Change in shares, on the new share basis when a split happened between the quarters. */
  sharesChangePct: number | null;
  weightBefore: number; weightAfter: number; valueAfter: number;
  split: number | null;
};

/**
 * What changed between two quarters, for long equity lines (options and principal amounts are listed on
 * their own). A position counts as added or trimmed when its split-adjusted share count moved by more
 * than 1%; smaller moves are rounding and other managers' lines.
 */
export function compareQuarters(prev: Holding[], cur: Holding[], knownSplits: Record<string, number> = {}): Change[] {
  const eq = (hs: Holding[]) => hs.filter((h) => !h.putCall && h.shareType === "SH");
  const p = eq(prev), c = eq(cur);
  const tp = p.reduce((s, h) => s + h.value, 0) || 1, tc = c.reduce((s, h) => s + h.value, 0) || 1;
  const pm = new Map(p.map((h) => [h.cusip, h]));
  const out: Change[] = [];
  for (const h of c) {
    const was = pm.get(h.cusip);
    pm.delete(h.cusip);
    if (!was) { out.push({ cusip: h.cusip, name: h.name, kind: "new", sharesBefore: 0, sharesAfter: h.shares, sharesChangePct: null, weightBefore: 0, weightAfter: h.value / tc, valueAfter: h.value, split: null }); continue; }
    const split = splitBetween(was, h, knownSplits[h.cusip]);
    const before = was.shares * (split ?? 1);
    const pct = before > 0 ? h.shares / before - 1 : null;
    const kind: ChangeKind = pct === null ? "unchanged" : pct > 0.01 ? "added" : pct < -0.01 ? "trimmed" : "unchanged";
    out.push({ cusip: h.cusip, name: h.name, kind, sharesBefore: was.shares, sharesAfter: h.shares, sharesChangePct: pct, weightBefore: was.value / tp, weightAfter: h.value / tc, valueAfter: h.value, split });
  }
  for (const was of pm.values()) out.push({ cusip: was.cusip, name: was.name, kind: "exited", sharesBefore: was.shares, sharesAfter: 0, sharesChangePct: -1, weightBefore: was.value / tp, weightAfter: 0, valueAfter: 0, split: null });
  const order: Record<ChangeKind, number> = { new: 0, added: 1, trimmed: 2, exited: 3, unchanged: 4 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || Math.abs(b.weightAfter - b.weightBefore) - Math.abs(a.weightAfter - a.weightBefore));
}

/* ---------------- Portfolio statistics ---------------- */

/** Concentration of a set of weights: the top-10 share, the Herfindahl index and the effective number of positions (1 / HHI). */
export function concentration(weights: number[]): { top10: number; hhi: number; effectiveN: number } {
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  const ws = weights.map((w) => w / total).sort((a, b) => b - a);
  const hhi = ws.reduce((s, w) => s + w * w, 0);
  return { top10: ws.slice(0, 10).reduce((s, w) => s + w, 0), hhi, effectiveN: hhi > 0 ? 1 / hhi : 0 };
}

/** One-way turnover between two weight maps: half the sum of absolute weight changes (0 none, 1 everything replaced). */
export function turnover(prev: Record<string, number>, cur: Record<string, number>): number {
  const keys = new Set([...Object.keys(prev), ...Object.keys(cur)]);
  let t = 0;
  for (const k of keys) t += Math.abs((cur[k] ?? 0) - (prev[k] ?? 0));
  return t / 2;
}

/** Weights of long equity positions keyed by CUSIP. */
export function equityWeights(hs: Holding[]): Record<string, number> {
  const eq = hs.filter((h) => !h.putCall && h.shareType === "SH");
  const total = eq.reduce((s, h) => s + h.value, 0) || 1;
  const out: Record<string, number> = {};
  for (const h of eq) out[h.cusip] = (out[h.cusip] ?? 0) + h.value / total;
  return out;
}

/** The 45-day deadline for a quarter's 13F (the next business day when it falls on a weekend). */
export function filingDeadline(period: string): string {
  const d = new Date(`${period}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 45);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Quarter end for a date: the last day of its calendar quarter. */
export function quarterEndOf(date: string): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  const qm = Math.ceil(m / 3) * 3;
  return new Date(Date.UTC(y, qm, 0)).toISOString().slice(0, 10);
}

/** Days from the quarter end to the filing. */
export const lagDays = (period: string, filedOn: string) => Math.round((Date.parse(`${filedOn}T00:00:00Z`) - Date.parse(`${period}T00:00:00Z`)) / 86_400_000);
