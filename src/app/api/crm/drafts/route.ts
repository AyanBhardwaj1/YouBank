import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { listDrafts } from "@/lib/crm/db";

export const dynamic = "force-dynamic";

/** Drafts waiting for review (and on the autopilot schedule), or with ?status=sent, what went out recently. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const status = new URL(req.url).searchParams.get("status") === "sent" ? "sent" : "pending";
    return NextResponse.json(await listDrafts(user.id, status));
  });
}
