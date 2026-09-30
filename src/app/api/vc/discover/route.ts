import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { discoverStartups } from "@/lib/vc/sources/web";
import { upsertStartups, searchStartups } from "@/lib/vc/directory";
import { errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** AI web discovery: find startups matching a query anywhere in the world and add them to the directory. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const { query, program } = ((await req.json().catch(() => ({}))) as { query?: string; program?: string });
    if (!query?.trim()) return NextResponse.json({ error: "query required" }, { status: 400 });
    await rateLimit(`vc-discover:${user.id}`, 10, 3_600_000, "Web discovery has run many times this hour. Try again later.");
    try {
      const rows = await discoverStartups(query.trim().slice(0, 300), program?.slice(0, 80));
      const written = await upsertStartups(rows);
      const names = rows.map((r) => r.name);
      const found = names.length ? (await searchStartups({ source: "web", pageSize: 100 })).rows.filter((r) => names.includes(r.name)) : [];
      return NextResponse.json({ written, rows: found });
    } catch (e) { return errorResponse(e, 502); }
  });
}
