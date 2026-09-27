import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { listOpenQuestions } from "@/lib/crm/knowledge";

export const dynamic = "force-dynamic";

/** What the agent is waiting to be told. */
export async function GET() {
  return guarded(async (user) => NextResponse.json(await listOpenQuestions(user.id)));
}
