/**
 * The decision journal: why each decision on a position was made, written when it was made. YouBank writes an
 * entry itself whenever the weight, the forecast, the kill criteria, the thesis or the side changes, and the
 * PM can add a dated note ("added after the call: margins guided up"). Entries are written by the server only,
 * so the journal cannot be backfilled after the outcome is known, and it is kept through the close.
 * Pure; tested in scripts/test-book.ts. Stored on the position (./position.ts) and the close (./journal.ts).
 */
import type { Position } from "./position";

export type LogEntry = { at: string; text: string; /** Written by YouBank from a change, not typed. */ auto?: boolean };
export const LOG_MAX = 50;

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

export function normalizeLog(raw: unknown): LogEntry[] {
  return (Array.isArray(raw) ? raw : []).flatMap((x) => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const text = clip(o.text, 500);
    return typeof o.at === "string" && !Number.isNaN(Date.parse(o.at)) && text ? [{ at: o.at, text, ...(o.auto === true ? { auto: true } : {}) }] : [];
  }).slice(-LOG_MAX);
}

const pct = (x: number | null) => (x === null ? "none" : `${x}%`);
const money = (x: number | null) => (x ? `$${x}` : "none");

/** What changed between the stored position and the saved one, in words; for a new position, its opening. */
export function changesOf(prev: Position | null, next: Position): string[] {
  if (!prev) return [`Opened: ${next.direction} ${next.ticker}${next.weight !== null ? ` at ${next.weight}% of NAV` : ""}${next.entry ? `, entry $${next.entry}` : ""}.`];
  const out: string[] = [];
  if (prev.direction !== next.direction) out.push(`Side changed from ${prev.direction} to ${next.direction}.`);
  if (prev.weight !== next.weight) out.push(`Weight ${pct(prev.weight)} → ${pct(next.weight)} of NAV.`);
  if (prev.entry !== next.entry) out.push(`Entry ${money(prev.entry)} → ${money(next.entry)}.`);
  if (prev.thesis !== next.thesis) out.push("Thesis rewritten.");
  const crit = (p: Position) => p.criteria.map((c) => `${c.metric}${c.op}${c.value}`).sort().join("|");
  if (crit(prev) !== crit(next)) out.push(`Kill criteria changed (${prev.criteria.length} → ${next.criteria.length}).`);
  const f = (p: Position) => (p.conviction ? `${Math.round(p.conviction.p * 100)}% to ${p.conviction.by}` : "none");
  if (f(prev) !== f(next)) out.push(`Forecast ${f(prev)} → ${f(next)}.`);
  return out;
}

/** The journal with the automatic entries for a save, and an optional note, appended. */
export function withEntries(log: LogEntry[] | undefined, texts: string[], at: string, note?: string): LogEntry[] {
  const typed = clip(note, 500);
  const add: LogEntry[] = [...texts.map((text) => ({ at, text, auto: true })), ...(typed ? [{ at, text: typed }] : [])];
  return [...(log ?? []), ...add].slice(-LOG_MAX);
}
