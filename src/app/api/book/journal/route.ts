import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { CLOSE_REASONS, scorecard, type CloseReason } from "@/lib/book/journal";
import { closePosition, deleteClosed, loadJournal } from "@/lib/book/store";

export const dynamic = "force-dynamic";

/** GET: the track record: closed positions, newest first, and the scorecard over them. */
export async function GET() {
  return guarded(async (user) => {
    const closed = await loadJournal(user.id);
    return NextResponse.json({ closed, scorecard: scorecard(closed) }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

/** POST { id, exit?, reason, note? }: close a position into the track record (nothing is traded). */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await rateLimit(`book-close:${user.id}`, 120, 3_600_000, "Many positions were closed this hour. Try again later.");
    const b = ((await req.json().catch(() => ({}))) ?? {}) as { id?: unknown; exit?: unknown; reason?: unknown; note?: unknown };
    const id = typeof b.id === "string" && /^[a-z0-9-]{4,40}$/.test(b.id) ? b.id : null;
    if (!id) return NextResponse.json({ error: "That position was not found." }, { status: 400 });
    const reason: CloseReason = typeof b.reason === "string" && b.reason in CLOSE_REASONS ? (b.reason as CloseReason) : "other";
    const exit = typeof b.exit === "number" && Number.isFinite(b.exit) && b.exit > 0 ? b.exit : null;
    const closed = await closePosition(user.id, id, { exit, reason, note: typeof b.note === "string" ? b.note : "" });
    if (!closed) return NextResponse.json({ error: "That position is no longer in the book." }, { status: 404 });
    return NextResponse.json({ closed });
  });
}

/** DELETE ?id=: remove a record from the track record (one closed by mistake). */
export async function DELETE(req: Request) {
  return guarded(async (user) => {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!/^[a-z0-9-]{4,40}$/.test(id)) return NextResponse.json({ error: "That record was not found." }, { status: 400 });
    await deleteClosed(user.id, id);
    return NextResponse.json({ ok: true });
  });
}
