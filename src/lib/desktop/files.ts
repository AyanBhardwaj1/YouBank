/**
 * Local files the desktop app indexes into Edge documents (CIMs, models, memos the person keeps in a
 * folder), so cited answers, Edge canvases and Studio can use them. The bytes travel through Edge's own
 * upload (4 MB parts, the same quota and reader); this module only keeps track of which local file
 * became which document, so that:
 * - a file whose content has not changed is never uploaded again (the app sends its SHA-256 first);
 * - the same file in two folders, or on two computers, becomes one document;
 * - a file that changed replaces its old document instead of leaving a stale copy behind;
 * - the free allowance counts files, not versions.
 * The server never learns where a file lives: the app sends a hash of the path, and the file's name.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { canUse, requireFeature } from "@/lib/billing/entitlements";
import { DESKTOP_FREE_FILES } from "@/lib/billing/features/desktop";
import { requireEdge } from "@/lib/edge/access";
import { ingest } from "@/lib/edge/docs/ingest";
import { deleteDoc } from "@/lib/edge/docs/store";
import { completeUpload, createUpload } from "@/lib/edge/docs/uploads";
import type { DesktopDevice } from "./auth";

const HEX64 = /^[a-f0-9]{64}$/;
export const isHash = (v: unknown): v is string => typeof v === "string" && HEX64.test(v);

/** What the app may index: documents people keep as files. Spreadsheets and decks become searchable text. Pure. */
export const INDEXABLE = /\.(pdf|docx|xlsx|xlsm|pptx)$/i;

const status = (message: string, code: number) => Object.assign(new Error(message), { status: code });

type Row = typeof schema.desktopFiles.$inferSelect;

/** How many distinct local files this person has indexed, and whether they may index more. */
export async function fileQuota(user: Pick<CurrentUser, "id" | "email">) {
  const [[{ n }], unlimited] = await Promise.all([
    requireDb().select({ n: sql<number>`count(*)::int` }).from(schema.desktopFiles).where(eq(schema.desktopFiles.userId, user.id)),
    canUse(user, "desktop.folders"),
  ]);
  return { used: n, free: DESKTOP_FREE_FILES, unlimited };
}

export type CheckItem = { pathKey: string; sha256: string };
export type CheckState = "unchanged" | "changed" | "new";

/** For each local file the app found, whether it needs uploading. One query for the whole folder. */
export async function checkFiles(userId: string, deviceId: number, items: CheckItem[]): Promise<Record<string, CheckState>> {
  const keys = items.filter((i) => isHash(i.pathKey) && isHash(i.sha256)).slice(0, 2000);
  if (!keys.length) return {};
  const rows = await requireDb().select({ pathKey: schema.desktopFiles.pathKey, sha256: schema.desktopFiles.sha256, docId: schema.desktopFiles.docId }).from(schema.desktopFiles)
    .where(and(eq(schema.desktopFiles.userId, userId), eq(schema.desktopFiles.deviceId, deviceId)));
  const known = new Map(rows.map((r) => [r.pathKey, r]));
  return Object.fromEntries(keys.map((i) => {
    const r = known.get(i.pathKey);
    return [i.pathKey, !r ? "new" : r.sha256 === i.sha256 && r.docId ? "unchanged" : "changed"];
  }));
}

export type StartInput = { pathKey: string; sha256: string; name: string; mime: string; bytes: number };

async function findRow(userId: string, deviceId: number, pathKey: string): Promise<Row | undefined> {
  const [r] = await requireDb().select().from(schema.desktopFiles)
    .where(and(eq(schema.desktopFiles.userId, userId), eq(schema.desktopFiles.deviceId, deviceId), eq(schema.desktopFiles.pathKey, pathKey)));
  return r;
}

/** Record that this local file is now `docId`; returns the document it replaced, if any. */
async function link(userId: string, deviceId: number, input: Omit<StartInput, "mime">, docId: number): Promise<number | null> {
  const db = requireDb();
  const prev = await findRow(userId, deviceId, input.pathKey);
  const values = { name: input.name.slice(0, 200), sha256: input.sha256, bytes: Math.max(0, Math.floor(input.bytes)), docId, updatedAt: new Date() };
  await db.insert(schema.desktopFiles).values({ userId, deviceId, pathKey: input.pathKey, ...values })
    .onConflictDoUpdate({ target: [schema.desktopFiles.userId, schema.desktopFiles.deviceId, schema.desktopFiles.pathKey], set: values });
  return prev?.docId && prev.docId !== docId ? prev.docId : null;
}

/** Delete a superseded document, unless another local file (a copy elsewhere) still points at it. */
async function dropIfUnused(userId: string, docId: number | null): Promise<void> {
  if (!docId) return;
  const [{ n }] = await requireDb().select({ n: sql<number>`count(*)::int` }).from(schema.desktopFiles)
    .where(and(eq(schema.desktopFiles.userId, userId), eq(schema.desktopFiles.docId, docId)));
  if (!n) await deleteDoc(userId, docId).catch(() => false);
}

/**
 * Start indexing one local file. Returns `skip` when nothing needs sending (unchanged, or the same
 * content is already a document); otherwise an Edge upload to send the parts to. A new file past the
 * free allowance needs `desktop.folders`, checked before any upload starts.
 */
export async function startFile(user: CurrentUser, device: DesktopDevice, input: StartInput): Promise<{ skip: true; docId: number } | { skip: false; fileId: number; parts: number; partBytes: number }> {
  if (!isHash(input.pathKey) || !isHash(input.sha256)) throw status("bad file key", 400);
  if (!INDEXABLE.test(input.name)) throw status("Only PDF, Word, Excel and PowerPoint files are indexed.", 400);
  await requireEdge(user.id);
  const row = await findRow(user.id, device.id, input.pathKey);
  if (row?.docId && row.sha256 === input.sha256) return { skip: true, docId: row.docId };
  if (!row) {
    const q = await fileQuota(user);
    if (q.used >= q.free) await requireFeature(user, "desktop.folders");
  }
  // The same content already indexed from another folder or computer: point at that document.
  const [same] = await requireDb().select({ docId: schema.desktopFiles.docId }).from(schema.desktopFiles)
    .where(and(eq(schema.desktopFiles.userId, user.id), eq(schema.desktopFiles.sha256, input.sha256), ne(schema.desktopFiles.pathKey, input.pathKey)));
  if (same?.docId) {
    await dropIfUnused(user.id, await link(user.id, device.id, input, same.docId));
    return { skip: true, docId: same.docId };
  }
  const u = await createUpload(user.id, { name: input.name, mime: input.mime, bytes: input.bytes });
  return { skip: false, fileId: u.file.id, parts: u.parts, partBytes: u.partBytes };
}

/** Every part is in: create the document, start reading it, and retire the version it replaces. */
export async function completeFile(user: CurrentUser, device: DesktopDevice, fileId: number, input: Omit<StartInput, "mime">): Promise<{ docId: number; status: "ready" | "reading" }> {
  if (!isHash(input.pathKey) || !isHash(input.sha256)) throw status("bad file key", 400);
  await requireEdge(user.id);
  const doc = await completeUpload(user.id, fileId);
  const how = doc.status === "ready" ? "ready" : await ingest(doc.id);
  await dropIfUnused(user.id, await link(user.id, device.id, input, doc.id));
  return { docId: doc.id, status: how === "ready" ? "ready" : "reading" };
}

/**
 * The person removed a file from YouBank (from the app's file list, or with its folder and "remove
 * the documents too"): its document goes, unless a copy elsewhere still uses it. Stopping a folder
 * without removing keeps its documents, and they keep counting toward the free allowance.
 */
export async function removeFile(userId: string, deviceId: number, pathKey: string): Promise<void> {
  if (!isHash(pathKey)) throw status("bad file key", 400);
  const [row] = await requireDb().delete(schema.desktopFiles)
    .where(and(eq(schema.desktopFiles.userId, userId), eq(schema.desktopFiles.deviceId, deviceId), eq(schema.desktopFiles.pathKey, pathKey)))
    .returning({ docId: schema.desktopFiles.docId });
  if (row) await dropIfUnused(userId, row.docId);
}
