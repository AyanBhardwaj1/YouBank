import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { historyFrom } from "@/lib/market/data";

export const dynamic = "force-dynamic";

/** Thirty-day closes for the data art on story cards: ?symbols=XOM,CVX (at most 24). */
export async function GET(req: Request) {
  return guarded(async () => {
    const symbols = [...new Set((new URL(req.url).searchParams.get("symbols") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z^][A-Z0-9.\-^]{0,9}$/.test(s)))].slice(0, 24);
    const from = new Date(Date.now() - 50 * 86_400_000).toISOString().slice(0, 10);
    const rows = await Promise.all(symbols.map(async (s) => {
      const h = await historyFrom(s, from, true).catch(() => null);
      const c = (h?.data ?? []).map((b) => b.close).slice(-30);
      return [s, { closes: c, change: c.length > 1 ? c[c.length - 1] / c[c.length - 2] - 1 : null, month: c.length > 1 ? c[c.length - 1] / c[0] - 1 : null }] as const;
    }));
    return NextResponse.json(Object.fromEntries(rows), { headers: { "Cache-Control": "private, max-age=600" } });
  });
}
