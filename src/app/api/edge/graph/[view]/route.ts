import { after, NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { isAdmin } from "@/lib/auth/admin";
import { guarded } from "@/lib/auth/user";
import { requireEdge, saveEdge } from "@/lib/edge/access";
import { cacheJson } from "@/lib/cache";
import { exposureOf, overview, ownershipTree, predictions, redFlags, subgraph, ultimateOwners, warmIntros } from "@/lib/edge/graph/findings";
import { ingestCompany } from "@/lib/edge/graph/ingest";
import { companyMetrics, graphMetrics } from "@/lib/edge/graph/metrics";
import { companyByTicker, graphSize, graphVersion, peopleOf } from "@/lib/edge/graph/store";
import { scorecardText, withBaselines, type ModelMetrics } from "@/lib/edge/graph/train";
import { sendJob } from "@/lib/edge/infra/jobs";
import { draftIntro } from "@/lib/edge/intros";
import { resolveTicker, searchTickers } from "@/lib/edgar/tickers";
import { logError } from "@/lib/errors";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const PRIVATE = { "cache-control": "private, max-age=120" };
/** Views read only from public filings, the same for everyone: cached per company and version of the graph. */
const SHARED = new Set(["company", "subgraph", "map", "tree", "owners"]);
const SHARED_MS = 6 * 3_600_000;

/**
 * Networks · GNN, by view: company (overview and red flags), acquirers and targets (the deal model's
 * picks with reason paths), exposure, subgraph, map, tree, owners (who ultimately owns it), intros (warm
 * introductions for this person), status (graph size and the model's scorecard with its baselines) and
 * search. POST: build (read a company into the graph
 * now), pool (share CRM contacts with teammates for intros), intro (draft an intro request from a warm
 * path, under the person's autopilot setting for intro requests), and for admins refresh (the whole
 * universe) and train.
 */
export async function GET(req: Request, ctx: { params: Promise<{ view: string }> }) {
  return guarded(async (user) => {
    const edge = await requireEdge(user.id);
    const view = (await ctx.params).view;
    const q = new URL(req.url).searchParams;
    if (view === "status") {
      // The size is counted at most every five minutes (store.ts); the model's state is read live, its baselines once per model (train.ts).
      const [models, size] = await Promise.all([requireDb().select().from(schema.edgeModels).where(eq(schema.edgeModels.kind, "gnn-deals")).orderBy(desc(schema.edgeModels.id)).limit(3), graphSize()]);
      const ready = models.find((m) => m.status === "ready");
      const m = ready ? await withBaselines(ready) : null;
      return NextResponse.json({
        size, latest: models[0] ? { status: models[0].status, version: models[0].version, trainedAt: models[0].trainedAt.toISOString(), error: (models[0].metrics as ModelMetrics).error ?? null } : null,
        model: ready ? { version: ready.version, trainedAt: ready.trainedAt.toISOString(), metrics: m, acquirers: scorecardText(m, "acquirers"), targets: scorecardText(m, "targets") } : null,
      });
    }
    if (view === "search") {
      const text = (q.get("q") ?? "").trim();
      if (!text) return NextResponse.json({ results: [] });
      const [inGraph, listed] = await Promise.all([
        requireDb().select({ id: schema.edgeNodes.id, name: schema.edgeNodes.name, ticker: schema.edgeNodes.ticker }).from(schema.edgeNodes)
          .where(and(eq(schema.edgeNodes.kind, "company"), sql`(${schema.edgeNodes.ticker} = ${text.toUpperCase()} or ${schema.edgeNodes.name} ilike ${`%${text}%`})`)).limit(8),
        searchTickers(text, 8),
      ]);
      const have = new Set(inGraph.map((r) => r.ticker));
      return NextResponse.json({ results: [...inGraph.filter((r) => r.ticker).map((r) => ({ ticker: r.ticker, name: r.name, inGraph: true })), ...listed.filter((r) => !have.has(r.ticker)).map((r) => ({ ticker: r.ticker, name: r.name, inGraph: false }))].slice(0, 10) });
    }
    const ticker = (q.get("ticker") ?? "").toUpperCase();
    if (!TICKER.test(ticker)) return NextResponse.json({ error: "Pick a company." }, { status: 400 });
    const [node, version] = await Promise.all([companyByTicker(ticker), SHARED.has(view) ? graphVersion() : ""]);
    if (!node) {
      const t = await resolveTicker(ticker);
      return NextResponse.json({ missing: true, ticker, name: t?.name ?? "", listed: !!t });
    }
    // The graph is public SEC data, so these are shared by everyone: keyed by the company's row (a rebuild
    // touches it) and the graph's newest link, and by the day where the day's metrics or flag windows count.
    const shared = <T,>(name: string, load: () => Promise<T>, daily = false) =>
      cacheJson(`edge:graph:${name}:v1:${node.id}:${node.updatedAt.getTime()}:${version}${daily ? `:${new Date().toISOString().slice(0, 10)}` : ""}`, SHARED_MS, load);
    switch (view) {
      case "company": {
        const [ov, metrics] = await Promise.all([
          shared("company", async () => { const [o, flags] = await Promise.all([overview(node), redFlags(node)]); return { ...o, flags }; }, true),
          // Kept apart so a day whose metrics are not ready is tried again on the next visit, not cached.
          shared("company-metrics", async () => { const m = await companyMetrics(node.id, await peopleOf(node.id)); if (!m) throw new Error("The graph's metrics are not ready."); return m; }, true).catch(() => null),
        ]);
        return NextResponse.json({ ...ov, metrics }, { headers: PRIVATE });
      }
      case "acquirers": return NextResponse.json(await predictions(node, "acquirer", 10), { headers: PRIVATE });
      case "targets": return NextResponse.json(await predictions(node, "target", 10), { headers: PRIVATE });
      case "exposure": return NextResponse.json({ items: await exposureOf(node, 12) }, { headers: PRIVATE });
      case "subgraph": {
        // Each node's influence comes from the day's metrics; without them the plain neighbourhood is sent, uncached.
        const ranked = shared("subgraph", async () => { const [g, m] = await Promise.all([subgraph(node), graphMetrics()]); return { ...g, nodes: g.nodes.map((n) => ({ ...n, rank: m.rank[n.id] })) }; }, true);
        return NextResponse.json(await ranked.catch(() => subgraph(node)), { headers: PRIVATE });
      }
      case "tree": return NextResponse.json(await shared("tree", () => ownershipTree(node)), { headers: PRIVATE });
      case "owners": return NextResponse.json(await shared("owners", () => ultimateOwners(node)), { headers: PRIVATE });
      case "intros": {
        // Whose contact it is stays on the server; the person sees "your contact" or a teammate's name.
        const items = (await warmIntros(user.id, node)).map((i) => ({ ...i, contact: { name: i.contact.name, email: i.contact.email, company: i.contact.company, title: i.contact.title, via: i.contact.via } }));
        return NextResponse.json({ items, pooled: edge.prefs.poolContacts });
      }
      case "map": return NextResponse.json(await shared("map", async () => {
        const g = await subgraph(node, 160);
        const tickers = [...new Set(g.nodes.filter((n) => n.kind === "company" && n.ticker).map((n) => n.ticker))].slice(0, 40);
        // Public plants only: a person's own uploaded sites never reach this shared view.
        const plants = tickers.length ? (await requireDb().execute(sql`select ticker, name, ST_X(ST_PointOnSurface(geom)) as lon, ST_Y(ST_PointOnSurface(geom)) as lat from edge_assets where owner_id is null and ticker in (${sql.join(tickers.map((t) => sql`${t}`), sql`, `)}) and kind = 'processing_plant' limit 600`)).rows as { ticker: string; name: string; lon: number; lat: number }[] : [];
        return { ...g, plants };
      }), { headers: PRIVATE });
      default: return NextResponse.json({ error: "Unknown view" }, { status: 404 });
    }
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ view: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const view = (await ctx.params).view;
    const body = (await req.json().catch(() => ({}))) as { ticker?: string; on?: boolean; index?: number };
    if (view === "pool") {
      const prefs = await saveEdge(user.id, { poolContacts: body.on === true });
      return NextResponse.json({ pooled: prefs.poolContacts });
    }
    if (view === "intro") {
      const ticker = String(body.ticker ?? "").toUpperCase();
      const index = Number(body.index);
      if (!TICKER.test(ticker) || !Number.isInteger(index) || index < 0 || index > 20) return NextResponse.json({ error: "Pick a path." }, { status: 400 });
      await rateLimit(`edge-intro:${user.id}`, 20, 3_600_000, "Many intro requests this hour; try again later.");
      return NextResponse.json(await draftIntro(user, ticker, index));
    }
    if (view === "train" || view === "refresh") {
      if (!isAdmin(user)) return NextResponse.json({ error: "Only admins can rebuild the graph or retrain the model." }, { status: 403 });
      return NextResponse.json(await sendJob(view === "train" ? "edge/graph.train" : "edge/graph.refresh", { reason: "manual" }, { id: `edge-graph-${view}-manual-${Date.now()}` }));
    }
    if (view === "build") {
      const ticker = String(body.ticker ?? "").toUpperCase();
      const t = TICKER.test(ticker) ? await resolveTicker(ticker) : null;
      if (!t) return NextResponse.json({ error: "No SEC filer has that ticker." }, { status: 404 });
      await rateLimit(`edge-graph-build:${user.id}`, 10, 3_600_000, "Several companies were read into the graph this hour; try again later.");
      const cik = t.cik.replace(/^0+/, "");
      const sent = await sendJob("edge/graph.ingest", { ciks: [cik] }, { id: `edge-graph-ingest-${cik}-${new Date().toISOString().slice(0, 13)}` }).catch(() => ({ sent: false as const, reason: "" }));
      if (!sent.sent) after(() => ingestCompany(cik, Date.now() + 270_000).then(() => undefined).catch((e) => logError(e, { where: "edge-graph-build-inline" })));
      return NextResponse.json({ status: "building", ticker, name: t.name });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 404 });
  });
}

