import { after, NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { logError } from "@/lib/errors";
import { rerankProvider, warmReranker } from "@/lib/edge/premium/rerank";

export const dynamic = "force-dynamic";

/**
 * Wake the free reranker on the ML service when the Ask panel opens (it scales to zero, and a cold start
 * takes 10 to 30 seconds), so the question that follows usually finds it warm. Answers at once; the call
 * runs after the response, and at most every few minutes per server. Nothing happens when a paid
 * reranker is set or the ML service is not.
 */
export async function POST() {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const warming = rerankProvider() === "ml";
    if (warming) after(() => warmReranker().catch((e) => { logError(e, { where: "edge-rerank-warm" }); }));
    return NextResponse.json({ warming });
  });
}
