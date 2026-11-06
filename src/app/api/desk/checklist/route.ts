import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { hasStyled, type ChecklistFacts } from "@/lib/desk/checklist";

export const dynamic = "force-dynamic";

/**
 * GET: what the person has done of Home's "Getting started" steps (src/lib/desk/checklist.ts). Each fact
 * is one indexed lookup of a single row; a table a database does not have yet reads as not done. Whether
 * the web app is installed is known only to the browser, which adds it; a paired desktop app is known here.
 */
export async function GET() {
  return guarded(async (user) => {
    const db = requireDb();
    const any = (q: Promise<unknown[]>) => q.then((r) => r.length > 0).catch(() => false);
    const [asked, ranTool, mail, calendar, twoFactor, profile, desktop] = await Promise.all([
      any(db.select({ id: schema.aiUsage.id }).from(schema.aiUsage).where(eq(schema.aiUsage.userId, user.id)).limit(1)),
      any(db.select({ id: schema.workflowRuns.id }).from(schema.workflowRuns).where(eq(schema.workflowRuns.userId, user.id)).limit(1)),
      any(db.select({ id: schema.emailAccounts.id }).from(schema.emailAccounts).where(eq(schema.emailAccounts.userId, user.id)).limit(1)),
      any(db.select({ id: schema.calendarAccounts.id }).from(schema.calendarAccounts).where(eq(schema.calendarAccounts.userId, user.id)).limit(1)),
      db.select({ on: schema.authUsers.twoFactorEnabled }).from(schema.authUsers).where(eq(schema.authUsers.id, user.id)).limit(1).then((r) => !!r[0]?.on).catch(() => false),
      db.select({ extra: schema.profiles.extra, role: schema.profiles.role }).from(schema.profiles).where(eq(schema.profiles.userId, user.id)).limit(1).then((r) => r[0] ?? { extra: {}, role: "" }).catch(() => ({ extra: {}, role: "" })),
      // The desktop app paired counts as installed too.
      any(db.select({ id: schema.desktopDevices.id }).from(schema.desktopDevices).where(eq(schema.desktopDevices.userId, user.id)).limit(1)),
    ]);
    const extra = (profile.extra ?? {}) as Record<string, unknown>;
    // For a fund: a book with a position in it (or one closed), and an AI app connected (an MCP key).
    const book = (Array.isArray(extra.book) && extra.book.length > 0) || (Array.isArray(extra.bookClosed) && extra.bookClosed.length > 0);
    const aiApp = Array.isArray(extra.apiKeys) && extra.apiKeys.length > 0;
    const facts: Omit<ChecklistFacts, "installed"> & { desktop: boolean; role: string } = { asked, ranTool, mail, calendar, twoFactor, styled: hasStyled(extra), desktop, book, aiApp, role: profile.role };
    return NextResponse.json(facts, { headers: { "Cache-Control": "private, no-store" } });
  });
}
