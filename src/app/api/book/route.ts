import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { deletePosition, evaluateBook, loadBook, savePosition } from "@/lib/book/store";
import { summarize } from "@/lib/book/position";

export const dynamic = "force-dynamic";

/** GET: the person's book: each position, where its kill criteria stand now, and exposure (src/lib/book). */
export async function GET() {
  return guarded(async (user) => {
    await rateLimit(`book-check:${user.id}`, 240, 3_600_000, "The book was checked many times this hour. Try again in a few minutes.");
    const positions = await loadBook(user.id);
    const evaluations = await evaluateBook(positions);
    return NextResponse.json({ positions, evaluations, summary: summarize(evaluations) }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

/** POST a position: added, or replaced by id. Cleaned on the server (src/lib/book/position.ts normalizePosition). */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = await req.json().catch(() => null);
    const saved = await savePosition(user.id, body);
    if (!saved) return NextResponse.json({ error: "A position needs a ticker and a one-line thesis." }, { status: 400 });
    return NextResponse.json({ position: saved });
  });
}

/** DELETE ?id=: close a position. */
export async function DELETE(req: Request) {
  return guarded(async (user) => {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!/^[a-z0-9-]{4,40}$/.test(id)) return NextResponse.json({ error: "That position was not found." }, { status: 400 });
    await deletePosition(user.id, id);
    return NextResponse.json({ ok: true });
  });
}
