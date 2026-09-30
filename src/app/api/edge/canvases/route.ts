import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { buildFromPrompt } from "@/lib/edge/canvas/build";
import { makeNode, TEMPLATE, TEMPLATES, validate, type Graph } from "@/lib/edge/canvas/catalog";
import { cleanGraph, createCanvas, listCanvases } from "@/lib/edge/canvas/store";
import { availableTypes } from "@/lib/edge/runtime";
import { listWatches } from "@/lib/edge/watches";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** The person's and their teams' canvases, the starter templates, and which blocks are available. */
export async function GET() {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const available = availableTypes();
    return NextResponse.json({
      canvases: await listCanvases(user.id),
      templates: TEMPLATES.map((t) => ({ id: t.id, title: t.title, blurb: t.blurb, modules: t.modules, ready: t.build({ tickers: ["ET", "KMI"] }).nodes.every((n) => available.has(n.type)) })),
      available: [...available],
    });
  });
}

/** A new canvas: blank, from a template, from a goal (the AI builder), or from a graph. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const body = (await req.json().catch(() => null)) as { template?: string; prompt?: string; title?: string; graph?: unknown; teamId?: number | null } | null;
    if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
    const available = availableTypes();
    const tickers = (await listWatches(user.id)).filter((w) => w.kind === "company" && w.target.ticker).map((w) => w.target.ticker!);
    let graph: Graph, title = (body.title ?? "").trim(), template = "", explanation = "", dropped: string[] = [];
    if (body.prompt?.trim()) {
      await rateLimit(`edge-build:${user.id}`, 15, 3_600_000, "Many canvases built this hour. Try again in a few minutes.");
      const built = await buildFromPrompt(body.prompt, available, { tickers });
      graph = built.graph; title ||= built.title; explanation = built.explanation; dropped = built.dropped;
    } else if (body.template && TEMPLATE[body.template]) {
      const t = TEMPLATE[body.template];
      graph = t.build({ tickers }); title ||= t.title; template = t.id;
    } else if (body.graph) {
      graph = cleanGraph(body.graph);
    } else {
      graph = { nodes: [makeNode("source.companies", { tickers: tickers.slice(0, 2) }, "companies", { x: 60, y: 120 })], edges: [] };
    }
    const canvas = await createCanvas(user, { title: title || "Untitled canvas", graph, template, teamId: body.teamId ?? null });
    return NextResponse.json({ canvas: { id: canvas.id, title: canvas.title }, explanation, dropped, issues: validate(graph, available) });
  });
}
