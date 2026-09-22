import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { crmCounts, listContacts, listDeals } from "@/lib/crm/db";

export const dynamic = "force-dynamic";

/** The pipeline, plus the counts the header shows. */
export async function GET() {
  return guarded(async (user) => {
    const [deals, contacts, counts] = await Promise.all([listDeals(user.id), listContacts(user.id), crmCounts(user.id)]);
    return NextResponse.json({ deals, contacts, counts });
  });
}
