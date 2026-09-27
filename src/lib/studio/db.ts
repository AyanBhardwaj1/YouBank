/**
 * Studio persistence. A document is one row; every edit is a patch stored with an atomic jsonb update
 * (so a person typing and the agent writing never overwrite each other's cells) and appended to
 * studio_events with the patches that undo it.
 */
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { Forbidden, membership, myTeamIds } from "@/lib/teams/db";
import { can } from "@/lib/teams/roles";
import { applyWithUndo, describePatches, type Patch } from "./ops";
import type { Engine } from "./engine";
import type { StudioDocData } from "./types";

export type DocRow = typeof schema.studioDocs.$inferSelect;
export type EventRow = typeof schema.studioEvents.$inferSelect;

export const docData = (row: DocRow): StudioDocData => ({ title: row.title, workbook: row.workbook, deck: row.deck, comments: row.comments ?? [] });

/** Own documents, and documents shared with a team the person is on (viewers may look, not edit). */
export async function requireDoc(user: CurrentUser, id: number, mode: "view" | "edit" = "view"): Promise<DocRow> {
  const [row] = await requireDb().select().from(schema.studioDocs).where(eq(schema.studioDocs.id, id));
  if (!row) throw new Forbidden("That model does not exist");
  if (row.ownerId === user.id) return row;
  if (row.teamId) {
    const m = await membership(row.teamId, user.id);
    if (m && can(m.role, mode === "edit" ? "edit" : "view")) return row;
  }
  throw new Forbidden(row.teamId ? "That model is shared with a team you are not on" : "That model is private to the person who made it");
}

export async function listDocs(user: CurrentUser) {
  const teams = await myTeamIds(user.id);
  const where = teams.length ? or(eq(schema.studioDocs.ownerId, user.id), inArray(schema.studioDocs.teamId, teams)) : eq(schema.studioDocs.ownerId, user.id);
  const rows = await requireDb().select({
    id: schema.studioDocs.id, title: schema.studioDocs.title, kind: schema.studioDocs.kind, ticker: schema.studioDocs.ticker,
    ownerId: schema.studioDocs.ownerId, teamId: schema.studioDocs.teamId, updatedAt: schema.studioDocs.updatedAt, createdAt: schema.studioDocs.createdAt,
    sheets: sql<number>`jsonb_array_length(${schema.studioDocs.workbook}->'order')`, slides: sql<number>`jsonb_array_length(${schema.studioDocs.deck}->'order')`,
  }).from(schema.studioDocs).where(where).orderBy(desc(schema.studioDocs.updatedAt)).limit(100);
  return rows.map((r) => ({ ...r, mine: r.ownerId === user.id }));
}

export async function createDoc(user: CurrentUser, d: StudioDocData & { kind: string; ticker?: string; teamId?: number | null; intake?: Record<string, unknown> | null }): Promise<DocRow> {
  if (d.teamId != null && !(await myTeamIds(user.id)).includes(d.teamId)) throw new Forbidden("You are not on that team");
  const [row] = await requireDb().insert(schema.studioDocs).values({
    ownerId: user.id, teamId: d.teamId ?? null, title: d.title.slice(0, 140) || "Untitled model", kind: d.kind, ticker: (d.ticker ?? "").toUpperCase(),
    workbook: d.workbook, deck: d.deck, comments: d.comments ?? [], intake: d.intake ?? null,
  }).returning();
  return row;
}

export async function deleteDoc(user: CurrentUser, id: number) {
  const row = await requireDoc(user, id, "edit");
  if (row.ownerId !== user.id) throw new Forbidden("Only the person who made a model can delete it");
  await requireDb().delete(schema.studioDocs).where(eq(schema.studioDocs.id, id));
}

export async function shareDoc(user: CurrentUser, id: number, teamId: number | null) {
  const row = await requireDoc(user, id, "edit");
  if (row.ownerId !== user.id) throw new Forbidden("Only the person who made a model can share it");
  if (teamId !== null && !(await myTeamIds(user.id)).includes(teamId)) throw new Forbidden("You are not on that team");
  await requireDb().update(schema.studioDocs).set({ teamId }).where(eq(schema.studioDocs.id, id));
}

export async function lastEventId(docId: number): Promise<number> {
  const [r] = await requireDb().select({ id: sql<number>`coalesce(max(${schema.studioEvents.id}), 0)::int` }).from(schema.studioEvents).where(eq(schema.studioEvents.docId, docId));
  return r?.id ?? 0;
}

export async function eventsSince(docId: number, cursor: number, limit = 200): Promise<EventRow[]> {
  return requireDb().select().from(schema.studioEvents)
    .where(and(eq(schema.studioEvents.docId, docId), gt(schema.studioEvents.id, cursor))).orderBy(schema.studioEvents.id).limit(limit);
}

/* ---------------- Writing ---------------- */

const J = (x: unknown) => JSON.stringify(x);

/** An order array with an id added (at an index, or at the end) unless it is already there. */
const withId = (arr: ReturnType<typeof sql>, id: string, index?: number) => index === undefined
  ? sql`case when ${arr} ? ${id}::text then ${arr} else coalesce(${arr}, '[]'::jsonb) || to_jsonb(${id}::text) end`
  : sql`case when ${arr} ? ${id}::text then ${arr} else jsonb_insert(coalesce(${arr}, '[]'::jsonb), ARRAY[${String(index)}::text], to_jsonb(${id}::text)) end`;
const withoutId = (arr: ReturnType<typeof sql>, id: string) => sql`coalesce((select jsonb_agg(x) from jsonb_array_elements(${arr}) x where x <> to_jsonb(${id}::text)), '[]'::jsonb)`;

/**
 * One patch as one atomic statement against the stored document, computed entirely in SQL, so a
 * person's edit can be stored without loading the document and never clobbers a concurrent write.
 */
export async function persist(docId: number, p: Patch) {
  const db = requireDb();
  const touch = sql`version = version + 1, updated_at = now()`;
  const sheetPath = (id: string, ...rest: string[]) => sql`ARRAY['sheets', ${id}::text${sql.raw(rest.map((r) => `, '${r}'`).join(""))}]`;
  switch (p.op) {
    case "cells":
      await db.execute(sql`update studio_docs set workbook = jsonb_set(workbook, ${sheetPath(p.sheet, "cells")},
        jsonb_strip_nulls(coalesce(workbook #> ${sheetPath(p.sheet, "cells")}, '{}'::jsonb) || ${J(p.cells)}::jsonb)), ${touch}
        where id = ${docId} and workbook #> ${sheetPath(p.sheet)} is not null`);
      return;
    case "sheet_add":
      await db.execute(sql`update studio_docs set workbook = jsonb_set(jsonb_set(workbook, ${sheetPath(p.sheet.id)}, ${J(p.sheet)}::jsonb), '{order}', ${withId(sql`workbook->'order'`, p.sheet.id, p.index)}), ${touch} where id = ${docId}`);
      return;
    case "sheet_rename":
      await db.execute(sql`update studio_docs set workbook = jsonb_set(workbook, ${sheetPath(p.sheet, "name")}, to_jsonb(${p.name}::text)), ${touch} where id = ${docId} and workbook #> ${sheetPath(p.sheet)} is not null`);
      return;
    case "sheet_delete":
      await db.execute(sql`update studio_docs set workbook = jsonb_set(workbook #- ${sheetPath(p.sheet)}, '{order}', ${withoutId(sql`workbook->'order'`, p.sheet)}), ${touch} where id = ${docId}`);
      return;
    case "sheet_meta": {
      let expr = sql`workbook`;
      if (p.cols) expr = sql`jsonb_set(${expr}, ${sheetPath(p.sheet, "cols")}, coalesce(workbook #> ${sheetPath(p.sheet, "cols")}, '{}'::jsonb) || ${J(p.cols)}::jsonb)`;
      if (p.freeze !== undefined) expr = p.freeze ? sql`jsonb_set(${expr}, ${sheetPath(p.sheet, "freeze")}, ${J(p.freeze)}::jsonb)` : sql`(${expr} #- ${sheetPath(p.sheet, "freeze")})`;
      if (p.sens) expr = sql`jsonb_set(${expr}, ${sheetPath(p.sheet, "sens")}, ${J(p.sens)}::jsonb)`;
      await db.execute(sql`update studio_docs set workbook = ${expr}, ${touch} where id = ${docId} and workbook #> ${sheetPath(p.sheet)} is not null`);
      return;
    }
    case "slide_upsert":
      await db.execute(sql`update studio_docs set deck = jsonb_set(jsonb_set(deck, ARRAY['slides', ${p.slide.id}::text], ${J(p.slide)}::jsonb), '{order}', ${withId(sql`deck->'order'`, p.slide.id, p.index)}), ${touch} where id = ${docId}`);
      return;
    case "slide_delete":
      await db.execute(sql`update studio_docs set deck = jsonb_set(deck #- ARRAY['slides', ${p.id}::text], '{order}', ${withoutId(sql`deck->'order'`, p.id)}), ${touch} where id = ${docId}`);
      return;
    case "deck_order":
      await db.execute(sql`update studio_docs set deck = jsonb_set(deck, '{order}', ${J(p.order)}::jsonb), ${touch} where id = ${docId}`);
      return;
    case "deck_theme":
      await db.execute(sql`update studio_docs set deck = jsonb_set(deck, '{theme}', ${J(p.theme)}::jsonb), ${touch} where id = ${docId}`);
      return;
    case "comments":
      await db.execute(sql`update studio_docs set comments = ${J(p.comments)}::jsonb, ${touch} where id = ${docId}`);
      return;
    case "title":
      await db.execute(sql`update studio_docs set title = ${p.title.slice(0, 140)}, ${touch} where id = ${docId}`);
      return;
    case "names":
      await db.execute(sql`update studio_docs set workbook = jsonb_set(workbook, '{names}', jsonb_strip_nulls(coalesce(workbook->'names', '{}'::jsonb) || ${J(p.names)}::jsonb)), ${touch} where id = ${docId}`);
      return;
  }
}

export type CommitMeta = { actor: string; actorName: string; runId?: string; label?: string };

/**
 * Apply patches to the in-memory document (and engine), store them, and log them with their undo.
 * Returns the event, which is what streams to everyone watching.
 */
export async function commit(docId: number, doc: StudioDocData, patches: Patch[], meta: CommitMeta, engine?: Engine): Promise<{ id: number; patches: Patch[]; label: string; actor: string; actorName: string; runId: string }> {
  if (!patches.length) return { id: 0, patches, label: "", actor: meta.actor, actorName: meta.actorName, runId: meta.runId ?? "" };
  const label = meta.label || describePatches(doc, patches);
  const undo = applyWithUndo(doc, patches, engine);
  for (const p of patches) await persist(docId, p);
  const [row] = await requireDb().insert(schema.studioEvents).values({
    docId, actor: meta.actor, actorName: meta.actorName, runId: meta.runId ?? "", label, patches, undo,
  }).returning({ id: schema.studioEvents.id });
  return { id: row.id, patches, label, actor: meta.actor, actorName: meta.actorName, runId: meta.runId ?? "" };
}

/**
 * A person's edit from the browser, which already applied it and computed its undo: store it without
 * loading the document.
 */
export async function commitRaw(docId: number, patches: Patch[], undo: Patch[], meta: CommitMeta & { label: string }) {
  for (const p of patches) await persist(docId, p);
  const [row] = await requireDb().insert(schema.studioEvents).values({
    docId, actor: meta.actor, actorName: meta.actorName, runId: meta.runId ?? "", label: meta.label.slice(0, 300), patches, undo,
  }).returning({ id: schema.studioEvents.id });
  return row.id;
}

/* ---------------- Runs ---------------- */

export async function startRun(docId: number, userId: string, id: string, instruction: string, model: string) {
  await requireDb().insert(schema.studioRuns).values({ id, docId, userId, instruction: instruction.slice(0, 4000), model });
}

export async function finishRun(id: string, status: "done" | "error" | "stopped", summary: string, stats: Record<string, unknown>) {
  await requireDb().update(schema.studioRuns).set({ status, summary: summary.slice(0, 8000), stats, finishedAt: new Date() }).where(eq(schema.studioRuns.id, id));
}

export async function listRuns(docId: number, limit = 20) {
  return requireDb().select().from(schema.studioRuns).where(eq(schema.studioRuns.docId, docId)).orderBy(desc(schema.studioRuns.startedAt)).limit(limit);
}

/** The patches that undo a whole agent run, newest change first. */
export async function undoForRun(docId: number, runId: string): Promise<Patch[]> {
  const rows = await requireDb().select({ undo: schema.studioEvents.undo }).from(schema.studioEvents)
    .where(and(eq(schema.studioEvents.docId, docId), eq(schema.studioEvents.runId, runId))).orderBy(desc(schema.studioEvents.id));
  return rows.flatMap((r) => (r.undo ?? []) as Patch[]);
}

export async function markRun(id: string, status: "undone") {
  await requireDb().update(schema.studioRuns).set({ status }).where(eq(schema.studioRuns.id, id));
}

/** The latest events for the history list. */
export async function recentEvents(docId: number, limit = 60) {
  return requireDb().select({ id: schema.studioEvents.id, actor: schema.studioEvents.actor, actorName: schema.studioEvents.actorName, runId: schema.studioEvents.runId, label: schema.studioEvents.label, createdAt: schema.studioEvents.createdAt })
    .from(schema.studioEvents).where(eq(schema.studioEvents.docId, docId)).orderBy(desc(schema.studioEvents.id)).limit(limit);
}
