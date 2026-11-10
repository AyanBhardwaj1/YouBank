import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { addNote } from "@/lib/book/store";

export const dynamic = "force-dynamic";

/** POST { id, text }: a dated note in a position's decision journal (src/lib/book/decisions.ts). */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const { id, text } = ((await req.json().catch(() => ({}))) ?? {}) as { id?: unknown; text?: unknown };
    if (typeof id !== "string" || typeof text !== "string" || !text.trim()) return NextResponse.json({ error: "Write the note first." }, { status: 400 });
    await rateLimit(`book-note:${user.id}`, 30, 86_400_000, "That is many notes for one day. Try again tomorrow.");
    const p = await addNote(user.id, id, text);
    if (!p) return NextResponse.json({ error: "That position was not found." }, { status: 404 });
    return NextResponse.json({ log: p.log ?? [] });
  });
}
