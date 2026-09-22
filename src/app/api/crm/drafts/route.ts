import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { listDrafts } from "@/lib/crm/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return guarded(async (user) => {
    const status = new URL(req.url).searchParams.get("status") ?? "pending";
    return NextResponse.json(await listDrafts(user.id, status));
  });
}
