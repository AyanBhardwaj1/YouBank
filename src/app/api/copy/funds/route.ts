import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { searchFilers } from "@/lib/copytrade/edgar13f";
import { CURATED } from "@/lib/copytrade/funds";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";

/** GET ?q= — the curated managers, or a search of every 13F filer by name or CIK. Free. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (!q) return NextResponse.json({ curated: CURATED, results: [] });
    await rateLimit(`copy-search:${user.id}`, 60, 60_000, "Too many searches. Wait a moment and try again.");
    return NextResponse.json({ curated: [], results: await searchFilers(q.slice(0, 80)) });
  });
}
