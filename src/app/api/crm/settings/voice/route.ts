import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { learnVoice } from "@/lib/crm/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Describe the reader's writing style from the mail they have sent, and save it. */
export async function POST() {
  return guarded(async (user) => NextResponse.json(await learnVoice(user.id)));
}
