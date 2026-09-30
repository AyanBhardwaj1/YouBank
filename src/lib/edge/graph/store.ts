/**
 * The relationship graph in Postgres: nodes (companies, people in public roles, funds, subsidiaries,
 * firms) and dated links between them, each with the filing it came from. Writes are batched upserts;
 * a node is the same node whenever its CIK (or, without one, its normalized name) is.
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { tickerMap } from "@/lib/edgar/tickers";
import { normName } from "./parse";

export type NodeKind = "company" | "person" | "fund" | "subsidiary" | "firm";
export type NodeIn = { kind: NodeKind; name: string; cik?: string; ticker?: string; attrs?: Record<string, unknown> };
export type LinkIn = { src: number; dst: number; kind: string; weight?: number; attrs?: Record<string, unknown>; sourceName?: string; sourceUrl?: string; asOf?: string | null; ended?: string | null };
export type NodeRow = typeof schema.edgeNodes.$inferSelect;
export type LinkRow = typeof schema.edgeLinks.$inferSelect;

export const nodeKey = (n: { kind: string; cik?: string; name: string }) => (n.cik ? `${n.kind}:cik:${n.cik.replace(/^0+/, "")}` : `${n.kind}:n:${normName(n.name)}`);

/**
 * Insert or refresh nodes; returns each one's id by nodeKey. Attributes merge (new values win). Only the
 * company's own filings rename it (`rename`); a name seen elsewhere (an old name in a merger filing)
 * never overwrites the current one.
 */
export async function upsertNodes(nodes: NodeIn[], opts: { rename?: boolean } = {}): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = new Map<string, NodeIn>();
  for (const n of nodes) {
    const name = n.name.trim().slice(0, 300);
    if (!name || !normName(name)) continue;
    const k = nodeKey({ ...n, name });
    const prev = uniq.get(k);
    uniq.set(k, { ...prev, ...n, name, attrs: { ...(prev?.attrs ?? {}), ...(n.attrs ?? {}) }, ticker: n.ticker || prev?.ticker || "" });
  }
  const list = [...uniq.values()];
  const db = requireDb();
  for (let i = 0; i < list.length; i += 200) {
    const batch = list.slice(i, i + 200);
    for (const withCik of [true, false]) {
      const rows = batch.filter((n) => !!n.cik === withCik);
      if (!rows.length) continue;
      const values = sql.join(rows.map((n) => sql`(${n.kind}, ${n.name}, ${normName(n.name)}, ${(n.ticker ?? "").toUpperCase()}, ${(n.cik ?? "").replace(/^0+/, "")}, ${JSON.stringify(n.attrs ?? {})}::jsonb)`), sql`, `);
      const conflict = withCik ? sql`("kind", "cik") where "cik" <> ''` : sql`("kind", "norm") where "cik" = ''`;
      const res = await db.execute(sql`
        insert into edge_nodes (kind, name, norm, ticker, cik, attrs) values ${values}
        on conflict ${conflict} do update set
          name = ${opts.rename ? sql`excluded.name` : sql`edge_nodes.name`},
          ticker = case when excluded.ticker <> '' then excluded.ticker else edge_nodes.ticker end,
          attrs = edge_nodes.attrs || excluded.attrs,
          updated_at = now()
        returning id, kind, cik, name`);
      for (const r of res.rows as { id: number; kind: string; cik: string; name: string }[]) out.set(nodeKey({ kind: r.kind, cik: r.cik, name: r.name }), Number(r.id));
    }
  }
  return out;
}

/** Insert or refresh links (one per source, target and kind); attributes merge. */
export async function upsertLinks(links: LinkIn[]): Promise<number> {
  const uniq = new Map<string, LinkIn>();
  for (const l of links) if (l.src && l.dst && l.src !== l.dst) uniq.set(`${l.src}>${l.dst}>${l.kind}`, { ...uniq.get(`${l.src}>${l.dst}>${l.kind}`), ...l });
  const list = [...uniq.values()];
  const db = requireDb();
  for (let i = 0; i < list.length; i += 300) {
    const values = sql.join(list.slice(i, i + 300).map((l) => sql`(${l.src}, ${l.dst}, ${l.kind}, ${l.weight ?? 1}, ${JSON.stringify(l.attrs ?? {})}::jsonb, ${(l.sourceName ?? "").slice(0, 300)}, ${(l.sourceUrl ?? "").slice(0, 1000)}, ${l.asOf ?? null}::date, ${l.ended ?? null}::date)`), sql`, `);
    await db.execute(sql`
      insert into edge_links (src, dst, kind, weight, attrs, source_name, source_url, as_of, ended) values ${values}
      on conflict (src, dst, kind) do update set
        weight = excluded.weight,
        attrs = edge_links.attrs || excluded.attrs,
        source_name = case when excluded.source_name <> '' then excluded.source_name else edge_links.source_name end,
        source_url = case when excluded.source_url <> '' then excluded.source_url else edge_links.source_url end,
        as_of = least(coalesce(edge_links.as_of, excluded.as_of), coalesce(excluded.as_of, edge_links.as_of)),
        ended = excluded.ended,
        updated_at = now()`);
  }
  return list.length;
}

export async function companyByTicker(ticker: string): Promise<NodeRow | null> {
  const [n] = await requireDb().select().from(schema.edgeNodes).where(and(eq(schema.edgeNodes.kind, "company"), eq(schema.edgeNodes.ticker, ticker.toUpperCase()))).limit(1);
  return n ?? null;
}

export async function companyByCik(cik: string): Promise<NodeRow | null> {
  const [n] = await requireDb().select().from(schema.edgeNodes).where(and(eq(schema.edgeNodes.kind, "company"), eq(schema.edgeNodes.cik, cik.replace(/^0+/, "")))).limit(1);
  return n ?? null;
}

export async function nodesById(ids: number[]): Promise<Map<number, NodeRow>> {
  if (!ids.length) return new Map();
  const rows = await requireDb().select().from(schema.edgeNodes).where(inArray(schema.edgeNodes.id, [...new Set(ids)].slice(0, 5000)));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Every link touching these nodes (optionally of some kinds), current or ended. */
export async function linksOf(ids: number[], kinds?: string[]): Promise<LinkRow[]> {
  if (!ids.length) return [];
  const touch = or(inArray(schema.edgeLinks.src, ids), inArray(schema.edgeLinks.dst, ids));
  return requireDb().select().from(schema.edgeLinks).where(kinds?.length ? and(touch, inArray(schema.edgeLinks.kind, kinds)) : touch).limit(20_000);
}

/** Merge into a node's attributes (a watermark, the latest facts). */
export async function setNodeAttrs(id: number, attrs: Record<string, unknown>) {
  await requireDb().execute(sql`update edge_nodes set attrs = attrs || ${JSON.stringify(attrs)}::jsonb, updated_at = now() where id = ${id}`);
}

/** How big the graph is (for the status line and the storage meter). */
export async function graphSize(): Promise<{ nodes: number; links: number; companies: number }> {
  const [r] = (await requireDb().execute(sql`select (select count(*) from edge_nodes)::int as nodes, (select count(*) from edge_links)::int as links, (select count(*) from edge_nodes where kind = 'company')::int as companies`)).rows as { nodes: number; links: number; companies: number }[];
  return r;
}

let listed: Promise<Map<string, { ticker: string; name: string }>> | null = null;
/** Listed companies by CIK (without leading zeros), from SEC's ticker file. */
export function listedByCik(): Promise<Map<string, { ticker: string; name: string }>> {
  listed ??= tickerMap().then((m) => { const out = new Map<string, { ticker: string; name: string }>(); for (const r of m.values()) { const c = r.cik.replace(/^0+/, ""); if (!out.has(c)) out.set(c, { ticker: r.ticker, name: r.name }); } return out; });
  listed.catch(() => { listed = null; });
  return listed;
}
