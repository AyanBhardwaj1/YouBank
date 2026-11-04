import { NextResponse } from "next/server";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";

/** `%` and `_` typed into the box are matched as themselves, not as wildcards. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * GET ?q=: the person's own contacts (name, email, company) and deals (name) matching a few typed letters,
 * five of each, for the command palette. Each read is filtered to the person first (their rows only, on
 * the user index), then matched. A database without the CRM tables answers with nothing.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 60);
    if (q.length < 2) return NextResponse.json({ contacts: [], deals: [] });
    await rateLimit(`crm-search:${user.id}`, 600, 3_600_000, "Too many searches this hour. Try again later.");
    const db = requireDb();
    const c = schema.crmContacts, d = schema.crmDeals, p = like(q);
    const [contacts, deals] = await Promise.all([
      db.select({ id: c.id, name: c.name, email: c.email, company: c.company }).from(c)
        .where(and(eq(c.userId, user.id), or(ilike(c.name, p), ilike(c.email, p), ilike(c.company, p))))
        .orderBy(desc(c.lastSeenAt)).limit(5).catch(() => []),
      db.select({ id: d.id, name: d.name, stage: d.stage }).from(d)
        .where(and(eq(d.userId, user.id), ilike(d.name, p))).orderBy(desc(d.updatedAt)).limit(5).catch(() => []),
    ]);
    return NextResponse.json({ contacts, deals }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
