import { NextResponse } from "next/server";
import { getCompanyData } from "@/lib/company";
import { derive } from "@/lib/metrics";
import { resolveTicker } from "@/lib/edgar/tickers";
import { structuredJson } from "@/lib/ai/agent";
import { PEER_PROMPT } from "@/lib/ai/prompts";
import { guarded } from "@/lib/auth/user";
import { loadUserContext } from "@/lib/ai/persona";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  return guarded(async (user) => {
  const { prefs } = await loadUserContext(user.id);
  const { ticker } = ((await req.json().catch(() => ({}))) as { ticker?: string });
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });
  try {
    const c = await getCompanyData(ticker);
    if (!c) return NextResponse.json({ error: `Unknown ticker ${ticker}` }, { status: 404 });
    const d = derive(c);
    const { data, provider, model } = await structuredJson(PEER_PROMPT({ ticker: c.ticker, name: c.name, description: c.description, sic: `${c.sic} ${c.sicLabel}`, revenue: c.ltm.revenue, growth: d.revenueGrowth, grossMargin: d.grossMargin }), { prefs, override: { effort: "low" } });
    // Keep only tickers that resolve on EDGAR, and never the target itself.
    const keep = async (list: { ticker: string; name: string; rationale: string }[]) => {
      const out: { ticker: string; name: string; rationale: string }[] = [];
      for (const m of list) {
        const t = m.ticker.toUpperCase().trim();
        if (t === c.ticker || out.some((o) => o.ticker === t)) continue;
        const row = await resolveTicker(t);
        if (row) out.push({ ticker: t, name: row.name, rationale: m.rationale });
      }
      return out;
    };
    return NextResponse.json({ summary: data.summary, core: await keep(data.core), adjacent: await keep(data.adjacent), provider, model });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  });
}
