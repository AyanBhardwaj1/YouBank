import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { createKey, listKeys, revokeKey } from "@/lib/mcp/store";

export const dynamic = "force-dynamic";

/** GET: the person's MCP keys (name, last four characters, created, last used; never the key). */
export async function GET() {
  return guarded(async (user) => NextResponse.json({ keys: await listKeys(user.id) }, { headers: { "Cache-Control": "private, no-store" } }));
}

/** POST { name }: a new key, returned once in full. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await rateLimit(`mcp-key-new:${user.id}`, 10, 3_600_000, "Many keys were made this hour. Try again later.");
    const { name } = ((await req.json().catch(() => ({}))) ?? {}) as { name?: unknown };
    const { key, view } = await createKey(user.id, typeof name === "string" ? name : "");
    return NextResponse.json({ key, view }, { headers: { "Cache-Control": "no-store" } });
  });
}

/** DELETE ?id=: revoke a key. Apps using it stop working at once. */
export async function DELETE(req: Request) {
  return guarded(async (user) => {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!/^[a-f0-9]{12}$/.test(id)) return NextResponse.json({ error: "That key was not found." }, { status: 400 });
    await revokeKey(user.id, id);
    return NextResponse.json({ ok: true });
  });
}
