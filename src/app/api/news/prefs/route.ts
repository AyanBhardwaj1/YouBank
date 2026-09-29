import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { encryptToken, encryptionReady } from "@/lib/crm/crypto";
import { budgetStatus } from "@/lib/news/budget";
import { deskBrief } from "@/lib/news/brief";
import { alertEmail, briefEmail, briefSlack, emailSelf, isSlackWebhook, pushReady, pushToUser, slackPost } from "@/lib/news/deliver";
import { allDesks, SECTOR_KEYS, SECTOR_LABEL } from "@/lib/news/desks";
import { EDITIONS, LAYOUTS, LOOKS, normalizeNewsPrefs, publicPrefs } from "@/lib/news/prefs";
import { readerFor } from "@/lib/news/reader";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function mailbox(userId: string) {
  const [a] = await requireDb().select({ address: schema.emailAccounts.address, provider: schema.emailAccounts.provider }).from(schema.emailAccounts)
    .where(and(eq(schema.emailAccounts.userId, userId), eq(schema.emailAccounts.status, "connected")));
  return a ?? null;
}

/** News preferences, the choices behind them, and what delivery channels are ready. */
export async function GET() {
  return guarded(async (user) => {
    const ctx = await readerFor(user.id);
    if (!ctx) return NextResponse.json({ error: "Finish onboarding first" }, { status: 409 });
    const [box, budget, [{ n }]] = await Promise.all([
      mailbox(user.id), budgetStatus(),
      requireDb().select({ n: schema.newsPushSubs.id }).from(schema.newsPushSubs).where(eq(schema.newsPushSubs.userId, user.id)).then((r) => [{ n: r.length }]),
    ]);
    return NextResponse.json({
      prefs: publicPrefs(ctx.prefs), editions: EDITIONS, looks: LOOKS, layouts: LAYOUTS,
      desks: allDesks().map((d) => ({ id: d.id, label: d.label })), ownDesk: { id: ctx.ownDesk.id, label: ctx.ownDesk.label },
      sectors: SECTOR_KEYS.map((id) => ({ id, label: id === "tech" ? "Technology" : SECTOR_LABEL[id] })), ownSector: ctx.desk.sectors[0] ?? ctx.ownDesk.sectors[0] ?? "tech",
      channels: { email: box ? { address: box.address, provider: box.provider } : null, push: { ready: pushReady(), key: process.env.NEWS_VAPID_PUBLIC_KEY ?? "", devices: n }, slack: { ready: encryptionReady() } },
      budget,
    });
  });
}

/** Update preferences (merged over what is stored); { slackWebhook } sets or clears Slack; { test: "email" | "push" | "slack" } sends a test. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const db = requireDb();
    const [row] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
    if (!row) return NextResponse.json({ error: "Finish onboarding first" }, { status: 409 });
    const extra = { ...((row.extra ?? {}) as Record<string, unknown>) };
    const stored = (extra.news && typeof extra.news === "object" ? extra.news : {}) as Record<string, unknown>;
    const origin = new URL(req.url).origin;

    if (typeof body.test === "string") {
      const ctx = await readerFor(user.id);
      if (!ctx) return NextResponse.json({ error: "Finish onboarding first" }, { status: 409 });
      try {
        if (body.test === "email") {
          const b = await deskBrief(ctx.desk);
          const address = await emailSelf(user.id, origin, b.items.length ? briefEmail(b, [], origin, "a test") : alertEmail({ title: "Your YouBank alerts are connected", body: "This is a test.", url: "/app/news", reasons: [] }, origin));
          return NextResponse.json({ ok: true, message: `Sent to ${address}.` });
        }
        if (body.test === "push") {
          const n = await pushToUser(user.id, { title: "YouBank alerts are on", body: "Alerts and your morning brief will arrive here.", url: "/app/news", tag: "test" });
          return NextResponse.json({ ok: n > 0, message: n ? `Sent to ${n} device${n === 1 ? "" : "s"}.` : "No device has push switched on yet." });
        }
        if (body.test === "slack") {
          if (!ctx.prefs.slack) return NextResponse.json({ ok: false, message: "Add a Slack webhook first." });
          const b = await deskBrief(ctx.desk);
          const s = briefSlack(b, origin);
          await slackPost(ctx.prefs.slack, `Test from YouBank. ${s.text}`, s.blocks);
          return NextResponse.json({ ok: true, message: "Posted to Slack." });
        }
      } catch (e) {
        return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : String(e) });
      }
      return NextResponse.json({ error: "Unknown test" }, { status: 400 });
    }

    const next: Record<string, unknown> = { ...stored, ...(body.prefs && typeof body.prefs === "object" ? (body.prefs as Record<string, unknown>) : {}) };
    delete next.slackConnected;
    if (typeof body.slackWebhook === "string") {
      const url = body.slackWebhook.trim();
      if (!url) delete next.slack;
      else if (!isSlackWebhook(url)) return NextResponse.json({ error: "That is not a Slack incoming-webhook URL (https://hooks.slack.com/…)" }, { status: 400 });
      else if (!encryptionReady()) return NextResponse.json({ error: "Encryption is not configured on this server" }, { status: 500 });
      else next.slack = encryptToken(url);
    } else if (typeof stored.slack === "string") next.slack = stored.slack;
    const prefs = normalizeNewsPrefs(next, { role: row.role as never });
    extra.news = prefs;
    await db.update(schema.profiles).set({ extra, updatedAt: new Date() }).where(eq(schema.profiles.userId, user.id));
    return NextResponse.json({ prefs: publicPrefs(prefs) });
  });
}
