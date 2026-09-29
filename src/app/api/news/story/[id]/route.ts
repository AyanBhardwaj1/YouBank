import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { noteNewsForNetwork } from "@/lib/news/crm";
import { normCompany, type NetworkPerson } from "@/lib/news/rank";
import { readerFor } from "@/lib/news/reader";
import { itemsOf } from "@/lib/news/store";
import { storyView } from "@/lib/news/views";
import { whyForMe } from "@/lib/news/why";

export const dynamic = "force-dynamic";

const idOf = async (ctx: { params: Promise<{ id: string }> }) => { const n = Number((await ctx.params).id); if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error("Bad story id"), { status: 400 }); return n; };

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const v = await storyView(user.id, await idOf(ctx));
    return v ? NextResponse.json(v) : NextResponse.json({ error: "Story not found" }, { status: 404 });
  });
}

/** { action: "read" | "save" | "unsave" | "hide" | "unhide" | "why" | "reach-out" } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = await idOf(ctx);
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    const db = requireDb();
    const [c] = await db.select().from(schema.newsClusters).where(eq(schema.newsClusters.id, id));
    if (!c) return NextResponse.json({ error: "Story not found" }, { status: 404 });
    const now = new Date();
    const set: Partial<typeof schema.newsUserItems.$inferInsert> | null =
      body.action === "read" ? { readAt: now } : body.action === "save" ? { savedAt: now } : body.action === "unsave" ? { savedAt: null } : body.action === "hide" ? { hiddenAt: now } : body.action === "unhide" ? { hiddenAt: null } : null;
    if (set) {
      await db.insert(schema.newsUserItems).values({ userId: user.id, clusterId: id, ...set, updatedAt: now }).onConflictDoUpdate({ target: [schema.newsUserItems.userId, schema.newsUserItems.clusterId], set: { ...set, updatedAt: now } });
      return NextResponse.json({ ok: true });
    }
    const reader = await readerFor(user.id);
    if (!reader) return NextResponse.json({ error: "Finish onboarding first" }, { status: 409 });
    if (body.action === "why") return NextResponse.json(await whyForMe(reader, id));
    if (body.action === "reach-out") {
      const people: NetworkPerson[] = [];
      for (const e of c.entities) if (e.kind !== "person") for (const p of reader.reader.network.get(normCompany(e.name)) ?? []) people.push(p);
      if (!people.length) return NextResponse.json({ ok: false, message: "No one in your network works at a company in this story." });
      const [lead] = (await itemsOf([id])).filter((i) => i.kind !== "filing");
      const n = await noteNewsForNetwork(user.id, c, people, lead?.url ?? `${new URL(req.url).origin}/app/news/story/${id}`);
      return NextResponse.json({ ok: true, message: n ? `Suggested in Relationships: reconnect with ${people.slice(0, n).map((p) => p.name).join(", ")}. Approve it there to draft the note.` : "Already suggested in Relationships." });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = await idOf(ctx);
    await requireDb().delete(schema.newsUserItems).where(and(eq(schema.newsUserItems.userId, user.id), eq(schema.newsUserItems.clusterId, id)));
    return NextResponse.json({ ok: true });
  });
}
