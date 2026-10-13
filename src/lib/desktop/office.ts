/**
 * Excel files on the person's computer, kept in step with Studio. The desktop app pulls a Studio
 * workbook as a real .xlsx (Studio's own export: formulas and values) and, when the person saves it in
 * Excel, pushes the file back. Here the pushed file is read with Studio's own importer and compared
 * with the document exactly as the Excel add-in's sync does (diffWorkbook), so a push is one undoable
 * change in the history ("Synced from desktop: 14 cells"), and the agent, the team and the decks all see
 * the same numbers. Decks pull as .pptx; a deck edited in PowerPoint cannot be read back into Studio's
 * slides yet, so decks only go one way.
 */
import type { CurrentUser } from "@/lib/auth/user";
import { commit, createDoc, docData, lastEventId, requireDoc } from "@/lib/studio/db";
import { describeSync, diffWorkbook, validSnapshot, type Snapshot } from "@/lib/studio/sync";
import { emptyDeck, type Workbook } from "@/lib/studio/types";
import { importXlsx } from "@/lib/studio/xlsx";

/** The host refuses request bodies over about 4.5 MB; the Studio importer takes up to 4 MB. */
export const MAX_PUSH_BYTES = 4_000_000;

/** A file name the app sent percent-encoded in a header; a malformed one is used as it came. Pure. */
export function fileNameHeader(v: string | null, fallback: string): string {
  if (!v) return fallback;
  try { return decodeURIComponent(v).slice(0, 200) || fallback; } catch { return v.slice(0, 200); }
}

const status = (message: string, code: number) => Object.assign(new Error(message), { status: code });

/** A Studio workbook in the shape the Excel add-in sends, so the add-in's diff and checks apply unchanged. Pure. */
export function snapshotOf(wb: Workbook): Snapshot {
  return {
    sheets: wb.order.map((id) => wb.sheets[id]).filter(Boolean).map((s) => ({
      name: s.name, cells: s.cells, styles: true, ...(s.cols ? { cols: s.cols } : {}), freeze: s.freeze ?? null,
    })),
    ...(wb.names ? { names: wb.names } : {}),
    partial: false,
  };
}

/** Read an .xlsx into a checked snapshot, or a 400 the person can act on. */
async function readXlsx(bytes: Uint8Array, name: string): Promise<{ snap: Snapshot; workbook: Workbook }> {
  if (!bytes.byteLength) throw status("That file is empty.", 400);
  if (bytes.byteLength > MAX_PUSH_BYTES) throw status("Files up to 4 MB can be synced for now. Trim the workbook or use the Excel add-in for larger models.", 413);
  let workbook: Workbook;
  try { ({ workbook } = await importXlsx(Buffer.from(bytes), name)); }
  catch { throw status("That file could not be read as an Excel workbook. Save it as .xlsx and try again.", 400); }
  const snap = validSnapshot(snapshotOf(workbook));
  if (!snap) throw status("That workbook could not be read. Very large workbooks (over 400,000 cells) are not supported yet.", 400);
  return { snap, workbook };
}

/**
 * Push a local workbook into its Studio document. `base` is the change the local copy was pulled at:
 * if Studio has moved on since (or the base is missing), the push would undo those changes, so it is
 * refused (409) unless the person chose to overwrite.
 */
export async function pushWorkbook(user: CurrentUser, docId: number, bytes: Uint8Array, opts: { name: string; base: number | null; force: boolean }) {
  const row = await requireDoc(user, docId, "edit");
  const latest = await lastEventId(docId);
  // Without a base the server cannot tell what the file was pulled at, so that counts as a conflict too.
  if (!opts.force && (opts.base === null || latest > opts.base)) {
    throw Object.assign(status("This model changed in Studio after you pulled it. Pull a fresh copy (your file is backed up first) or push anyway to overwrite Studio.", 409), { cursor: latest });
  }
  const { snap } = await readXlsx(bytes, opts.name);
  const doc = docData(row);
  const patches = diffWorkbook(doc.workbook, snap);
  if (!patches.length) return { changed: false, label: "No changes", cursor: latest };
  const label = describeSync(patches).replace(/^Synced from Excel/, "Synced from desktop");
  const ev = await commit(docId, doc, patches, { actor: user.id, actorName: user.name || user.email || "Someone", runId: "desktop", label });
  return { changed: true, label: ev.label, cursor: ev.id };
}

/** A local workbook that is not in Studio yet becomes a new Studio document, linked from then on. */
export async function createFromWorkbook(user: CurrentUser, bytes: Uint8Array, name: string) {
  const { workbook } = await readXlsx(bytes, name);
  const title = name.replace(/\.[^.]+$/, "").slice(0, 120) || "Workbook";
  const row = await createDoc(user, { title, workbook, deck: emptyDeck(), comments: [], kind: "upload" });
  return { id: row.id, title, cursor: await lastEventId(row.id) };
}
