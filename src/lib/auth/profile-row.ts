import { cache } from "react";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";

/**
 * The signed-in person's profile row, read once per request: the workspace layout and a page that also
 * needs it (the Newsroom's first paint, say) share one lookup, as `currentUser` does.
 */
export const profileRow = cache(async (userId: string): Promise<typeof schema.profiles.$inferSelect | undefined> => {
  const [p] = await requireDb().select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
  return p;
});
