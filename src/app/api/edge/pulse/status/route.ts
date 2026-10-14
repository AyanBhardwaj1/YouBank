import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { guarded } from "@/lib/auth/user";
import { isAdmin } from "@/lib/auth/admin";
import { requireEdge } from "@/lib/edge/access";
import { warnStatus } from "@/lib/edge/pulse/ingest";
import { weeklyCursor } from "@/lib/edge/pulse/jobs";
import { patentsviewReady } from "@/lib/edge/pulse/sources/patentsview";
import { seriesSize } from "@/lib/edge/series/store";
import { titleAiOn } from "@/lib/edge/pulse/titles";

export const dynamic = "force-dynamic";

/**
 * The Pulse's health for administrators (E3): each WARN parser's last good read (stale after three weeks),
 * the weekly pass's cursor, the placebo rates, whether the PatentsView key and the title model are set, and
 * the signal store's size.
 */
export async function GET() {
  return guarded(async (user) => {
    await requireEdge(user.id);
    if (!isAdmin(user)) return NextResponse.json({ error: "Only administrators see the Pulse's status." }, { status: 403 });
    const [placebo] = (await requireDb().execute(sql`select state from edge_job_state where name = 'pulse.placebo'`)).rows as { state: unknown }[];
    return NextResponse.json({ warn: await warnStatus(), weekly: await weeklyCursor(), placebo: placebo?.state ?? {}, patentsview: patentsviewReady(), titleAi: titleAiOn(), store: await seriesSize() });
  });
}
