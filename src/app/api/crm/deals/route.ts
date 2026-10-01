import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { crmCounts, listContacts, listDeals } from "@/lib/crm/db";

export const dynamic = "force-dynamic";

/** The pipeline (each deal with Edge's latest finding about its company, if any), plus the counts the header shows. */
export async function GET() {
  return guarded(async (user) => {
    const [deals, contacts, counts] = await Promise.all([listDeals(user.id), listContacts(user.id), crmCounts(user.id)]);
    const ids = deals.slice(0, 500).map((d) => d.id);
    const edge = ids.length ? await requireDb().select({ dealId: schema.crmSignals.dealId, title: schema.crmSignals.title, url: schema.crmSignals.url }).from(schema.crmSignals)
      .where(and(eq(schema.crmSignals.userId, user.id), eq(schema.crmSignals.kind, "edge"), inArray(schema.crmSignals.dealId, ids))).orderBy(desc(schema.crmSignals.createdAt)).limit(300) : [];
    return NextResponse.json({ deals: deals.map((d) => ({ ...d, edge: edge.find((e) => e.dealId === d.id) ?? null })), contacts, counts });
  });
}
