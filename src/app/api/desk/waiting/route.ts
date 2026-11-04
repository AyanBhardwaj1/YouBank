import { NextResponse } from "next/server";
import { and, count, eq, isNull } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";

export const dynamic = "force-dynamic";

/**
 * GET: what the agents left waiting for the person, as counts with where to go (Home's "Waiting for you").
 * Drafts to review, questions the email agent asked, suggested actions and unread alerts. Each count reads
 * one indexed column; a table a database does not have yet counts as nothing rather than failing Home.
 */
export async function GET() {
  return guarded(async (user) => {
    const db = requireDb();
    const n = (q: Promise<{ n: number }[]>) => q.then((r) => Number(r[0]?.n ?? 0)).catch(() => 0);
    const [drafts, questions, actions, alerts] = await Promise.all([
      n(db.select({ n: count() }).from(schema.crmDrafts).where(and(eq(schema.crmDrafts.userId, user.id), eq(schema.crmDrafts.status, "pending")))),
      n(db.select({ n: count() }).from(schema.crmQuestions).where(and(eq(schema.crmQuestions.userId, user.id), eq(schema.crmQuestions.status, "open")))),
      n(db.select({ n: count() }).from(schema.crmActions).where(and(eq(schema.crmActions.userId, user.id), eq(schema.crmActions.status, "pending")))),
      n(db.select({ n: count() }).from(schema.newsNotifications).where(and(eq(schema.newsNotifications.userId, user.id), isNull(schema.newsNotifications.readAt)))),
    ]);
    return NextResponse.json({
      items: [
        { id: "drafts", label: "Drafts to review", count: drafts, href: "/app/crm" },
        { id: "questions", label: "Questions from the email agent", count: questions, href: "/app/crm?tab=agent" },
        { id: "actions", label: "Suggested follow-ups", count: actions, href: "/app/crm?tab=pipeline" },
        { id: "alerts", label: "Unread alerts", count: alerts, href: "/app/news" },
      ],
    });
  });
}
