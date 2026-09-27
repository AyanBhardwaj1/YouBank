import { and, desc, eq, inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { editRatio } from "@/lib/crm/learning-math";
import { getSettings } from "@/lib/crm/settings";

export const dynamic = "force-dynamic";

const csv = (v: unknown) => {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The audit log: every email the agent drafted, what became of it, who sent it and how much a person
 * changed it, as CSV. For supervision reviews (FINRA Rule 3110) alongside the firm's own mail archive,
 * which already holds every message, since YouBank only ever sends from the person's own mailbox.
 */
export async function GET() {
  return guarded(async (user) => {
    const db = requireDb();
    const settings = await getSettings(user.id);
    const drafts = await db.select().from(schema.crmDrafts)
      .where(and(eq(schema.crmDrafts.userId, user.id), inArray(schema.crmDrafts.status, ["sent", "pending", "discarded", "superseded"])))
      .orderBy(desc(schema.crmDrafts.createdAt)).limit(5000);
    const header = ["draft_id", "created_at", "kind", "status", "sent_by", "sent_at", "to", "subject", "model", "provider", "confidence", "sensitive",
      "edit_ratio", "autopilot_hold_reason", "body_sent_or_current"];
    const rows = drafts.map((d) => [
      d.id, d.createdAt, d.kind, d.status, d.sentBy, d.sentAt, d.toAddresses.map((a) => a.address).join("; "), d.subject, d.model, d.provider,
      d.confidence, d.sensitive, d.originalBody ? editRatio(d.originalBody, d.body, settings.signature).toFixed(3) : "", d.holdReason, d.body,
    ].map(csv).join(","));
    const body = [header.join(","), ...rows].join("\r\n");
    return new Response(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="youbank-email-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  });
}
