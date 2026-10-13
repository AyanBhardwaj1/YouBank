import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { studioTrail } from "@/lib/crypto/studio-trail";

export const dynamic = "force-dynamic";

/** A Studio model's audit trail as canonical text, for the browser to hash and notarize. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Unknown model" }, { status: 400 });
    return NextResponse.json(await studioTrail(user, id), { headers: { "cache-control": "no-store" } });
  });
}
