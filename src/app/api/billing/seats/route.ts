import { NextResponse } from "next/server";
import { forgetAiCaps } from "@/lib/ai/limits";
import { guarded } from "@/lib/auth/user";
import { entitlements } from "@/lib/billing/entitlements";
import { assignSeat, releaseSeat, seatBoard, SeatError } from "@/lib/billing/seats";

export const dynamic = "force-dynamic";

/**
 * Deal Team and Enterprise seats. GET answers the owner's board (`{ board }`: seats, who holds one, and
 * who on their teams could) and, for anyone, the seat they hold (`{ seat }`). POST `{ userId, teamId }`
 * gives a seat to a member of a team the owner owns or administers; DELETE `{ userId }` takes it back
 * (the owner) or gives it up (the holder, with their own id). Seat counts change in the billing portal.
 */
export async function GET() {
  return guarded(async (user) => {
    const [board, ent] = await Promise.all([seatBoard(user.id).catch(() => null), entitlements(user)]);
    return NextResponse.json({ board, seat: ent.seat });
  });
}

export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { userId?: unknown; teamId?: unknown } | null;
    const teamId = Number(body?.teamId);
    if (typeof body?.userId !== "string" || !body.userId || !Number.isInteger(teamId)) throw new SeatError("Choose a person on one of your teams.");
    await assignSeat(user.id, body.userId, teamId);
    forgetAiCaps(body.userId);
    return NextResponse.json({ board: await seatBoard(user.id) });
  });
}

export async function DELETE(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { userId?: unknown } | null;
    if (typeof body?.userId !== "string" || !body.userId) throw new SeatError("Choose whose seat to free.");
    if (!(await releaseSeat(user.id, body.userId))) throw new SeatError("That seat is not yours to free.", 404);
    forgetAiCaps(body.userId);
    return NextResponse.json({ board: await seatBoard(user.id).catch(() => null) });
  });
}
