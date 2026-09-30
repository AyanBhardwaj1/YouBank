/**
 * Documents and their passages in Postgres. Public documents (filings, the Newsroom archive) have
 * owner "" and are shared; uploads, recordings and workspace items belong to their owner (and their team
 * when shared). Passages carry a half-precision embedding and a full-text vector for hybrid search.
 * Uploads are held to a per-person quota, and indexing stops before passages outgrow their share of
 * the database. Deleting a document removes its passages and its files.
 */
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { memo } from "@/lib/memo";
import { myTeamIds } from "@/lib/teams/db";
import { deleteObject, deletePrefix, r2Ready } from "../infra/r2";
import { limits } from "../infra/usage";
import type { Passage } from "./chunk";
import { embedTexts, vectorLiteral } from "./embed";

export const USER_QUOTA_BYTES = 500 * 1024 * 1024;
export const USER_QUOTA_FILES = 300;

export type DocRow = typeof schema.edgeDocs.$inferSelect;

/** Find or create a document by where it came from. */
export async function upsertDoc(d: { ownerId: string; teamId?: number | null; source: string; externalId: string; title: string; url?: string; fileId?: number | null; mime?: string; meta?: Record<string, unknown> }): Promise<DocRow> {
  const db = requireDb();
  const [row] = await db.insert(schema.edgeDocs).values({
    ownerId: d.ownerId, teamId: d.teamId ?? null, source: d.source, externalId: d.externalId.slice(0, 400), title: d.title.slice(0, 300),
    url: (d.url ?? "").slice(0, 1000), fileId: d.fileId ?? null, mime: d.mime ?? "", meta: d.meta ?? {},
  }).onConflictDoNothing().returning();
  if (row) return row;
  const [existing] = await db.select().from(schema.edgeDocs).where(and(eq(schema.edgeDocs.source, d.source), eq(schema.edgeDocs.externalId, d.externalId.slice(0, 400)), eq(schema.edgeDocs.ownerId, d.ownerId)));
  return existing;
}

export async function setDoc(id: number, set: Partial<typeof schema.edgeDocs.$inferInsert>) {
  await requireDb().update(schema.edgeDocs).set(set).where(eq(schema.edgeDocs.id, id));
}

/** Bytes the passages table takes now (shared for a minute). */
const chunksBytes = () => memo("edge:chunks:bytes", 60_000, async () => {
  const [r] = (await requireDb().execute(sql`select pg_total_relation_size('edge_chunks')::float8 as b`)).rows as { b: number }[];
  return Number(r?.b ?? 0);
});

export async function roomForPassages(): Promise<{ ok: boolean; reason?: string }> {
  return (await chunksBytes()) < limits().docsDbBytes ? { ok: true } : { ok: false, reason: "Document search is full for the beta; older documents need removing before more can be indexed." };
}

/** Embed passages and store them (replacing any the document had). Returns how many. */
export async function indexPassages(docId: number, passages: Passage[]): Promise<number> {
  const room = await roomForPassages();
  if (!room.ok) throw Object.assign(new Error(room.reason!), { status: 507 });
  const db = requireDb();
  await db.delete(schema.edgeChunks).where(eq(schema.edgeChunks.docId, docId));
  const list = passages.slice(0, 4000);
  for (let i = 0; i < list.length; i += 120) {
    const batch = list.slice(i, i + 120);
    const vectors = await embedTexts(batch.map((p) => `${p.section ? `${p.section}: ` : ""}${p.text}`));
    await db.execute(sql`insert into edge_chunks (doc_id, ord, page, t_start, t_end, speaker, section, text, embedding, tsv) values ${sql.join(batch.map((p, k) => sql`(${docId}, ${p.ord}, ${p.page}, ${p.tStart ?? null}, ${p.tEnd ?? null}, ${(p.speaker ?? "").slice(0, 80)}, ${p.section.slice(0, 80)}, ${p.text}, ${vectorLiteral(vectors[k])}::halfvec(512), to_tsvector('english', ${p.text}))`), sql`, `)}
      on conflict (doc_id, ord) do nothing`);
  }
  await setDoc(docId, { chunks: list.length, status: "ready", error: "", indexedAt: new Date() });
  return list.length;
}

/** Documents a person can read: the public corpus, their own, and their teams'. */
export async function readableDocs(userId: string, filter: { ids?: number[]; sources?: string[]; tickers?: string[]; limit?: number } = {}): Promise<DocRow[]> {
  const teams = await myTeamIds(userId);
  const who = or(eq(schema.edgeDocs.ownerId, ""), eq(schema.edgeDocs.ownerId, userId), ...(teams.length ? [inArray(schema.edgeDocs.teamId, teams)] : []));
  const conds = [who!];
  if (filter.ids?.length) conds.push(inArray(schema.edgeDocs.id, filter.ids));
  if (filter.sources?.length) conds.push(inArray(schema.edgeDocs.source, filter.sources));
  if (filter.tickers?.length) conds.push(sql`${schema.edgeDocs.meta}->>'ticker' in (${sql.join(filter.tickers.map((t) => sql`${t}`), sql`, `)})`);
  return requireDb().select().from(schema.edgeDocs).where(and(...conds)).orderBy(desc(schema.edgeDocs.createdAt)).limit(filter.limit ?? 400);
}

export async function canRead(userId: string, doc: Pick<DocRow, "ownerId" | "teamId">): Promise<boolean> {
  if (doc.ownerId === "" || doc.ownerId === userId) return true;
  return !!doc.teamId && (await myTeamIds(userId)).includes(doc.teamId);
}

/** A person's uploads so far, against their quota. */
export async function uploadUsage(userId: string): Promise<{ bytes: number; files: number; quotaBytes: number; quotaFiles: number }> {
  const [r] = (await requireDb().execute(sql`select coalesce(sum(bytes), 0)::float8 as bytes, count(*)::int as files from edge_files where owner_id = ${userId} and kind = 'upload'`)).rows as { bytes: number; files: number }[];
  return { bytes: Number(r?.bytes ?? 0), files: Number(r?.files ?? 0), quotaBytes: USER_QUOTA_BYTES, quotaFiles: USER_QUOTA_FILES };
}

/** Remove a document (its passages, its file and everything derived from it). Only its owner may. */
export async function deleteDoc(userId: string, docId: number): Promise<boolean> {
  const db = requireDb();
  const [d] = await db.select().from(schema.edgeDocs).where(eq(schema.edgeDocs.id, docId));
  if (!d || d.ownerId !== userId) return false;
  await db.delete(schema.edgeChunks).where(eq(schema.edgeChunks.docId, docId));
  if (d.fileId) {
    const [f] = await db.select().from(schema.edgeFiles).where(eq(schema.edgeFiles.id, d.fileId));
    if (f) {
      if (r2Ready()) {
        await deletePrefix(`${f.r2Key}/`).catch(() => 0);
        // What the ML service made from it: the parsed pages or the transcript.
        const m = d.meta as { transcriptKey?: string; parsedKey?: string };
        for (const k of [m.transcriptKey, m.parsedKey]) if (k) await deleteObject(k).catch(() => undefined);
        await deletePrefix(`ml/parsed/${f.id}`).catch(() => 0); await deletePrefix(`ml/transcripts/${f.id}`).catch(() => 0);
      }
      await db.delete(schema.edgeFiles).where(eq(schema.edgeFiles.id, f.id));
    }
  }
  await db.delete(schema.edgeDocs).where(eq(schema.edgeDocs.id, docId));
  return true;
}
