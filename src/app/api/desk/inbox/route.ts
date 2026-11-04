import { NextResponse } from "next/server";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { inboxOrder, type InboxItem } from "@/lib/desk/inbox";

export const dynamic = "force-dynamic";

const PER_KIND = 8;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * GET: the desk inbox, one queue of what the agents left for the person to decide (Home's "Waiting for
 * you"): questions the email agent cannot answer alone, drafts to review (those autopilot held first),
 * suggested follow-ups and unread alerts, with each kind's full count. Every item is acted on through
 * the endpoint that already owns it (src/lib/desk/inbox.ts says which), so the rules there (trust
 * learning, the autopilot gate, step-up) hold here too. A table a database does not have yet reads as
 * empty rather than failing Home.
 */
export async function GET() {
  return guarded(async (user) => {
    const db = requireDb();
    const safe = <T,>(q: Promise<T[]>) => q.catch(() => [] as T[]);
    const n = (q: Promise<{ n: number }[]>) => q.then((r) => Number(r[0]?.n ?? 0)).catch(() => 0);
    const d = schema.crmDrafts, qn = schema.crmQuestions, a = schema.crmActions, nt = schema.newsNotifications;
    const [drafts, questions, actions, alerts, counts] = await Promise.all([
      safe(db.select({ id: d.id, subject: d.subject, body: d.body, to: d.toAddresses, rationale: d.rationale, holdReason: d.holdReason, scheduledFor: d.scheduledFor, confidence: d.confidence, sensitive: d.sensitive, kind: d.kind, createdAt: d.createdAt })
        .from(d).where(and(eq(d.userId, user.id), eq(d.status, "pending"))).orderBy(desc(d.createdAt)).limit(PER_KIND)),
      safe(db.select({ id: qn.id, question: qn.question, context: qn.context, createdAt: qn.createdAt })
        .from(qn).where(and(eq(qn.userId, user.id), eq(qn.status, "open"))).orderBy(desc(qn.createdAt)).limit(PER_KIND)),
      safe(db.select({ id: a.id, kind: a.kind, title: a.title, reasoning: a.reasoning, payload: a.payload, createdAt: a.createdAt })
        .from(a).where(and(eq(a.userId, user.id), eq(a.status, "pending"))).orderBy(desc(a.createdAt)).limit(PER_KIND)),
      safe(db.select({ id: nt.id, kind: nt.kind, title: nt.title, body: nt.body, url: nt.url, urgent: nt.urgent, createdAt: nt.createdAt })
        .from(nt).where(and(eq(nt.userId, user.id), isNull(nt.readAt))).orderBy(desc(nt.createdAt)).limit(5)),
      Promise.all([
        n(db.select({ n: count() }).from(d).where(and(eq(d.userId, user.id), eq(d.status, "pending")))),
        n(db.select({ n: count() }).from(qn).where(and(eq(qn.userId, user.id), eq(qn.status, "open")))),
        n(db.select({ n: count() }).from(a).where(and(eq(a.userId, user.id), eq(a.status, "pending")))),
        n(db.select({ n: count() }).from(nt).where(and(eq(nt.userId, user.id), isNull(nt.readAt)))),
      ]),
    ]);
    const items: InboxItem[] = [
      ...questions.map((q): InboxItem => ({ key: `question:${q.id}`, kind: "question", id: q.id, title: clip(q.question, 300), detail: clip(q.context, 400), at: q.createdAt.toISOString() })),
      ...drafts.map((x): InboxItem => ({
        key: `draft:${x.id}`, kind: "draft", id: x.id, title: x.subject || "(no subject)",
        detail: clip(x.holdReason || x.rationale, 300), body: clip(x.body, 4000),
        to: x.to.map((t) => t.name || t.address).filter(Boolean).slice(0, 3).join(", "),
        held: !!x.holdReason, sensitive: x.sensitive, confidence: x.confidence, scheduledFor: x.scheduledFor?.toISOString() ?? null, at: x.createdAt.toISOString(),
      })),
      ...actions.map((x): InboxItem => ({
        key: `action:${x.id}`, kind: "action", id: x.id, title: clip(x.title, 200), detail: clip(x.reasoning, 300), at: x.createdAt.toISOString(),
        needsEmail: x.kind === "add_contact", name: typeof x.payload.name === "string" ? x.payload.name : undefined,
      })),
      ...alerts.map((x): InboxItem => ({ key: `alert:${x.id}`, kind: "alert", id: x.id, title: clip(x.title, 200), detail: clip(x.body, 240), href: x.url || "/app/news", urgent: x.urgent, at: x.createdAt.toISOString() })),
    ];
    const [nDrafts, nQuestions, nActions, nAlerts] = counts;
    return NextResponse.json({ items: inboxOrder(items), counts: { draft: nDrafts, question: nQuestions, action: nActions, alert: nAlerts } }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
