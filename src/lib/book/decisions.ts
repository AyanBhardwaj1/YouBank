/**
 * The decision journal: why each decision on a position was made, written when it was made. YouBank writes an
 * entry itself whenever the weight, the forecast, the kill criteria, the thesis or the side changes, and the
 * PM can add a dated note ("added after the call: margins guided up"). Entries are written by the server only,
 * so the journal cannot be backfilled after the outcome is known, and it is kept through the close.
 *
 * YouBank's own entries and the PM's notes are capped separately (AUTO_MAX, NOTES_MAX), so notes can never push
 * the record of what changed out of the journal. Pure; tested in scripts/test-book.ts. Stored on the position
 * (./position.ts) and the close (./journal.ts).
 */
import type { Position } from "./position";

export type LogEntry = { at: string; text: string; /** Written by YouBank from a change, not typed. */ auto?: boolean };
export const AUTO_MAX = 100;
export const NOTES_MAX = 30;

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** The newest automatic entries and the newest notes, each within its own cap, in time order. */
function capped(xs: LogEntry[]): LogEntry[] {
  const auto = xs.filter((x) => x.auto).slice(-AUTO_MAX), notes = xs.filter((x) => !x.auto).slice(-NOTES_MAX);
  return [...auto, ...notes].sort((a, b) => a.at.localeCompare(b.at));
}

export function normalizeLog(raw: unknown): LogEntry[] {
  return capped((Array.isArray(raw) ? raw : []).flatMap((x): LogEntry[] => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const text = clip(o.text, 500);
    return typeof o.at === "string" && !Number.isNaN(Date.parse(o.at)) && text ? [{ at: o.at, text, ...(o.auto === true ? { auto: true } : {}) }] : [];
  }));
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number | null) => (x === null ? "none" : `${r2(x)}%`);
const money = (x: number | null) => (x ? `$${r2(x)}` : "none");

/** What changed between the stored position and the saved one, in words; for a new position, its opening. */
export function changesOf(prev: Position | null, next: Position): string[] {
  if (!prev) return [`Opened: ${next.direction} ${next.ticker}${next.weight !== null ? ` at ${pct(next.weight)} of NAV` : ""}${next.entry ? `, entry ${money(next.entry)}` : ""}.`];
  const out: string[] = [];
  if (prev.direction !== next.direction) out.push(`Side changed from ${prev.direction} to ${next.direction}.`);
  if (prev.weight !== next.weight) out.push(`Weight ${pct(prev.weight)} → ${pct(next.weight)} of NAV.`);
  if (prev.entry !== next.entry) out.push(`Entry ${money(prev.entry)} → ${money(next.entry)}.`);
  if (prev.thesis !== next.thesis) out.push("Thesis rewritten.");
  // Kill criteria: which lines were added and which removed (a changed threshold is one of each).
  const line = (c: Position["criteria"][number]) => `${c.metric.replace(/_/g, " ")} ${c.op === ">=" ? "at least" : "at most"} ${r2(c.value)}`;
  const before = new Set(prev.criteria.map(line)), after = new Set(next.criteria.map(line));
  const added = [...after].filter((x) => !before.has(x)), removed = [...before].filter((x) => !after.has(x));
  if (added.length || removed.length) out.push(`Kill criteria: ${[...(added.length ? [`added ${added.join(", ")}`] : []), ...(removed.length ? [`removed ${removed.join(", ")}`] : [])].join("; ")}.`);
  const f = (p: Position) => (p.conviction ? `${Math.round(p.conviction.p * 100)}% to ${p.conviction.by}` : "none");
  if (f(prev) !== f(next)) out.push(`Forecast ${f(prev)} → ${f(next)}.`);
  return out;
}

/**
 * An entry YouBank wrote for a change the PM made (not the AI committee's sitting, not an AI app's proposal):
 * the changes a note from the PM is expected to explain.
 */
export const isPmChange = (e: LogEntry) => !!e.auto && !/^(AI committee:|Proposed by )/.test(e.text);

/**
 * The PM's own notes, each with the changes it explains, so a quoted note keeps its context: "Sized up after
 * the call" beside "Weight 3% → 5% of NAV". Those are the PM's changes saved with the note or since the
 * previous note, within the week before it (a note typed in the journal after a resize answers that resize).
 */
export function notesOf(log: LogEntry[]): { at: string; text: string; with?: string }[] {
  const sorted = [...log].sort((a, b) => a.at.localeCompare(b.at));
  let prev = "";
  return sorted.filter((e) => !e.auto).map((e) => {
    const t = Date.parse(e.at);
    const floor = Number.isFinite(t) ? new Date(t - 7 * 86_400_000).toISOString() : e.at;
    const since = prev > floor ? prev : floor;
    const same = sorted.filter((x) => isPmChange(x) && x.at <= e.at && (x.at > since || x.at === e.at)).map((x) => x.text.replace(/\.$/, ""));
    prev = e.at;
    return { at: e.at, text: e.text, ...(same.length ? { with: same.join("; ") } : {}) };
  });
}

/**
 * Kill criteria the save made easier to pass: a line removed, or its threshold moved the lenient way (an "at
 * least" lowered, an "at most" raised). Moving the goalposts after the evidence turns is the commonest way a
 * thesis survives its own test; YouBank records it in the journal when the thesis reads broken or on watch.
 */
type Line = { metric: string; op: ">=" | "<="; value: number };
export function loosened(prev: { criteria: Line[] }, next: { criteria: Line[] }): string[] {
  const line = (c: Line) => `${c.metric.replace(/_/g, " ")} ${c.op === ">=" ? "at least" : "at most"} ${r2(c.value)}`;
  const out: string[] = [];
  for (const c of prev.criteria) {
    const same = next.criteria.filter((x) => x.metric === c.metric && x.op === c.op).map((x) => x.value);
    if (!same.length) { out.push(`${line(c)} removed`); continue; }
    const strictest = c.op === ">=" ? Math.max(...same) : Math.min(...same);
    if (c.op === ">=" ? strictest < c.value : strictest > c.value) out.push(`${line(c)} → ${r2(strictest)}`);
  }
  return out;
}

export const GOALPOSTS = "Kill criteria loosened while the thesis read";
export const isGoalposts = (e: LogEntry) => !!e.auto && e.text.startsWith(GOALPOSTS);

/** The journal entry for loosened criteria while the thesis reads broken or on watch, or null. */
export function goalpostEntry(prev: Position | null, next: Position, verdict: string | undefined): string | null {
  if (!prev || (verdict !== "broken" && verdict !== "watch")) return null;
  const xs = loosened(prev, next);
  return xs.length ? `${GOALPOSTS} ${verdict === "broken" ? "broken" : "on watch"}: ${xs.join("; ")}.` : null;
}

/** The journal with the automatic entries for a save, and an optional note, appended. */
export function withEntries(log: LogEntry[] | undefined, texts: string[], at: string, note?: string): LogEntry[] {
  const typed = clip(note, 500);
  const add: LogEntry[] = [...texts.map((text) => ({ at, text, auto: true })), ...(typed ? [{ at, text: typed }] : [])];
  return capped([...(log ?? []), ...add]);
}
