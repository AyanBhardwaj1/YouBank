import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { searchStartups } from "@/lib/vc/directory";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return guarded(async () => {
    const p = new URL(req.url).searchParams;
    return NextResponse.json(await searchStartups({
      q: p.get("q") ?? undefined, source: p.get("source") ?? undefined, country: p.get("country") ?? undefined, industry: p.get("industry") ?? undefined, program: p.get("program") ?? undefined,
      hiring: p.get("hiring") === "1", page: Number(p.get("page") ?? 1), pageSize: Number(p.get("pageSize") ?? 50),
    }));
  });
}
