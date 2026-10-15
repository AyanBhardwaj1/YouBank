import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { canUse, requireFeature } from "@/lib/billing/entitlements";
import { capDaily, CROSS_SITE, jsonBody, refuse, requireQuantConsent, sameSiteJson } from "@/lib/quant/access";
import { toCsv } from "@/lib/quant/csv";
import { baseRateFor, CATALOG } from "@/lib/quant/events/rates";
import { board, companyInsiders, readItem4 } from "@/lib/quant/insiders/store";
import { DISCLOSURES } from "@/lib/quant/words";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Tickers the person watches in Edge, plus any the page sends (its watchlist and holdings). */
async function watched(userId: string, extra: string[]): Promise<string[]> {
  const rows = await requireDb().select({ t: sql<string>`${schema.edgeWatches.target}->>'ticker'` }).from(schema.edgeWatches).where(and(eq(schema.edgeWatches.userId, userId), eq(schema.edgeWatches.kind, "company"))).limit(200);
  return [...new Set([...rows.map((r) => r.t).filter(Boolean), ...extra].map((t) => t.toUpperCase().replace(/\./g, "-")))].slice(0, 300);
}

/**
 * GET ?ticker=X — one company's insider trades (routine or opportunistic) and its events.
 * GET [?watch=A,B&types=&format=csv&baseRates=1] — the board: events on watched and held companies, and the
 * market-wide top 20 (free); quant.insiders-pro: the full board with filters and CSV export of the events.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const q = new URL(req.url).searchParams;
    const ticker = (q.get("ticker") ?? "").toUpperCase();
    if (ticker) {
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) throw refuse("Give a ticker.");
      return NextResponse.json({ ...(await companyInsiders(ticker)), disclosures: [DISCLOSURES.base_rate, DISCLOSURES.not_advice] });
    }
    if (q.get("baseRates") === "1") return NextResponse.json({ rates: await Promise.all(Object.keys(CATALOG).map(async (k) => ({ type: k, label: CATALOG[k].label, rate: await baseRateFor(k) }))) });
    const pro = await canUse(user, "quant.insiders-pro");
    const types = (q.get("types") ?? "").split(",").filter((t) => CATALOG[t]);
    if (q.get("format") === "csv") {
      await requireFeature(user, "quant.insiders-pro");
      const rows = await board({ types, limit: 500, days: Number(q.get("days")) || 365 });
      return new Response(toCsv(["accepted_at", "type", "symbol", "issuer_cik", "occurred_at", "insiders", "total_usd", "explain", "filing"], rows.map((r) => [r.acceptedAt, r.type, r.symbol, r.issuerCik, r.occurredAt, r.insiders, r.totalUsd, r.explain, r.url ?? ""])), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=youbank-insider-events.csv" } });
    }
    const mine = await watched(user.id, (q.get("watch") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    const [yours, market] = await Promise.all([mine.length ? board({ symbols: mine, types, limit: 100 }) : Promise.resolve([]), board({ types, limit: pro ? 300 : 20, days: Number(q.get("days")) || 90 })]);
    return NextResponse.json({ yours, market, pro, watched: mine.length, disclosures: [DISCLOSURES.base_rate, DISCLOSURES.not_advice] });
  });
}

/** POST { eventId } — a 13D's Item 4 read by the small model, with a verified quote (quant.insiders-pro; cached per filing). */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await requireQuantConsent(user.id);
    await requireFeature(user, "quant.insiders-pro");
    await capDaily(user, "insiderReadsPerDay", "That is the most 13D readings in a day.");
    const b = await jsonBody(req);
    return NextResponse.json({ reading: await readItem4(String(b.eventId ?? "")) });
  });
}
