import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { radarView } from "@/lib/news/views";

export const dynamic = "force-dynamic";

/** The tech radar: this week's top papers, rising repositories, trending models and launches. */
export async function GET() {
  return guarded(async () => NextResponse.json(await radarView()));
}
