/**
 * What Networks finds for a company, read from the graph: its likely buyers and targets (from the deal
 * model, each explained by the paths that connect the two and by what they share on the ground), who a
 * shock to it would reach, red flags, who ultimately owns it, the warm introductions a person could ask
 * for, its ownership tree, and the neighbourhood to draw. Every step names the filing it came from.
 */
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheGet, cacheJson, cacheSet } from "@/lib/cache";
import { myTeamIds } from "@/lib/teams/db";
import { eventFlags, exposure, insiderFlags, integratedOwnership, loopThrough, ownershipRings, reasonPaths, section8Flag, section8Screen, servedTogether, strongestChain, type Flag, type GLink, type Section8Company } from "./algo";
import { sameGroup } from "./deals";
import { normName, xmlText, type Form4Tx } from "./parse";
import { companyByTicker, nodesById, type LinkRow, type NodeRow } from "./store";
import { latestModels, predictionsFor, scorecardText, withBaselines, type ModelMetrics } from "./train";

export type GNode = { id: number; kind: string; name: string; ticker: string; lon?: number; lat?: number; sub?: string; /** Influence, 0 to 1 (PageRank scaled by the most influential). */ rank?: number };
export type GEdge = { id: number; s: number; d: number; kind: string; w: number; asOf: string | null; ended: string | null; source: string; url: string; label: string };
export type Step = { text: string; url: string; asOf: string | null };

const HUB = 150;

/** An officer's title as filed on Form 4, readable: entities decoded, and "See Remarks" (the title is elsewhere) dropped. Pure. */
export function officerTitle(raw: unknown): string {
  const t = xmlText(typeof raw === "string" ? raw : "").replace(/\s+/g, " ").trim();
  return /^see\b.*\bremarks?\b/i.test(t) ? "" : t;
}

/** A sentence that ends in a name: no second full stop after "Corp.". Pure. */
export const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** One link in words, the way a reason path reads. Pure. */
export function linkSentence(kind: string, a: string, b: string, attrs: Record<string, unknown> = {}): string {
  const year = (d: unknown) => (typeof d === "string" && d ? ` (${d.slice(0, 4)})` : "");
  switch (kind) {
    case "director": return `${a} is a director of ${b}`;
    case "officer": return `${a} is ${officerTitle(attrs.title) || "an officer"} of ${b}`;
    case "insider": return `${a} is an insider of ${b}`;
    case "holder": return `${a} owns ${typeof attrs.percent === "number" ? `${attrs.percent}%` : "a stake"} of ${b}`;
    case "subsidiary": return `${a} lists ${b} as a subsidiary`;
    case "supplies": return typeof attrs.share === "number" ? `${b} is a customer of ${a} (${attrs.share}% of ${attrs.role === "supplier" ? "its purchases" : "revenue"})` : `${a} supplies ${b}`;
    case "acquired": return `${a} ${attrs.status === "terminated" ? "tried to acquire" : "acquired"} ${b}${year(attrs.asOf ?? attrs.filed)}`;
    case "bought_assets": return `${a} bought ${attrs.what ? String(attrs.what) : "assets"} from ${b}`;
    case "advised": return `${a} advised ${b}${attrs.role ? ` (${attrs.role})` : ""}`;
    default: return `${a} is linked to ${b} (${kind})`;
  }
}

const edgeOf = (l: LinkRow, names: Map<number, NodeRow>): GEdge => ({
  id: l.id, s: l.src, d: l.dst, kind: l.kind, w: l.weight, asOf: l.asOf, ended: l.ended, source: l.sourceName, url: l.sourceUrl,
  label: linkSentence(l.kind, names.get(l.src)?.name ?? "?", names.get(l.dst)?.name ?? "?", { ...(l.attrs as Record<string, unknown>), asOf: l.asOf }),
});

const nodeOf = (n: NodeRow): GNode => {
  const a = n.attrs as { lon?: number; lat?: number; sicDescription?: string; jurisdiction?: string; title?: string };
  return { id: n.id, kind: n.kind, name: n.name, ticker: n.ticker, ...(typeof a.lon === "number" ? { lon: a.lon, lat: a.lat } : {}), sub: a.sicDescription ?? a.jurisdiction ?? "" };
};

async function degrees(ids: number[]): Promise<Map<number, number>> {
  if (!ids.length) return new Map();
  const list = sql.join(ids.map((i) => sql`${i}`), sql`, `);
  const rows = (await requireDb().execute(sql`select n, count(*)::int as c from (select src as n from edge_links where src in (${list}) union all select dst from edge_links where dst in (${list})) x group by n`)).rows as { n: number; c: number }[];
  return new Map(rows.map((r) => [Number(r.n), Number(r.c)]));
}

async function linksTouching(ids: number[], kinds?: string[], limit = 6000): Promise<LinkRow[]> {
  if (!ids.length) return [];
  const touch = or(inArray(schema.edgeLinks.src, ids), inArray(schema.edgeLinks.dst, ids));
  return requireDb().select().from(schema.edgeLinks).where(kinds?.length ? and(touch, inArray(schema.edgeLinks.kind, kinds)) : touch).limit(limit);
}

/** Links within two hops of some nodes, never expanding through hubs (an index fund, a 400-subsidiary parent). */
export async function neighborhood(seed: number[], opts: { kinds?: string[]; hub?: number } = {}): Promise<LinkRow[]> {
  const first = await linksTouching(seed, opts.kinds);
  const next = [...new Set(first.flatMap((l) => [l.src, l.dst]))].filter((n) => !seed.includes(n));
  const deg = await degrees(next);
  const open = next.filter((n) => (deg.get(n) ?? 0) <= (opts.hub ?? HUB) && (deg.get(n) ?? 0) > 1);
  const second = await linksTouching(open.slice(0, 1500), opts.kinds);
  const seen = new Set<number>();
  return [...first, ...second].filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));
}

/**
 * What a company shares on the ground with each of some others: pairs of their processing plants within
 * 25 km of each other (Earth's public maps), by the other's ticker, in one query for all of them.
 */
async function plantsNear(a: string, others: string[]): Promise<Map<string, number>> {
  const bs = [...new Set(others.filter(Boolean))];
  if (!a || !bs.length) return new Map();
  const rows = (await requireDb().execute(sql`select y.ticker, count(*)::int as n from edge_assets x join edge_assets y on x.ticker = ${a} and y.ticker in (${sql.join(bs.map((b) => sql`${b}`), sql`, `)}) and x.kind = 'processing_plant' and y.kind = 'processing_plant' and x.owner_id is null and y.owner_id is null and ST_DWithin(x.geom::geography, y.geom::geography, 25000) group by y.ticker`)).rows as { ticker: string; n: number }[];
  return new Map(rows.map((r) => [r.ticker, Number(r.n)]));
}

export type Prediction = { node: GNode; score: number; rank: number; paths: Step[][]; pathNodes: number[][]; also: string[] };

/** A company's likely buyers or targets from the latest model, each with up to three reason paths. */
export async function predictions(subject: NodeRow, kind: "acquirer" | "target", limit = 8): Promise<{ items: Prediction[]; scorecard: string; version: string | null; trainedAt: string | null; metrics: ModelMetrics | null; graph: { nodes: GNode[]; links: GEdge[] } }> {
  const [model] = await latestModels();
  if (!model) return { items: [], scorecard: "The deal model has not been trained yet.", version: null, trainedAt: null, metrics: null, graph: { nodes: [], links: [] } };
  const key = `edge:graph:pred:v2:${model.id}:${subject.id}:${kind}:${limit}`;
  const hit = await cacheGet(key);
  if (hit) return JSON.parse(hit);
  // The scorecard with the baselines scored on the model's split (train.ts).
  const [metrics, rows] = await Promise.all([withBaselines(model), predictionsFor(model.id, subject.id, kind, limit)]);
  const ids = [subject.id, ...rows.map((r) => r.candidate)];
  const [names, links] = await Promise.all([nodesById(ids), neighborhood(ids, { kinds: ["director", "officer", "holder", "subsidiary", "supplies", "acquired", "bought_assets", "advised"] })]);
  const [allNames, plants] = await Promise.all([nodesById([...new Set(links.flatMap((l) => [l.src, l.dst]))]), plantsNear(subject.ticker, rows.map((r) => names.get(r.candidate)?.ticker ?? ""))]);
  for (const [k, v] of names) allNames.set(k, v);
  const byId = new Map(links.map((l) => [l.id, l]));
  // Index funds hold everyone: a passive stake (13G, under 20%) connects companies without explaining anything.
  const glinks: GLink[] = links.filter((l) => !l.ended && (l.kind !== "holder" || (l.attrs as { activist?: boolean }).activist || l.weight >= 0.2)).map((l) => ({ id: l.id, s: l.src, d: l.dst, kind: l.kind, w: l.weight }));
  const items: Prediction[] = [];
  const drawn = new Set<number>();
  for (const r of rows) {
    const cand = names.get(r.candidate);
    if (!cand) continue;
    const found = reasonPaths(glinks, subject.id, r.candidate, { maxHops: 3, k: 3 });
    found.forEach((p) => p.links.forEach((id) => drawn.add(id)));
    const paths = found.map((p) => p.links.map((id) => {
      const l = byId.get(id)!;
      return { text: linkSentence(l.kind, allNames.get(l.src)?.name ?? "?", allNames.get(l.dst)?.name ?? "?", { ...(l.attrs as Record<string, unknown>), asOf: l.asOf }), url: l.sourceUrl, asOf: l.asOf };
    }));
    const also: string[] = [];
    const sa = subject.attrs as { sic?: string; state?: string; revenue?: number }, ca = cand.attrs as { sic?: string; state?: string; revenue?: number; sicDescription?: string };
    if (sa.sic && sa.sic === ca.sic) also.push(`Same industry (${ca.sicDescription ?? `SIC ${ca.sic}`})`);
    if (sa.state && sa.state === ca.state) also.push(`Both headquartered in ${ca.state}`);
    const [buyer, target] = kind === "acquirer" ? [ca, sa] : [sa, ca];
    if (buyer.revenue && target.revenue && buyer.revenue > target.revenue * 1.5) also.push(`The buyer's revenue is ${Math.round(buyer.revenue / target.revenue)}× the target's`);
    const near = plants.get(cand.ticker) ?? 0;
    if (near) also.push(`${near} pairs of their processing plants sit within 25 km of each other (Earth maps)`);
    items.push({ node: nodeOf(cand), score: Math.round(r.score * 1000) / 1000, rank: r.rank, paths, pathNodes: found.map((p) => p.nodes), also });
  }
  // The paths as a small graph the view can draw alongside the neighbourhood.
  const pathLinks = [...drawn].map((id) => byId.get(id)!).filter(Boolean);
  const graph = { nodes: [...new Set([subject.id, ...rows.map((r) => r.candidate), ...pathLinks.flatMap((l) => [l.src, l.dst])])].map((id) => allNames.get(id)).filter((n): n is NodeRow => !!n).map(nodeOf), links: pathLinks.map((l) => edgeOf(l, allNames)) };
  const out = { items, scorecard: scorecardText(metrics, kind === "acquirer" ? "acquirers" : "targets"), version: model.version, trainedAt: model.trainedAt.toISOString(), metrics, graph };
  // A day, or an hour while the baselines could not be scored, so they join the scorecard soon after.
  await cacheSet(key, JSON.stringify(out), metrics.fair || !metrics.gnn ? 86_400_000 : 3_600_000);
  return out;
}

export type RingLink = { s: number; d: number; kind: string; percent: number | null; url: string; asOf: string | null };
export type Ring = { members: number[]; names: Record<number, string>; links: RingLink[] };

/**
 * Every ownership ring in the graph, from the live stakes and subsidiary listings: read whole, since a
 * ring can be any length, but only the links that could sit on a loop (whose owner is itself owned and
 * whose holding itself owns something), then strongly connected components (algo.ts).
 */
export async function computeRings(): Promise<Ring[]> {
  const db = requireDb();
  const rows = (await db.execute(sql`select l.id, l.src, l.dst from edge_links l where l.kind in ('holder', 'subsidiary') and l.ended is null and l.src <> l.dst
    and exists (select 1 from edge_links i where i.dst = l.src and i.kind in ('holder', 'subsidiary') and i.ended is null)
    and exists (select 1 from edge_links o where o.src = l.dst and o.kind in ('holder', 'subsidiary') and o.ended is null)
    order by l.id`)).rows as { id: number; src: number; dst: number }[];
  const rings = ownershipRings(rows.map((r) => ({ id: Number(r.id), s: Number(r.src), d: Number(r.dst) })));
  if (!rings.length) return [];
  const list = (ids: number[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);
  const [detail, names] = await Promise.all([
    db.execute(sql`select id, kind, (attrs->>'percent')::float8 as percent, source_url, as_of::text as as_of from edge_links where id in (${list(rings.flatMap((r) => r.links.map((l) => l.id)))})`),
    db.execute(sql`select id, name from edge_nodes where id in (${list(rings.flatMap((r) => r.members))})`),
  ]);
  const byId = new Map((detail.rows as { id: number; kind: string; percent: number | null; source_url: string; as_of: string | null }[]).map((r) => [Number(r.id), r]));
  const nameOf = new Map((names.rows as { id: number; name: string }[]).map((r) => [Number(r.id), r.name]));
  return rings.map((r) => ({
    members: r.members, names: Object.fromEntries(r.members.map((m) => [m, nameOf.get(m) ?? "?"])),
    links: r.links.map((l) => { const x = byId.get(l.id); return { s: l.s, d: l.d, kind: x?.kind ?? "holder", percent: x?.percent === null || x?.percent === undefined ? null : Number(x.percent), url: x?.source_url ?? "", asOf: x?.as_of ?? null }; }),
  }));
}

/** The day's ownership rings (found on first use, then shared). */
export const ownershipRingsToday = () => cacheJson(`edge:graph:rings:v1:${new Date().toISOString().slice(0, 10)}`, 86_400_000, computeRings);

/**
 * The red flag for a company inside an ownership ring, once per ring: the shortest loop through it with
 * the stake or listing at each step, then the ring's other members. Dated when the loop's latest link
 * was filed, so the feed posts it once. Pure.
 */
export function ringFlag(ring: Ring, nodeId: number, now: string): Flag {
  const name = (id: number) => ring.names[id] ?? "?";
  const loop = loopThrough(ring.links, nodeId);
  const step = (l: RingLink) => (l.kind !== "holder" ? `${name(l.s)} lists ${name(l.d)} as a subsidiary` : l.percent !== null ? `${name(l.s)} owns ${Math.round(l.percent * 10) / 10}% of ${name(l.d)}` : `${name(l.s)} holds a stake in ${name(l.d)}`);
  const onLoop = new Set(loop.map((l) => l.s));
  const rest = ring.members.filter((m) => !onLoop.has(m));
  return {
    kind: "circular_ownership", severity: "medium", title: `Ownership loops back on itself${loop.length ? ` in ${loop.length} steps` : ""}`,
    detail: `${sentence(loop.map(step).join("; "))}${rest.length ? ` The ring holds ${ring.members.length} owners in all, with ${ring.links.length} stakes and subsidiary listings among them; the others are ${sentence(`${rest.slice(0, 6).map(name).join(", ")}${rest.length > 6 ? ` and ${rest.length - 6} more` : ""}`)}` : ""}`,
    date: loop.map((l) => l.asOf).filter((d): d is string => !!d).sort().pop() ?? now,
    urls: [...new Set(loop.map((l) => l.url).filter((u) => /^https?:/.test(u)))].slice(0, 3),
  };
}

type SizeAttrs = { sic?: string; sicDescription?: string; equity?: number | null; revenue?: number | null };
const section8Of = (n: NodeRow): Section8Company => { const a = n.attrs as SizeAttrs; return { name: n.name, sic: a.sic, industry: a.sicDescription, equity: a.equity, revenue: a.revenue }; };

/**
 * Red flags: filings, insider selling, an ownership ring it belongs to, directors shared with companies it
 * trades with, and a section 8 screen of the directors and officers it shares with competitors. A shared
 * seat counts only where the Form 4s show both held at once and recently (algo.ts), and is dated when the
 * later of the two began, so the feed posts each once.
 */
export async function redFlags(node: NodeRow): Promise<Flag[]> {
  const now = new Date().toISOString().slice(0, 10);
  const flags: Flag[] = eventFlags(((node.attrs as { events?: { date: string; items: string[]; url: string }[] }).events ?? []), now);
  // Its insiders, and the day's ownership rings (a ring can run through the whole graph), read side by side.
  const [inbound, rings] = await Promise.all([linksTouching([node.id], ["director", "officer", "holder", "insider"]), ownershipRingsToday().catch(() => [] as Ring[])]);
  const people = await nodesById(inbound.map((l) => l.src));
  flags.push(...insiderFlags(inbound.filter((l) => l.dst === node.id).map((l) => {
    const a = l.attrs as { title?: string; txns?: (Form4Tx & { url?: string })[] };
    return { name: people.get(l.src)?.name ?? "An insider", title: a.title || (l.kind === "director" ? "Director" : l.kind), txns: a.txns ?? [] };
  }), now));
  const ring = rings.find((r) => r.members.includes(node.id));
  if (ring) flags.push(ringFlag(ring, node.id, now));
  // Where its directors and officers also serve.
  const seatsHere = inbound.filter((l) => l.dst === node.id && !l.ended && (l.kind === "director" || l.kind === "officer"));
  const ids = [...new Set(seatsHere.map((l) => l.src))];
  const elsewhere = ids.length ? await requireDb().select({ src: schema.edgeLinks.src, dst: schema.edgeLinks.dst, kind: schema.edgeLinks.kind, asOf: schema.edgeLinks.asOf, sourceUrl: schema.edgeLinks.sourceUrl, title: sql<string | null>`${schema.edgeLinks.attrs}->>'title'`, last: sql<string | null>`${schema.edgeLinks.attrs}->>'lastFiled'` })
    .from(schema.edgeLinks).where(and(inArray(schema.edgeLinks.src, ids), inArray(schema.edgeLinks.kind, ["director", "officer"]), isNull(schema.edgeLinks.ended), ne(schema.edgeLinks.dst, node.id))) : [];
  const others = [...new Set(elsewhere.map((s) => s.dst))];
  if (others.length) {
    const [business, who] = await Promise.all([
      requireDb().select().from(schema.edgeLinks).where(and(or(and(eq(schema.edgeLinks.src, node.id), inArray(schema.edgeLinks.dst, others)), and(inArray(schema.edgeLinks.src, others), eq(schema.edgeLinks.dst, node.id))), inArray(schema.edgeLinks.kind, ["supplies", "acquired", "bought_assets", "holder", "subsidiary"]))),
      nodesById(others),
    ]);
    type Seat = { kind: string; asOf: string | null; sourceUrl: string; title: string | null; last: string | null };
    // A person's seats at one company, as the span of their Form 4s there.
    const span = (seats: Seat[]) => ({ first: seats.map((x) => x.asOf).filter((d): d is string => !!d).sort()[0] ?? null, last: seats.map((x) => x.last ?? x.asOf).filter((d): d is string => !!d).sort().pop() ?? null });
    const role = (seats: Seat[]) => { const t = seats.map((s) => officerTitle(s.title)).find(Boolean); return seats.some((s) => s.kind === "director") ? "a director" : `an officer${t ? ` (${t})` : ""}`; };
    const lead = (seats: Seat[]) => seats.find((s) => s.kind === "director") ?? seats[0];
    const shared: Flag[] = [];
    for (const person of ids) {
      const mine = seatsHere.filter((l) => l.src === person).map((l) => ({ kind: l.kind, asOf: l.asOf, sourceUrl: l.sourceUrl, title: (l.attrs as { title?: string }).title || null, last: (l.attrs as { lastFiled?: string }).lastFiled || null }));
      for (const other of [...new Set(elsewhere.filter((s) => s.src === person).map((s) => s.dst))]) {
        const co = who.get(other), theirs = elsewhere.filter((s) => s.src === person && s.dst === other);
        if (!co || !servedTogether(span(mine), span(theirs), now)) continue;
        const name = people.get(person)?.name ?? "A director";
        const since = [lead(mine).asOf, lead(theirs).asOf].filter((d): d is string => !!d).sort().pop() ?? now;
        const ties = business.filter((b) => b.src === other || b.dst === other);
        // Section 8 is about competitors, and a related-party concern about arm's-length business: a parent and its
        // subsidiary, a large holder and its holding, or one group's companies are neither.
        const affiliated = ties.some((b) => b.kind === "subsidiary" || (b.kind === "holder" && b.weight >= 0.5)) || sameGroup(node.name, co.name);
        const trade = affiliated ? undefined : ties.find((b) => b.kind !== "subsidiary");
        const hit = co.kind === "company" && !affiliated ? section8Screen(section8Of(node), section8Of(co)) : null;
        const pair = `${person}:${other}`;
        if (hit) shared.push({ ...section8Flag(name, { name: node.name, role: role(mine), url: lead(mine).sourceUrl, since: lead(mine).asOf }, { name: co.name, role: role(theirs), url: lead(theirs).sourceUrl, since: lead(theirs).asOf }, hit, now), key: pair });
        // A director on both boards is a concern when the other company is also a customer, supplier or deal counterparty.
        if (!mine.some((s) => s.kind === "director") || !theirs.some((s) => s.kind === "director") || (hit && !trade)) continue;
        shared.push({
          kind: trade ? "related_party" : "shared_director", severity: trade ? "high" : "medium",
          title: trade ? `A director sits on both sides of a business relationship` : `A director also sits on ${co.name}`,
          detail: sentence(`${name} is a director of ${node.name} and of ${co.name}${trade ? `, and ${linkSentence(trade.kind, trade.src === node.id ? node.name : co.name, trade.dst === node.id ? node.name : co.name, trade.attrs as Record<string, unknown>)}` : ""}`),
          date: trade?.asOf && trade.asOf > since ? trade.asOf : since, people: [name], urls: [trade?.sourceUrl ?? ""].filter(Boolean), key: pair,
        });
      }
    }
    const rank = { related_party: 0, interlocking_directorate: 1 } as Record<string, number>;
    flags.push(...shared.sort((a, b) => (rank[a.kind] ?? 2) - (rank[b.kind] ?? 2) || b.date.localeCompare(a.date)).slice(0, 8));
  }
  const order = { high: 0, medium: 1 };
  return flags.sort((a, b) => order[a.severity] - order[b.severity] || b.date.localeCompare(a.date));
}

/** Who a shock to this company reaches, through dependence: customers and suppliers by share, stakes by size, subsidiaries. */
export async function exposureOf(node: NodeRow, limit = 12): Promise<{ node: GNode; score: number; via: Step[] }[]> {
  // Dependence travels through operations: customers and suppliers, joint ventures, and controlling or
  // strategic stakes (13D filings or 20% and more). Passive index holdings (13G) do not carry a shock.
  const all = (await neighborhood([node.id], { kinds: ["supplies", "holder", "subsidiary"], hub: 400 })).filter((l) => !l.ended);
  const links = all.filter((l) => l.kind !== "holder" || (l.attrs as { activist?: boolean }).activist || l.weight >= 0.2);
  const w = (l: LinkRow) => (l.kind === "supplies" ? Math.max(0.05, l.weight) : l.kind === "holder" ? Math.max(0.05, l.weight) : 0.5);
  const rank = exposure(links.map((l) => ({ s: l.src, d: l.dst, w: w(l) })), node.id);
  const names = await nodesById([...rank.keys(), node.id]);
  const byId = new Map(links.map((l) => [l.id, l]));
  const glinks: GLink[] = links.map((l) => ({ id: l.id, s: l.src, d: l.dst, kind: l.kind, w: w(l) }));
  const ranked = [...rank.entries()].filter(([id]) => names.get(id)?.kind === "company").sort((a, b) => b[1] - a[1]).slice(0, limit);
  const top = ranked[0]?.[1] || 1;
  return ranked.map(([id, raw]) => {
    const score = raw / top;
    const p = reasonPaths(glinks, node.id, id, { maxHops: 3, k: 1, hubDegree: 400 })[0];
    return { node: nodeOf(names.get(id)!), score: Math.round(score * 1000) / 1000, via: (p?.links ?? []).map((lid) => { const l = byId.get(lid)!; return { text: linkSentence(l.kind, names.get(l.src)?.name ?? "?", names.get(l.dst)?.name ?? "?", l.attrs as Record<string, unknown>), url: l.sourceUrl, asOf: l.asOf }; }) };
  });
}

/** The neighbourhood to draw: the company's own links, then interlocks, co-holdings and deals one step out. */
export async function subgraph(node: NodeRow, max = 220): Promise<{ nodes: GNode[]; links: GEdge[] }> {
  const own = (await linksTouching([node.id])).filter((l) => !l.ended);
  // Most parents list hundreds of subsidiaries; draw the ones that matter (listed companies, joint ventures) and a few others.
  const subs = own.filter((l) => l.kind === "subsidiary" && l.src === node.id);
  const subIds = subs.map((l) => l.dst);
  const [subDeg, subNodes] = await Promise.all([degrees(subIds), nodesById(subIds)]);
  const keepSubs = new Set(subs.filter((l) => subNodes.get(l.dst)?.kind === "company" || (subDeg.get(l.dst) ?? 0) > 1).map((l) => l.id).concat(subs.slice(0, 12).map((l) => l.id)));
  const first = own.filter((l) => l.kind !== "subsidiary" || l.src !== node.id || keepSubs.has(l.id));
  const n1 = [...new Set(first.flatMap((l) => [l.src, l.dst]))].filter((n) => n !== node.id);
  const deg = await degrees(n1);
  const expand = n1.filter((n) => (deg.get(n) ?? 0) <= HUB);
  const second = (await linksTouching(expand, ["director", "holder", "acquired", "supplies", "subsidiary"], 3000)).filter((l) => !l.ended && l.kind !== "subsidiary");
  const names = await nodesById([...new Set([...first, ...second].flatMap((l) => [l.src, l.dst]))]);
  // Second-hop links only where they reach a company (an interlock, a co-holding, a deal).
  const hop2 = second.filter((l) => !first.some((f) => f.id === l.id) && [names.get(l.src)?.kind, names.get(l.dst)?.kind].includes("company"));
  const ids = new Set<number>([node.id, ...n1]);
  const links: LinkRow[] = [...first];
  for (const l of hop2) { if (ids.size >= max && !(ids.has(l.src) && ids.has(l.dst))) continue; ids.add(l.src); ids.add(l.dst); links.push(l); }
  return { nodes: [...ids].map((id) => names.get(id)).filter((n): n is NodeRow => !!n).map(nodeOf), links: links.filter((l) => ids.has(l.src) && ids.has(l.dst)).map((l) => edgeOf(l, names)) };
}

export type TreeNode = { node: GNode; relation: string; percent: number | null; url: string; children: TreeNode[] };

/** The ownership tree: who owns the company (5% holders, parents) and what it owns (subsidiaries, stakes), two levels down. */
export async function ownershipTree(node: NodeRow): Promise<{ root: GNode; up: TreeNode[]; down: TreeNode[] }> {
  const own = (await linksTouching([node.id], ["holder", "subsidiary"])).filter((l) => !l.ended);
  const downLinks = own.filter((l) => l.src === node.id), upLinks = own.filter((l) => l.dst === node.id);
  const kids = downLinks.map((l) => l.dst);
  const names = await nodesById([...kids, ...upLinks.map((l) => l.src)]);
  const companyKids = kids.filter((k) => names.get(k)?.kind === "company");
  const grand = (await linksTouching(companyKids, ["holder", "subsidiary"])).filter((l) => !l.ended && companyKids.includes(l.src));
  const gNames = await nodesById(grand.map((l) => l.dst));
  const pct = (l: LinkRow) => (typeof (l.attrs as { percent?: number }).percent === "number" ? (l.attrs as { percent: number }).percent : null);
  const leaf = (l: LinkRow, n: NodeRow | undefined, children: TreeNode[] = []): TreeNode | null => (n ? { node: nodeOf(n), relation: l.kind, percent: pct(l), url: l.sourceUrl, children } : null);
  // A company listed as a subsidiary and also held through a 13D stake is one child, with the stake's size.
  const byChild = new Map<number, LinkRow>();
  for (const l of downLinks) { const had = byChild.get(l.dst); if (!had || (pct(l) !== null && pct(had) === null)) byChild.set(l.dst, l); }
  const down = [...byChild.values()].map((l) => leaf(l, names.get(l.dst), grand.filter((g) => g.src === l.dst).slice(0, 25).map((g) => leaf(g, gNames.get(g.dst))).filter((x): x is TreeNode => !!x)))
    .filter((x): x is TreeNode => !!x)
    .sort((a, b) => Number(b.node.kind === "company") - Number(a.node.kind === "company") || (b.percent ?? 100) - (a.percent ?? 100) || a.node.name.localeCompare(b.node.name));
  const up = upLinks.map((l) => leaf(l, names.get(l.src))).filter((x): x is TreeNode => !!x).sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
  return { root: nodeOf(node), up, down };
}

export type Owner = { node: GNode; percent: number; direct: number | null; atLeast: boolean };
export type Owners = { owners: Owner[]; chain: Step[]; chainPercent: number | null; parents: GNode[] };

/**
 * A filed stake's share of the company: as stated, or where the filing gives no figure, the floor its form
 * implies (5% for Schedule 13D/13G, 10% for a Form 4 ten-percent owner). Pure.
 */
export function stakeShare(a: { percent?: number | null; tenPct?: boolean | null }): { share: number; floor: boolean } {
  if (typeof a.percent === "number" && Number.isFinite(a.percent)) return { share: Math.min(1, Math.max(0, a.percent / 100)), floor: false };
  return { share: a.tenPct ? 0.1 : 0.05, floor: true };
}

/** A share as a percentage: to a tenth of a point, or a hundredth below 1%. Pure. */
const pctOf = (share: number) => { const p = share * 100; return p >= 1 ? Math.round(p * 10) / 10 : Math.round(p * 100) / 100; };

/**
 * Who ultimately owns a company: integrated ownership (algo.ts) over the stakes filed up the chain from
 * it (Schedule 13D/13G holders, and Form 4 ten-percent owners, directors and officers among them), the
 * largest few with how much each holds directly, the strongest chain behind the largest, and the parents
 * that list it as a subsidiary (Exhibit 21 gives no share, so they are named apart).
 */
export async function ultimateOwners(node: NodeRow, limit = 5): Promise<Owners> {
  const db = requireDb();
  type Row = { src: number; dst: number; cik: string; src_kind: string; percent: number | null; ten: boolean; url: string; as_of: string | null };
  // Up the chain a level at a time: who holds it, who holds them, and so on.
  const walk = async () => {
    const rows: Row[] = [], seen = new Set<number>([node.id]);
    let frontier = [node.id];
    for (let depth = 0; depth < 8 && frontier.length && rows.length < 5000; depth++) {
      const got = (await db.execute(sql`select l.src, l.dst, n.cik, n.kind as src_kind, (l.attrs->>'percent')::float8 as percent, coalesce(l.attrs->>'tenPct', '') = 'true' as ten, l.source_url as url, l.as_of::text as as_of
        from edge_links l join edge_nodes n on n.id = l.src
        where l.dst in (${sql.join(frontier.map((i) => sql`${i}`), sql`, `)}) and l.ended is null and l.src <> l.dst and (l.kind = 'holder' or (l.kind in ('director', 'officer') and l.attrs->>'tenPct' = 'true'))`)).rows as Row[];
      rows.push(...got);
      frontier = [...new Set(got.map((r) => Number(r.src)))].filter((x) => !seen.has(x));
      frontier.forEach((x) => seen.add(x));
    }
    return rows;
  };
  // With the parents that list it in Exhibit 21.
  const [rows, parentRows] = await Promise.all([walk(), db.select({ src: schema.edgeLinks.src }).from(schema.edgeLinks).where(and(eq(schema.edgeLinks.dst, node.id), eq(schema.edgeLinks.kind, "subsidiary"), isNull(schema.edgeLinks.ended))).limit(20)]);
  // One stake per holder and company: a stated figure over a floor, else the larger. A holder is known by its CIK, because the
  // same filer can be two nodes (a fund from its Form 4s, a company from its 13D); the company node is the one shown.
  const best = new Map<string, { s: number; d: number; share: number; floor: boolean; url: string; asOf: string | null; company: boolean }>();
  for (const r of rows) {
    const { share, floor } = stakeShare({ percent: r.percent === null ? null : Number(r.percent), tenPct: r.ten });
    const k = `${r.cik || `node:${r.src}`}>${r.dst}`, had = best.get(k), company = r.src_kind === "company";
    const better = !had || (had.floor && !floor) || (had.floor === floor && (share > had.share || (share === had.share && company && !had.company)));
    if (share > 0 && better) best.set(k, { s: Number(r.src), d: Number(r.dst), share, floor, url: r.url, asOf: r.as_of, company });
  }
  const stakes = [...best.values()];
  const all = integratedOwnership(stakes, node.id), stated = integratedOwnership(stakes.filter((s) => !s.floor), node.id);
  const top = [...all.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit);
  const chain = top.length ? strongestChain(stakes, top[0][0], node.id) : [];
  const names = await nodesById([node.id, ...top.map(([id]) => id), ...chain.map((c) => c.s), ...parentRows.map((p) => p.src)]);
  const name = (id: number) => names.get(id)?.name ?? "?";
  const direct = new Map(stakes.filter((s) => s.d === node.id).map((s) => [s.s, s.share]));
  return {
    owners: top.filter(([id]) => names.has(id)).map(([id, v]) => ({ node: nodeOf(names.get(id)!), percent: pctOf(v), direct: direct.has(id) ? pctOf(direct.get(id)!) : null, atLeast: v - (stated.get(id) ?? 0) > 1e-6 })),
    chain: chain.map((c) => ({ text: c.floor ? `${name(c.s)} owns at least ${pctOf(c.share)}% of ${name(c.d)} (the filing gives no figure)` : `${name(c.s)} owns ${pctOf(c.share)}% of ${name(c.d)}`, url: c.url, asOf: c.asOf })),
    chainPercent: chain.length ? pctOf(chain.reduce((p, c) => p * c.share, 1)) : null,
    parents: parentRows.map((p) => names.get(p.src)).filter((n): n is NodeRow => !!n).map(nodeOf),
  };
}

export type Intro = { contact: { name: string; email: string; company: string; title: string; via: string; ownerId?: string }; steps: Step[]; hops: number; strength: number };

const personKey = (name: string) => { const w = normName(name).split(" ").filter((x) => x.length > 1); return w.length >= 2 ? `${w[0]} ${w[w.length - 1]}` : w.join(" "); };

/**
 * Warm introductions to a company: people the person (or, when they opted in, a teammate) knows who
 * sit on its board or run it, sit on a board with someone who does, or work at a company it does
 * business with. Contacts come from the CRM; the rest is the graph, cited.
 */
export async function warmIntros(userId: string, target: NodeRow, limit = 8): Promise<Intro[]> {
  const db = requireDb();
  const teams = await myTeamIds(userId);
  const mates = teams.length ? ((await db.execute(sql`select distinct m.user_id, coalesce(p.name, '') as name from team_members m join profiles p on p.user_id = m.user_id where m.team_id in (${sql.join(teams.map((t) => sql`${t}`), sql`, `)}) and m.user_id <> ${userId} and coalesce((p.extra->'edge'->>'poolContacts')::boolean, false)`)).rows as { user_id: string; name: string }[]) : [];
  const owners = [userId, ...mates.map((m) => m.user_id)];
  const contacts = await db.select().from(schema.crmContacts).where(and(inArray(schema.crmContacts.userId, owners), isNull(schema.crmContacts.optedOutAt))).limit(5000);
  if (!contacts.length) return [];
  const viaOf = (uid: string) => (uid === userId ? "your contact" : `${mates.find((m) => m.user_id === uid)?.name || "a teammate"}'s contact (pooled)`);
  // The target's people, and the companies and people one step from them.
  const around = (await neighborhood([target.id], { kinds: ["director", "officer", "supplies", "holder", "acquired", "bought_assets"] })).filter((l) => !l.ended);
  const names = await nodesById([...new Set(around.flatMap((l) => [l.src, l.dst]))]);
  const sentence = (l: LinkRow) => ({ text: linkSentence(l.kind, names.get(l.src)?.name ?? "?", names.get(l.dst)?.name ?? "?", l.attrs as Record<string, unknown>), url: l.sourceUrl, asOf: l.asOf });
  const peopleByKey = new Map<string, number[]>();
  for (const n of names.values()) if (n.kind === "person") { const k = personKey(n.name); peopleByKey.set(k, [...(peopleByKey.get(k) ?? []), n.id]); }
  const companyByNorm = new Map<string, number>();
  for (const n of names.values()) if (n.kind === "company") companyByNorm.set(n.norm, n.id);
  const out: Intro[] = [];
  for (const c of contacts) {
    const recency = c.lastSeenAt ? Math.exp(-(Date.now() - c.lastSeenAt.getTime()) / (365 * 86_400_000)) : 0.3;
    const base = { name: c.name || c.email, email: c.email, company: c.company, title: c.title, via: viaOf(c.userId), ownerId: c.userId };
    const known = { text: `${c.userId === userId ? "You know" : "Your teammate knows"} ${c.name || c.email}${c.company ? ` (${c.title ? `${c.title}, ` : ""}${c.company})` : ""}`, url: "", asOf: c.lastSeenAt ? c.lastSeenAt.toISOString().slice(0, 10) : null };
    // 1. The contact is one of the graph's people near the target.
    for (const pid of peopleByKey.get(personKey(c.name)) ?? []) {
      const direct = around.find((l) => l.src === pid && l.dst === target.id);
      if (direct) { out.push({ contact: base, steps: [known, sentence(direct)], hops: 1, strength: recency * 1.0 }); continue; }
      const seat = around.find((l) => l.src === pid && (l.kind === "director" || l.kind === "officer"));
      const shared = seat && around.find((l) => l.dst === target.id && (l.kind === "director" || l.kind === "officer") && around.some((m) => m.src === l.src && m.dst === seat.dst && m.kind === "director"));
      if (seat && shared) out.push({ contact: base, steps: [known, sentence(seat), sentence(around.find((m) => m.src === shared.src && m.dst === seat.dst && m.kind === "director")!), sentence(shared)], hops: 3, strength: recency * 0.6 });
    }
    // 2. The contact works at a company that does business with the target, or shares a director with it.
    const cid = c.company ? companyByNorm.get(normName(c.company)) : undefined;
    if (cid && cid !== target.id) {
      const biz = around.find((l) => (l.src === cid && l.dst === target.id) || (l.dst === cid && l.src === target.id));
      if (biz) out.push({ contact: base, steps: [known, sentence(biz)], hops: 2, strength: recency * 0.7 });
      const board = around.find((l) => l.kind === "director" && l.dst === cid && around.some((m) => m.src === l.src && m.dst === target.id && m.kind === "director"));
      if (board) out.push({ contact: base, steps: [known, sentence(board), sentence(around.find((m) => m.src === board.src && m.dst === target.id && m.kind === "director")!)], hops: 3, strength: recency * 0.5 });
    } else if (cid === target.id) out.push({ contact: base, steps: [known, { text: `${c.name || c.email} works at ${target.name}`, url: "", asOf: null }], hops: 1, strength: recency * 0.9 });
  }
  const seen = new Set<string>();
  return out.sort((a, b) => a.hops - b.hops || b.strength - a.strength).filter((i) => { const k = `${i.contact.email}|${i.steps.map((s) => s.text).join("|")}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
}

const DEALS = ["acquired", "bought_assets"];
export type LinkTally = { kind: string; dir: "in" | "out"; live: number; n: number };

/** The header's counts from a company's links tallied by kind and direction: current links, and every deal (current or ended, either way round). Pure. */
export function linkCounts(rows: LinkTally[]) {
  const count = (kind: string, dir: "in" | "out") => Number(rows.find((r) => r.kind === kind && r.dir === dir)?.live ?? 0);
  return { directors: count("director", "in"), officers: count("officer", "in"), holders: count("holder", "in"), stakes: count("holder", "out"), subsidiaries: count("subsidiary", "out"), customers: count("supplies", "out"), suppliers: count("supplies", "in"), deals: rows.filter((r) => DEALS.includes(r.kind)).reduce((s, r) => s + Number(r.n), 0) };
}

/** A company's graph summary for the header: counts by kind of link and its recorded deals. */
export async function overview(node: NodeRow) {
  // Counted in SQL by kind and direction (a parent can have hundreds of links); only the 20 latest deals are read.
  const touch = or(eq(schema.edgeLinks.src, node.id), eq(schema.edgeLinks.dst, node.id));
  const [tally, dealLinks] = await Promise.all([
    requireDb().execute(sql`select kind, case when src = ${node.id} then 'out' else 'in' end as dir, (count(*) filter (where ended is null))::int as live, count(*)::int as n from edge_links where src = ${node.id} or dst = ${node.id} group by 1, 2`),
    requireDb().select().from(schema.edgeLinks).where(and(touch, inArray(schema.edgeLinks.kind, DEALS))).orderBy(sql`${schema.edgeLinks.asOf} desc nulls last`, schema.edgeLinks.id).limit(20),
  ]);
  const names = await nodesById(dealLinks.flatMap((l) => [l.src, l.dst]));
  const a = node.attrs as { sicDescription?: string; city?: string; state?: string; revenue?: number | null; assets?: number | null; seen?: Record<string, string> };
  return {
    node: nodeOf(node), industry: a.sicDescription ?? "", place: [a.city, a.state].filter(Boolean).join(", "), revenue: a.revenue ?? null, assets: a.assets ?? null,
    counts: linkCounts(tally.rows as LinkTally[]),
    deals: dealLinks.map((l) => edgeOf(l, names)), refreshed: a.seen ?? {},
  };
}

export { companyByTicker };
