/**
 * The Deal Radar's data (E4): what it keeps about each company in R2, and the target events.
 * - The universe scan walks SEC's ticker list in slices (under SEC's ten requests a second, through the
 *   shared throttle): each company's submissions give its SIC; companies in scope (labels.inScope) also get
 *   their filing list (with up to two older pages) and the XBRL concepts the features read, kept compactly
 *   as odds/raw/{cik}.json. An index (odds/universe.json) remembers every company's SIC, so out-of-scope
 *   ones are not fetched again for 90 days. Past targets that have since delisted are added from the events
 *   (their filings and facts are still on EDGAR), so the panel learns from the companies that were sold.
 * - Target events come from EDGAR full-text search month by month (DEFM14A, DEFM14C, SC 14D9; cached in R2,
 *   a closed month never fetched twice), the deal database (F4) and the graph's acquired links.
 * Needs R2 (the raw store); without it the Radar says it is not set up.
 */
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { edgarFetch } from "@/lib/edgar/client";
import { getCompanyFactsFull } from "@/lib/edgar/facts";
import { getSubmissions } from "@/lib/edgar/submissions";
import { tickerMap } from "@/lib/edgar/tickers";
import { logError } from "@/lib/errors";
import { getJson, putJson, r2Ready } from "../infra/r2";
import { compactFacts, compactFilings, type FilingRow, type RawCompany } from "./features";
import { dedupeEvents, eventsFromHits, inScope, monthsFrom, type TargetEvent } from "./labels";

const DAY = 86_400_000;
export const UNIVERSE_KEY = "odds/universe.json";
export const rawKey = (cik: string) => `odds/raw/${cik}.json`;
export type UniverseEntry = { sic: string; ticker: string; name: string; listed: boolean; scope: boolean; at: string };
export type Universe = { entries: Record<string, UniverseEntry>; cursor: number; mode: string; updatedAt: string };

export async function loadUniverse(): Promise<Universe> {
  return (r2Ready() ? await getJson<Universe>(UNIVERSE_KEY).catch(() => null) : null) ?? { entries: {}, cursor: 0, mode: "", updatedAt: "" };
}
export const saveUniverse = (u: Universe) => putJson(UNIVERSE_KEY, { ...u, updatedAt: new Date().toISOString() });

type SubmissionsFull = Awaited<ReturnType<typeof getSubmissions>> & { filings: { files?: { name: string }[] } };

/** A company's raw record from EDGAR now: submissions (with up to two older pages) and compact facts. */
export async function fetchRaw(cik: string, listed: boolean, ticker = "", opts: { keepFacts?: Record<string, import("./features").FactRow[]> } = {}): Promise<RawCompany | null> {
  const padded = cik.padStart(10, "0");
  const sub = (await getSubmissions(padded)) as SubmissionsFull;
  let filings: FilingRow[] = compactFilings(cik, sub.filings.recent);
  for (const f of (sub.filings.files ?? []).slice(0, 2)) {
    const res = await edgarFetch(`https://data.sec.gov/submissions/${f.name}`).catch(() => null);
    if (res?.ok) filings = filings.concat(compactFilings(cik, (await res.json()) as SubmissionsFull["filings"]["recent"]));
  }
  const facts = opts.keepFacts ?? (await getCompanyFactsFull(padded).then((cf) => compactFacts(cf as never)).catch(() => ({})));
  return { cik, name: sub.name, ticker: ticker || sub.tickers?.[0] || "", sic: sub.sic ?? "", listed, facts, filings, fetchedAt: new Date().toISOString() };
}

/**
 * One slice of the universe scan, within the deadline: the next companies of SEC's ticker list (by CIK),
 * their SIC recorded, and in-scope ones fetched into the raw store. Returns how far it got.
 */
export async function scanSlice(deadline: number, opts: { mode: "all" | "sectors"; refreshDays?: number } ): Promise<{ scanned: number; fetched: number; cursor: number; done: boolean }> {
  const u = await loadUniverse();
  if (u.mode !== opts.mode) { u.cursor = 0; u.mode = opts.mode; }
  const list = [...new Map([...(await tickerMap()).values()].map((t) => [t.cik.replace(/^0+/, ""), t])).values()].sort((a, b) => Number(a.cik) - Number(b.cik));
  let scanned = 0, fetched = 0;
  const fresh = (e?: UniverseEntry) => !!e && Date.now() - Date.parse(e.at) < (e.scope ? (opts.refreshDays ?? 28) : 90) * DAY;
  while (u.cursor < list.length && Date.now() < deadline - 15_000) {
    const t = list[u.cursor++];
    const cik = t.cik.replace(/^0+/, "");
    if (fresh(u.entries[cik])) continue;
    scanned++;
    try {
      const sub = await getSubmissions(cik.padStart(10, "0"));
      const scope = inScope(sub.sic ?? "", opts.mode);
      u.entries[cik] = { sic: sub.sic ?? "", ticker: t.ticker, name: sub.name, listed: true, scope, at: new Date().toISOString() };
      if (scope) { const raw = await fetchRaw(cik, true, t.ticker); if (raw) { await putJson(rawKey(cik), raw); fetched++; } }
    } catch (e) { logError(e, { where: "edge-odds-scan" }); }
  }
  const done = u.cursor >= list.length;
  if (done) u.cursor = 0;
  await saveUniverse(u);
  return { scanned, fetched, cursor: u.cursor, done };
}

/** Bring past targets (delisted now) that are in scope into the raw store, within the deadline. */
export async function addPastTargets(events: TargetEvent[], deadline: number, mode: "all" | "sectors"): Promise<number> {
  const u = await loadUniverse();
  let n = 0;
  for (const e of events) {
    if (Date.now() > deadline - 15_000) break;
    if (u.entries[e.cik] || (e.sic && !inScope(e.sic, mode))) continue;
    try {
      const raw = await fetchRaw(e.cik, false);
      if (!raw) continue;
      const scope = inScope(raw.sic, mode);
      u.entries[e.cik] = { sic: raw.sic, ticker: raw.ticker, name: raw.name, listed: false, scope, at: new Date().toISOString() };
      if (scope) { await putJson(rawKey(e.cik), raw); n++; }
    } catch (err) { logError(err, { where: "edge-odds-past" }); }
  }
  await saveUniverse(u);
  return n;
}

/** One month's target events from EDGAR full-text search, cached in R2 once the month has closed. */
async function monthEvents(month: string): Promise<TargetEvent[]> {
  const key = `odds/events/${month}.json`;
  const closed = month < new Date(Date.now() - 40 * DAY).toISOString().slice(0, 7);
  if (closed) { const have = await getJson<TargetEvent[]>(key).catch(() => null); if (have) return have; }
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const hits: Parameters<typeof eventsFromHits>[0] = [];
  for (const [forms, q] of [["DEFM14A,DEFM14C", "\"merger\""], ["SC 14D9", "\"offer\""]]) {
    for (let page = 0; page < 3; page++) {
      const p = new URLSearchParams({ q, forms, dateRange: "custom", startdt: `${month}-01`, enddt: end, from: String(page * 100) });
      const res = await edgarFetch(`https://efts.sec.gov/LATEST/search-index?${p}`);
      if (!res.ok) throw Object.assign(new Error(`EDGAR full-text search answered ${res.status}`), { status: 502 });
      const j = (await res.json()) as { hits: { total: { value: number }; hits: Parameters<typeof eventsFromHits>[0] } };
      hits.push(...j.hits.hits);
      if (j.hits.hits.length < 100) break;
    }
  }
  const events = eventsFromHits(hits);
  await putJson(key, events).catch(() => undefined);
  return events;
}

/** Every target event since a month (EDGAR, the deal database, the graph), deduplicated per company, within the deadline. */
export async function loadEvents(from: string, deadline: number): Promise<{ events: TargetEvent[]; complete: boolean }> {
  const out: TargetEvent[] = [];
  let complete = true;
  for (const m of monthsFrom(`${from}-01`, new Date().toISOString().slice(0, 10)).map((d) => d.slice(0, 7))) {
    if (Date.now() > deadline - 10_000) { complete = false; break; }
    out.push(...await monthEvents(m).catch((e) => { logError(e, { where: "edge-odds-events" }); complete = false; return []; }));
  }
  const db = requireDb();
  const deals = (await db.execute(sql`select target_cik as cik, announced_at::text as date, sic from edge_deals where owner_id is null and target_cik <> '' and announced_at is not null`)).rows as { cik: string; date: string; sic: string }[];
  const links = (await db.execute(sql`select n.cik, l.as_of::text as date, coalesce(n.attrs->>'sic', '') as sic from edge_links l join edge_nodes n on n.id = l.dst where l.kind = 'acquired' and l.as_of is not null and n.cik <> '' and coalesce(l.attrs->>'relation', 'third_party') = 'third_party'`)).rows as { cik: string; date: string; sic: string }[];
  out.push(...deals.map((d) => ({ cik: d.cik.replace(/^0+/, ""), date: d.date.slice(0, 10), sic: d.sic, source: "Edge deal database" })), ...links.map((l) => ({ cik: l.cik.replace(/^0+/, ""), date: l.date.slice(0, 10), sic: l.sic, source: "relationship graph (merger filings)" })));
  return { events: dedupeEvents(out), complete };
}

/** Every in-scope company's raw record from R2 (sequential reads; the caller bounds time). */
export async function loadRaws(deadline: number): Promise<{ raws: RawCompany[]; complete: boolean }> {
  const u = await loadUniverse();
  const ciks = Object.entries(u.entries).filter(([, e]) => e.scope).map(([c]) => c);
  const raws: RawCompany[] = [];
  for (const c of ciks) {
    if (Date.now() > deadline) return { raws, complete: false };
    const r = await getJson<RawCompany>(rawKey(c)).catch(() => null);
    if (r) raws.push(r);
  }
  return { raws, complete: true };
}

/**
 * A company's raw record refreshed now: its filing list always (new 13Ds and 8-Ks move the odds within
 * days), its facts only when `facts` (they change quarterly and are large; the monthly scan refreshes them).
 */
export async function refreshRaw(cik: string, opts: { facts?: boolean } = {}): Promise<RawCompany | null> {
  const u = await loadUniverse();
  const e = u.entries[cik];
  const old = opts.facts ? null : await getJson<RawCompany>(rawKey(cik)).catch(() => null);
  const raw = await fetchRaw(cik, e?.listed ?? true, e?.ticker ?? "", old ? { keepFacts: old.facts } : {});
  if (raw) await putJson(rawKey(cik), raw);
  return raw;
}
