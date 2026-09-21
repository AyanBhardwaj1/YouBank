import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { discoverStartups } from "@/lib/vc/sources/web";
import { upsertStartups, searchStartups } from "@/lib/vc/directory";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** AI web discovery: find startups matching a query anywhere in the world and add them to the directory. */
export async function POST(req: Request) {
  return guarded(async () => {
    const { query, program } = ((await req.json().catch(() => ({}))) as { query?: string; program?: string });
    if (!query?.trim()) return NextResponse.json({ error: "query required" }, { status: 400 });
    try {
      const rows = await discoverStartups(query.trim().slice(0, 300), program?.slice(0, 80));
      const written = await upsertStartups(rows);
      const names = rows.map((r) => r.name);
      const found = names.length ? (await searchStartups({ source: "web", pageSize: 100 })).rows.filter((r) => names.includes(r.name)) : [];
      return NextResponse.json({ written, rows: found });
    } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
  });
}
