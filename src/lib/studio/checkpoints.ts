/**
 * Checkpoints: a named snapshot of a document ("Sent to MD 22:14"), a semantic comparison between any
 * two states (which inputs changed, which formulas, how the key outputs moved, which slides), and the
 * patches that restore a checkpoint as one undoable change.
 */
import { parseAddr } from "./address";
import { Engine } from "./engine";
import { formatValue } from "./format";
import type { Patch } from "./ops";
import type { CellData, StudioDocData, Workbook } from "./types";
import { isErr } from "./values";

export type SemDiff = {
  sheets: { added: string[]; removed: string[]; renamed: { from: string; to: string }[] };
  inputs: { sheet: string; cell: string; label: string; before: string; after: string }[];
  formulas: { sheet: string; cell: string; label: string; before: string; after: string }[];
  outputs: { name: string; ref: string; before: string; after: string; change: number | null }[];
  text: number;
  slides: { added: string[]; removed: string[]; changed: string[] };
};

const label = (wb: Workbook, sheet: string, a: string) => {
  const p = parseAddr(a);
  const v = p ? wb.sheets[sheet]?.cells[`A${p.r}`]?.v : null;
  return typeof v === "string" ? v.trim().slice(0, 60) : "";
};
/** Deep equality that ignores key order: documents read back from Postgres jsonb come with their keys re-sorted. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return (a ?? null) === (b ?? null);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => same(x, (b as unknown[])[i]));
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined), kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
const show = (c?: CellData) => (c?.f !== undefined ? `=${c.f}` : c?.v === undefined || c.v === null ? "(empty)" : String(c.v));

/** The cells that matter for "how did the answer move": named outputs, key-filled cells and slide metrics. */
function keyCells(doc: StudioDocData): { name: string; sheet: string; a: string }[] {
  const out: { name: string; sheet: string; a: string }[] = [];
  const wb = doc.workbook;
  const byName = (n: string) => wb.order.find((id) => wb.sheets[id].name.toLowerCase() === n.toLowerCase());
  for (const [k, ref] of Object.entries(wb.names ?? {})) {
    const m = /^(?:'([^']+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)$/.exec(ref);
    const sheet = m ? byName(m[1] ?? m[2]) : undefined;
    if (m && sheet) out.push({ name: k, sheet, a: `${m[3]}${m[4]}` });
  }
  for (const id of wb.order) for (const [a, c] of Object.entries(wb.sheets[id].cells)) {
    if (c.s?.fill?.toUpperCase() === "#FFF2CC" && c.f !== undefined && !out.some((o) => o.sheet === id && o.a === a)) out.push({ name: label(wb, id, a) || `${wb.sheets[id].name}!${a}`, sheet: id, a });
  }
  for (const sid of doc.deck.order) for (const e of doc.deck.slides[sid]?.elements ?? []) {
    if (e.type === "metric" && e.link) {
      const a = e.link.range.split(":")[0];
      if (!out.some((o) => o.sheet === e.link!.sheet && o.a === a)) out.push({ name: e.label || `${wb.sheets[e.link.sheet]?.name}!${a}`, sheet: e.link.sheet, a });
    }
  }
  return out.slice(0, 60);
}

export function semanticDiff(before: StudioDocData, after: StudioDocData): SemDiff {
  const A = before.workbook, B = after.workbook;
  const d: SemDiff = { sheets: { added: [], removed: [], renamed: [] }, inputs: [], formulas: [], outputs: [], text: 0, slides: { added: [], removed: [], changed: [] } };
  const match = (id: string) => (B.sheets[id] ? id : B.order.find((x) => B.sheets[x].name.toLowerCase() === A.sheets[id]?.name.toLowerCase()));
  const matched = new Set<string>();
  for (const id of A.order) {
    const bid = match(id);
    if (!bid) { d.sheets.removed.push(A.sheets[id].name); continue; }
    matched.add(bid);
    if (A.sheets[id].name !== B.sheets[bid].name) d.sheets.renamed.push({ from: A.sheets[id].name, to: B.sheets[bid].name });
    const ca = A.sheets[id].cells, cb = B.sheets[bid].cells;
    for (const a of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
      const x = ca[a], y = cb[a];
      if (x?.f !== undefined || y?.f !== undefined) {
        if ((x?.f ?? "") !== (y?.f ?? "")) d.formulas.push({ sheet: B.sheets[bid].name, cell: a, label: label(B, bid, a), before: show(x), after: show(y) });
      } else if ((x?.v ?? null) !== (y?.v ?? null)) {
        if (typeof x?.v === "number" || typeof y?.v === "number") d.inputs.push({ sheet: B.sheets[bid].name, cell: a, label: label(B, bid, a), before: show(x), after: show(y) });
        else d.text++;
      }
    }
  }
  for (const id of B.order) if (!matched.has(id)) d.sheets.added.push(B.sheets[id].name);
  const ea = new Engine(structuredClone(A)), eb = new Engine(structuredClone(B));
  for (const k of keyCells(after)) {
    const bs = B.sheets[k.sheet];
    const as = A.sheets[k.sheet] ? k.sheet : A.order.find((x) => A.sheets[x].name === bs?.name);
    const vb = eb.get(k.sheet, k.a), va = as ? ea.get(as, k.a) : null;
    const same = typeof va === "number" && typeof vb === "number" ? Math.abs(va - vb) <= 1e-9 * Math.max(1, Math.abs(va)) : String(va) === String(vb);
    if (same) continue;
    const nf = bs?.cells[k.a]?.s?.nf;
    d.outputs.push({
      name: k.name, ref: `${bs?.name}!${k.a}`, before: isErr(va) ? va.code : formatValue(va, nf).text.trim() || "(empty)", after: isErr(vb) ? vb.code : formatValue(vb, nf).text.trim() || "(empty)",
      change: typeof va === "number" && typeof vb === "number" && va !== 0 ? vb / va - 1 : null,
    });
  }
  const sa = before.deck.slides, sb = after.deck.slides;
  for (const id of after.deck.order) {
    if (!sa[id]) d.slides.added.push(sb[id].title);
    else if (!same(sa[id], sb[id])) d.slides.changed.push(sb[id].title);
  }
  for (const id of before.deck.order) if (!sb[id]) d.slides.removed.push(sa[id].title);
  d.inputs.sort((x, y) => x.sheet.localeCompare(y.sheet));
  return d;
}

export function diffIsEmpty(d: SemDiff) {
  return !d.sheets.added.length && !d.sheets.removed.length && !d.sheets.renamed.length && !d.inputs.length && !d.formulas.length && !d.text && !d.slides.added.length && !d.slides.removed.length && !d.slides.changed.length;
}

/** The patches that turn `current` back into `target`, applied as one change (so the restore can be undone). */
export function restorePatches(current: StudioDocData, target: StudioDocData): Patch[] {
  const patches: Patch[] = [];
  const C = current.workbook, T = target.workbook;
  for (const id of C.order) if (!T.sheets[id]) patches.push({ op: "sheet_delete", sheet: id });
  for (const id of T.order) {
    const t = T.sheets[id];
    const c = C.sheets[id];
    if (!c) { patches.push({ op: "sheet_add", sheet: structuredClone(t) }); continue; }
    if (c.name !== t.name) patches.push({ op: "sheet_rename", sheet: id, name: t.name });
    const cells: Record<string, CellData | null> = {};
    for (const a of new Set([...Object.keys(c.cells), ...Object.keys(t.cells)])) {
      if (!same(c.cells[a] ?? null, t.cells[a] ?? null)) cells[a] = t.cells[a] ? structuredClone(t.cells[a]) : null;
    }
    if (Object.keys(cells).length) patches.push({ op: "cells", sheet: id, cells });
    const cols = Object.fromEntries(Object.entries(t.cols ?? {}).filter(([k, v]) => c.cols?.[k] !== v));
    if (Object.keys(cols).length || !same(c.freeze ?? null, t.freeze ?? null) || !same(c.sens ?? [], t.sens ?? [])) {
      patches.push({ op: "sheet_meta", sheet: id, ...(Object.keys(cols).length ? { cols } : {}), freeze: t.freeze ?? null, sens: t.sens ?? [] });
    }
  }
  if (!same(C.order, T.order)) patches.push({ op: "sheet_order", order: [...T.order] });
  const names: Record<string, string | null> = {};
  for (const k of new Set([...Object.keys(C.names ?? {}), ...Object.keys(T.names ?? {})])) if ((C.names?.[k] ?? null) !== (T.names?.[k] ?? null)) names[k] = T.names?.[k] ?? null;
  if (Object.keys(names).length) patches.push({ op: "names", names });
  const cd = current.deck, td = target.deck;
  for (const id of cd.order) if (!td.slides[id]) patches.push({ op: "slide_delete", id });
  for (const id of td.order) if (!same(cd.slides[id] ?? null, td.slides[id])) patches.push({ op: "slide_upsert", slide: structuredClone(td.slides[id]) });
  if (!same(cd.order, td.order)) patches.push({ op: "deck_order", order: [...td.order] });
  if (!same(cd.theme, td.theme)) patches.push({ op: "deck_theme", theme: structuredClone(td.theme) });
  return patches;
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

/** The comparison as plain lines, for the agent and for a change note. */
export function summarizeDiff(d: SemDiff, limit = 25): string {
  if (diffIsEmpty(d) && !d.outputs.length) return "No changes.";
  const out: string[] = [];
  if (d.outputs.length) out.push(`Key outputs: ${d.outputs.slice(0, limit).map((o) => `${o.name} ${o.before} → ${o.after}${o.change !== null ? ` (${pct(o.change)})` : ""}`).join("; ")}`);
  if (d.inputs.length) out.push(`Inputs changed (${d.inputs.length}): ${d.inputs.slice(0, limit).map((x) => `${x.sheet}!${x.cell}${x.label ? ` ${x.label}` : ""} ${x.before} → ${x.after}`).join("; ")}`);
  if (d.formulas.length) out.push(`Formulas changed (${d.formulas.length}): ${d.formulas.slice(0, limit).map((x) => `${x.sheet}!${x.cell}${x.label ? ` ${x.label}` : ""}`).join(", ")}`);
  if (d.text) out.push(`${d.text} label${d.text === 1 ? "" : "s"} edited`);
  const sh = d.sheets;
  if (sh.added.length || sh.removed.length || sh.renamed.length) out.push(`Sheets: ${[...sh.added.map((x) => `added ${x}`), ...sh.removed.map((x) => `removed ${x}`), ...sh.renamed.map((x) => `renamed ${x.from} to ${x.to}`)].join(", ")}`);
  const sl = d.slides;
  if (sl.added.length || sl.removed.length || sl.changed.length) out.push(`Slides: ${[...sl.added.map((x) => `added "${x}"`), ...sl.removed.map((x) => `removed "${x}"`), ...sl.changed.map((x) => `changed "${x}"`)].join(", ")}`);
  return out.join("\n");
}

