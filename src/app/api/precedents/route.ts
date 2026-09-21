import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { fullTextSearch } from "@/lib/edgar/fulltext";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Live precedent-transaction candidates from EDGAR full-text search over merger disclosure. */
export async function GET(req: Request) {
  return guarded(async () => {
    const url = new URL(req.url);
    const keywords = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
    const from = url.searchParams.get("from") ?? new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
    const to = url.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
    const forms = (url.searchParams.get("forms") ?? "DEFM14A,8-K,S-4").split(",").map((s) => s.trim()).filter(Boolean);
    const phrase = url.searchParams.get("phrase") ?? '"agreement and plan of merger"';
    try {
      const r = await fullTextSearch({ q: `${phrase}${keywords ? ` ${keywords}` : ""}`, forms, from, to, limit: 40 });
      // One row per issuer, keeping the earliest disclosure (closest to announcement).
      const byEntity = new Map<string, (typeof r.hits)[number]>();
      for (const h of r.hits) {
        const key = h.entity || h.cik;
        const prev = byEntity.get(key);
        if (!prev || h.filed < prev.filed) byEntity.set(key, h);
      }
      const rows = [...byEntity.values()].sort((a, b) => (a.filed < b.filed ? 1 : -1));
      return NextResponse.json({ total: r.total, matched: r.hits.length, rows, query: { phrase, keywords, from, to, forms } });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  });
}
