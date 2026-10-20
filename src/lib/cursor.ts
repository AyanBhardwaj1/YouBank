/**
 * Keyset cursors for lists that grow without bound (the pipeline, the inbox, the bell): the next page
 * starts after the last row's sort key and id, so a page costs the same however deep it is (no OFFSET,
 * which reads and throws away every row before the page), and rows added meanwhile do not shift it.
 *
 * The time is carried at the database's own precision (microseconds, as text), not as a JavaScript Date
 * (milliseconds): rows written in one statement share a time to the microsecond, and a cursor rounded to
 * the millisecond would skip them. A cursor is opaque to the browser: base64url of "<time or empty>|<id>".
 */
import { and, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export type Cursor = { at: string | null; id: number };

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** A timestamp column as microsecond-precise UTC text, to select beside the rows a cursor is made from. */
export const cursorTime = (col: PgColumn) => sql<string | null>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Pure. */
export function encodeCursor(at: string | null, id: number): string {
  return Buffer.from(`${at ?? ""}|${id}`).toString("base64url");
}

/** The largest id a cursor may carry: the lists' ids are `serial` (int4), and a larger one fails the query. */
const MAX_ID = 2_147_483_647;

/**
 * The cursor, or null for a missing or malformed one. Only a time Postgres will accept passes (a real
 * calendar moment: "2026-13-45T…" matches the pattern but would fail the cast), and only an id the
 * column can hold. Routes take it through cursorParam, which refuses a malformed one. Pure.
 */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw || raw.length > 120) return null;
  const m = /^([^|]*)\|(\d{1,10})$/.exec(Buffer.from(raw, "base64url").toString("utf8"));
  if (!m || (m[1] && !validTime(m[1]))) return null;
  const id = Number(m[2]);
  if (!Number.isSafeInteger(id) || id > MAX_ID) return null;
  return { at: m[1] || null, id };
}

/** A microsecond UTC time that names a real moment (its millisecond part round-trips through Date). Pure. */
function validTime(t: string): boolean {
  if (!TIME.test(t)) return false;
  const ms = Date.parse(`${t.slice(0, 23)}Z`);
  return Number.isFinite(ms) && ms >= 0 && new Date(ms).toISOString() === `${t.slice(0, 23)}Z`;
}

/**
 * The `?cursor=` of a list request: null when absent (the first page, as before cursors), the cursor when
 * well formed, and a 400 (thrown, for guarded() to answer) when it is not, so a client with a mangled
 * cursor is told rather than silently sent back to the first page (which a "load more" loop would repeat).
 */
export function cursorParam(req: Request): Cursor | null {
  const raw = new URL(req.url).searchParams.get("cursor");
  if (raw === null || raw === "") return null;
  const c = decodeCursor(raw);
  if (!c) throw Object.assign(new Error("That page link is not valid any more. Reload the list."), { status: 400 });
  return c;
}

/**
 * Rows after the cursor in `order by <time> desc, id desc` (Postgres puts nulls first in a descending
 * order, so a row with no time comes before every timed one). Undefined without a cursor.
 */
export function afterCursor(c: Cursor | null, time: PgColumn, id: PgColumn): SQL | undefined {
  if (!c) return undefined;
  if (c.at === null) return or(and(isNull(time), lt(id, c.id)), isNotNull(time));
  return or(sql`${time} < ${c.at}::timestamptz`, and(sql`${time} = ${c.at}::timestamptz`, lt(id, c.id)));
}

/**
 * Split a page fetched with one extra row: the rows to show (without their cursor time) and the cursor
 * for the next page, or null on the last page. Pure.
 */
export function pageOf<T extends { id: number; cursorAt: string | null }>(rows: T[], limit: number): { rows: Omit<T, "cursorAt">[]; next: string | null } {
  const shown = rows.slice(0, limit);
  const last = shown[shown.length - 1];
  return {
    rows: shown.map((row) => { const { cursorAt, ...rest } = row; void cursorAt; return rest; }),
    next: rows.length > limit && last ? encodeCursor(last.cursorAt, last.id) : null,
  };
}
