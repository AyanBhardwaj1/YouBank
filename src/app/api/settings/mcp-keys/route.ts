import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { createKey, listKeys, revokeKey, setPolicy } from "@/lib/mcp/store";
import { record } from "@/lib/ledger/store";

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

/**
 * PATCH { id, paused?, book?, propose? }: what a connected app may do. Pausing stops every call at once;
 * the Book and proposing can be withheld. The change goes in the research ledger (when it is on), so the
 * record shows who could do what, and when.
 */
export async function PATCH(req: Request) {
  return guarded(async (user) => {
    const b = ((await req.json().catch(() => ({}))) ?? {}) as { id?: unknown; paused?: unknown; book?: unknown; propose?: unknown };
    const id = typeof b.id === "string" && /^[a-f0-9]{12}$/.test(b.id) ? b.id : null;
    if (!id) return NextResponse.json({ error: "That key was not found." }, { status: 400 });
    const change = Object.fromEntries((["paused", "book", "propose"] as const).filter((k) => typeof b[k] === "boolean").map((k) => [k, b[k] as boolean]));
    const res = await setPolicy(user.id, id, change);
    if (!res) return NextResponse.json({ error: "That key was not found." }, { status: 404 });
    const p = res.view.policy;
    const what = p.paused ? "paused: every call refused" : `active; may read the Book: ${p.book ? "yes" : "no"}; may propose positions: ${p.propose ? "yes" : "no"}`;
    await record(user.id, { kind: "note", subject: `AI app access changed: ${res.view.name}`, output: `${res.view.name} (${res.view.hint}) is now ${what}. Before: ${res.before.paused ? "paused" : `Book ${res.before.book ? "yes" : "no"}, propose ${res.before.propose ? "yes" : "no"}`}.`, meta: { key: id, policy: p, before: res.before } }).catch(() => undefined);
    return NextResponse.json({ view: res.view });
  });
}
