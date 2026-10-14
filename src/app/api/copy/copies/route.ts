import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { canUse } from "@/lib/billing/entitlements";
import { consentsOf, CROSS_SITE, limits, liveCopyLimit, requestMeta, sameSiteJson, tradingEnabled } from "@/lib/copytrade/access";
import { CONSENTS } from "@/lib/copytrade/disclosures";
import { brokerSetup } from "@/lib/copytrade/live";
import { createCopy, listCopies } from "@/lib/copytrade/portfolios";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET — the person's copies, consents, limits and whether brokers and trading are set up here. */
export async function GET() {
  return guarded(async (user) => {
    const [copies, consents, broker, blends, live] = await Promise.all([listCopies(user.id), consentsOf(user.id), canUse(user, "copytrade.broker"), canUse(user, "copytrade.blends"), liveCopyLimit(user)]);
    return NextResponse.json({
      copies: copies.map((c) => ({ id: c.id, name: c.name, mode: c.mode, status: c.status, funds: c.funds, rules: c.rules, sizing: c.sizing, trading: c.trading, accountId: c.accountId, managed: c.managed, lastAccession: c.lastAccession, createdAt: c.createdAt.toISOString(), paper: c.mode === "paper" ? summary(c.paper) : null })),
      consents, consentTexts: CONSENTS,
      plan: { broker, blends, liveCopies: live, paperCopies: limits().paperCopies },
      setup: { ...brokerSetup(), tradingEnabled: tradingEnabled(), maxOrderUsd: limits().maxOrderUsd, maxDayUsd: limits().maxDayUsd },
    });
  });
}

const summary = (p: Record<string, unknown>) => {
  const ev = (p.events as { date: string; cash: number; units: Record<string, number> }[] | undefined) ?? [];
  return ev.length ? { startCash: p.startCash, startedAt: p.startedAt, positions: Object.keys(ev.at(-1)!.units).length, lastRebalance: ev.at(-1)!.date } : null;
};

/** POST — create a copy (paper is free; live needs copytrade.broker, a blend copytrade.blends). */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const row = await createCopy(user, body, requestMeta(req));
    return NextResponse.json({ id: row.id }, { status: 201 });
  });
}
