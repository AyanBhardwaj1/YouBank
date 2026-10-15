/**
 * Q7 on the server: EDGAR's latest Form 4 and Schedule 13D filings polled through the existing client (User-
 * Agent, shared rate limit), parsed, stored (quant_insider_tx, quant_events), turned into events, and published
 * as QuantSignals once their base rate exists (rule 4). Also the board, a company's view and the Pro Item 4
 * reading. Background work uses free data only and never a premium scope.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { edgarJson, edgarText, HOUR } from "@/lib/edgar/client";
import { getSubmissions, listFilings } from "@/lib/edgar/submissions";
import { holdingPercent, parseHeader } from "@/lib/edge/graph/parse";
import { CONTRACT_VERSION, type QuantSignal } from "../contracts";
import { baseRateFor, CATALOG, signalBaseRate } from "../events/rates";
import { logForecast } from "@/lib/edge/forecasts/ledger";
import type { ForecastRule } from "@/db/schema";
import { addSessions, nextOpenAfter } from "../pit/calendar";
import { publishSignals } from "../signals";
import { estimateCost } from "../tca/run";
import { signalId } from "../validate";
import { T } from "../words";
import { parseAcceptance, parseCurrentFeed, parseForm4, type FeedEntry } from "./parse";
import { activistEvent, classify, detectEvents, eligible, item4Text, type InsiderEvent, type Stake, type Tx } from "./rules";

export const INSIDER_VERSION = "2026-10-15.1";
const DAY = 86_400_000;
const folder = (cik: string, acc: string) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}`;

const FEED = (type: string) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(type)}&company=&dateb=&owner=include&start=0&count=100&output=atom`;

/** The primary XML (Form 4) or main document (13D) of a filing, from its index.json. */
async function primaryDoc(cik: string, acc: string, want: "xml" | "doc"): Promise<{ url: string; text: string } | null> {
  const idx = await edgarJson<{ directory?: { item?: { name: string; type?: string }[] } }>(`${folder(cik, acc)}/index.json`, `idx-${acc}.json`, 30 * 24 * HOUR).catch(() => null);
  const items = idx?.directory?.item ?? [];
  const pick = want === "xml" ? items.find((i) => /\.xml$/i.test(i.name) && !/^xsl|filingsummary/i.test(i.name)) : items.find((i) => /\.(xml|htm|html|txt)$/i.test(i.name) && !/index|filingsummary|\.hdr/i.test(i.name));
  if (!pick) return null;
  const url = `${folder(cik, acc)}/${pick.name}`;
  return { url, text: await edgarText(url, `doc-${acc}-${pick.name}.json`, 30 * 24 * HOUR) };
}

/** Store a Form 4's open-market lines. Returns the issuer CIK when anything was stored. */
async function ingestForm4(e: FeedEntry): Promise<string | null> {
  const doc = await primaryDoc(e.cik, e.accession, "xml");
  if (!doc) return null;
  const f = parseForm4(doc.text);
  const lines = f.lines.filter((l) => l.code === "P" || l.code === "S");
  if (!lines.length || !f.issuerCik) return null;
  await requireDb().insert(schema.quantInsiderTx).values(lines.map((l) => ({
    accession: e.accession, line: l.line, issuerCik: f.issuerCik, symbol: f.symbol, ownerCik: f.owner.cik, ownerName: f.owner.name, isDirector: f.owner.isDirector, isOfficer: f.owner.isOfficer, isTenPct: f.owner.isTenPct,
    officerTitle: f.owner.title, code: l.code, acquired: l.acquired, shares: l.shares, price: l.price, ownedAfter: l.ownedAfter, tradeDate: l.tradeDate || f.period, acceptedAt: new Date(e.acceptedAt), plan10b51: f.plan10b51, form: f.form, source: "live", url: `${folder(f.issuerCik, e.accession)}/`,
  }))).onConflictDoNothing();
  return f.issuerCik;
}

/** Store a 13D or 13G stake and any activist event it makes. */
async function ingest13d(e: FeedEntry): Promise<string | null> {
  const db = requireDb();
  const hdr = await edgarText(`${folder(e.cik, e.accession)}/${e.accession}.hdr.sgml`, `hdr-${e.accession}.json`, 30 * 24 * HOUR).catch(() => "");
  const head = parseHeader(hdr);
  if (!head.subject?.cik || !head.filers[0]?.cik) return null;
  const doc = await primaryDoc(head.subject.cik, e.accession, "doc").catch(() => null);
  const pct = doc ? holdingPercent(doc.text).percent : null;
  const stake: Stake = { form: head.type || e.form, holder: head.filers[0].name, holderCik: head.filers[0].cik, percent: pct, item4: doc ? item4Text(doc.text) : "", acceptedAt: parseAcceptance(hdr) ?? e.acceptedAt, accession: e.accession };
  const issuer = head.subject.cik;
  const [prevRow] = await db.select().from(schema.quantEvents).where(and(eq(schema.quantEvents.type, "stake13"), eq(schema.quantEvents.issuerCik, issuer), sql`${schema.quantEvents.body}->>'holderCik' = ${stake.holderCik}`)).orderBy(desc(schema.quantEvents.acceptedAt)).limit(1);
  const symbol = await symbolOf(issuer);
  await db.insert(schema.quantEvents).values({ id: `stake13:${issuer}:${e.accession}`, type: "stake13", issuerCik: issuer, symbol, occurredAt: stake.acceptedAt.slice(0, 10), acceptedAt: new Date(stake.acceptedAt), body: { ...stake, url: doc?.url ?? `${folder(issuer, e.accession)}/` } }).onConflictDoNothing();
  const ev = activistEvent(prevRow ? (prevRow.body as unknown as Stake) : null, stake, issuer);
  if (ev) await db.insert(schema.quantEvents).values({ id: ev.id, type: ev.type, issuerCik: issuer, symbol, occurredAt: ev.acceptedAt.slice(0, 10), acceptedAt: new Date(ev.acceptedAt), body: { ...ev, url: doc?.url ?? `${folder(issuer, e.accession)}/`, holderCik: stake.holderCik } }).onConflictDoNothing();
  return issuer;
}

async function symbolOf(cik: string): Promise<string> {
  const [u] = await requireDb().select({ symbol: schema.quantUniverse.symbol }).from(schema.quantUniverse).where(eq(schema.quantUniverse.cik, cik.padStart(10, "0"))).limit(1);
  if (u) return u.symbol;
  const [n] = await requireDb().select({ ticker: schema.edgeNodes.ticker }).from(schema.edgeNodes).where(and(eq(schema.edgeNodes.cik, cik.replace(/^0+/, "")), sql`${schema.edgeNodes.ticker} <> ''`)).limit(1);
  return n?.ticker ?? "";
}

/** Recompute an issuer's insider events from its stored lines (two years) and its insiders' histories. */
export async function refreshIssuer(issuerCik: string): Promise<InsiderEvent[]> {
  const db = requireDb();
  const since = new Date(Date.now() - 2 * 365 * DAY).toISOString().slice(0, 10);
  const rows = await db.select().from(schema.quantInsiderTx).where(and(eq(schema.quantInsiderTx.issuerCik, issuerCik), gte(schema.quantInsiderTx.tradeDate, since))).limit(5_000);
  if (!rows.length) return [];
  const owners = [...new Set(rows.map((r) => r.ownerCik))].filter(Boolean);
  const hist = owners.length ? await db.select({ ownerCik: schema.quantInsiderTx.ownerCik, tradeDate: schema.quantInsiderTx.tradeDate, code: schema.quantInsiderTx.code }).from(schema.quantInsiderTx).where(inArray(schema.quantInsiderTx.ownerCik, owners.slice(0, 500))).limit(50_000) : [];
  const byOwner = new Map<string, { tradeDate: string; code: string }[]>();
  for (const h of hist) byOwner.set(h.ownerCik, [...(byOwner.get(h.ownerCik) ?? []), { tradeDate: String(h.tradeDate), code: h.code }]);
  const offerings = await offeringDates(issuerCik).catch(() => []);
  const txs: Tx[] = rows.map((r) => ({ accession: r.accession, line: r.line, issuerCik: r.issuerCik, symbol: r.symbol, ownerCik: r.ownerCik, ownerName: r.ownerName, isDirector: r.isDirector, isOfficer: r.isOfficer, isTenPct: r.isTenPct, title: r.officerTitle, code: r.code, acquired: r.acquired, shares: r.shares, price: r.price, ownedAfter: r.ownedAfter, tradeDate: String(r.tradeDate), acceptedAt: r.acceptedAt.toISOString(), plan10b51: r.plan10b51, url: r.url }));
  const events = detectEvents(txs, (o) => byOwner.get(o) ?? [], offerings);
  const symbol = rows.find((r) => r.symbol)?.symbol ?? (await symbolOf(issuerCik));
  for (const ev of events) {
    const [u] = await db.select({ marketCap: schema.quantUniverse.marketCap }).from(schema.quantUniverse).where(eq(schema.quantUniverse.symbol, symbol)).limit(1);
    await db.insert(schema.quantEvents).values({ id: ev.id, type: ev.type, issuerCik, symbol, occurredAt: ev.occurredAt, acceptedAt: new Date(ev.acceptedAt), body: { ...ev, marketCap: u?.marketCap ?? null } as unknown as Record<string, unknown> }).onConflictDoNothing();
  }
  return events;
}

/** Dates the issuer filed a 424B offering prospectus (from its EDGAR submissions). */
async function offeringDates(cik: string): Promise<string[]> {
  const sub = await getSubmissions(cik.padStart(10, "0"));
  return listFilings(sub, ["424B1", "424B2", "424B3", "424B4", "424B5", "424B7"], 50).map((f) => f.filed);
}

/** Poll the feeds: new Form 4s and 13Ds since the last poll, within the deadline. */
export async function pollInsiders(deadline: number): Promise<{ form4: number; stakes: number; issuers: number; events: number; published: number }> {
  const db = requireDb();
  let form4 = 0, stakes = 0;
  const issuers = new Set<string>();
  for (const type of ["4", "SC 13D", "SCHEDULE 13D", "SC 13G", "SCHEDULE 13G"]) {
    if (Date.now() > deadline) break;
    const atom = await edgarText(FEED(type), `feed-${type}-${Math.floor(Date.now() / 600_000)}.json`, 9 * 60_000).catch(() => "");
    const entries = parseCurrentFeed(atom);
    const accs = entries.map((e) => e.accession);
    const seen = new Set<string>();
    if (accs.length) {
      if (type === "4") for (const r of await db.selectDistinct({ a: schema.quantInsiderTx.accession }).from(schema.quantInsiderTx).where(inArray(schema.quantInsiderTx.accession, accs))) seen.add(r.a);
      else for (const r of await db.select({ a: sql<string>`${schema.quantEvents.body}->>'accession'` }).from(schema.quantEvents).where(and(eq(schema.quantEvents.type, "stake13"), inArray(sql`${schema.quantEvents.body}->>'accession'`, accs)))) seen.add(r.a);
    }
    for (const e of entries) {
      if (Date.now() > deadline || seen.has(e.accession)) continue;
      try {
        const issuer = type === "4" ? await ingestForm4(e) : await ingest13d(e);
        if (issuer) { issuers.add(issuer); if (type === "4") form4++; else stakes++; }
      } catch { /* skip one bad filing */ }
    }
  }
  let events = 0;
  for (const i of issuers) { if (Date.now() > deadline) break; events += (await refreshIssuer(i).catch(() => [])).length; }
  const published = (await publishInsiderSignals(Date.now() + Math.max(5_000, deadline - Date.now())).catch(() => ({ stored: 0 }))).stored;
  return { form4, stakes, issuers: issuers.size, events, published };
}

/* ---------------- Signals ---------------- */

const EXPLAIN = (type: string, body: Record<string, unknown>) => {
  const ins = (body.insiders as { role: string; value: number }[] | undefined) ?? [];
  if (type === "cluster_buy") return T.clusterBuy(ins.length, Math.max(1, Number(body.days ?? 30)), Number(body.totalUsd ?? 0));
  if (type === "cluster_sell") return T.clusterSell(ins.length, Math.max(1, Number(body.days ?? 30)), Number(body.totalUsd ?? 0));
  if (type === "large_officer_buy") return T.largeOfficerBuy(ins[0]?.role ?? "chief executive", Number(body.totalUsd ?? ins[0]?.value ?? 0));
  if (type === "activist_new") return T.activistNew(String(body.holder ?? "A holder"), typeof body.to === "number" ? body.to : null);
  return T.activistUp(String(body.holder ?? "A holder"), typeof body.from === "number" ? body.from : null, typeof body.to === "number" ? body.to : null);
};

/** A stored event as a QuantSignal, when its base rate exists. Pure apart from the inputs. */
export function eventSignal(e: { id: string; type: string; symbol: string; issuerCik: string; occurredAt: string; acceptedAt: string; body: Record<string, unknown> }, baseRate: ReturnType<typeof signalBaseRate>, costs: QuantSignal["costs"] | undefined, now = new Date()): QuantSignal | null {
  if (!baseRate || !e.symbol || !CATALOG[e.type]) return null;
  const def = CATALOG[e.type];
  const base = { contract: CONTRACT_VERSION, producer: e.type.startsWith("activist") ? "quant.activist" : "quant.insider_cluster", producerVersion: INSIDER_VERSION, instrument: { symbol: e.symbol, assetClass: "equity" as const, currency: "USD", cik: String(Number(e.issuerCik)) }, asOf: e.acceptedAt, horizonDays: def.horizonDays };
  const ins = (e.body.insiders as { name: string; role: string; accession: string; url?: string }[] | undefined) ?? [];
  const evidence = ins.length ? ins.slice(0, 8).map((i) => ({ label: `Form 4, ${i.name} (${i.role})`, url: i.url && /^https:/.test(i.url) ? i.url : `${folder(e.issuerCik, i.accession)}/`, source: "SEC EDGAR", licence: "public domain", knownAt: e.acceptedAt, retrievedAt: now.toISOString() }))
    : [{ label: `Schedule 13D, ${String(e.body.holder ?? "")}`, url: String(e.body.url ?? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${e.issuerCik}`), source: "SEC EDGAR", licence: "public domain", knownAt: e.acceptedAt, retrievedAt: now.toISOString() }];
  return {
    ...base, id: signalId(base), computedAt: now.toISOString(), reconstructed: false,
    validUntil: new Date(Date.parse(addSessions(nextOpenAfter(e.acceptedAt).slice(0, 10), def.horizonDays)) + DAY).toISOString(),
    kind: "event", event: { type: e.type, occurredAt: e.occurredAt, baseRate }, universe: "us-all", explain: EXPLAIN(e.type, e.body), evidence,
    calibration: { method: "event-study", n: baseRate.n, trackKind: "quant_event" }, ...(costs ? { costs } : {}), tags: ["insiders", e.type],
  };
}

/**
 * The ledger forecast an event signal implies: that the stock beats SPY over the base rate's window, at the
 * base rate's hit rate (kind quant_event), resolved from daily closes when the window ends. Pure.
 * Day 0 is the first session the filing could be traded on; a window "+2..+125" runs from day 1's close to day
 * 125's close.
 */
export function eventForecast(s: QuantSignal): { subject: string; question: string; probability: number; baseRate: number; opensAt: Date; closesAt: Date; rule: ForecastRule } | null {
  const br = s.event?.baseRate;
  const m = br?.window.match(/^\+?(\d+)\.\.\+?(\d+)$/);
  if (!br || !m) return null;
  const day0 = nextOpenAfter(s.asOf).slice(0, 10);
  const from = addSessions(day0, Math.max(0, Number(m[1]) - 1)), to = addSessions(day0, Number(m[2]));
  const sym = s.instrument.symbol;
  return {
    subject: `quant:event:${s.id}`, question: `${sym} beats SPY from the close of ${from} to the close of ${to} (after an event of the kind "${(CATALOG[s.event!.type]?.label ?? s.event!.type).toLowerCase()}", base rate ${Math.round(br.hitRate * 100)}% over n = ${br.n})`,
    probability: br.hitRate, baseRate: br.unconditionalHitRate, opensAt: new Date(s.asOf), closesAt: new Date(`${to}T21:00:00Z`),
    rule: { type: "return", symbol: sym, benchmark: "SPY", from, to, op: ">", value: 0 },
  };
}

/** Publish signals for events of the last 30 days whose base rates exist. */
export async function publishInsiderSignals(deadline: number) {
  const db = requireDb();
  const rows = await db.select().from(schema.quantEvents).where(and(inArray(schema.quantEvents.type, Object.keys(CATALOG).filter((k) => !/shift|spike/.test(k))), gte(schema.quantEvents.acceptedAt, new Date(Date.now() - 30 * DAY)))).orderBy(desc(schema.quantEvents.acceptedAt)).limit(300);
  const rates = new Map<string, ReturnType<typeof signalBaseRate>>();
  for (const t of new Set(rows.map((r) => r.type))) rates.set(t, signalBaseRate(await baseRateFor(t)));
  const signals: QuantSignal[] = [];
  for (const r of rows) {
    if (Date.now() > deadline) break;
    const br = rates.get(r.type) ?? null;
    if (!br) continue;
    const costs = await estimateCost(r.symbol, 10_000, "buy").catch(() => undefined);
    const s = eventSignal({ id: r.id, type: r.type, symbol: r.symbol, issuerCik: r.issuerCik, occurredAt: String(r.occurredAt), acceptedAt: r.acceptedAt.toISOString(), body: r.body }, br, costs ? { spreadBps: costs.spreadBps, impactBps: costs.impactBps, commissionBps: costs.commissionBps, borrowBpsYear: costs.borrowBpsYear, totalRoundTripBps: costs.totalRoundTripBps, referenceNotionalUsd: costs.referenceNotionalUsd, adv20Usd: costs.adv20Usd, model: costs.model, asOf: costs.asOf } : undefined);
    if (s) signals.push(s);
  }
  const out = await publishSignals(signals);
  // Each event's base rate is a forecast the ledger scores when its window closes (spec Q7: ledger forecasts).
  let ledger = 0;
  for (const s of signals) {
    if (Date.now() > deadline) break;
    const f = eventForecast(s);
    if (!f) continue;
    const r = await logForecast({ kind: "quant_event", ...f, model: s.producer, modelVersion: s.producerVersion }).catch(() => null);
    if (r?.logged) ledger++;
  }
  return { ...out, forecasts: out.forecasts + ledger };
}

/* ---------------- Board and company view ---------------- */

export type BoardRow = { id: string; type: string; label: string; symbol: string; issuerCik: string; occurredAt: string; acceptedAt: string; explain: string; totalUsd: number | null; insiders: number; baseRate: ReturnType<typeof signalBaseRate>; pending: boolean; url: string | null };

export async function board(opts: { symbols?: string[]; types?: string[]; limit: number; days?: number }): Promise<BoardRow[]> {
  const db = requireDb();
  const types = (opts.types?.length ? opts.types : ["cluster_buy", "large_officer_buy", "cluster_sell", "activist_new", "activist_up"]).filter((t) => CATALOG[t]);
  const rows = await db.select().from(schema.quantEvents).where(and(inArray(schema.quantEvents.type, types), gte(schema.quantEvents.acceptedAt, new Date(Date.now() - (opts.days ?? 90) * DAY)), opts.symbols?.length ? inArray(schema.quantEvents.symbol, opts.symbols.slice(0, 500)) : undefined)).orderBy(desc(schema.quantEvents.acceptedAt)).limit(Math.min(opts.limit, 500));
  const rates = new Map<string, ReturnType<typeof signalBaseRate>>();
  for (const t of new Set(rows.map((r) => r.type))) rates.set(t, signalBaseRate(await baseRateFor(t)));
  return rows.map((r) => {
    const b = r.body as Record<string, unknown>;
    return { id: r.id, type: r.type, label: CATALOG[r.type]?.label ?? r.type, symbol: r.symbol, issuerCik: r.issuerCik, occurredAt: String(r.occurredAt), acceptedAt: r.acceptedAt.toISOString(), explain: EXPLAIN(r.type, b), totalUsd: typeof b.totalUsd === "number" ? b.totalUsd : null, insiders: Array.isArray(b.insiders) ? b.insiders.length : 0, baseRate: rates.get(r.type) ?? null, pending: !rates.get(r.type), url: typeof b.url === "string" ? b.url : null };
  });
}

/** A company's insider trades with each one's habit, newest first (for INSC and the INS screen). */
export async function companyInsiders(symbol: string): Promise<{ trades: (Tx & { habit: string; excluded: string | null })[]; events: BoardRow[] }> {
  const db = requireDb();
  const rows = await db.select().from(schema.quantInsiderTx).where(eq(schema.quantInsiderTx.symbol, symbol.toUpperCase())).orderBy(desc(schema.quantInsiderTx.tradeDate)).limit(300);
  const owners = [...new Set(rows.map((r) => r.ownerCik))].filter(Boolean);
  const hist = owners.length ? await db.select({ ownerCik: schema.quantInsiderTx.ownerCik, tradeDate: schema.quantInsiderTx.tradeDate, code: schema.quantInsiderTx.code }).from(schema.quantInsiderTx).where(inArray(schema.quantInsiderTx.ownerCik, owners.slice(0, 300))).limit(30_000) : [];
  const trades = rows.map((r) => {
    const t: Tx = { accession: r.accession, line: r.line, issuerCik: r.issuerCik, symbol: r.symbol, ownerCik: r.ownerCik, ownerName: r.ownerName, isDirector: r.isDirector, isOfficer: r.isOfficer, isTenPct: r.isTenPct, title: r.officerTitle, code: r.code, acquired: r.acquired, shares: r.shares, price: r.price, ownedAfter: r.ownedAfter, tradeDate: String(r.tradeDate), acceptedAt: r.acceptedAt.toISOString(), plan10b51: r.plan10b51, url: r.url };
    const e = eligible(t);
    return { ...t, habit: classify(hist.filter((h) => h.ownerCik === r.ownerCik).map((h) => ({ tradeDate: String(h.tradeDate), code: h.code })), t), excluded: e.ok ? null : e.reason ?? null };
  });
  return { trades, events: await board({ symbols: [symbol.toUpperCase()], limit: 50, days: 3 * 365 }) };
}

/* ---------------- Item 4 readings (Pro, small model, cached per filing) ---------------- */

const Item4 = z.object({
  intent: z.enum(["board_seats", "sale_or_merger", "proxy_contest", "operational_changes", "capital_return", "engagement_only", "no_plans", "other"]),
  summary: z.string().describe("one factual sentence"),
  quote: z.string().describe("a verbatim sentence from the text that supports the reading"),
});

export async function readItem4(eventId: string): Promise<{ intent: string; summary: string; quote: string; verified: boolean; model: string; cached: boolean }> {
  const db = requireDb();
  const [ev] = await db.select().from(schema.quantEvents).where(eq(schema.quantEvents.id, eventId));
  if (!ev || !/^activist/.test(ev.type)) throw Object.assign(new Error("No such 13D event."), { status: 404 });
  const b = ev.body as Record<string, unknown>;
  const cached = b.item4Reading as { intent: string; summary: string; quote: string; verified: boolean; model: string } | undefined;
  if (cached) return { ...cached, cached: true };
  const [stake] = await db.select().from(schema.quantEvents).where(and(eq(schema.quantEvents.type, "stake13"), sql`${schema.quantEvents.body}->>'accession' = ${String(b.accession ?? "")}`)).limit(1);
  const text = String((stake?.body as Record<string, unknown> | undefined)?.item4 ?? "");
  if (text.length < 40) throw Object.assign(new Error("This filing's Item 4 could not be found to read."), { status: 422 });
  const out = await structured(Item4, "quant-item4", "You read Item 4 (Purpose of Transaction) of a Schedule 13D and state what the filer says it may do, factually, without predicting. Quote one sentence verbatim from the text that supports your reading. No advice.", text.slice(0, 12_000), { task: "extract", maxTokens: 400, timeoutMs: 60_000 });
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const verified = out.data.quote.length > 20 && norm(text).includes(norm(out.data.quote).slice(0, 200));
  const reading = { intent: out.data.intent, summary: out.data.summary, quote: verified ? out.data.quote : "", verified, model: out.model };
  await db.update(schema.quantEvents).set({ body: { ...b, item4Reading: reading } }).where(eq(schema.quantEvents.id, eventId));
  return { ...reading, cached: false };
}
