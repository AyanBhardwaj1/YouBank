/**
 * Deal history for the graph, the model's training data. Three sources, each cited:
 * - merger communications (Rule 425, merger proxies, tender offers) name both parties, found with
 *   EDGAR full-text search; a small model reads one of them to say who is buying whom, quoting it;
 * - completed acquisitions and disposals a company reports under 8-K Item 2.01, read the same way;
 * - deals the Newsroom has recorded from the news.
 * A deal becomes an "acquired" link from buyer to target, dated when it was announced (or completed).
 */
import { and, gte, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { cacheGet, cacheSet } from "@/lib/cache";
import { edgarFetch } from "@/lib/edgar/client";
import { htmlToText } from "@/lib/edgar/filingText";
import { tickerByName, tickerMap } from "@/lib/edgar/tickers";
import { logError } from "@/lib/errors";
import { quoteFound } from "../docs/text";
import { small } from "../models";
import { isDealVehicle, normName, titleCase } from "./parse";

/** Whether two names belong to one corporate family ("Energy Transfer LP" and "Energy Transfer Partners"). Pure. */
export function sameGroup(a: string, b: string): boolean {
  const wa = normName(a).split(" ").filter((w) => w.length > 2), wb = normName(b).split(" ").filter((w) => w.length > 2);
  if (!wa.length || !wb.length) return false;
  return wa.slice(0, 2).join(" ") === wb.slice(0, 2).join(" ") && wa.length >= 2 && wb.length >= 2;
}
import { listedByCik, upsertLinks, upsertNodes, nodeKey, type LinkIn, type NodeIn } from "./store";

type EftsHit = { _id: string; _source: { display_names?: string[]; ciks?: string[]; form?: string; file_date?: string } };
type Pair = { otherCik: string; otherName: string; first: string; last: string; forms: Set<string>; sample: { url: string; form: string } };

const CIK_IN_NAME = /\s*\((?:[A-Z0-9.\-, ]+\)\s*\()?CIK\s*\d+\)\s*$/;
const cleanName = (s: string) => s.replace(CIK_IN_NAME, "").replace(/\s+\([A-Z0-9.\-, ]+\)\s*$/, "").trim();

async function efts(params: Record<string, string>, pages = 2): Promise<EftsHit[]> {
  const out: EftsHit[] = [];
  for (let page = 0; page < pages; page++) {
    const p = new URLSearchParams({ ...params, from: String(page * 100) });
    const res = await edgarFetch(`https://efts.sec.gov/LATEST/search-index?${p}`);
    if (!res.ok) break;
    const j = (await res.json()) as { hits: { total: { value: number }; hits: EftsHit[] } };
    out.push(...j.hits.hits);
    if (j.hits.hits.length < 100 || out.length >= j.hits.total.value) break;
  }
  return out;
}

const docUrl = (hit: EftsHit) => {
  const [acc, doc] = hit._id.split(":");
  const cik = hit._source.ciks?.[0] ?? "0";
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}/${doc}`;
};

/** The other parties in a company's merger communications since `from`, with the dates they span. Pure over search hits. */
export function pairsFromHits(cik: string, hits: EftsHit[]): Pair[] {
  const me = cik.replace(/^0+/, "");
  const by = new Map<string, Pair>();
  for (const h of hits) {
    const ciks = (h._source.ciks ?? []).map((c) => c.replace(/^0+/, ""));
    const names = h._source.display_names ?? [];
    if (!ciks.includes(me)) continue;
    ciks.forEach((c, i) => {
      if (c === me || !c) return;
      const date = (h._source.file_date ?? "").slice(0, 10);
      const cur = by.get(c) ?? { otherCik: c, otherName: cleanName(names[i] ?? ""), first: date, last: date, forms: new Set<string>(), sample: { url: docUrl(h), form: h._source.form ?? "" } };
      if (date && (!cur.first || date < cur.first)) { cur.first = date; cur.sample = { url: docUrl(h), form: h._source.form ?? "" }; }
      if (date > cur.last) cur.last = date;
      cur.forms.add(h._source.form ?? "");
      by.set(c, cur);
    });
  }
  return [...by.values()];
}

const Direction = z.object({
  kind: z.enum(["acquisition", "merger_of_equals", "not_a_deal", "unclear"]),
  relation: z.enum(["third_party", "affiliate_rollup", "internal"]).describe("third_party: unrelated companies; affiliate_rollup: a parent buying in its separately listed affiliate (an MLP simplification); internal: a reorganization among one group's own entities"),
  acquirer: z.enum(["A", "B", "neither"]).describe("which named company is buying or absorbing the other"),
  status: z.enum(["announced", "completed", "terminated", "unknown"]),
  quote: z.string().describe("the exact words from the text that say who acquires whom, under 30 words"),
});

async function readText(url: string, max = 9000): Promise<string> {
  const res = await edgarFetch(url);
  if (!res.ok) throw new Error(`EDGAR ${res.status}`);
  const raw = await res.text();
  return (/<html|<div|<p[ >]/i.test(raw) ? htmlToText(raw) : raw).replace(/\s+/g, " ").slice(0, max);
}

/** Who bought whom between a company and each party it filed merger communications with. */
export async function mergerDeals(me: { cik: string; name: string }, since: string, deadline: number): Promise<{ nodes: NodeIn[]; links: (Omit<LinkIn, "src" | "dst"> & { from: string; to: string })[] }> {
  const hits = await efts({ q: "\"merger\"", forms: "425,DEFM14A,SC TO-T,SC 14D9,S-4", dateRange: "custom", startdt: since, enddt: new Date().toISOString().slice(0, 10), ciks: me.cik.padStart(10, "0") });
  const pairs = pairsFromHits(me.cik, hits);
  const nodes: NodeIn[] = [], links: (Omit<LinkIn, "src" | "dst"> & { from: string; to: string })[] = [];
  const meKey = nodeKey({ kind: "company", cik: me.cik, name: me.name });
  for (const p of pairs.slice(0, 12)) {
    if (Date.now() > deadline) break;
    const judged = `edge:graph:pair:v2:${[me.cik, p.otherCik].sort().join("-")}`;
    const cached = await cacheGet(judged);
    let verdict: z.infer<typeof Direction> & { a: string } | null = cached ? JSON.parse(cached) : null;
    if (!verdict) {
      try {
        const text = await readText(p.sample.url);
        const r = await structured(Direction, "edge-graph-deal", "You read an SEC merger filing. Say whether it describes an acquisition between company A and company B, which one is the buyer (the one acquiring or absorbing the other), and the deal's status. Quote the words that show it. If the filing is not about a deal between these two, say not_a_deal.",
          `A: ${me.name}\nB: ${p.otherName}\nForm: ${p.sample.form}\n\n${text}`, { override: small(), maxTokens: 400, timeoutMs: 45_000 });
        verdict = { ...r.data, a: me.cik };
        if (!quoteFound(r.data.quote, text)) verdict = { ...verdict, kind: "unclear" };
      } catch (e) { logError(e, { where: "edge-graph-deal" }); continue; }
      await cacheSet(judged, JSON.stringify(verdict), 180 * 86_400_000);
    }
    if (verdict.kind !== "acquisition" || verdict.acquirer === "neither" || verdict.relation === "internal") continue;
    const listed = (await listedByCik()).get(p.otherCik);
    const other: NodeIn = { kind: "company", name: titleCase(p.otherName), cik: p.otherCik, ticker: listed?.ticker ?? "" };
    nodes.push(other);
    const otherKey = nodeKey(other);
    // The verdict was made with A as whichever company first asked; map it back to this pair.
    const aIsMe = verdict.a === me.cik;
    const buyerIsMe = (verdict.acquirer === "A") === aIsMe;
    links.push({ from: buyerIsMe ? meKey : otherKey, to: buyerIsMe ? otherKey : meKey, kind: "acquired", asOf: p.first || null, sourceName: `${p.sample.form} (SEC EDGAR)`, sourceUrl: p.sample.url, attrs: { status: verdict.status, relation: verdict.relation, quote: verdict.quote, forms: [...p.forms], last: p.last, via: "merger filings" } });
  }
  return { nodes, links };
}

const Completed = z.object({
  deals: z.array(z.object({
    counterparty: z.string().describe("the one other company, as named (one company per entry)"),
    role: z.enum(["we_acquired", "we_sold"]).describe("we_acquired: the filer bought the counterparty or assets from it; we_sold: the filer sold to the counterparty"),
    whole: z.boolean().describe("true when a whole company changed hands (a merger or purchase of the company), false for assets, units, securities or interests"),
    relation: z.enum(["third_party", "affiliate_rollup", "internal"]).describe("third_party: unrelated companies; affiliate_rollup: buying in a separately listed affiliate; internal: a reorganization among one group's own entities"),
    what: z.string().describe("the company or assets, in a few words"),
    date: z.string().describe("completion date YYYY-MM-DD if stated, else empty"),
    quote: z.string().describe("the exact words that describe it, under 30 words"),
  })).max(4),
});

/** Acquisitions and disposals a company completed, from its 8-K Item 2.01 reports since `since`. */
export async function completedDeals(me: { cik: string; name: string }, since: string, deadline: number, max = 8): Promise<{ nodes: NodeIn[]; links: (Omit<LinkIn, "src" | "dst"> & { from: string; to: string })[] }> {
  const hits = await efts({ q: "\"Item 2.01\"", forms: "8-K", dateRange: "custom", startdt: since, enddt: new Date().toISOString().slice(0, 10), ciks: me.cik.padStart(10, "0") }, 1);
  const byFiling = new Map<string, EftsHit>();
  for (const h of hits) { const acc = h._id.split(":")[0]; if (!byFiling.has(acc) || /8-?k/i.test(h._id.split(":")[1] ?? "")) byFiling.set(acc, h); }
  const nodes: NodeIn[] = [], links: (Omit<LinkIn, "src" | "dst"> & { from: string; to: string })[] = [];
  const meKey = nodeKey({ kind: "company", cik: me.cik, name: me.name });
  for (const h of [...byFiling.values()].sort((a, b) => (b._source.file_date ?? "").localeCompare(a._source.file_date ?? "")).slice(0, max)) {
    if (Date.now() > deadline) break;
    const url = docUrl(h), filed = (h._source.file_date ?? "").slice(0, 10);
    const key = `edge:graph:k201:v2:${h._id.split(":")[0]}`;
    const cached = await cacheGet(key);
    let found: z.infer<typeof Completed>["deals"] = cached ? JSON.parse(cached) : [];
    if (!cached) {
      try {
        const full = await readText(url, 60_000);
        const at = full.search(/item\s*2\.01/i);
        const text = full.slice(Math.max(0, at), Math.max(0, at) + 6000) || full.slice(0, 6000);
        const r = await structured(Completed, "edge-graph-201", "You read the Item 2.01 section of an 8-K (completion of an acquisition or disposition). List each completed deal: the counterparty as named, whether the filer bought or sold, what changed hands, the completion date, and the exact words that say so. Leave out anything not completed.",
          `Filer: ${me.name}\n\n${text}`, { override: small(), maxTokens: 700, timeoutMs: 45_000 });
        found = r.data.deals.filter((d) => d.counterparty.trim().length > 2 && quoteFound(d.quote, text));
      } catch (e) { logError(e, { where: "edge-graph-201" }); continue; }
      await cacheSet(key, JSON.stringify(found), 365 * 86_400_000);
    }
    for (const d of found) {
      // One group's own reshuffles are not deals; neither are lists of several entities.
      if (d.relation === "internal" || /,|\band\b/i.test(d.counterparty) || normName(d.counterparty).length < 4 || isDealVehicle(d.counterparty) || sameGroup(me.name, d.counterparty)) continue;
      const listed = await tickerByName(d.counterparty).catch(() => null);
      const other: NodeIn = listed ? { kind: "company", name: titleCase(listed.name), cik: listed.cik.replace(/^0+/, ""), ticker: listed.ticker } : { kind: "company", name: d.counterparty.trim(), attrs: { private: true } };
      if (other.cik === me.cik) continue;
      nodes.push(other);
      const otherKey = nodeKey(other);
      const [from, to] = d.role === "we_acquired" ? [meKey, otherKey] : [otherKey, meKey];
      // Only whole companies changing hands train the deal model; asset purchases are kept as their own kind of
      // link. When the filer sells, what changed hands was a business of its own, never the filer itself.
      links.push({ from, to, kind: d.whole && d.role === "we_acquired" ? "acquired" : "bought_assets", asOf: /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : filed || null, sourceName: "8-K Item 2.01 (SEC EDGAR)", sourceUrl: url, attrs: { status: "completed", what: d.what, quote: d.quote, via: "8-K Item 2.01", relation: d.relation, private: !listed } });
    }
  }
  return { nodes, links };
}

/** Deals the Newsroom recorded (the last `days`) between listed companies, with the advisers it named. */
export async function newsroomDeals(days = 3650): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await requireDb().select().from(schema.newsDeals).where(and(gte(schema.newsDeals.announcedAt, since), inArray(schema.newsDeals.kind, ["acquisition", "merger", "take_private", "tender"]), or(ne(schema.newsDeals.acquirerTicker, ""), ne(schema.newsDeals.targetTicker, "")))).limit(2000);
  const map = await tickerMap();
  const nodes: NodeIn[] = [];
  const pairs: { a: NodeIn; b: NodeIn; row: (typeof rows)[number] }[] = [];
  const advisers: { firm: NodeIn; party: NodeIn; role: string; row: (typeof rows)[number] }[] = [];
  for (const r of rows) {
    const a = r.acquirerTicker ? map.get(r.acquirerTicker.toUpperCase()) : null;
    const b = r.targetTicker ? map.get(r.targetTicker.toUpperCase()) : null;
    if (!a || !b || a.cik === b.cik) continue;
    const na: NodeIn = { kind: "company", name: titleCase(a.name), cik: a.cik.replace(/^0+/, ""), ticker: a.ticker }, nb: NodeIn = { kind: "company", name: titleCase(b.name), cik: b.cik.replace(/^0+/, ""), ticker: b.ticker };
    nodes.push(na, nb); pairs.push({ a: na, b: nb, row: r });
    for (const adv of r.advisors ?? []) {
      if (!adv.firm || adv.firm.length < 3) continue;
      const firm: NodeIn = { kind: "firm", name: adv.firm.trim() };
      nodes.push(firm);
      advisers.push({ firm, party: /target|sell/i.test(adv.side) ? nb : na, role: adv.role || "adviser", row: r });
    }
  }
  const ids = await upsertNodes(nodes);
  const deals: LinkIn[] = pairs.map(({ a, b, row }) => ({
    src: ids.get(nodeKey(a))!, dst: ids.get(nodeKey(b))!, kind: "acquired", asOf: row.announcedAt.toISOString().slice(0, 10),
    sourceName: "YouBank Newsroom deal tracker", sourceUrl: row.sourceUrl, attrs: { status: row.status, via: "newsroom", valueUsd: row.valueUsd },
  }));
  const advised: LinkIn[] = advisers.map(({ firm, party, role, row }) => ({
    src: ids.get(nodeKey(firm))!, dst: ids.get(nodeKey(party))!, kind: "advised", asOf: row.announcedAt.toISOString().slice(0, 10),
    sourceName: "YouBank Newsroom deal tracker", sourceUrl: row.sourceUrl, attrs: { role, via: "newsroom" },
  }));
  return upsertLinks([...deals, ...advised].filter((l) => l.src && l.dst));
}

/** Deals announced since a date (by the deal's own date, not when Edge re-read it): whether predictions need refreshing. */
export async function dealsSince(date: string): Promise<number> {
  const [r] = (await requireDb().execute(sql`select count(*)::int as n from edge_links where kind = 'acquired' and as_of >= ${date.slice(0, 10)}::date and coalesce(attrs->>'relation', 'third_party') = 'third_party'`)).rows as { n: number }[];
  return r?.n ?? 0;
}

