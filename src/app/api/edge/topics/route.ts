import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { readableDocs } from "@/lib/edge/docs/store";
import { topicMap } from "@/lib/edge/docs/topics";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** The topic map of some documents: { docIds } or { tickers, sources }. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const body = (await req.json().catch(() => null)) as { docIds?: number[]; tickers?: string[]; sources?: string[] } | null;
    await rateLimit(`edge-topics:${user.id}`, 20, 3_600_000, "Many topic maps this hour; try again later.");
    const docs = (await readableDocs(user.id, { ids: body?.docIds?.map(Number).filter(Number.isInteger), tickers: body?.tickers, sources: body?.sources, limit: 200 })).filter((d) => d.status === "ready");
    return NextResponse.json({ ...(await topicMap(docs.map((d) => d.id))), docs: docs.length });
  });
}
