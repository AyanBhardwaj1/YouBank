import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { isScheme } from "@/lib/edge/entities/crosswalk";
import { isEditor } from "@/lib/edge/entities/editors";
import { companyNode, correctLink, decideLink, entityIds, resolveEntity, reviewQueue } from "@/lib/edge/entities/resolve";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/**
 * The entity crosswalk (F1). GET ?node=ID or ?ticker=ET: a company's ids in every scheme with each link's
 * method, confidence and evidence (links waiting for review included, marked); ?review=1 (editors): the
 * review queue. POST (editors only): { action: "confirm" | "reject", id } or { action: "correct", node,
 * scheme, value, evidence } or { action: "resolve", ticker | node } to look again now.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const q = new URL(req.url).searchParams;
    if (q.get("review") === "1") {
      if (!isEditor(user)) return NextResponse.json({ error: "Only editors can see the review queue." }, { status: 403 });
      return NextResponse.json({ queue: await reviewQueue(Number(q.get("limit")) || 50) });
    }
    const ticker = (q.get("ticker") ?? "").toUpperCase();
    const node = Number(q.get("node")) || (TICKER.test(ticker) ? (await companyNode(ticker))?.id ?? 0 : 0);
    if (!node) return NextResponse.json({ error: "Give a company: ?ticker= or ?node=." }, { status: 400 });
    const links = await entityIds(node, { includeReview: true });
    return NextResponse.json({ node, editor: isEditor(user), links: links.map((l) => ({ id: l.id, scheme: l.scheme, value: l.value, confidence: l.confidence, method: l.method, evidenceUrl: l.evidenceUrl, status: l.status, verified: !!l.verifiedBy, updatedAt: l.updatedAt.toISOString() })) }, { headers: { "cache-control": "private, max-age=30" } });
  });
}

export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    if (!isEditor(user)) return NextResponse.json({ error: "Only editors can change the crosswalk. Ask an administrator to add you to EDGE_EDITOR_EMAILS." }, { status: 403 });
    const body = (await req.json().catch(() => ({}))) as { action?: string; id?: number; node?: number; ticker?: string; scheme?: string; value?: string; evidence?: string; note?: string };
    if (body.action === "confirm" || body.action === "reject") {
      const row = await decideLink(user.id, Number(body.id), body.action === "confirm", String(body.note ?? ""));
      return row ? NextResponse.json({ ok: true, link: row }) : NextResponse.json({ error: "That link does not exist." }, { status: 404 });
    }
    if (body.action === "correct") {
      const scheme = String(body.scheme ?? "");
      const value = String(body.value ?? "").trim();
      if (!isScheme(scheme) || !value || !(Number(body.node) > 0)) return NextResponse.json({ error: "Give the company, the scheme and the right value." }, { status: 400 });
      return NextResponse.json({ ok: true, link: await correctLink(user.id, Number(body.node), scheme, value, String(body.evidence ?? "")) });
    }
    if (body.action === "resolve") {
      await rateLimit(`edge-entities-resolve:${user.id}`, 20, 3_600_000, "Many look-ups this hour. Try again later.");
      const ticker = String(body.ticker ?? "").toUpperCase();
      const node = Number(body.node) || (TICKER.test(ticker) ? (await companyNode(ticker))?.id ?? 0 : 0);
      if (!node) return NextResponse.json({ error: "That company is not in SEC's list." }, { status: 404 });
      return NextResponse.json(await resolveEntity(node, Date.now() + 90_000));
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  });
}
