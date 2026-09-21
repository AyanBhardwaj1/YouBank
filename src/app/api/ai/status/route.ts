import { NextResponse } from "next/server";
import { aiStatus } from "@/lib/ai/config";
import { currentUser } from "@/lib/auth/user";
import { loadUserContext } from "@/lib/ai/persona";

export const dynamic = "force-dynamic";

/** Effective AI configuration for the caller (account preference over environment default). */
export async function GET() {
  const user = await currentUser();
  const prefs = user ? (await loadUserContext(user.id)).prefs : null;
  return NextResponse.json({ ...aiStatus(prefs), prefs: prefs ?? {} });
}
