import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { parseAnchors } from "@/lib/ledger/chain";
import { chainAnchors, checkAnchors, verifyAll } from "@/lib/ledger/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET: recompute every hash in the person's ledger and say whether the chain is intact, and check every
 * head they anchored on chain. POST { text }: also check head lines they kept outside YouBank.
 */
async function check(userId: string, text: string) {
  await rateLimit(`ledger-verify:${userId}`, 30, 3_600_000, "The ledger was checked many times this hour. Try again later.");
  const [chain, onChain, saved] = await Promise.all([verifyAll(userId), chainAnchors(userId), checkAnchors(userId, parseAnchors(text))]);
  return NextResponse.json({ ...chain, anchors: [...saved, ...onChain], at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return guarded((user) => check(user.id, ""));
}

export async function POST(req: Request) {
  return guarded(async (user) => {
    const { text } = ((await req.json().catch(() => ({}))) ?? {}) as { text?: unknown };
    if (typeof text !== "string" || !text.trim()) return NextResponse.json({ error: "Paste a head line you saved: it names the entry and its hash." }, { status: 400 });
    if (!/[0-9a-f]{64}/i.test(text)) return NextResponse.json({ error: "No 64-character hash was found in what you pasted." }, { status: 400 });
    return check(user.id, text.slice(0, 20_000));
  });
}
