/**
 * The Deal Radar's features (E4): the only place they are defined. Each is computed for a company at a
 * cut-off date from what had been filed by then, so nothing from the future leaks in: XBRL facts are taken
 * as filed (a later restatement has a later filing date and is ignored), filings are counted only when
 * their filing date is before the cut-off. The scorecard's no-look-ahead test feeds a "future" filing and
 * checks the row does not change.
 *
 * Families (docs/edge-next.md, E4): classic takeover likelihood (size, growth, profitability, leverage,
 * liquidity, Palepu's growth-resource mismatch), the industry's deal wave (Harford 2005), shareholders
 * (new 13Ds, amendments, a 13G turning into a 13D, insider filings), governance and events from 8-K items
 * (5.02 officer departures, 3.03 rights plans, 5.03 bylaw changes, 1.01 agreements), proxy contests, and
 * filing activity. Market prices, the deal model's graph scores, Newsroom clusters and the Pulse are left
 * out of training in this round: none has a dated history for delisted companies (the past targets), and
 * using them for some companies and not others would teach the model that missing data means a sale.
 * Pure.
 */

/** One XBRL value as filed: period end (and start for durations), value, filing date. */
export type FactRow = { e: string; s?: string; v: number; f: string };
/** One filing: form, filing date, 8-K items, and (for the forms that can be reasons) its URL. */
export type FilingRow = { f: string; d: string; i?: string; u?: string };
/** What the Radar keeps about a company (R2 odds/raw/{cik}.json): its SIC, names and the two lists. */
export type RawCompany = { cik: string; name: string; ticker: string; sic: string; listed: boolean; facts: Record<string, FactRow[]>; filings: FilingRow[]; fetchedAt: string };

/** The concepts kept from company facts (first available in each list wins). */
export const CONCEPTS: Record<string, string[]> = {
  assets: ["Assets"], liabilities: ["Liabilities"], cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"], netIncome: ["NetIncomeLoss"], opIncome: ["OperatingIncomeLoss"],
  debt: ["LongTermDebt", "LongTermDebtNoncurrent"],
};

export type FeatureDef = { key: string; label: string; up: string; down: string; monotone: -1 | 0 | 1; family: string };

/** Every feature, in model order, with words for its reasons and its monotone constraint (+1: more never lowers the odds). */
export const FEATURES: FeatureDef[] = [
  { key: "logAssets", label: "size (assets)", up: "a larger company", down: "a smaller company", monotone: 0, family: "classic" },
  { key: "logRevenue", label: "revenue", up: "higher revenue", down: "lower revenue", monotone: 0, family: "classic" },
  { key: "revGrowth", label: "revenue growth", up: "faster revenue growth", down: "slower revenue growth", monotone: 0, family: "classic" },
  { key: "roa", label: "return on assets", up: "higher profitability", down: "weak profitability", monotone: 0, family: "classic" },
  { key: "leverage", label: "leverage", up: "more leverage", down: "less leverage", monotone: 0, family: "classic" },
  { key: "cashRatio", label: "cash to assets", up: "more cash on hand", down: "less cash on hand", monotone: 0, family: "classic" },
  { key: "mismatch", label: "growth-resource mismatch", up: "a growth-resource mismatch (Palepu)", down: "growth matched to resources", monotone: 1, family: "classic" },
  { key: "wave", label: "industry deal wave", up: "a merger wave in its industry", down: "a quiet deal market in its industry", monotone: 1, family: "wave" },
  { key: "sc13d", label: "new 13D filings", up: "a new 13D (an active holder)", down: "no new 13D", monotone: 1, family: "holders" },
  { key: "sc13dA", label: "13D amendments", up: "13D amendments", down: "no 13D amendments", monotone: 1, family: "holders" },
  { key: "switch13g", label: "a 13G turned 13D", up: "a passive holder turned active (13G to 13D)", down: "no holder turned active", monotone: 1, family: "holders" },
  { key: "insider", label: "insider filings (6 months)", up: "more insider filings", down: "fewer insider filings", monotone: 0, family: "holders" },
  { key: "officerChange", label: "officer departures (8-K 5.02)", up: "a CEO or CFO change", down: "no officer change", monotone: 0, family: "events" },
  { key: "rightsPlan", label: "rights plan (8-K 3.03)", up: "a rights plan or change to holders' rights", down: "no rights plan", monotone: 0, family: "events" },
  { key: "bylaws", label: "bylaw changes (8-K 5.03)", up: "bylaw changes", down: "no bylaw changes", monotone: 0, family: "events" },
  { key: "agreements", label: "material agreements (8-K 1.01)", up: "material agreements signed", down: "few material agreements", monotone: 0, family: "events" },
  { key: "proxyFight", label: "proxy contest", up: "a proxy contest", down: "no proxy contest", monotone: 1, family: "events" },
  { key: "lateFiling", label: "late filing notice", up: "a late filing notice", down: "filings on time", monotone: 0, family: "events" },
  { key: "activity8k", label: "8-K activity (3 months)", up: "more 8-K filings lately", down: "fewer 8-K filings lately", monotone: 0, family: "events" },
  { key: "age", label: "years filing", up: "a longer filing history", down: "a shorter filing history", monotone: 0, family: "classic" },
];
export const FEATURE_KEYS = FEATURES.map((f) => f.key);
export const FEATURE: Record<string, FeatureDef> = Object.fromEntries(FEATURES.map((f) => [f.key, f]));

const DAY = 86_400_000;
const back = (cutoff: string, days: number) => new Date(Date.parse(cutoff) - days * DAY).toISOString().slice(0, 10);

/** The latest value of an instant concept filed before the cut-off. Pure. */
export function instantAsOf(rows: FactRow[] | undefined, cutoff: string): number | null {
  let best: FactRow | null = null;
  for (const r of rows ?? []) if (!r.s && r.f < cutoff && (!best || r.e > best.e || (r.e === best.e && r.f > best.f))) best = r;
  return best ? best.v : null;
}

/** The last twelve months of a duration concept filed before the cut-off: an annual row, or four quarters, ending latest. Pure. */
export function ltmAsOf(rows: FactRow[] | undefined, cutoff: string, endBefore?: string): { v: number; end: string } | null {
  const ok = (rows ?? []).filter((r) => r.s && r.f < cutoff && (!endBefore || r.e <= endBefore));
  const len = (r: FactRow) => (Date.parse(r.e) - Date.parse(r.s!)) / DAY;
  const annual = ok.filter((r) => len(r) >= 350 && len(r) <= 380).sort((a, b) => b.e.localeCompare(a.e) || b.f.localeCompare(a.f))[0];
  const quarters = ok.filter((r) => len(r) >= 80 && len(r) <= 100).sort((a, b) => b.e.localeCompare(a.e) || b.f.localeCompare(a.f));
  const q4: FactRow[] = [];
  for (const q of quarters) { if (q4.some((x) => x.e === q.e)) continue; if (q4.length && Date.parse(q4[q4.length - 1].s!) - Date.parse(q.e) > 20 * DAY) break; q4.push(q); if (q4.length === 4) break; }
  const fromQ = q4.length === 4 ? { v: q4.reduce((s, r) => s + r.v, 0), end: q4[0].e } : null;
  if (annual && (!fromQ || annual.e >= fromQ.end)) return { v: annual.v, end: annual.e };
  return fromQ;
}

/** Filings of these forms (prefix match on "SC 13D" etc.) in the `days` before the cut-off. Pure. */
export function countForms(filings: FilingRow[], cutoff: string, days: number, test: (f: FilingRow) => boolean): number {
  const from = back(cutoff, days);
  let n = 0;
  for (const f of filings) if (f.d < cutoff && f.d >= from && test(f)) n++;
  return n;
}

/** The first index in a sorted array whose value is at least `v`. Pure. */
const lowerBound = (xs: string[], v: string) => { let lo = 0, hi = xs.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] < v) lo = mid + 1; else hi = mid; } return lo; };

/** Filing dates sorted once per company and signal, so a panel of many months counts by binary search. */
type Indexed = Record<string, string[]>;
const INDEX = new WeakMap<FilingRow[], Indexed>();
const SIGNALS: Record<string, (f: FilingRow) => boolean> = {};
function indexed(filings: FilingRow[]): Indexed {
  let ix = INDEX.get(filings);
  if (ix) return ix;
  ix = {};
  for (const [k, t] of Object.entries(SIGNALS)) ix[k] = filings.filter(t).map((f) => f.d).sort();
  INDEX.set(filings, ix);
  return ix;
}
/** Filings of a named signal in the `days` before the cut-off, by binary search. Pure. */
export function countSignal(filings: FilingRow[], key: string, cutoff: string, days: number): number {
  const d = indexed(filings)[key] ?? [];
  return lowerBound(d, cutoff) - lowerBound(d, back(cutoff, days));
}

const item = (code: string) => (f: FilingRow) => /^8-K/.test(f.f) && (f.i ?? "").split(",").some((x) => x.trim() === code);
const isForm = (...forms: string[]) => (f: FilingRow) => forms.includes(f.f);
Object.assign(SIGNALS, {
  sc13g: (x: FilingRow) => /^SC 13G/.test(x.f), sc13d: isForm("SC 13D"), sc13dA: isForm("SC 13D/A"), form4: isForm("4", "4/A"),
  i502: item("5.02"), i303: item("3.03"), i503: item("5.03"), i101: item("1.01"), proxy: isForm("PREC14A", "DEFC14A", "DFAN14A", "PREC14C"),
  late: (x: FilingRow) => /^NT 10-[KQ]/.test(x.f), any8k: (x: FilingRow) => /^8-K/.test(x.f), all: () => true,
});

/** The context a row needs beyond the company: target events by SIC2 (for the wave). */
export type WaveContext = { eventsBySic2: Map<string, string[]>; longRunMonthly: Map<string, number> };

/** Events in a SIC2 group in the 12 months before the cut-off, against its long-run monthly rate (12 x rate). Pure. */
export function waveOf(sic: string, cutoff: string, ctx: WaveContext): number {
  const g = sic.slice(0, 2);
  const dates = ctx.eventsBySic2.get(g) ?? [];
  const from = back(cutoff, 365);
  const recent = dates.filter((d) => d < cutoff && d >= from).length;
  const rate = ctx.longRunMonthly.get(g) ?? 0;
  return rate > 0 ? recent / (12 * rate) : recent > 0 ? 2 : 1;
}

const log10p = (v: number | null) => (v !== null && v > 0 ? Math.log10(v / 1e6 + 1) : NaN);
const ratio = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? a / b : NaN);

/**
 * The feature row for a company at a cut-off date (YYYY-MM-DD), in FEATURES order; NaN where the data is
 * missing (the model treats it as missing, never as zero). Only data filed before the cut-off is read. Pure.
 */
export function featureRow(raw: Pick<RawCompany, "facts" | "filings" | "sic">, cutoff: string, ctx: WaveContext, medians?: { growth: number; cash: number; leverage: number }): number[] {
  const assets = instantAsOf(raw.facts.assets, cutoff), liabilities = instantAsOf(raw.facts.liabilities, cutoff), cash = instantAsOf(raw.facts.cash, cutoff);
  const rev = ltmAsOf(raw.facts.revenue, cutoff), ni = ltmAsOf(raw.facts.netIncome, cutoff);
  const revPrior = rev ? ltmAsOf(raw.facts.revenue, cutoff, back(rev.end, 330)) : null;
  const growth = rev && revPrior && revPrior.v > 0 ? rev.v / revPrior.v - 1 : NaN;
  const leverage = ratio(liabilities, assets), cashRatio = ratio(cash, assets);
  const m = medians ?? { growth: 0.05, cash: 0.08, leverage: 0.55 };
  // Palepu: high growth with little cash and much debt, or low growth with much cash and little debt.
  const mismatch = Number.isFinite(growth) && Number.isFinite(cashRatio) && Number.isFinite(leverage)
    ? ((growth > m.growth && cashRatio < m.cash && leverage > m.leverage) || (growth < m.growth && cashRatio > m.cash && leverage < m.leverage) ? 1 : 0) : NaN;
  const f = raw.filings;
  const c = (key: string, days: number) => countSignal(f, key, cutoff, days);
  const had13g = c("sc13g", 730) > 0;
  const new13d = c("sc13d", 365);
  const all = indexed(f).all;
  const first = all.length && all[0] < cutoff ? all[0] : cutoff;
  const row: Record<string, number> = {
    logAssets: log10p(assets), logRevenue: log10p(rev?.v ?? null), revGrowth: Number.isFinite(growth) ? Math.max(-1, Math.min(3, growth)) : NaN,
    roa: Number.isFinite(ratio(ni?.v ?? null, assets)) ? Math.max(-1, Math.min(1, ratio(ni?.v ?? null, assets))) : NaN, leverage: Number.isFinite(leverage) ? Math.min(3, leverage) : NaN, cashRatio, mismatch,
    wave: waveOf(raw.sic, cutoff, ctx),
    sc13d: new13d, sc13dA: c("sc13dA", 365), switch13g: had13g && new13d > 0 ? 1 : 0, insider: c("form4", 182),
    officerChange: c("i502", 365), rightsPlan: c("i303", 365), bylaws: c("i503", 365), agreements: c("i101", 365),
    proxyFight: c("proxy", 365) > 0 ? 1 : 0, lateFiling: c("late", 365) > 0 ? 1 : 0,
    activity8k: c("any8k", 91), age: (Date.parse(cutoff) - Date.parse(first)) / (365 * DAY),
  };
  return FEATURE_KEYS.map((k) => row[k]);
}

/** The filing behind a feature's reason, the latest before the cut-off: the 13D, the 8-K, the proxy contest. Pure. */
export function evidenceFor(raw: Pick<RawCompany, "filings">, key: string, cutoff: string): FilingRow | null {
  const test: Record<string, (f: FilingRow) => boolean> = {
    sc13d: isForm("SC 13D"), switch13g: isForm("SC 13D"), sc13dA: isForm("SC 13D/A"), officerChange: item("5.02"), rightsPlan: item("3.03"), bylaws: item("5.03"),
    agreements: item("1.01"), proxyFight: isForm("PREC14A", "DEFC14A", "DFAN14A"), lateFiling: (x) => /^NT 10-[KQ]/.test(x.f), insider: isForm("4"),
  };
  const t = test[key];
  if (!t) return null;
  return raw.filings.filter((f) => f.d < cutoff && t(f)).sort((a, b) => b.d.localeCompare(a.d))[0] ?? null;
}

/** Which features a filing in the last week moved: the "new dated signal" a weekly rise needs to become a finding. Pure. */
export function newSignals(raw: Pick<RawCompany, "filings">, cutoff: string, days = 7): string[] {
  const out = new Set<string>();
  for (const f of raw.filings) {
    if (f.d >= cutoff || f.d < back(cutoff, days)) continue;
    if (f.f === "SC 13D") out.add("sc13d");
    if (f.f === "SC 13D/A") out.add("sc13dA");
    if (item("5.02")(f)) out.add("officerChange");
    if (item("3.03")(f)) out.add("rightsPlan");
    if (item("5.03")(f)) out.add("bylaws");
    if (isForm("PREC14A", "DEFC14A", "DFAN14A")(f)) out.add("proxyFight");
  }
  return [...out];
}

/** Compact company facts as the Radar keeps them: only CONCEPTS, rows as {e, s, v, f}. Pure. */
export function compactFacts(cf: { facts?: Record<string, Record<string, { units?: Record<string, { start?: string; end: string; val: number; filed: string; form?: string }[]> }>> }): Record<string, FactRow[]> {
  const out: Record<string, FactRow[]> = {};
  for (const [key, names] of Object.entries(CONCEPTS)) {
    for (const n of names) {
      const rows = cf.facts?.["us-gaap"]?.[n]?.units?.USD;
      if (!rows?.length) continue;
      out[key] = rows.filter((r) => /^(10-K|10-Q|20-F|40-F)/.test(r.form ?? "10-K")).map((r) => ({ e: r.end, ...(r.start ? { s: r.start } : {}), v: r.val, f: r.filed }));
      break;
    }
  }
  return out;
}

const REASON_FORMS = /^(SC 13D|SC 13D\/A|8-K|PREC14A|DEFC14A|DFAN14A)$/;

/** Submissions' filing lists as compact rows; URLs kept only for forms that can be reasons. Pure. */
export function compactFilings(cik: string, recent: { form: string[]; filingDate: string[]; items?: string[]; accessionNumber?: string[]; primaryDocument?: string[] }): FilingRow[] {
  return recent.form.map((f, i) => ({
    f, d: recent.filingDate[i], ...(recent.items?.[i] ? { i: recent.items[i] } : {}),
    ...(REASON_FORMS.test(f) && recent.accessionNumber?.[i] ? { u: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${recent.accessionNumber[i].replace(/-/g, "")}/${recent.primaryDocument?.[i] ?? ""}` } : {}),
  })).filter((r) => r.f && /^\d{4}-\d{2}-\d{2}$/.test(r.d));
}
