import { after, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { edgeProfile, saveEdge, type Blend } from "@/lib/edge/access";
import { starterCanvas } from "@/lib/edge/onboard";
import { edgeState } from "@/lib/edge/state";
import { checkWatch, seedWatches } from "@/lib/edge/watches";
import type { Profile, RoleId } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Edge for this person: whether the beta is on, their watches and limits, and what they can watch. */
export async function GET() {
  return guarded(async (user) => {
    const p = await edgeProfile(user.id);
    if (!p) return NextResponse.json({ error: "Finish setting up your profile first." }, { status: 400 });
    return NextResponse.json(await edgeState(user.id, p.prefs.beta, p.prefs.since, p.prefs.blend));
  });
}

/**
 * Turn the beta on or off, or change how the feed is ranked. Turning it on the first time pins the tab,
 * seeds three watches from the person's desk, builds and runs a first canvas for their role, and starts
 * checking the watches, after the response.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { beta?: unknown; blend?: Partial<Blend> } | null;
    if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
    let prefs = (await edgeProfile(user.id))?.prefs;
    if (!prefs) return NextResponse.json({ error: "Finish setting up your profile first." }, { status: 400 });
    if (typeof body.beta === "boolean") {
      prefs = await saveEdge(user.id, { beta: body.beta }, { pin: body.beta });
      if (body.beta && !prefs.seeded) {
        const [row] = await requireDb().select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
        const profile: Profile = { role: row.role as RoleId, specialty: row.specialty, seniority: row.seniority, firmType: row.firmType, firmName: row.firmName, firmTicker: row.firmTicker, sectors: row.sectors, goals: row.goals, name: user.name };
        const seeded = await seedWatches(user.id, profile);
        prefs = await saveEdge(user.id, { seeded: true });
        const deadline = Date.now() + 50_000;
        const tickers = seeded.filter((w) => w.kind === "company" && w.target.ticker).map((w) => w.target.ticker!);
        after(async () => {
          // A first canvas, built for their role and run, then the watches' first checks.
          await starterCanvas(user, profile.role, tickers);
          for (const w of seeded) await checkWatch(w, deadline, 2);
        });
      }
    }
    if (body.blend && typeof body.blend === "object") {
      if (!prefs.beta) return NextResponse.json({ error: "Turn on the Edge beta first." }, { status: 403 });
      prefs = await saveEdge(user.id, { blend: body.blend });
    }
    return NextResponse.json(await edgeState(user.id, prefs.beta, prefs.since, prefs.blend));
  });
}
