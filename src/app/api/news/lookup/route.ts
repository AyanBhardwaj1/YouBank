import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { companyNews, topicNews } from "@/lib/news/views";

export const dynamic = "force-dynamic";

/** Company news (?ticker=XOM, terminal CN and the DES strip) or topic news (?topic=energy or words, terminal NI). */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const p = new URL(req.url).searchParams;
    const ticker = p.get("ticker")?.trim().toUpperCase();
    if (ticker) {
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) return NextResponse.json({ error: "Bad ticker" }, { status: 400 });
      return NextResponse.json({ stories: await companyNews(user.id, ticker, Math.min(90, Number(p.get("days")) || 30), Math.min(60, Number(p.get("limit")) || 30)) });
    }
    const topic = p.get("topic")?.trim().slice(0, 60);
    if (!topic) return NextResponse.json({ error: "Give ?ticker= or ?topic=" }, { status: 400 });
    return NextResponse.json({ stories: await topicNews(user.id, topic) });
  });
}
