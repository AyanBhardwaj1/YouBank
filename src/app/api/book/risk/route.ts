import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { loadBook } from "@/lib/book/store";
import { riskOf } from "@/lib/book/risk-store";

export const dynamic = "force-dynamic";

/** GET: the book's risk (beta-adjusted net, VaR, risk shares, correlated pairs, stress replays), from daily closes. */
export async function GET() {
  return guarded(async (user) => {
    await rateLimit(`book-risk:${user.id}`, 120, 3_600_000, "The book's risk was asked for many times this hour. Try again later.");
    const book = await loadBook(user.id);
    return Response.json(await riskOf(book), { headers: { "Cache-Control": "no-store" } });
  });
}
