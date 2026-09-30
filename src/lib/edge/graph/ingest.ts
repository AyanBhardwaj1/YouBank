/**
 * Building a company's corner of the graph from EDGAR, one source at a time, each resuming from its own
 * watermark so a weekly pass only reads what is new:
 * - 8-K items (auditor changes, restatements, departures) for red flags, read from the filing list;
 * - insiders (Form 4): directors, officers and 10% owners, with their trades;
 * - 5% holders (Schedule 13D/13G), and the stakes this company holds in others;
 * - subsidiaries (Exhibit 21), matched to listed companies where they are one (joint ventures appear as
 *   a subsidiary shared by two parents);
 * - named customers and suppliers in the 10-K, read by a small model and kept only when quoted;
 * - deals (merger filings, 8-K Item 2.01);
 * - size (XBRL facts) and headquarters location, for the model's features and the map.
 * Filings are fetched without the text cache: only what is parsed is kept.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { edgarFetch } from "@/lib/edgar/client";
import { getCompanyFacts, instantAt, latestEnd, ltmAt, pickConcept } from "@/lib/edgar/facts";
import { filingUrl, getSubmissions } from "@/lib/edgar/submissions";
import { tickerByName } from "@/lib/edgar/tickers";
import { logError } from "@/lib/errors";
import { filingTextCached } from "../docs/changes";
import { quoteFound } from "../docs/text";
import { completedDeals, mergerDeals } from "./deals";
import { geocode, type Address } from "./geo";
import { exhibit21Href, holdingPercent, isDealVehicle, ITEM_MEANING, normName, parseExhibit21, parseForm4, parseHeader, personName, relationParagraphs, titleCase, type Form4Tx } from "./parse";
import { listedByCik, nodeKey, nodesById, setNodeAttrs, upsertLinks, upsertNodes, type LinkIn, type NodeIn } from "./store";

export type Seen = { f4?: string; s13?: string; ex21?: string; rel?: string; deals?: string; facts?: string };
export type IngestResult = { cik: string; nodeId: number; name: string; added: Record<string, number>; done: boolean; errors: string[] };

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const ENTITY = /\b(llc|l\.?\s?p\.?|inc|corp|corporation|fund|funds|partners|trust|capital|holdings|management|group|ltd|limited|company|advisors|advisers|investments|associates|bank|n\.?a\.?)\b/i;

async function text(url: string): Promise<string> {
  const res = await edgarFetch(url);
  if (!res.ok) throw new Error(`EDGAR ${res.status} for ${url}`);
  return res.text();
}

const nice = (name: string) => (/[a-z]/.test(name) ? name : titleCase(name));

const Relations = z.object({
  parties: z.array(z.object({
    name: z.string().describe("the customer's or supplier's name exactly as written"),
    role: z.enum(["customer", "supplier"]),
    share: z.number().nullable().describe("its share of the company's revenue (customer) or purchases (supplier), in percent, if stated"),
    year: z.string().describe("the fiscal year the share is for, if stated"),
    quote: z.string().describe("the exact words that name it, under 40 words"),
  })).max(12),
});

/** Refresh one company's corner of the graph; stops cleanly at the deadline (call again to continue). */
export async function ingestCompany(cikIn: string, deadline: number): Promise<IngestResult> {
  const cik = cikIn.replace(/^0+/, "");
  const sub = await getSubmissions(cik.padStart(10, "0"));
  const addr = ((sub as unknown as { addresses?: { business?: Address } }).addresses?.business ?? {}) as Address;
  const me: NodeIn = { kind: "company", name: nice(sub.name), cik, ticker: sub.tickers?.[0] ?? "", attrs: { sic: sub.sic, sicDescription: sub.sicDescription, state: addr.stateOrCountry ?? "", city: addr.city ?? "", exchanges: sub.exchanges ?? [], tickers: sub.tickers ?? [], fye: sub.fiscalYearEnd } };
  const meKey = nodeKey(me);
  const nodeId = (await upsertNodes([me], { rename: true })).get(meKey)!;
  const node = (await nodesById([nodeId])).get(nodeId)!;
  const seen = ((node.attrs as { seen?: Seen }).seen ?? {}) as Seen;
  const out: IngestResult = { cik, nodeId, name: me.name, added: {}, done: false, errors: [] };
  const r = sub.filings.recent;
  const folder = (acc: string) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}`;
  const time = () => Date.now() < deadline - 20_000;
  const step = async (name: string, fn: () => Promise<number | void>) => {
    if (!time()) return false;
    try { const n = await fn(); if (typeof n === "number") out.added[name] = n; } catch (e) { out.errors.push(`${name}: ${(e as Error).message}`.slice(0, 200)); logError(e, { where: `edge-graph-${name}` }); }
    return true;
  };

  // 1. 8-K items worth a flag (from the filing list; no extra reads).
  await step("events", async () => {
    const events: { date: string; items: string[]; url: string }[] = [];
    for (let i = 0; i < r.form.length && events.length < 60; i++) {
      if (r.form[i] !== "8-K" || !r.items?.[i] || r.filingDate[i] < daysAgo(3 * 365)) continue;
      const items = r.items[i].split(",").map((x) => x.trim()).filter((x) => ITEM_MEANING[x]);
      if (items.length) events.push({ date: r.filingDate[i], items, url: filingUrl(cik, r.accessionNumber[i], r.primaryDocument[i]) });
    }
    await setNodeAttrs(nodeId, { events });
    return events.length;
  });

  // 2. Insiders (Form 4): the most recent 40 since the watermark (two years on the first pass).
  if (time()) await step("insiders", async () => {
    const since = seen.f4 ?? daysAgo(730);
    const idx: number[] = [];
    for (let i = 0; i < r.form.length && idx.length < 40; i++) if ((r.form[i] === "4" || r.form[i] === "4/A") && r.filingDate[i] > since) idx.push(i);
    if (!idx.length) return 0;
    type Agg = { cik: string; name: string; entity: boolean; director: boolean; officer: boolean; title: string; tenPct: boolean; first: string; last: string; url: string; txns: (Form4Tx & { url: string })[] };
    const by = new Map<string, Agg>();
    for (const i of idx) {
      if (!time()) break;
      const url = filingUrl(cik, r.accessionNumber[i], r.primaryDocument[i]).replace(/\/xsl[^/]*\//, "/");
      const f = parseForm4(await text(url).catch(() => ""));
      if (!f || f.issuerCik !== cik) continue;
      const index = `${folder(r.accessionNumber[i])}/`;
      for (const o of f.owners) {
        const a = by.get(o.cik) ?? { cik: o.cik, name: o.name, entity: ENTITY.test(o.name), director: false, officer: false, title: "", tenPct: false, first: r.filingDate[i], last: r.filingDate[i], url: index, txns: [] };
        a.director ||= o.director; a.officer ||= o.officer; a.tenPct ||= o.tenPct; a.title ||= o.title;
        if (r.filingDate[i] < a.first) a.first = r.filingDate[i];
        if (r.filingDate[i] >= a.last) { a.last = r.filingDate[i]; a.url = index; }
        // Trades are the filing's own; with several owners on one filing they are shared (a family trust and its trustee).
        if (f.owners.length === 1) a.txns.push(...f.txns.map((t) => ({ ...t, url: index })));
        by.set(o.cik, a);
      }
    }
    const aggs = [...by.values()];
    const ids = await upsertNodes(aggs.map((a) => (a.entity ? { kind: "fund" as const, name: nice(a.name), cik: a.cik } : { kind: "person" as const, name: personName(a.name), cik: a.cik, attrs: { rawName: a.name } })));
    const keyOf = (a: Agg) => nodeKey(a.entity ? { kind: "fund", cik: a.cik, name: a.name } : { kind: "person", cik: a.cik, name: a.name });
    // Keep each link's recent trades, merged with what earlier passes stored.
    const personIds = aggs.map((a) => ids.get(keyOf(a))).filter((x): x is number => !!x);
    const prior = personIds.length ? await requireDb().select({ src: schema.edgeLinks.src, kind: schema.edgeLinks.kind, attrs: schema.edgeLinks.attrs }).from(schema.edgeLinks).where(and(inArray(schema.edgeLinks.src, personIds), eq(schema.edgeLinks.dst, nodeId))) : [];
    const links: LinkIn[] = [];
    for (const a of aggs) {
      const src = ids.get(keyOf(a));
      if (!src) continue;
      const kind = a.director ? "director" : a.officer ? "officer" : a.tenPct ? "holder" : "insider";
      const old = (prior.find((p) => p.src === src && p.kind === kind)?.attrs as { txns?: (Form4Tx & { url: string })[] } | undefined)?.txns ?? [];
      const merged = new Map<string, Form4Tx & { url: string }>();
      for (const t of [...old, ...a.txns]) merged.set(`${t.date}|${t.code}|${t.shares}|${t.derivative}`, t);
      const txns = [...merged.values()].sort((x, y) => y.date.localeCompare(x.date)).slice(0, 15);
      links.push({ src, dst: nodeId, kind, weight: kind === "holder" ? 0.1 : 1, asOf: a.first, sourceName: "Form 4 (SEC EDGAR)", sourceUrl: a.url, attrs: { title: a.officer ? a.title || "Officer" : "", director: a.director, officer: a.officer, tenPct: a.tenPct, lastFiled: a.last, txns } });
      // An officer who is also a director gets both links (board interlocks look at directors).
      if (a.director && a.officer) links.push({ src, dst: nodeId, kind: "officer", asOf: a.first, sourceName: "Form 4 (SEC EDGAR)", sourceUrl: a.url, attrs: { title: a.title || "Officer", lastFiled: a.last } });
    }
    await upsertLinks(links);
    await setNodeAttrs(nodeId, { seen: { ...seen, f4: r.filingDate[idx[0]] } });
    seen.f4 = r.filingDate[idx[0]];
    return links.length;
  });

  // 3. 5% holders (Schedule 13D/13G, old text and new XML), oldest first so later amendments win.
  if (time()) await step("holders", async () => {
    const since = seen.s13 ?? daysAgo(3 * 365);
    const idx: number[] = [];
    for (let i = 0; i < r.form.length && idx.length < 25; i++) if (/^(SC 13[DG]|SCHEDULE 13[DG])(\/A)?$/.test(r.form[i]) && r.filingDate[i] > since) idx.push(i);
    if (!idx.length) return 0;
    const names = await listedByCik();
    const nodes: NodeIn[] = [], links: (Omit<LinkIn, "src" | "dst"> & { from: string; to: string })[] = [];
    let newest = since;
    for (const i of idx.reverse()) {
      if (!time()) break;
      const acc = r.accessionNumber[i];
      const head = parseHeader(await text(`${folder(acc)}/${acc}.hdr.sgml`).catch(() => ""));
      const filer = head.filers[0];
      if (!head.subject || !filer?.cik) continue;
      const doc = await text(filingUrl(cik, acc, r.primaryDocument[i]).replace(/\/xsl[^/]*\//, "/")).catch(() => "");
      const { percent, exited } = holdingPercent(doc);
      const subj: NodeIn = { kind: "company", name: nice(head.subject.name), cik: head.subject.cik, ticker: names.get(head.subject.cik)?.ticker ?? "" };
      // A listed filer is a company; an individual (no legal-entity words in the name) is the same person node Form 4 makes.
      // Listed asset managers (BlackRock, State Street) hold as funds: financial industry codes 6000-6799.
      const investor = /^6[0-7]\d\d$/.test(filer.sic) || /\b(capital|management|advisors|advisers|investments|asset|funds?|partners)\b/i.test(filer.name);
      const holder: NodeIn = names.has(filer.cik) && !investor ? { kind: "company", name: nice(filer.name), cik: filer.cik, ticker: names.get(filer.cik)!.ticker }
        : ENTITY.test(filer.name) ? { kind: "fund", name: nice(filer.name), cik: filer.cik } : { kind: "person", name: personName(filer.name), cik: filer.cik, attrs: { rawName: filer.name } };
      if (subj.cik === holder.cik) continue;
      nodes.push(subj, holder);
      links.push({ from: nodeKey(holder), to: nodeKey(subj), kind: "holder", weight: percent !== null ? percent / 100 : 0.05, asOf: head.filed || r.filingDate[i], ended: exited ? head.filed || r.filingDate[i] : null, sourceName: `${r.form[i]} (SEC EDGAR)`, sourceUrl: `${folder(acc)}/`, attrs: { percent, form: r.form[i], filed: r.filingDate[i], activist: /13D/.test(r.form[i]) } });
      if (r.filingDate[i] > newest) newest = r.filingDate[i];
    }
    const ids = await upsertNodes(nodes);
    const n = await upsertLinks(links.map(({ from, to, ...l }) => ({ ...l, src: ids.get(from)!, dst: ids.get(to)! })).filter((l) => l.src && l.dst));
    await setNodeAttrs(nodeId, { seen: { ...seen, s13: newest } });
    seen.s13 = newest;
    return n;
  });

  const tenK = r.form.findIndex((f) => f === "10-K" || f === "10-K405");

  // 4. Subsidiaries (Exhibit 21 of the latest 10-K).
  if (time() && tenK >= 0 && seen.ex21 !== r.accessionNumber[tenK]) await step("subsidiaries", async () => {
    const acc = r.accessionNumber[tenK], filed = r.filingDate[tenK];
    const href = exhibit21Href(await text(`${folder(acc)}/${acc}-index.htm`));
    if (!href) { await setNodeAttrs(nodeId, { seen: { ...seen, ex21: acc } }); seen.ex21 = acc; return 0; }
    const url = href.startsWith("http") ? href : `https://www.sec.gov${href}`;
    const subs = parseExhibit21(await text(url), 400);
    const norms = [...new Set(subs.map((s) => normName(s.name)))];
    const known = norms.length ? await requireDb().select({ id: schema.edgeNodes.id, norm: schema.edgeNodes.norm }).from(schema.edgeNodes).where(and(eq(schema.edgeNodes.kind, "company"), inArray(schema.edgeNodes.norm, norms))) : [];
    const knownBy = new Map(known.map((k) => [k.norm, k.id]));
    const fresh = subs.filter((s) => !knownBy.has(normName(s.name)));
    const ids = await upsertNodes(fresh.map((s) => ({ kind: "subsidiary" as const, name: s.name, attrs: { jurisdiction: s.jurisdiction } })));
    const pairs = subs.map((sub) => ({ sub, id: knownBy.get(normName(sub.name)) ?? ids.get(nodeKey({ kind: "subsidiary", name: sub.name })) })).filter((p): p is { sub: typeof p.sub; id: number } => !!p.id && p.id !== nodeId);
    const dsts = pairs.map((p) => p.id);
    const n = await upsertLinks(pairs.map((p) => ({ src: nodeId, dst: p.id, kind: "subsidiary", asOf: filed, ended: null, sourceName: `Exhibit 21 to the ${filed.slice(0, 4)} 10-K (SEC EDGAR)`, sourceUrl: url, attrs: { jurisdiction: p.sub.jurisdiction } })));
    // Subsidiaries no longer listed are marked as ended rather than deleted (history stays citable).
    if (dsts.length) await requireDb().execute(sql`update edge_links set ended = ${filed}::date, updated_at = now() where src = ${nodeId} and kind = 'subsidiary' and ended is null and dst <> all(${`{${dsts.join(",")}}`}::int[])`);
    await setNodeAttrs(nodeId, { seen: { ...seen, ex21: acc }, subsidiaries: dsts.length });
    seen.ex21 = acc;
    return n;
  });

  // 5. Named customers and suppliers (the latest 10-K, read by a small model, kept only when quoted).
  if (time() && tenK >= 0 && seen.rel !== r.accessionNumber[tenK]) await step("customers", async () => {
    const acc = r.accessionNumber[tenK], filed = r.filingDate[tenK];
    const url = filingUrl(cik, acc, r.primaryDocument[tenK]);
    const paras = relationParagraphs(await filingTextCached(acc, url), 8);
    let n = 0;
    if (paras.length) {
      const body = paras.join("\n\n");
      const res = await structured(Relations, "edge-graph-relations", "You read paragraphs from a company's annual report. List every customer or supplier the text names (by company name, not 'one customer'), with its share of revenue or purchases when stated, and the exact words that name it. Leave out unnamed ones, the company's own subsidiaries, and government agencies unless they are named customers.",
        `Company: ${me.name}\n\n${body}`, { override: { model: "gpt-5.6-luna", effort: "low" }, maxTokens: 900, timeoutMs: 60_000 });
      const good = res.data.parties.filter((p) => p.name.trim().length > 2 && !isDealVehicle(p.name) && quoteFound(p.quote, body) && normName(p.quote).includes(normName(p.name).split(" ")[0] ?? ""));
      const nodes: NodeIn[] = [];
      const resolved = await Promise.all(good.map(async (p) => {
        const t = await tickerByName(p.name).catch(() => null);
        const node: NodeIn = t ? { kind: "company", name: nice(t.name), cik: t.cik.replace(/^0+/, ""), ticker: t.ticker } : { kind: "company", name: p.name.trim(), attrs: { private: true } };
        nodes.push(node);
        return { p, node };
      }));
      const ids = await upsertNodes(nodes);
      n = await upsertLinks(resolved.map(({ p, node }) => {
        const other = ids.get(nodeKey(node))!;
        const [src, dst] = p.role === "customer" ? [nodeId, other] : [other, nodeId];
        return { src, dst, kind: "supplies", weight: p.share !== null ? Math.min(1, p.share / 100) : 0.05, asOf: filed, sourceName: `${filed.slice(0, 4)} 10-K (SEC EDGAR)`, sourceUrl: url, attrs: { share: p.share, year: p.year, quote: p.quote, statedBy: me.name, role: p.role } };
      }).filter((l) => l.src && l.dst && l.src !== l.dst));
    }
    await setNodeAttrs(nodeId, { seen: { ...seen, rel: acc } });
    seen.rel = acc;
    return n;
  });

  // 6. Deals: merger filings and completed acquisitions since the watermark (2014 on the first pass).
  if (time()) await step("deals", async () => {
    const since = seen.deals ?? "2014-01-01";
    const got = [await mergerDeals({ cik, name: me.name }, since, deadline - 30_000)];
    if (time()) got.push(await completedDeals({ cik, name: me.name }, since, deadline - 30_000));
    const ids = await upsertNodes([me, ...got.flatMap((g) => g.nodes)]);
    const n = await upsertLinks(got.flatMap((g) => g.links).map(({ from, to, ...l }) => ({ ...l, src: ids.get(from)!, dst: ids.get(to)! })).filter((l) => l.src && l.dst));
    const today = new Date().toISOString().slice(0, 10);
    await setNodeAttrs(nodeId, { seen: { ...seen, deals: today } });
    seen.deals = today;
    return n;
  });

  // 7. Size (XBRL, monthly) and headquarters (once).
  if (time() && (!seen.facts || seen.facts < daysAgo(30))) await step("facts", async () => {
    const cf = await getCompanyFacts(cik.padStart(10, "0"));
    const assetRows = pickConcept(cf, ["Assets"])?.rows ?? [];
    const revRows = pickConcept(cf, ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenuesNetOfInterestExpense"])?.rows ?? [];
    // Assets are point-in-time rows (no start); revenue is read over the last twelve months.
    const aEnd = assetRows.filter((x) => !x.start).reduce<string | null>((m, x) => (!m || x.end > m ? x.end : m), null), rEnd = latestEnd(revRows);
    const assets = aEnd ? instantAt(assetRows, aEnd)?.val ?? null : null;
    const revenue = rEnd ? ltmAt(revRows, rEnd)?.value ?? null : null;
    const today = new Date().toISOString().slice(0, 10);
    await setNodeAttrs(nodeId, { assets, revenue, factsAt: aEnd ?? rEnd ?? "", seen: { ...seen, facts: today } });
    seen.facts = today;
  });
  if (time() && (node.attrs as { lon?: number }).lon === undefined) await step("geo", async () => {
    const g = await geocode(addr);
    if (g) await setNodeAttrs(nodeId, { lon: g.lon, lat: g.lat, geo: g.how });
  });

  out.done = time();
  return out;
}

/** Ingest several companies in turn until the deadline; returns what was done and which were left. */
export async function ingestMany(ciks: string[], deadline: number): Promise<{ results: IngestResult[]; left: string[] }> {
  const results: IngestResult[] = [];
  let i = 0;
  for (; i < ciks.length; i++) {
    if (Date.now() > deadline - 45_000) break;
    try {
      const res = await ingestCompany(ciks[i], deadline);
      results.push(res);
      if (!res.done) break; // ran out of time partway: finish this one next time
    } catch (e) { logError(e, { where: "edge-graph-ingest" }); results.push({ cik: ciks[i], nodeId: 0, name: "", added: {}, done: true, errors: [String((e as Error).message).slice(0, 200)] }); }
  }
  return { results, left: ciks.slice(i) };
}
