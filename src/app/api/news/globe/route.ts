import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { globeView } from "@/lib/news/views";

export const dynamic = "force-dynamic";

/** Where the last two days' stories are happening, by place, for the globe (the desk filter is applied in the browser). */
export async function GET() {
  return guarded(async () => NextResponse.json(await globeView(), { headers: { "Cache-Control": "private, max-age=60" } }));
}
