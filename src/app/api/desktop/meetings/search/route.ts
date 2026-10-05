import { NextResponse } from "next/server";
import { guardedDesktop } from "@/lib/desktop/auth";
import { searchRefs } from "@/lib/meetings/views";

export const dynamic = "force-dynamic";

/** Contacts and deals for the copilot's "who is this with" picker: ?q= */
export async function GET(req: Request) {
  return guardedDesktop(req, async (user) => NextResponse.json(await searchRefs(user.id, new URL(req.url).searchParams.get("q") ?? "")), { device: "required" });
}
