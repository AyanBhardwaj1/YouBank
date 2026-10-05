/**
 * What the desktop app turns into native notifications. One read-only query per poll, over what the
 * site already records; nothing here runs a model or calls a paid service, so the app may poll it from
 * the tray (every few minutes at most; the route limits it):
 * - alerts: the bell (`news_notifications`), which already carries Edge's big findings, briefs and
 *   radar alerts, in the person's own alert rules;
 * - questions: the email agent waiting on an answer before it can finish a draft (`crm_questions`);
 * - deals: something new about a deal in the person's pipeline (`crm_signals` with a deal), such as an
 *   Edge finding or a filing about its company. A deal the person moved themselves is not news to them,
 *   so stage changes are not sent.
 */
import { and, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { requireDb, schema } from "@/db";

export type DesktopNotice = {
  /** Stable per item, so the app shows each once: `n:12`, `q:4`, `d:9`. */
  id: string;
  kind: "alert" | "brief" | "question" | "deal";
  title: string;
  body: string;
  /** A path on the site to open when the person clicks it. */
  url: string;
  urgent: boolean;
  at: string;
};

const MAX_LOOKBACK_MS = 3 * 86_400_000;

/** Where to start reading: the app's cursor, never more than three days back (a laptop back from a holiday should not get a flood). Pure. */
export function feedSince(raw: string | null, now = Date.now()): Date {
  const t = raw ? Date.parse(raw) : NaN;
  const floor = now - MAX_LOOKBACK_MS;
  if (!Number.isFinite(t)) return new Date(now - 3_600_000);
  return new Date(Math.min(Math.max(t, floor), now));
}

/** Only paths on our own site go back to the app, so a notification can never open somewhere else. Pure. */
export const sitePath = (url: string, fallback: string) => (/^\/(?!\/)/.test(url) ? url.slice(0, 500) : fallback);

export async function desktopFeed(userId: string, since: Date, kinds: { alerts: boolean; questions: boolean; deals: boolean }): Promise<DesktopNotice[]> {
  const db = requireDb();
  const [alerts, questions, deals] = await Promise.all([
    kinds.alerts
      ? db.select().from(schema.newsNotifications)
        .where(and(eq(schema.newsNotifications.userId, userId), gt(schema.newsNotifications.createdAt, since), isNull(schema.newsNotifications.readAt)))
        .orderBy(desc(schema.newsNotifications.createdAt)).limit(20)
      : [],
    kinds.questions
      ? db.select({ id: schema.crmQuestions.id, question: schema.crmQuestions.question, createdAt: schema.crmQuestions.createdAt }).from(schema.crmQuestions)
        .where(and(eq(schema.crmQuestions.userId, userId), eq(schema.crmQuestions.status, "open"), gt(schema.crmQuestions.createdAt, since)))
        .orderBy(desc(schema.crmQuestions.createdAt)).limit(10)
      : [],
    kinds.deals
      ? db.select({ id: schema.crmSignals.id, title: schema.crmSignals.title, detail: schema.crmSignals.detail, createdAt: schema.crmSignals.createdAt, deal: schema.crmDeals.name })
        .from(schema.crmSignals).innerJoin(schema.crmDeals, eq(schema.crmDeals.id, schema.crmSignals.dealId))
        .where(and(eq(schema.crmSignals.userId, userId), isNotNull(schema.crmSignals.dealId), gt(schema.crmSignals.createdAt, since)))
        .orderBy(desc(schema.crmSignals.createdAt)).limit(10)
      : [],
  ]);
  const out: DesktopNotice[] = [
    ...alerts.map((a): DesktopNotice => ({
      id: `n:${a.id}`, kind: a.kind === "brief" ? "brief" : "alert", title: a.title.slice(0, 200), body: a.body.slice(0, 400),
      url: sitePath(a.url, "/app/news"), urgent: a.urgent, at: a.createdAt.toISOString(),
    })),
    ...questions.map((q): DesktopNotice => ({
      id: `q:${q.id}`, kind: "question", title: "The email agent has a question", body: q.question.slice(0, 400),
      url: "/app/crm?tab=drafts", urgent: false, at: q.createdAt.toISOString(),
    })),
    ...deals.map((d): DesktopNotice => ({
      id: `d:${d.id}`, kind: "deal", title: `New on ${d.deal}`.slice(0, 200), body: [d.title, d.detail].filter(Boolean).join(": ").slice(0, 400),
      url: "/app/crm?tab=pipeline", urgent: false, at: d.createdAt.toISOString(),
    })),
  ];
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
}
