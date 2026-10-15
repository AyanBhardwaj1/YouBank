import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { isAdmin } from "@/lib/auth/admin";
import { canUse } from "@/lib/billing/entitlements";
import { CROSS_SITE, jsonBody, refuse, sameSiteJson } from "@/lib/quant/access";
import { parse605, parse606, summarise605 } from "@/lib/quant/tca/rules";
import { scorecard, setScorecard } from "@/lib/quant/tca/run";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET ?broker= — brokers' Rule 605 and 606 figures (public disclosures). Free: the named broker's latest summary;
 * quant.tca-pro: every broker and every report loaded.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const cards = await scorecard();
    const pro = await canUse(user, "quant.tca-pro");
    const want = (new URL(req.url).searchParams.get("broker") ?? "").toLowerCase();
    const shown = pro ? cards : cards.filter((c) => want && c.broker.toLowerCase().includes(want)).slice(0, 2);
    return NextResponse.json({ brokers: cards.map((c) => c.broker), cards: shown, locked: !pro, note: "Each figure is the broker's or market center's own public Rule 605 or 606 disclosure, as filed." });
  });
}

/** POST { broker, xml606? | text605?, source } — an administrator loads a broker's report (public data, parsed and kept). */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    if (!isAdmin(user)) throw refuse("Only administrators load broker reports.", 403);
    const b = await jsonBody(req);
    const broker = String(b.broker ?? "").trim().slice(0, 80);
    if (!broker) throw refuse("Name the broker.");
    const source = String(b.source ?? "").slice(0, 300);
    if (typeof b.xml606 === "string") return NextResponse.json({ cards: await setScorecard({ broker, r606: parse606(b.xml606), source, loadedAt: new Date().toISOString() }) });
    if (typeof b.text605 === "string") return NextResponse.json({ cards: await setScorecard({ broker, r605: summarise605(parse605(b.text605)), source, loadedAt: new Date().toISOString() }) });
    throw refuse("Send xml606 or text605.");
  });
}
