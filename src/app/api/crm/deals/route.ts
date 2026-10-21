import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { cursorParam } from "@/lib/cursor";
import { createDeal, crmCounts, listContacts, listDeals } from "@/lib/crm/db";

export const dynamic = "force-dynamic";

/**
 * The pipeline (each deal with Edge's latest finding about its company, if any), plus the contacts and the
 * counts the header shows. Deals come 500 a page, most recently changed first; `next` is the cursor for
 * the page after (null on the last), which `?cursor=` asks for.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const cursor = cursorParam(req);
    const [{ rows: deals, next }, contacts, counts] = await Promise.all([listDeals(user.id, 500, cursor), listContacts(user.id), crmCounts(user.id)]);
    const ids = deals.map((d) => d.id);
    const edge = ids.length ? await requireDb().select({ dealId: schema.crmSignals.dealId, title: schema.crmSignals.title, url: schema.crmSignals.url }).from(schema.crmSignals)
      .where(and(eq(schema.crmSignals.userId, user.id), eq(schema.crmSignals.kind, "edge"), inArray(schema.crmSignals.dealId, ids))).orderBy(desc(schema.crmSignals.createdAt)).limit(300) : [];
    // The newest finding per deal (the rows come newest first).
    const latest = new Map<number, (typeof edge)[number]>();
    for (const e of edge) if (e.dealId !== null && !latest.has(e.dealId)) latest.set(e.dealId, e);
    return NextResponse.json({ deals: deals.map((d) => ({ ...d, edge: latest.get(d.id) ?? null })), contacts, counts, next });
  });
}

/** A deal added by hand: { name, stage?, contactId?, amountUsd?, nextStep? }. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { name?: unknown; stage?: unknown; contactId?: unknown; amountUsd?: unknown; nextStep?: unknown } | null;
    if (typeof body?.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "Give the deal a name" }, { status: 400 });
    // An id the database could not take (1.5, 1e20) is a 400 here, not a failed query.
    if (body.contactId != null && !(Number.isSafeInteger(body.contactId) && (body.contactId as number) > 0)) return NextResponse.json({ error: "That contact was not found" }, { status: 400 });
    const deal = await createDeal(user.id, {
      name: body.name, stage: typeof body.stage === "string" ? body.stage : undefined,
      contactId: typeof body.contactId === "number" ? body.contactId : null,
      amountUsd: typeof body.amountUsd === "number" ? body.amountUsd : null,
      nextStep: typeof body.nextStep === "string" ? body.nextStep : "",
    });
    return NextResponse.json({ deal }, { status: 201 });
  });
}
