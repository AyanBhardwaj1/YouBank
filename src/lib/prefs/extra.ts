import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";

type Row = { extra: Record<string, unknown>; role: string };

/**
 * Change a person's profiles.extra (theme, ai, nav, desk, look, looks) as one step: the row is locked
 * while `change` works out the new value, so two saves sent together (a style and a look applied in
 * the same click) both land instead of the later overwriting the earlier with what it read before.
 * `change` gets a copy and returns the new extra. Resolves to it, or null when there is no profile row.
 */
export async function updateExtra(userId: string, change: (extra: Record<string, unknown>, row: Row) => Record<string, unknown> | Promise<Record<string, unknown>>): Promise<Record<string, unknown> | null> {
  return requireDb().transaction(async (tx) => {
    const [row] = await tx.select({ extra: schema.profiles.extra, role: schema.profiles.role }).from(schema.profiles).where(eq(schema.profiles.userId, userId)).for("update");
    if (!row) return null;
    const extra = await change({ ...(row.extra ?? {}) }, { extra: row.extra ?? {}, role: row.role });
    await tx.update(schema.profiles).set({ extra, updatedAt: new Date() }).where(eq(schema.profiles.userId, userId));
    return extra;
  });
}
