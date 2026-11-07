import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { dismissProposal } from "@/lib/book/store";

export const dynamic = "force-dynamic";

/** DELETE ?id=: a proposal from an AI app, dismissed (or added: the editor saves the position, then this clears it). */
export async function DELETE(req: Request) {
  return guarded(async (user) => {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!/^[a-z0-9-]{4,40}$/.test(id)) return NextResponse.json({ error: "That proposal was not found." }, { status: 400 });
    await dismissProposal(user.id, id);
    return NextResponse.json({ ok: true });
  });
}
