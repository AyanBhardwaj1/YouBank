import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { loadBook } from "@/lib/book/store";
import { riskOf, riskWhatIf } from "@/lib/book/risk-store";
import { tickerOf } from "@/lib/book/position";

export const dynamic = "force-dynamic";

/**
 * GET: the book's risk (beta-adjusted net, VaR, risk shares, correlated pairs, stress replays), from daily closes.
 * GET ?add=TICKER&side=long|short&weight=3: before a trade, the book's risk with that position added.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await rateLimit(`book-risk:${user.id}`, 120, 3_600_000, "The book's risk was asked for many times this hour. Try again later.");
    const book = await loadBook(user.id);
    const q = new URL(req.url).searchParams;
    if (q.has("add")) {
      const ticker = tickerOf(q.get("add") ?? ""), weight = Number(q.get("weight"));
      if (!ticker || !Number.isFinite(weight) || weight <= 0 || weight > 100) return Response.json({ error: "Give a ticker and a weight between 0 and 100 (% of NAV)." }, { status: 400 });
      return Response.json(await riskWhatIf(book, { ticker, direction: q.get("side") === "short" ? "short" : "long", weight }), { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(await riskOf(book), { headers: { "Cache-Control": "no-store" } });
  });
}
