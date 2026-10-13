/**
 * A Studio model's audit trail as one canonical text, for notarizing. Server only.
 *
 * The text names the model and lists every recorded change (who, when, what it was called, and a
 * SHA-256 of the exact patches applied), then the SHA-256 of the workbook and deck as they stand.
 * The browser hashes this text and the person's wallet records that hash on chain. Later, the same
 * text can be rebuilt: if nobody has edited the model since, it hashes to the same value, which is
 * what "unchanged since notarized" means. The model's contents never leave YouBank.
 */
import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { requireDoc } from "@/lib/studio/db";
import { canonicalJson } from "./notary";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const TRAIL_LIMIT = 5000;

export type TrailEvent = { id: number; actor: string; actorName: string; label: string; at: string; patches: unknown };

/** The canonical text for a model and its events. Pure, for tests. */
export function trailText(doc: { id: number; title: string; workbook: unknown; deck: unknown }, events: TrailEvent[]): string {
  return canonicalJson({
    format: "youbank-studio-audit-trail/v1",
    model: { id: doc.id, title: doc.title, workbookSha256: sha(canonicalJson(doc.workbook)), deckSha256: sha(canonicalJson(doc.deck)) },
    events: events.map((e) => ({ id: e.id, actor: e.actor, by: e.actorName, label: e.label, at: e.at, patchesSha256: sha(canonicalJson(e.patches)) })),
  });
}

/** The trail for a model the person can see, with the last event it covers. */
export async function studioTrail(user: CurrentUser, docId: number): Promise<{ text: string; title: string; lastEventId: number; events: number; truncated: boolean }> {
  const doc = await requireDoc(user, docId, "view");
  const rows = await requireDb().select({ id: schema.studioEvents.id, actor: schema.studioEvents.actor, actorName: schema.studioEvents.actorName, label: schema.studioEvents.label, patches: schema.studioEvents.patches, createdAt: schema.studioEvents.createdAt })
    .from(schema.studioEvents).where(eq(schema.studioEvents.docId, docId)).orderBy(desc(schema.studioEvents.id)).limit(TRAIL_LIMIT + 1);
  // The latest TRAIL_LIMIT changes (the page says "latest 5,000"), oldest first.
  const events = rows.slice(0, TRAIL_LIMIT).reverse().map((r) => ({ id: r.id, actor: r.actor, actorName: r.actorName, label: r.label, at: r.createdAt.toISOString(), patches: r.patches }));
  return { text: trailText({ id: doc.id, title: doc.title, workbook: doc.workbook, deck: doc.deck }, events), title: doc.title, lastEventId: events.at(-1)?.id ?? 0, events: events.length, truncated: rows.length > TRAIL_LIMIT };
}
