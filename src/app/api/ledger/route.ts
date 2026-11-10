import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { isMissingTable } from "@/lib/errors";
import { KINDS, type LedgerKind } from "@/lib/ledger/chain";
import { headLine } from "@/lib/ledger/chain";
import { anchorByEmail } from "@/lib/ledger/anchor";
import { ledgerHead, ledgerSettings, listEntries, setLedger, updateLedgerPrefs } from "@/lib/ledger/store";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";

/** GET ?before=&kind=: the person's research ledger, newest first, with its setting. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const q = new URL(req.url).searchParams;
    const before = Number(q.get("before")) || undefined;
    const kind = (KINDS as readonly string[]).includes(q.get("kind") ?? "") ? (q.get("kind") as LedgerKind) : undefined;
    const settings = await ledgerSettings(user.id);
    try {
      const [page, head] = await Promise.all([listEntries(user.id, { before, kind, limit: 30 }), ledgerHead(user.id)]);
      return NextResponse.json({ available: true, settings, ...page, head: head ? { ...head, line: headLine(user.email, head) } : null }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (e) {
      if (!isMissingTable(e)) throw e;
      return NextResponse.json({ available: false, settings, entries: [], total: 0, reviewed: {} });
    }
  });
}

/**
 * POST { on }: keep a ledger from now on, or stop (what is kept stays). POST { anchorEmail, complianceEmail }:
 * email the chain's head every day it moved (src/lib/ledger/anchor.ts); { anchorNow: true } sends one now.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const b = ((await req.json().catch(() => ({}))) ?? {}) as { on?: unknown; anchorEmail?: unknown; complianceEmail?: unknown; anchorNow?: unknown };
    if (b.anchorNow === true) {
      await rateLimit(`ledger-anchor-now:${user.id}`, 10, 3_600_000, "Several anchors were sent this hour. Try again later.");
      const sent = await anchorByEmail(user.id, user.email).catch((e: unknown) => {
        // No mailbox connected is the person's to fix, not ours: say so plainly.
        if (e instanceof Error && /no connected mailbox/i.test(e.message)) throw Object.assign(new Error("Connect a mailbox in Relationships first: anchors are emailed from your own mailbox."), { status: 409 });
        throw e;
      });
      return NextResponse.json({ sent, settings: await ledgerSettings(user.id) });
    }
    if (typeof b.on === "boolean") return NextResponse.json({ settings: await setLedger(user.id, b.on) });
    return NextResponse.json({ settings: await updateLedgerPrefs(user.id, {
      ...(typeof b.anchorEmail === "boolean" ? { anchorEmail: b.anchorEmail } : {}),
      ...(typeof b.complianceEmail === "string" ? { complianceEmail: b.complianceEmail.slice(0, 200) } : {}),
    }) });
  });
}
