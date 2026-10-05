/**
 * Edge's alerts. Big changes go out straight away through the Newsroom's delivery (the bell, push,
 * Slack and email, in the person's chosen channels and quiet hours); everything else waits for the
 * daily visual digest. Each subject alerts a person once per kind.
 */
import { requireDb, schema } from "@/db";
import { logError } from "@/lib/errors";
import { deliverAlert } from "@/lib/news/alerts";
import { readerFor } from "@/lib/news/reader";
import { siteUrl } from "@/lib/site";

/** The address links in emails and Slack point at: the site's one setting (src/lib/site.ts). */
export function appOrigin(): string {
  return siteUrl();
}

export type EdgeAlert = { subject: string; title: string; body: string; url: string; reasons: string[]; urgent?: boolean };

/** Alert a person now (bell plus their channels). Returns false when they already had this one. */
export async function alertNow(userId: string, a: EdgeAlert): Promise<boolean> {
  const db = requireDb();
  const [fresh] = await db.insert(schema.edgeAlerts).values({ userId, subject: a.subject, kind: "immediate" }).onConflictDoNothing().returning({ id: schema.edgeAlerts.id });
  if (!fresh) return false;
  const [row] = await db.insert(schema.newsNotifications).values({
    userId, key: `edge:${a.subject}`, kind: "alert", title: a.title.slice(0, 300), body: a.body.slice(0, 600), url: a.url, urgent: !!a.urgent,
  }).onConflictDoNothing().returning();
  if (!row) return true;
  try {
    const ctx = await readerFor(userId);
    if (ctx?.prefs.alerts.enabled) await deliverAlert(ctx, { key: row.key, title: row.title, body: row.body, url: row.url, urgent: row.urgent, reasons: a.reasons }, appOrigin());
  } catch (e) {
    logError(e, { where: "edge-alert-deliver" });
  }
  return true;
}

/** Keep something for the person's daily digest. */
export async function alertLater(userId: string, subject: string): Promise<boolean> {
  const [row] = await requireDb().insert(schema.edgeAlerts).values({ userId, subject, kind: "digest" }).onConflictDoNothing().returning({ id: schema.edgeAlerts.id });
  return !!row;
}
