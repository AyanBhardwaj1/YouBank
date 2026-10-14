import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { padCik } from "@/lib/copytrade/funds";

export const dynamic = "force-dynamic";

/** GET — funds the person follows (alerts on each new 13F). Free. */
export async function GET() {
  return guarded(async (user) => {
    const rows = await requireDb().select({ cik: schema.copyFollows.cik, since: schema.copyFollows.createdAt, name: schema.copyFilers.name, latestFiled: schema.copyFilers.latestFiled, latestPeriod: schema.copyFilers.latestPeriod })
      .from(schema.copyFollows).leftJoin(schema.copyFilers, eq(schema.copyFilers.cik, schema.copyFollows.cik)).where(eq(schema.copyFollows.userId, user.id)).orderBy(desc(schema.copyFollows.createdAt));
    return NextResponse.json({ follows: rows });
  });
}

/** POST { cik } — follow a fund. DELETE { cik } — stop. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const cik = padCik(String(((await req.json().catch(() => ({}))) as { cik?: unknown }).cik ?? ""));
    if (!cik) return NextResponse.json({ error: "Choose a fund to follow." }, { status: 400 });
    const db = requireDb();
    const n = await db.$count(schema.copyFollows, eq(schema.copyFollows.userId, user.id));
    if (n >= 50) return NextResponse.json({ error: "You can follow up to 50 funds." }, { status: 400 });
    await db.insert(schema.copyFollows).values({ userId: user.id, cik }).onConflictDoNothing();
    return NextResponse.json({ ok: true, following: true });
  });
}

export async function DELETE(req: Request) {
  return guarded(async (user) => {
    const cik = padCik(String(((await req.json().catch(() => ({}))) as { cik?: unknown }).cik ?? ""));
    await requireDb().delete(schema.copyFollows).where(and(eq(schema.copyFollows.userId, user.id), eq(schema.copyFollows.cik, cik)));
    return NextResponse.json({ ok: true, following: false });
  });
}
