import { and, eq, inArray, isNull } from "drizzle-orm";
import { requireDb, schema } from "@/db";

/** The bell notice for a draft's questions (src/lib/crm/knowledge.ts recordQuestions). */
export const questionNoticeKey = (draftId: number) => `crm:questions:${draftId}`;

/**
 * Mark the bell notices of these drafts read: their questions were answered, dismissed, or closed with the
 * draft (superseded, discarded). Best effort; a notice left unread is only a stale bell item.
 */
export async function settleQuestionNotices(userId: string, draftIds: (number | null | undefined)[]): Promise<void> {
  const keys = [...new Set(draftIds.filter((d): d is number => typeof d === "number"))].map(questionNoticeKey);
  if (!keys.length) return;
  await requireDb().update(schema.newsNotifications).set({ readAt: new Date() })
    .where(and(eq(schema.newsNotifications.userId, userId), inArray(schema.newsNotifications.key, keys), isNull(schema.newsNotifications.readAt)))
    .catch(() => undefined);
}
