import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit, withinRate } from "@/lib/locks";
import { bookAlertsOn, deletePosition, evaluateBook, loadBook, loadProposals, noteHistory, savePosition, setBookAlerts, warmInsiders } from "@/lib/book/store";
import { cachedInsiderFact } from "@/lib/book/insiders-store";
import { cachedRisk, riskOf } from "@/lib/book/risk-store";
import { inBackground } from "@/lib/cache";
import type { Position } from "@/lib/book/position";
import { summarize } from "@/lib/book/position";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET: the person's book: each position, where its kill criteria stand now, exposure, and positions their AI apps proposed (src/lib/book). */
export async function GET() {
  return guarded(async (user) => {
    await rateLimit(`book-check:${user.id}`, 240, 3_600_000, "The book was checked many times this hour. Try again in a few minutes.");
    const positions = await loadBook(user.id);
    const evaluations = await evaluateBook(positions);
    // Today's point in each thesis's history (the daily check writes it too); a failure only costs the point.
    // Warm the risk panel after the answer: prices are fetched once per book and day, so opening it is instant.
    // At most six warm-ups an hour per person (Home polls this too), and none when today's figures are cached.
    if (positions.some((p) => p.weight)) inBackground((async () => { if (!(await cachedRisk(positions)) && (await withinRate(`book-risk-warm:${user.id}`, 6, 3_600_000).catch(() => false))) await riskOf(positions); })());
    const [history, alerts, proposals] = await Promise.all([noteHistory(user.id, evaluations).catch(() => ({})), bookAlertsOn(user.id).catch(() => true), loadProposals(user.id).catch(() => [])]);
    // Each name's one-year volatility, when today's risk is already worked out (never computed for this): the
    // card's price base rate for a forecast (baserate.ts).
    const risk = positions.some((p) => p.weight) ? await cachedRisk(positions).catch(() => null) : null;
    const vols = Object.fromEntries((risk?.positions ?? []).filter((x) => x.vol !== null).map((x) => [x.ticker, x.vol as number]));
    return NextResponse.json({ positions, evaluations, summary: summarize(evaluations), history, alerts, proposals, vols }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

/** POST a position: added, or replaced by id. Cleaned on the server (src/lib/book/position.ts normalizePosition). POST { alerts }: the daily check's alerts on or off. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = await req.json().catch(() => null);
    if (body && typeof body === "object" && Object.keys(body).length === 1 && typeof (body as { alerts?: unknown }).alerts === "boolean") {
      return NextResponse.json({ alerts: await setBookAlerts(user.id, (body as { alerts: boolean }).alerts) });
    }
    const saved = await savePosition(user.id, body);
    if (!saved) return NextResponse.json({ error: "A position needs a ticker and a one-line thesis." }, { status: 400 });
    // An insider-selling criterion: work the figure out now, after the answer, rather than at the next close.
    const p = saved as Position;
    if (p.criteria.some((c) => c.metric === "insider_selling") && !(await cachedInsiderFact(p.ticker))) inBackground(warmInsiders([p.ticker], Date.now() + 60_000));
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
