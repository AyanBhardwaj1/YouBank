import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth/user";
import { LibraryClient, type LibRun, type LibSheet, type LibGroup } from "@/components/workspace/LibraryClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Library" };

export default async function LibraryPage() {
  const user = await currentUser();
  if (!user || !db) redirect("/sign-in");
  const [runs, sheets, groups] = await Promise.all([
    db.select({ id: schema.workflowRuns.id, toolId: schema.workflowRuns.toolId, title: schema.workflowRuns.title, model: schema.workflowRuns.model, provider: schema.workflowRuns.provider, status: schema.workflowRuns.status, durationMs: schema.workflowRuns.durationMs, createdAt: schema.workflowRuns.createdAt })
      .from(schema.workflowRuns).where(eq(schema.workflowRuns.userId, user.id)).orderBy(desc(schema.workflowRuns.createdAt)).limit(100).catch(() => []),
    db.select({ id: schema.compsSheets.id, name: schema.compsSheets.name, targetTicker: schema.compsSheets.targetTicker, updatedAt: schema.compsSheets.updatedAt })
      .from(schema.compsSheets).where(eq(schema.compsSheets.userId, user.id)).orderBy(desc(schema.compsSheets.updatedAt)).limit(50).catch(() => []),
    db.select({ id: schema.peerGroups.id, name: schema.peerGroups.name, description: schema.peerGroups.description, createdAt: schema.peerGroups.createdAt })
      .from(schema.peerGroups).where(and(eq(schema.peerGroups.userId, user.id))).orderBy(desc(schema.peerGroups.createdAt)).limit(50).catch(() => []),
  ]);
  const ser = <T extends { createdAt?: Date; updatedAt?: Date }>(rows: T[]) => rows.map((r) => ({ ...r, createdAt: r.createdAt?.toISOString(), updatedAt: r.updatedAt?.toISOString() }));
  return <LibraryClient runs={ser(runs) as LibRun[]} sheets={ser(sheets) as LibSheet[]} groups={ser(groups) as LibGroup[]} />;
}
