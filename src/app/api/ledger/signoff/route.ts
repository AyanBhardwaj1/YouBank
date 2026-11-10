import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { signOff } from "@/lib/ledger/store";

export const dynamic = "force-dynamic";

/** POST { seq, decision, note }: a person's review of an entry, appended to the chain as its own entry. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await rateLimit(`ledger-signoff:${user.id}`, 300, 3_600_000, "Many reviews this hour. Try again later.");
    const b = ((await req.json().catch(() => ({}))) ?? {}) as { seq?: unknown; decision?: unknown; note?: unknown };
    const decision = b.decision === "approved" || b.decision === "rejected" ? b.decision : "noted";
    const seq = Number(b.seq);
    if (!Number.isInteger(seq) || seq < 1) return NextResponse.json({ error: "That entry was not found." }, { status: 400 });
    const entry = await signOff(user.id, seq, user.name ? `${user.name} <${user.email}>` : user.email, decision, typeof b.note === "string" ? b.note : "");
    if (!entry) return NextResponse.json({ error: "That entry was not found, or is itself a review." }, { status: 404 });
    return NextResponse.json({ entry });
  });
}
