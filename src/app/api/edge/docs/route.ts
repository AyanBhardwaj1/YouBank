import { NextResponse } from "next/server";
import { desc, eq, inArray, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { indexFilings, indexWorkspace } from "@/lib/edge/docs/sources";
import { uploadUsage } from "@/lib/edge/docs/store";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The person's library: their uploads and recordings, workspace items, filings already read for them, and
 * their quota. It is checked every few seconds while documents are read, so it reads only the columns the
 * list shows (meta can hold a call's whole transcript; just its ticker and form come back) and sends its
 * reads together, with the beta check alongside (nothing is returned unless it passes).
 */
export async function GET() {
  return guarded(async (user) => {
    const db = requireDb();
    const d = schema.edgeDocs;
    const cols = {
      id: d.id, source: d.source, title: d.title, url: d.url, status: d.status, error: d.error, pages: d.pages, chunks: d.chunks, lang: d.lang, durationSec: d.durationSec, mime: d.mime, fileId: d.fileId,
      ownerId: d.ownerId, teamId: d.teamId, createdAt: d.createdAt, ticker: sql<string>`coalesce(${d.meta}->>'ticker', '')`, form: sql<string>`coalesce(${d.meta}->>'form', '')`,
      // Which premium reader read it, or why the one asked for did not (see premium/reading.ts).
      readBy: sql<string>`coalesce(${d.meta}->'readBy'->>'credit', '')`, premiumNote: sql<string>`coalesce(${d.meta}->>'premiumNote', '')`,
    };
    const teams = db.select({ id: schema.teamMembers.teamId }).from(schema.teamMembers).where(eq(schema.teamMembers.userId, user.id));
    const [, mine, filings, usage] = await Promise.all([
      requireEdge(user.id),
      db.select(cols).from(d).where(or(eq(d.ownerId, user.id), inArray(d.teamId, teams))).orderBy(desc(d.createdAt)).limit(300),
      db.select(cols).from(d).where(eq(d.source, "sec")).orderBy(desc(d.createdAt)).limit(60),
      uploadUsage(user.id),
    ]);
    const view = (r: (typeof mine)[number]) => ({
      id: r.id, source: r.source, title: r.title, url: r.url, status: r.status, error: r.error, pages: r.pages, chunks: r.chunks, lang: r.lang, durationSec: r.durationSec, mime: r.mime, fileId: r.fileId,
      ticker: r.ticker, form: r.form, createdAt: r.createdAt.toISOString(), mine: r.ownerId === user.id, shared: !!r.teamId, teamId: r.teamId,
      ...(r.readBy ? { readBy: r.readBy } : {}), ...(r.premiumNote ? { premiumNote: r.premiumNote } : {}),
    });
    return NextResponse.json({ docs: mine.map(view), filings: filings.map(view), usage });
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
