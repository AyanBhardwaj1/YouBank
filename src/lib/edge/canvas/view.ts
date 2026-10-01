/**
 * Pure helpers for the canvas page, so it redraws only what changed: a run view merged with the one
 * before it (a light view, polled while the run goes, has no outputs), a selection after the canvas's
 * select changes, and a block's data compared by value. Types only from the engine, so the browser
 * never loads it.
 */
import type { RunView, StepView } from "./engine";

/** True while a run is still going. */
export const going = (status: string) => status === "queued" || status === "running";

const sameJson = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function sameStep(a: StepView, b: StepView): boolean {
  return a.status === b.status && a.step === b.step && a.summary === b.summary && a.error === b.error && a.type === b.type
    && a.startedAt === b.startedAt && a.finishedAt === b.finishedAt && a.output === b.output
    && a.downloads.length === b.downloads.length && a.downloads.every((d, i) => d.url === b.downloads[i].url && d.name === b.downloads[i].name)
    && sameJson(a.preview, b.preview);
}

/**
 * The run to show after fetching `next`. A block that was done keeps the outputs and download links an
 * earlier full view brought when a light one (outputs left out) arrives; a block whose view did not change
 * keeps its old object, and when nothing changed the old run comes back, so nothing redraws. Pure.
 */
export function mergeRun(prev: RunView | null, next: RunView): RunView {
  if (!prev || prev.id !== next.id) return next;
  const before = new Map(prev.steps.map((s) => [s.nodeId, s]));
  const steps = next.steps.map((s) => {
    const p = before.get(s.nodeId);
    if (!p) return s;
    const step = s.output === null && p.output !== null && s.status === "done" ? { ...s, output: p.output, downloads: p.downloads } : s;
    return sameStep(p, step) ? p : step;
  });
  const same = steps.length === prev.steps.length && steps.every((s) => before.get(s.nodeId) === s)
    && prev.status === next.status && prev.error === next.error && prev.startedAt === next.startedAt && prev.finishedAt === next.finishedAt && sameJson(prev.cost, next.cost);
  return same ? prev : { ...next, graph: prev.graph, steps };
}

/** A selection after the canvas's select changes; the same set when they change nothing. Pure. */
export function applySelect(cur: ReadonlySet<string>, changes: { id: string; selected: boolean }[]): ReadonlySet<string> {
  const next = new Set(cur);
  for (const ch of changes) if (ch.selected) next.add(ch.id); else next.delete(ch.id);
  return next.size === cur.size && [...next].every((id) => cur.has(id)) ? cur : next;
}

/** Two blocks' data, field by field (lists by their items): it is rebuilt with the graph, and a block redraws only when what it shows changed. Pure. */
export function sameData(a: object, b: object): boolean {
  if (a === b) return true;
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  return keys.every((k) => {
    const u = x[k], v = y[k];
    return k in y && (u === v || (Array.isArray(u) && Array.isArray(v) && u.length === v.length && u.every((e, i) => e === v[i])));
  });
}
