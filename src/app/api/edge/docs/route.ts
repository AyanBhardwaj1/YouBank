import { NextResponse } from "next/server";
import { desc, eq, inArray, or } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { indexFilings, indexWorkspace } from "@/lib/edge/docs/sources";
import { uploadUsage } from "@/lib/edge/docs/store";
import { rateLimit } from "@/lib/locks";
import { myTeamIds } from "@/lib/teams/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The person's library: their uploads and recordings, workspace items, filings already read for them, and their quota. */
export async function GET() {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const teams = await myTeamIds(user.id);
    const db = requireDb();
    const mine = await db.select().from(schema.edgeDocs).where(or(eq(schema.edgeDocs.ownerId, user.id), ...(teams.length ? [inArray(schema.edgeDocs.teamId, teams)] : []))).orderBy(desc(schema.edgeDocs.createdAt)).limit(300);
    const filings = await db.select().from(schema.edgeDocs).where(eq(schema.edgeDocs.source, "sec")).orderBy(desc(schema.edgeDocs.createdAt)).limit(60);
    const view = (d: typeof schema.edgeDocs.$inferSelect) => ({
      id: d.id, source: d.source, title: d.title, url: d.url, status: d.status, error: d.error, pages: d.pages, chunks: d.chunks, lang: d.lang, durationSec: d.durationSec, mime: d.mime, fileId: d.fileId,
      ticker: String((d.meta as { ticker?: string }).ticker ?? ""), form: String((d.meta as { form?: string }).form ?? ""), createdAt: d.createdAt.toISOString(), mine: d.ownerId === user.id, shared: !!d.teamId, teamId: d.teamId,
    });
    return NextResponse.json({ docs: mine.map(view), filings: filings.map(view), usage: await uploadUsage(user.id) });
  });
}

/** Read sources now: { kind: "sec", tickers, forms?, months? } or { kind: "workspace" }. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const body = (await req.json().catch(() => null)) as { kind?: string; tickers?: string[]; forms?: string[]; months?: number } | null;
    await rateLimit(`edge-index:${user.id}`, 20, 3_600_000, "Many documents read this hour; try again later.");
    const deadline = Date.now() + 250_000;
    if (body?.kind === "workspace") return NextResponse.json(await indexWorkspace(user.id, deadline));
    if (body?.kind === "sec" && body.tickers?.length) {
      const out = [];
      for (const t of body.tickers.slice(0, 4)) out.push(await indexFilings(t.toUpperCase(), body.forms ?? [], body.months ?? 12, deadline).catch((e) => ({ error: String((e as Error).message) })));
      return NextResponse.json({ results: out });
    }
    return NextResponse.json({ error: "Say what to read." }, { status: 400 });
  });
}
