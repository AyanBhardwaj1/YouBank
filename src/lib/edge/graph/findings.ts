/**
 * What Networks finds for a company, read from the graph: its likely buyers and targets (from the deal
 * model, each explained by the paths that connect the two and by what they share on the ground), who a
 * shock to it would reach, red flags, the warm introductions a person could ask for, its ownership tree,
 * and the neighbourhood to draw. Every step names the filing it came from.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheGet, cacheSet } from "@/lib/cache";
import { myTeamIds } from "@/lib/teams/db";
import { eventFlags, exposure, insiderFlags, interlocks, ownershipCycles, reasonPaths, type Flag, type GLink } from "./algo";
import { normName, type Form4Tx } from "./parse";
import { companyByTicker, nodesById, type LinkRow, type NodeRow } from "./store";
import { latestModels, predictionsFor, scorecardText, type ModelMetrics } from "./train";

export type GNode = { id: number; kind: string; name: string; ticker: string; lon?: number; lat?: number; sub?: string };
export type GEdge = { id: number; s: number; d: number; kind: string; w: number; asOf: string | null; ended: string | null; source: string; url: string; label: string };
export type Step = { text: string; url: string; asOf: string | null };

const HUB = 150;

/** One link in words, the way a reason path reads. Pure. */
export function linkSentence(kind: string, a: string, b: string, attrs: Record<string, unknown> = {}): string {
  const year = (d: unknown) => (typeof d === "string" && d ? ` (${d.slice(0, 4)})` : "");
  switch (kind) {
    case "director": return `${a} is a director of ${b}`;
    case "officer": return `${a} is ${attrs.title ? String(attrs.title) : "an officer"} of ${b}`;
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

/** What two companies share on the ground: processing plants within 25 km of each other (Earth's maps). */
async function plantsNear(a: string, b: string): Promise<number> {
  if (!a || !b) return 0;
  const [r] = (await requireDb().execute(sql`select count(*)::int as n from edge_assets x join edge_assets y on x.ticker = ${a} and y.ticker = ${b} and x.kind = 'processing_plant' and y.kind = 'processing_plant' and ST_DWithin(x.geom::geography, y.geom::geography, 25000)`)).rows as { n: number }[];
  return r?.n ?? 0;
}

export type Prediction = { node: GNode; score: number; rank: number; paths: Step[][]; pathNodes: number[][]; also: string[] };

/** A company's likely buyers or targets from the latest model, each with up to three reason paths. */
export async function predictions(subject: NodeRow, kind: "acquirer" | "target", limit = 8): Promise<{ items: Prediction[]; scorecard: string; version: string | null; trainedAt: string | null; metrics: ModelMetrics | null; graph: { nodes: GNode[]; links: GEdge[] } }> {
  const [model] = await latestModels();
  if (!model) return { items: [], scorecard: "The deal model has not been trained yet.", version: null, trainedAt: null, metrics: null, graph: { nodes: [], links: [] } };
  const metrics = model.metrics as ModelMetrics;
  const key = `edge:graph:pred:${model.id}:${subject.id}:${kind}:${limit}`;
  const hit = await cacheGet(key);
  if (hit) return JSON.parse(hit);
  const rows = await predictionsFor(model.id, subject.id, kind, limit);
  const names = await nodesById([subject.id, ...rows.map((r) => r.candidate)]);
  const links = await neighborhood([subject.id, ...rows.map((r) => r.candidate)], { kinds: ["director", "officer", "holder", "subsidiary", "supplies", "acquired", "bought_assets", "advised"] });
  const allNames = await nodesById([...new Set(links.flatMap((l) => [l.src, l.dst]))]);
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
    const near = await plantsNear(subject.ticker, cand.ticker);
    if (near) also.push(`${near} pairs of their processing plants sit within 25 km of each other (Earth maps)`);
    items.push({ node: nodeOf(cand), score: Math.round(r.score * 1000) / 1000, rank: r.rank, paths, pathNodes: found.map((p) => p.nodes), also });
  }
  // The paths as a small graph the view can draw alongside the neighbourhood.
  const pathLinks = [...drawn].map((id) => byId.get(id)!).filter(Boolean);
  const graph = { nodes: [...new Set([subject.id, ...rows.map((r) => r.candidate), ...pathLinks.flatMap((l) => [l.src, l.dst])])].map((id) => allNames.get(id)).filter((n): n is NodeRow => !!n).map(nodeOf), links: pathLinks.map((l) => edgeOf(l, allNames)) };
  const out = { items, scorecard: scorecardText(metrics, kind === "acquirer" ? "acquirers" : "targets"), version: model.version, trainedAt: model.trainedAt.toISOString(), metrics, graph };
  await cacheSet(key, JSON.stringify(out), 86_400_000);
  return out;
}

/** Red flags: filings, insider selling, ownership that loops, and directors shared with companies it trades with. */
export async function redFlags(node: NodeRow): Promise<Flag[]> {
  const now = new Date().toISOString().slice(0, 10);
  const flags: Flag[] = eventFlags(((node.attrs as { events?: { date: string; items: string[]; url: string }[] }).events ?? []), now);
  const inbound = await linksTouching([node.id], ["director", "officer", "holder", "insider"]);
  const people = await nodesById(inbound.map((l) => l.src));
  flags.push(...insiderFlags(inbound.filter((l) => l.dst === node.id).map((l) => {
    const a = l.attrs as { title?: string; txns?: (Form4Tx & { url?: string })[] };
    return { name: people.get(l.src)?.name ?? "An insider", title: a.title || (l.kind === "director" ? "Director" : l.kind), txns: a.txns ?? [] };
  }), now));
  // Ownership that loops back (through stakes and subsidiaries), near this company.
  const own = await neighborhood([node.id], { kinds: ["holder", "subsidiary"], hub: 60 });
  const names = await nodesById([...new Set(own.flatMap((l) => [l.src, l.dst]))]);
  for (const cyc of ownershipCycles(own.filter((l) => !l.ended).map((l) => ({ s: l.src, d: l.dst })), 4).filter((c) => c.includes(node.id)).slice(0, 3)) {
    flags.push({ kind: "circular_ownership", severity: "medium", title: "Ownership loops back on itself", detail: `${cyc.map((id) => names.get(id)?.name ?? "?").join(" → ")} → ${names.get(cyc[0])?.name ?? "?"}`, date: now });
  }
  // Directors this company shares with others; a concern when the other company is also a customer, supplier or deal counterparty.
  const directors = inbound.filter((l) => l.kind === "director" && l.dst === node.id && !l.ended).map((l) => l.src);
  if (directors.length) {
    const seats = await requireDb().select().from(schema.edgeLinks).where(and(inArray(schema.edgeLinks.src, directors), eq(schema.edgeLinks.kind, "director"), isNull(schema.edgeLinks.ended)));
    const locks = interlocks(seats.map((s) => ({ person: s.src, name: "", company: s.dst }))).filter((x) => x.companies.includes(node.id));
    if (locks.length) {
      const others = [...new Set(locks.flatMap((x) => x.companies).filter((c) => c !== node.id))];
      const business = await requireDb().select().from(schema.edgeLinks).where(and(or(and(eq(schema.edgeLinks.src, node.id), inArray(schema.edgeLinks.dst, others)), and(inArray(schema.edgeLinks.src, others), eq(schema.edgeLinks.dst, node.id))), inArray(schema.edgeLinks.kind, ["supplies", "acquired", "bought_assets", "holder"])));
      const who = await nodesById([...others, ...locks.map((x) => x.person)]);
      for (const x of locks.slice(0, 6)) {
        const other = x.companies.find((c) => c !== node.id)!;
        const trade = business.find((b) => b.src === other || b.dst === other);
        flags.push({
          kind: trade ? "related_party" : "shared_director", severity: trade ? "high" : "medium",
          title: trade ? `A director sits on both sides of a business relationship` : `A director also sits on ${who.get(other)?.name ?? "another board"}`,
          detail: `${who.get(x.person)?.name ?? "A director"} is a director of ${node.name} and of ${who.get(other)?.name ?? "another company"}${trade ? `, and ${linkSentence(trade.kind, trade.src === node.id ? node.name : who.get(other)?.name ?? "?", trade.dst === node.id ? node.name : who.get(other)?.name ?? "?", trade.attrs as Record<string, unknown>)}` : ""}.`,
          date: now, people: [who.get(x.person)?.name ?? ""], urls: [trade?.sourceUrl ?? ""].filter(Boolean),
        });
      }
    }
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
  const subDeg = await degrees(subIds);
  const subNodes = await nodesById(subIds);
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

/** A company's graph summary for the header: counts by kind of link and its recorded deals. */
export async function overview(node: NodeRow) {
  const links = await linksTouching([node.id], undefined, 8000);
  const count = (kind: string, dir: "in" | "out") => links.filter((l) => l.kind === kind && !l.ended && (dir === "in" ? l.dst === node.id : l.src === node.id)).length;
  const dealLinks = links.filter((l) => l.kind === "acquired" || l.kind === "bought_assets").sort((a, b) => (b.asOf ?? "").localeCompare(a.asOf ?? ""));
  const names = await nodesById(dealLinks.flatMap((l) => [l.src, l.dst]));
  const a = node.attrs as { sicDescription?: string; city?: string; state?: string; revenue?: number | null; assets?: number | null; seen?: Record<string, string> };
  return {
    node: nodeOf(node), industry: a.sicDescription ?? "", place: [a.city, a.state].filter(Boolean).join(", "), revenue: a.revenue ?? null, assets: a.assets ?? null,
    counts: { directors: count("director", "in"), officers: count("officer", "in"), holders: count("holder", "in"), stakes: count("holder", "out"), subsidiaries: count("subsidiary", "out"), customers: count("supplies", "out"), suppliers: count("supplies", "in"), deals: dealLinks.length },
    deals: dealLinks.slice(0, 20).map((l) => edgeOf(l, names)), refreshed: a.seen ?? {},
  };
}

export { companyByTicker };
