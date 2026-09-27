/** Shape checks for patches a browser sends, before any of them touch the database. */
import { parseAddr } from "./address";
import type { Patch } from "./ops";

const OPS = new Set(["cells", "sheet_add", "sheet_rename", "sheet_delete", "sheet_order", "sheet_meta", "slide_upsert", "slide_delete", "deck_order", "deck_theme", "comments", "title", "names"]);

export function validPatches(x: unknown): Patch[] | null {
  if (!Array.isArray(x) || x.length === 0 || x.length > 300) return null;
  let cells = 0;
  for (const p of x as Record<string, unknown>[]) {
    if (!p || typeof p !== "object" || !OPS.has(String(p.op))) return null;
    if (p.op === "cells") {
      if (typeof p.sheet !== "string" || !p.cells || typeof p.cells !== "object") return null;
      for (const a of Object.keys(p.cells as object)) if (!parseAddr(a)) return null;
      cells += Object.keys(p.cells as object).length;
    }
    if ((p.op === "sheet_add" && (!p.sheet || typeof (p.sheet as { id?: unknown }).id !== "string")) || (p.op === "slide_upsert" && (!p.slide || typeof (p.slide as { id?: unknown }).id !== "string"))) return null;
  }
  return cells <= 60_000 ? (x as Patch[]) : null;
}
