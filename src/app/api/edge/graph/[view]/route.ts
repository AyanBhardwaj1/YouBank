import { after, NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { isAdmin } from "@/lib/auth/admin";
import { guarded } from "@/lib/auth/user";
import { requireEdge, saveEdge } from "@/lib/edge/access";
import { exposureOf, overview, ownershipTree, predictions, redFlags, subgraph, warmIntros } from "@/lib/edge/graph/findings";
import { ingestCompany } from "@/lib/edge/graph/ingest";
import { companyByTicker, graphSize } from "@/lib/edge/graph/store";
import { scorecardText, type ModelMetrics } from "@/lib/edge/graph/train";
import { sendJob } from "@/lib/edge/infra/jobs";
import { draftIntro } from "@/lib/edge/intros";
import { resolveTicker, searchTickers } from "@/lib/edgar/tickers";
import { logError } from "@/lib/errors";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const PRIVATE = { "cache-control": "private, max-age=120" };

/**
 * Networks · GNN, by view: company (overview and red flags), acquirers and targets (the deal model's
 * picks with reason paths), exposure, subgraph, map, tree, intros (warm introductions for this person),
 * status (graph size and the model's scorecard) and search. POST: build (read a company into the graph
 * now), pool (share CRM contacts with teammates for intros), intro (draft an intro request from a warm
 * path, under the person's autopilot setting for intro requests), and for admins refresh (the whole
 * universe) and train.
 */
export async function GET(req: Request, ctx: { params: Promise<{ view: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const view = (await ctx.params).view;
    const q = new URL(req.url).searchParams;
    if (view === "status") {
      const models = await requireDb().select().from(schema.edgeModels).where(eq(schema.edgeModels.kind, "gnn-deals")).orderBy(desc(schema.edgeModels.id)).limit(3);
      const ready = models.find((m) => m.status === "ready");
      const m = (ready?.metrics ?? null) as ModelMetrics | null;
      return NextResponse.json({
        size: await graphSize(), latest: models[0] ? { status: models[0].status, version: models[0].version, trainedAt: models[0].trainedAt.toISOString(), error: (models[0].metrics as ModelMetrics).error ?? null } : null,
        model: ready ? { version: ready.version, trainedAt: ready.trainedAt.toISOString(), metrics: m, acquirers: scorecardText(m, "acquirers"), targets: scorecardText(m, "targets") } : null,
      });
    }
    if (view === "search") {
      const text = (q.get("q") ?? "").trim();
      if (!text) return NextResponse.json({ results: [] });
      const inGraph = await requireDb().select({ id: schema.edgeNodes.id, name: schema.edgeNodes.name, ticker: schema.edgeNodes.ticker }).from(schema.edgeNodes)
        .where(and(eq(schema.edgeNodes.kind, "company"), sql`(${schema.edgeNodes.ticker} = ${text.toUpperCase()} or ${schema.edgeNodes.name} ilike ${`%${text}%`})`)).limit(8);
      const listed = await searchTickers(text, 8);
      const have = new Set(inGraph.map((r) => r.ticker));
      return NextResponse.json({ results: [...inGraph.filter((r) => r.ticker).map((r) => ({ ticker: r.ticker, name: r.name, inGraph: true })), ...listed.filter((r) => !have.has(r.ticker)).map((r) => ({ ticker: r.ticker, name: r.name, inGraph: false }))].slice(0, 10) });
    }
    const ticker = (q.get("ticker") ?? "").toUpperCase();
    if (!TICKER.test(ticker)) return NextResponse.json({ error: "Pick a company." }, { status: 400 });
    const node = await companyByTicker(ticker);
    if (!node) {
      const t = await resolveTicker(ticker);
      return NextResponse.json({ missing: true, ticker, name: t?.name ?? "", listed: !!t });
    }
    switch (view) {
      case "company": return NextResponse.json({ ...(await overview(node)), flags: await redFlags(node) }, { headers: PRIVATE });
      case "acquirers": return NextResponse.json(await predictions(node, "acquirer", 10), { headers: PRIVATE });
      case "targets": return NextResponse.json(await predictions(node, "target", 10), { headers: PRIVATE });
      case "exposure": return NextResponse.json({ items: await exposureOf(node, 12) }, { headers: PRIVATE });
      case "subgraph": return NextResponse.json(await subgraph(node), { headers: PRIVATE });
      case "tree": return NextResponse.json(await ownershipTree(node), { headers: PRIVATE });
      case "intros": {
        const p = await requireEdge(user.id);
        // Whose contact it is stays on the server; the person sees "your contact" or a teammate's name.
        const items = (await warmIntros(user.id, node)).map((i) => ({ ...i, contact: { name: i.contact.name, email: i.contact.email, company: i.contact.company, title: i.contact.title, via: i.contact.via } }));
        return NextResponse.json({ items, pooled: p.prefs.poolContacts });
      }
      case "map": {
        const g = await subgraph(node, 160);
        const tickers = [...new Set(g.nodes.filter((n) => n.kind === "company" && n.ticker).map((n) => n.ticker))].slice(0, 40);
        const plants = tickers.length ? (await requireDb().execute(sql`select ticker, name, ST_X(ST_PointOnSurface(geom)) as lon, ST_Y(ST_PointOnSurface(geom)) as lat from edge_assets where ticker in (${sql.join(tickers.map((t) => sql`${t}`), sql`, `)}) and kind = 'processing_plant' limit 600`)).rows as { ticker: string; name: string; lon: number; lat: number }[] : [];
        return NextResponse.json({ ...g, plants }, { headers: PRIVATE });
      }
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

