import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { searchRefs } from "@/lib/meetings/views";

export const dynamic = "force-dynamic";

/** Contacts and deals for the "who was this with" pickers: ?q= (empty lists recent ones). */
export async function GET(req: Request) {
  return guarded(async (user) => NextResponse.json(await searchRefs(user.id, new URL(req.url).searchParams.get("q") ?? "")));
}
