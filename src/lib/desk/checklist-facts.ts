/**
 * What the person has done of Home's "Getting started" steps (./checklist.ts), read from the database. Each
 * fact is one indexed lookup of a single row; a table a database does not have yet reads as not done. Whether
 * the web app is installed is known only to the browser, which adds it; a paired desktop app is known here.
 * Used by GET /api/desk/checklist and by Home's server render, so the checklist is in the first paint and
 * nothing below it jumps when it arrives. Server only.
 */
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { hasStyled, type ChecklistFacts } from "./checklist";

export type ServerChecklistFacts = Omit<ChecklistFacts, "installed"> & { desktop: boolean; role: string };

export async function checklistFacts(userId: string): Promise<ServerChecklistFacts> {
  const db = requireDb();
  const any = (q: Promise<unknown[]>) => q.then((r) => r.length > 0).catch(() => false);
  const [asked, ranTool, mail, calendar, twoFactor, profile, desktop] = await Promise.all([
    any(db.select({ id: schema.aiUsage.id }).from(schema.aiUsage).where(eq(schema.aiUsage.userId, userId)).limit(1)),
    any(db.select({ id: schema.workflowRuns.id }).from(schema.workflowRuns).where(eq(schema.workflowRuns.userId, userId)).limit(1)),
    any(db.select({ id: schema.emailAccounts.id }).from(schema.emailAccounts).where(eq(schema.emailAccounts.userId, userId)).limit(1)),
    any(db.select({ id: schema.calendarAccounts.id }).from(schema.calendarAccounts).where(eq(schema.calendarAccounts.userId, userId)).limit(1)),
    db.select({ on: schema.authUsers.twoFactorEnabled }).from(schema.authUsers).where(eq(schema.authUsers.id, userId)).limit(1).then((r) => !!r[0]?.on).catch(() => false),
    db.select({ extra: schema.profiles.extra, role: schema.profiles.role }).from(schema.profiles).where(eq(schema.profiles.userId, userId)).limit(1).then((r) => r[0] ?? { extra: {}, role: "" }).catch(() => ({ extra: {}, role: "" })),
    // The desktop app paired counts as installed too.
    any(db.select({ id: schema.desktopDevices.id }).from(schema.desktopDevices).where(eq(schema.desktopDevices.userId, userId)).limit(1)),
  ]);
  const extra = (profile.extra ?? {}) as Record<string, unknown>;
  const positions = [...(Array.isArray(extra.book) ? extra.book : []), ...(Array.isArray(extra.bookClosed) ? extra.bookClosed : [])];
  // For a fund: a book with a position in it (or one closed), and an AI app connected (an MCP key).
  const book = positions.length > 0;
  const aiApp = Array.isArray(extra.apiKeys) && extra.apiKeys.length > 0;
  // A forecast on any position, open or closed (one kept from before counts too).
  const forecast = positions.some((x: unknown) => !!x && typeof x === "object" && (!!(x as { conviction?: unknown }).conviction || (Array.isArray((x as { pastForecasts?: unknown[] }).pastForecasts) && (x as { pastForecasts: unknown[] }).pastForecasts.length > 0)));
  // A note of the PM's own in any position's decision journal, open or closed.
  const reason = positions.some((x: unknown) => !!x && typeof x === "object" && Array.isArray((x as { log?: unknown[] }).log) && (x as { log: { auto?: unknown }[] }).log.some((e) => e && typeof e === "object" && e.auto !== true));
  return { asked, ranTool, mail, calendar, twoFactor, styled: hasStyled(extra), desktop, book, forecast, reason, aiApp, role: profile.role };
}
