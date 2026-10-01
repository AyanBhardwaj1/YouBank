import { NextResponse } from "next/server";
import { requireEdge } from "@/lib/edge/access";
import { kindOfValue } from "@/lib/edge/canvas/values";
import { createPush, pendingPushes } from "@/lib/edge/push";
import { rateLimit } from "@/lib/locks";
import { guardedFor } from "@/lib/office/auth";

export const dynamic = "force-dynamic";

/**
 * Edge results waiting for review in a Studio model: GET ?doc=ID lists them with what each would add
 * (for Studio and the Office add-in, for anyone who can see the model). POST { docId?, title, source,
 * items: [{ label, value }] } queues one from Edge (a new model when docId is empty).
 */
export async function GET(req: Request) {
  return guardedFor(req, async (user) => {
    const doc = Number(new URL(req.url).searchParams.get("doc"));
    if (!Number.isInteger(doc) || doc <= 0) return NextResponse.json({ error: "Pick a model." }, { status: 400 });
    return NextResponse.json({ pushes: await pendingPushes(user, doc) });
  });
}

export async function POST(req: Request) {
  return guardedFor(req, async (user) => {
    await requireEdge(user.id);
    await rateLimit(`edge-push:${user.id}`, 60, 3_600_000, "Many pushes to Studio this hour; try again later.");
    const b = (await req.json().catch(() => ({}))) as { docId?: unknown; title?: unknown; source?: unknown; items?: unknown };
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 12).flatMap((i) => {
      const it = i as { label?: unknown; value?: unknown };
      const kind = kindOfValue(it.value);
      return kind ? [{ kind, label: String(it.label ?? kind).slice(0, 60), value: it.value }] : [];
    });
    if (JSON.stringify(items).length > 2_000_000) return NextResponse.json({ error: "That is too large to push; export it instead." }, { status: 413 });
    const docId = Number(b.docId) > 0 ? Number(b.docId) : null;
    const r = await createPush(user, { docId, title: String(b.title ?? "From Edge").slice(0, 140), source: String(b.source ?? "edge").slice(0, 120), items });
    return NextResponse.json({ ...r, url: `/app/studio/${r.docId}` });
  });
}
