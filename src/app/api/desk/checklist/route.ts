import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { checklistFacts } from "@/lib/desk/checklist-facts";

export const dynamic = "force-dynamic";

/** GET: what the person has done of Home's "Getting started" steps (src/lib/desk/checklist-facts.ts). */
export async function GET() {
  return guarded(async (user) => NextResponse.json(await checklistFacts(user.id), { headers: { "Cache-Control": "private, no-store" } }));
}
