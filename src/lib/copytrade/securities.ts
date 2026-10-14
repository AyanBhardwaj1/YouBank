/**
 * CUSIP to ticker and sector, stored and reused. Server only; every source here is free.
 *
 * For each CUSIP, in order, the first that answers:
 * 1. the owner's override (copy_cusip_overrides), then the built-in ones (cusip.ts);
 * 2. a stored answer (copy_securities), re-asked after 30 days when it was a miss;
 * 3. OpenFIGI, by CUSIP, for its US composite listing (OPENFIGI_API_KEY raises the rate limit; it works
 *    without one, slowly);
 * 4. the issuer name matched against SEC's company_tickers.json: SEC's own spelling from the 13(f) list
 *    first, then the filer's, and only a unique match whose share class is unambiguous.
 * Sectors come from the issuer's SIC code in SEC's submissions record, read once per company.
 * Coverage (what share of a fund's value got a ticker, and how) is reported on every fund page.
 */
import { inArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheJson } from "@/lib/cache";
import { DAY, edgarText } from "@/lib/edgar/client";
import { getSubmissions } from "@/lib/edgar/submissions";
import { tickerByName, tickerMap } from "@/lib/edgar/tickers";
import { withinRate } from "@/lib/locks";
import { sectorOfSic } from "@/lib/news/desks";
import { BUILTIN_OVERRIDES, isCommonTitle, OPENFIGI_URL, openFigiJobs, openFigiLimits, parse13fList, pickFigi, shareClassOf, tickerForClass, type TickerRow } from "./cusip";
import type { SecurityInfo } from "./targets";

export type Security = SecurityInfo & { cusip: string; source: string; onList: boolean | null; hasOptions: boolean | null };
type Want = { cusip: string; name: string; title: string };

const MISS_RETRY_MS = 30 * DAY;

/** SEC's Official List of Section 13(f) Securities, latest edition we can read: CUSIP -> [issuer, description, options]. */
export async function thirteenFList(): Promise<{ edition: string; rows: Map<string, [string, string, boolean]> } | null> {
  const now = new Date();
  for (let back = 0; back < 3; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3 * back, 1));
    const y = d.getUTCFullYear(), q = Math.ceil((d.getUTCMonth() + 1) / 3);
    const edition = `${y}q${q}`;
    try {
      const compact = await cacheJson<[string, string, string, boolean][]>(`copy:13flist:${edition}`, 30 * DAY, async () => {
        const text = await edgarText(`https://www.sec.gov/files/investment/13flist${edition}.txt`, `13flist-${edition}`, 30 * DAY);
        const rows = parse13fList(text).filter((r) => r.status !== "DELETED");
        if (rows.length < 1000) throw new Error(`13(f) list ${edition} looks incomplete`);
        return rows.map((r) => [r.cusip, r.issuer, r.description, r.hasOptions]);
      });
      return { edition, rows: new Map(compact.map(([c, i, dsc, o]) => [c, [i, dsc, o]])) };
    } catch { /* not published yet, or unreachable: try the edition before */ }
  }
  return null;
}

let byCik: Promise<Map<string, TickerRow[]>> | null = null;
function listingsByCik(): Promise<Map<string, TickerRow[]>> {
  byCik ??= tickerMap().then((m) => {
    const out = new Map<string, TickerRow[]>();
    for (const r of m.values()) out.set(r.cik, [...(out.get(r.cik) ?? []), r]);
    return out;
  });
  byCik.catch(() => { byCik = null; });
  return byCik;
}

/** A ticker by issuer name and share class, or null when the name or class is ambiguous. */
async function byName(names: string[], title: string): Promise<{ ticker: string; cik: string } | null> {
  if (!isCommonTitle(title)) return null;
  const cls = shareClassOf(title);
  const all = await listingsByCik();
  for (const n of names) {
    if (!n) continue;
    const hit = await tickerByName(n).catch(() => null);
    if (!hit) continue;
    const t = tickerForClass(all.get(hit.cik) ?? [hit], cls);
    if (t) return { ticker: t, cik: hit.cik };
  }
  return null;
}

/** Ask OpenFIGI about CUSIPs, within its rate limit. Unanswered ones are simply absent. */
async function openFigi(cusips: string[], deadline: number): Promise<Map<string, { ticker: string; figi: string }>> {
  const out = new Map<string, { ticker: string; figi: string }>();
  const key = process.env.OPENFIGI_API_KEY?.trim();
  const lim = openFigiLimits(!!key);
  for (let i = 0; i < cusips.length && Date.now() < deadline; i += lim.jobs) {
    if (!(await withinRate("openfigi", lim.perWindow, lim.windowMs))) break;
    const chunk = cusips.slice(i, i + lim.jobs);
    try {
      const res = await fetch(OPENFIGI_URL, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json", ...(key ? { "X-OPENFIGI-APIKEY": key } : {}) }, body: JSON.stringify(openFigiJobs(chunk)) });
      if (res.status === 429) break;
      if (!res.ok) continue;
      const answers = (await res.json()) as Parameters<typeof pickFigi>[0][];
      chunk.forEach((c, j) => { const p = pickFigi(answers[j]); if (p) out.set(c, { ticker: p.ticker, figi: p.figi }); });
    } catch { break; /* unreachable: the name match takes over */ }
  }
  return out;
}

/**
 * Tickers and sectors for a fund's CUSIPs. With `lookup` false only stored answers and overrides are used
 * (a page render that must stay fast); otherwise new CUSIPs are mapped within `budgetMs`.
 */
export async function resolveSecurities(wants: Want[], opts: { lookup?: boolean; budgetMs?: number; sectors?: number } = {}): Promise<Map<string, Security>> {
  const deadline = Date.now() + (opts.budgetMs ?? 8_000);
  const uniq = new Map<string, Want>();
  for (const w of wants) if (!uniq.has(w.cusip)) uniq.set(w.cusip, w);
  const cusips = [...uniq.keys()];
  const out = new Map<string, Security>();
  if (!cusips.length) return out;
  const db = requireDb();
  const [overrides, stored] = await Promise.all([
    db.select().from(schema.copyCusipOverrides).where(inArray(schema.copyCusipOverrides.cusip, cusips)),
    db.select().from(schema.copySecurities).where(inArray(schema.copySecurities.cusip, cusips)),
  ]);
  const over = new Map(overrides.map((o) => [o.cusip, o.ticker.toUpperCase()]));
  const have = new Map(stored.map((s) => [s.cusip, s]));
  const list = opts.lookup ? await thirteenFList() : null;
  const todo: Want[] = [];
  for (const c of cusips) {
    const s = have.get(c);
    const manual = over.get(c) ?? BUILTIN_OVERRIDES[c];
    if (manual) { out.set(c, { cusip: c, ticker: manual, sector: s?.sector ?? null, source: over.has(c) ? "manual" : "builtin", onList: s?.on13fList ? true : null, hasOptions: s?.hasOptions ?? null }); if (!s && opts.lookup) todo.push(uniq.get(c)!); continue; }
    if (s && (s.ticker || Date.now() - s.checkedAt.getTime() < MISS_RETRY_MS || !opts.lookup)) { out.set(c, { cusip: c, ticker: s.ticker, sector: s.sector, source: s.source, onList: s.on13fList ? true : null, hasOptions: s.hasOptions }); continue; }
    if (opts.lookup) todo.push(uniq.get(c)!);
    else out.set(c, { cusip: c, ticker: null, sector: null, source: "none", onList: null, hasOptions: null });
  }
  if (opts.lookup && todo.length) {
    const needFigi = todo.filter((w) => !over.has(w.cusip) && !BUILTIN_OVERRIDES[w.cusip]).map((w) => w.cusip);
    const figi = needFigi.length ? await openFigi(needFigi, deadline - 2_000) : new Map();
    const tickers = await tickerMap().catch(() => new Map<string, TickerRow>());
    const rows: (typeof schema.copySecurities.$inferInsert)[] = [];
    for (const w of todo) {
      const listed = list?.rows.get(w.cusip);
      const manual = over.get(w.cusip) ?? BUILTIN_OVERRIDES[w.cusip];
      let ticker: string | null = manual ?? null, source = manual ? (over.has(w.cusip) ? "manual" : "builtin") : "none", cik: string | null = null, figiId: string | null = null;
      const f = figi.get(w.cusip);
      if (!ticker && f) { ticker = f.ticker; figiId = f.figi; source = "openfigi"; }
      if (!ticker && Date.now() < deadline) {
        const n = await byName([listed?.[0] ?? "", w.name], listed?.[1] || w.title);
        if (n) { ticker = n.ticker; cik = n.cik; source = "name"; }
      }
      if (ticker && !cik) cik = tickers.get(ticker)?.cik ?? null;
      rows.push({ cusip: w.cusip, ticker, issuer: listed?.[0] ?? w.name, title: listed?.[1] ?? w.title, cik, figi: figiId, source, hasOptions: listed ? listed[2] : null, on13fList: listed ? list!.edition : null, checkedAt: new Date() });
      const prev = out.get(w.cusip);
      out.set(w.cusip, { cusip: w.cusip, ticker, sector: prev?.sector ?? null, source, onList: listed ? true : list ? false : null, hasOptions: listed ? listed[2] : null });
    }
    for (let i = 0; i < rows.length; i += 300) {
      await db.insert(schema.copySecurities).values(rows.slice(i, i + 300)).onConflictDoUpdate({
        target: schema.copySecurities.cusip,
        set: { ticker: sqlExcluded("ticker"), issuer: sqlExcluded("issuer"), title: sqlExcluded("title"), cik: sqlExcluded("cik"), figi: sqlExcluded("figi"), source: sqlExcluded("source"), hasOptions: sqlExcluded("has_options"), on13fList: sqlExcluded("on_13f_list"), checkedAt: new Date() },
      });
    }
  }
  if (opts.lookup && (opts.sectors ?? 25) > 0) await fillSectors(out, opts.sectors ?? 25, deadline);
  return out;
}

const sqlExcluded = (col: string) => sql.raw(`excluded."${col}"`);

/** Sectors from SIC codes for mapped securities that have none yet, a few per call. */
async function fillSectors(out: Map<string, Security>, max: number, deadline: number): Promise<void> {
  const missing = [...out.values()].filter((s) => s.ticker && !s.sector);
  if (!missing.length) return;
  const db = requireDb();
  const tickers = await tickerMap().catch(() => new Map<string, TickerRow>());
  let n = 0;
  for (const s of missing) {
    if (n >= max || Date.now() > deadline) break;
    const cik = tickers.get(s.ticker!)?.cik;
    if (!cik) continue;
    n++;
    try {
      const sub = await getSubmissions(cik);
      const sic = Number(sub.sic);
      const sector = sectorOfSic(sic) ?? (sic ? "other" : null);
      s.sector = sector;
      await db.update(schema.copySecurities).set({ sic: sic || null, sector, cik }).where(inArray(schema.copySecurities.cusip, [s.cusip]));
    } catch { /* next time */ }
  }
}

/** Sector labels for display. */
export const SECTOR_LABEL: Record<string, string> = { tech: "Technology", healthcare: "Healthcare", energy: "Energy and utilities", financials: "Financials", consumer: "Consumer", industrials: "Industrials and materials", media: "Media and telecom", realestate: "Real estate", other: "Other" };
