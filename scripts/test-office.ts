/**
 * YouBank for Excel and PowerPoint, and the Studio roadmap features, without Office or a database:
 * the workbook diff behind "Synced from Excel", the Excel adapter against an in-memory Excel (write a
 * model in, read it back, nothing changes), the PowerPoint refresh, checkpoints, the deck brand check,
 * markup and data-room reading, the manifest, and pairing codes.   pnpm exec tsx scripts/test-office.ts
 */
import { MBook, MPresentation } from "./mock-office";
import { restorePatches, same, semanticDiff, summarizeDiff, diffIsEmpty } from "@/lib/studio/checkpoints";
import { newDocument } from "@/lib/studio/create";
import { commentsFromMarks, outline, tablesToSheet, type ExtractResult, type Mark } from "@/lib/studio/documents";
import { fixAll, lintDeck } from "@/lib/studio/lint";
import { addSheet, applyPatch, applyWithUndo, clearRange, deleteSheet, fillRange, formatRange, renameSheet, shiftCells, writeRange, type Patch } from "@/lib/studio/ops";
import { describeSync, diffWorkbook, validSnapshot, workbookFromSnapshot, type Snapshot } from "@/lib/studio/sync";
import { emptyDeck, type Slide, type StudioDocData } from "@/lib/studio/types";
import { applyPatches, excelInput, readSnapshot, runsOf, writeWorkbook } from "@/lib/office/excel";
import { insertDeck, linkedSlides, refreshDeck, sourceSlideId, unlinkSelected } from "@/lib/office/powerpoint";
import { manifestXml } from "@/lib/office/manifest";
import { newCode, normalizeCode } from "@/lib/office/codes";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail).slice(0, 900)}` : ""}`); }
};
const clone = <T,>(x: T): T => structuredClone(x);
const blankDoc = (): StudioDocData => ({ title: "t", workbook: { order: ["s1"], sheets: { s1: { id: "s1", name: "Model", cells: {} } } }, deck: emptyDeck(), comments: [] });

/* ---------------- The workbook diff ---------------- */
{
  const doc = blankDoc();
  doc.workbook.sheets.s1.cells = { A1: { v: "Revenue" }, B1: { v: 100, src: "10-K" }, C1: { f: "B1*1.1" }, D1: { v: 5, s: { b: true } } };
  const snap: Snapshot = { sheets: [{ name: "Model", styles: true, cells: { A1: { v: "Revenue" }, B1: { v: 100 }, C1: { f: "=b1*1.1", cv: 110 }, D1: { v: 5, s: { b: true } } } }] };
  check("an identical workbook syncs nothing (formula case, cached result and a source tag are not edits)", diffWorkbook(doc.workbook, snap).length === 0, diffWorkbook(doc.workbook, snap));
  const s2 = clone(snap);
  s2.sheets[0].cells.B1 = { v: 120 };
  s2.sheets[0].cells.E1 = { v: "new" };
  delete s2.sheets[0].cells.D1;
  const p = diffWorkbook(doc.workbook, s2);
  const cells = p.find((x) => x.op === "cells") as Extract<Patch, { op: "cells" }>;
  check("edits, new cells and cleared cells come back as one cells patch", !!cells && cells.cells.B1?.v === 120 && cells.cells.E1?.v === "new" && cells.cells.D1 === null && Object.keys(cells.cells).length === 3, p);
  check("a changed figure loses its old source", cells.cells.B1?.src === undefined);
  check("describeSync counts cells", describeSync(p) === "Synced from Excel: 3 cells", describeSync(p));
  const s3 = clone(snap);
  s3.sheets[0].cells.D1 = { v: 5, s: { b: true, fill: "#fff2cc" } };
  const p3 = diffWorkbook(doc.workbook, s3);
  check("a format change is an edit", p3.length === 1 && (p3[0] as { cells: Record<string, { s?: { fill?: string } }> }).cells.D1?.s?.fill === "#FFF2CC", p3);
  const s4 = clone(snap);
  s4.sheets[0].styles = false;
  delete s4.sheets[0].cells.D1.s;
  check("a sheet too big to read formats keeps Studio's formats", diffWorkbook(doc.workbook, s4).length === 0, diffWorkbook(doc.workbook, s4));
  const s5: Snapshot = { sheets: [{ name: "Inputs", styles: true, cells: { A1: { v: 1 } } }, { name: "MODEL", styles: true, cells: snap.sheets[0].cells, freeze: { rows: 1, cols: 0 }, cols: { A: 240 } }] };
  const p5 = diffWorkbook(doc.workbook, s5);
  check("a new sheet is added, sheets match by name whatever the case, renames by case are kept", p5.some((x) => x.op === "sheet_add" && x.sheet.name === "Inputs") && p5.some((x) => x.op === "sheet_rename" && x.name === "MODEL"), p5.map((x) => x.op));
  check("order, frozen panes and widths come across", p5.some((x) => x.op === "sheet_order") && p5.some((x) => x.op === "sheet_meta" && x.freeze?.rows === 1 && x.cols?.A === 240), p5);
  const frozen = blankDoc();
  frozen.workbook.sheets.s1.freeze = JSON.parse('{"cols":1,"rows":4}');
  check("frozen panes compare by value, not by key order (Postgres re-sorts keys)", diffWorkbook(frozen.workbook, { sheets: [{ name: "Model", styles: true, cells: {}, freeze: { rows: 4, cols: 1 } }] }).length === 0);
  const p6 = diffWorkbook(doc.workbook, { sheets: [{ name: "Other", styles: true, cells: {} }] });
  check("a sheet missing from a full snapshot was deleted in Excel", p6.some((x) => x.op === "sheet_delete" && x.sheet === "s1"));
  const p7 = diffWorkbook(doc.workbook, { sheets: [{ name: "Other", styles: true, cells: {} }], partial: true });
  check("a partial snapshot never deletes or reorders", !p7.some((x) => x.op === "sheet_delete" || x.op === "sheet_order"));
  const big = blankDoc();
  big.workbook.sheets.s1.cells = { A1: { v: 1 }, A500: { v: 2 } };
  check("rows past a large sheet's read limit are left alone", diffWorkbook(big.workbook, { sheets: [{ name: "Model", styles: true, cells: { A1: { v: 1 } }, lastRow: 200 }] }).length === 0);
  check("a skipped sheet keeps its cells", diffWorkbook(doc.workbook, { sheets: [{ name: "Model", styles: true, cells: {}, skip: true }] }).length === 0);
  const named = blankDoc();
  named.workbook.names = { WACC: "Model!$B$2", OLD: "Model!$A$1" };
  const pn = diffWorkbook(named.workbook, { sheets: [{ name: "Model", styles: true, cells: {} }], names: { WACC: "=Model!B2", NEW: "=Model!$C$3" } });
  const nm = pn.find((x) => x.op === "names") as Extract<Patch, { op: "names" }>;
  check("names: same reference ignoring $ and =, new names added, missing ones removed", !!nm && !("WACC" in nm.names) && nm.names.NEW === "Model!$C$3" && nm.names.OLD === null, pn);
  const wb = workbookFromSnapshot(s5);
  check("a workbook from a snapshot", wb.order.length === 2 && wb.sheets[wb.order[1]].name === "MODEL" && wb.sheets[wb.order[1]].cells.C1.f === "b1*1.1" && wb.sheets[wb.order[1]].freeze?.rows === 1);
  check("an empty snapshot still makes a sheet", workbookFromSnapshot({ sheets: [] }).order.length === 1);
}
{
  check("validSnapshot accepts a good one and cleans styles", (() => { const s = validSnapshot({ sheets: [{ name: "A", cells: { B2: { v: 1, s: { b: true, evil: "x", color: "#ff0000" } } }, styles: true }] }); return !!s && JSON.stringify(s.sheets[0].cells.B2.s) === JSON.stringify({ b: true, color: "#ff0000" }); })());
  check("validSnapshot rejects bad addresses, names and shapes", validSnapshot({ sheets: [{ name: "A", cells: { ZZZZ1: { v: 1 } } }] }) === null && validSnapshot({ sheets: [{ name: "a/b", cells: {} }] }) === null && validSnapshot({ sheets: "x" }) === null && validSnapshot({ sheets: [{ name: "A", cells: {} }, { name: "a", cells: {} }] }) === null);
  check("validSnapshot keeps formulas without the = and drops junk values", (() => { const s = validSnapshot({ sheets: [{ name: "A", cells: { A1: { f: "=SUM(B1:B3)", cv: 6 }, A2: { v: { x: 1 } } } }] }); return !!s && s.sheets[0].cells.A1.f === "SUM(B1:B3)" && !s.sheets[0].cells.A2; })());
}

/* ---------------- Excel: what gets typed ---------------- */
check("text Excel would reinterpret is protected with an apostrophe", excelInput({ v: "2025" }) === "'2025" && excelInput({ v: "Jun-25" }) === "'Jun-25" && excelInput({ v: "- growth" }) === "'- growth" && excelInput({ v: "TRUE" }) === "'TRUE" && excelInput({ v: "=x" }) === "'=x" && excelInput({ v: "12%" }) === "'12%");
check("ordinary text, numbers and formulas go in as they are", excelInput({ v: "Revenue" }) === "Revenue" && excelInput({ v: 5 }) === 5 && excelInput({ f: "A1*2" }) === "=A1*2" && excelInput({ v: true }) === true && excelInput(null) === "");
check("runs group cells along rows, splitting at gaps and at clears", JSON.stringify(runsOf({ A1: { v: 1 }, B1: { v: 2 }, D1: { v: 3 }, A2: null, B2: null, C2: { v: 4 } }).map((r) => [r.r, r.c, r.cells.length])) === JSON.stringify([[1, 1, 2], [1, 4, 1], [2, 1, 2], [2, 3, 1]]));

async function roundTrip(label: string, book: MBook, doc: StudioDocData) {
  const { snapshot, warnings } = await readSnapshot(book.context());
  const d = diffWorkbook(doc.workbook, snapshot);
  check(`${label}: Excel reads back exactly what Studio has`, d.length === 0 && warnings.length === 0, { d: d.slice(0, 3), warnings });
  return snapshot;
}

async function excelTests() {
  for (const template of ["valuation", "lbo", "merger", "cap_table"] as const) {
    const doc = await newDocument(template, { ticker: null });
    const book = new MBook();
    const r = await writeWorkbook(book.context(), doc);
    check(`${template}: written to Excel without rejections`, r.failed.length === 0, r.failed);
    check(`${template}: the blank Sheet1 is replaced by the model's sheets, in order`, book.sheets.map((s) => s.name).join("|") === doc.workbook.order.map((id) => doc.workbook.sheets[id].name).join("|"), book.sheets.map((s) => s.name));
    check(`${template}: names come across`, Object.keys(doc.workbook.names ?? {}).every((k) => book.namesList.some((n) => n.name === k)), { studio: Object.keys(doc.workbook.names ?? {}).slice(0, 5), excel: book.namesList.map((n) => n.name).slice(0, 5) });
    await roundTrip(template, book, doc);
  }

  // The agent's kinds of edit, applied to Studio and to Excel side by side.
  const studio = await newDocument("valuation", { ticker: null });
  const book = new MBook();
  await writeWorkbook(book.context(), studio);
  const mirror = clone(studio);
  const both = async (label: string, make: (d: StudioDocData) => Patch[]) => {
    const patches = make(studio);
    for (const p of patches) applyPatch(studio, p);
    const r = await applyPatches(book.context(), mirror, patches);
    check(`${label}: applied without rejections`, r.failed.length === 0, r.failed);
    check(`${label}: the mirror keeps step with Studio`, JSON.stringify(mirror.workbook) === JSON.stringify(studio.workbook));
    await roundTrip(label, book, studio);
  };
  const dcf = studio.workbook.order.map((id) => studio.workbook.sheets[id]).find((s) => s.name === "DCF")!.name;
  await both("write a block", (d) => [writeRange(d, dcf, "H40", [["Scenario", 1.5, "=I40*2"], ["2025", "Jun-25", "- note"]])]);
  await both("format a range", (d) => [formatRange(d, dcf, "H40:J41", { b: true, fill: "#FFF2CC", bt: "thin", bb: "double", nf: "0.0%", al: "right" })]);
  await both("fill right", (d) => [fillRange(d, dcf, "J40", "J40:L40")]);
  await both("insert rows", (d) => shiftCells(d, dcf, "r", 5, 2));
  await both("clear", (d) => [clearRange(d, dcf, "H41:J41", "all")]);
  await both("add a sheet", (d) => [addSheet(d, "Scratch").patch]);
  await both("write on the new sheet", (d) => [writeRange(d, "Scratch", "A1", [["Label", 1, 2], ["Total", "=SUM(B1:C1)", null]])]);
  await both("rename a sheet (formulas follow)", (d) => renameSheet(d, "Scratch", "Scratch pad"));
  await both("column widths and frozen panes", (d) => { const id = d.workbook.order.find((x) => d.workbook.sheets[x].name === "Scratch pad")!; return [{ op: "sheet_meta", sheet: id, cols: { A: 240, B: 100 }, freeze: { rows: 1, cols: 1 } }]; });
  await both("reorder sheets", (d) => [{ op: "sheet_order", order: [...d.workbook.order].reverse() }]);
  await both("a new name", () => [{ op: "names", names: { SCRATCH_TOTAL: "'Scratch pad'!$B$2" } }]);
  await both("delete a sheet", (d) => deleteSheet(d, "Scratch pad"));
  await both("slides and comments are not Excel's business", (d) => [{ op: "title", title: "Renamed" }, { op: "comments", comments: [{ id: "c1", target: { kind: "cell", sheet: d.workbook.order[0], cell: "A1" }, text: "check", author: "me", at: "" }] }]);

  // Formulas Excel will not take cost only those cells.
  const bad = clone(studio);
  const badMirror = clone(studio);
  const p = writeRange(bad, dcf, "N1", [[1, "=NOSUCHFN(1)", 3]]);
  const r = await applyPatches(book.context(), badMirror, [p]);
  check("a formula Excel rejects fails alone; its neighbours are written", r.failed.length === 1 && r.failed[0] === `${dcf}!O1` && book.sheets.find((s) => s.name === dcf)!.cells.has("0,13") && book.sheets.find((s) => s.name === dcf)!.cells.has("0,15"), r.failed);

  // A person's edits in Excel come back as a sync.
  const person = new MBook();
  const doc = await newDocument("dcf", { ticker: null });
  await writeWorkbook(person.context(), doc);
  const sheet = doc.workbook.sheets[doc.workbook.order[0]];
  const input = Object.entries(sheet.cells).find(([, c]) => typeof c.v === "number" && c.s?.color === "#0000FF")!;
  person.type(sheet.name, input[0], 0.123);
  person.type(sheet.name, "Z1", "My note");
  person.worksheets.add("Notes");
  person.type("Notes", "A1", "=DCF!" + input[0] + "*2");
  const { snapshot } = await readSnapshot(person.context());
  const patches = diffWorkbook(doc.workbook, snapshot);
  const cellPatch = patches.find((x) => x.op === "cells") as Extract<Patch, { op: "cells" }> | undefined;
  check("typing in Excel: the new input, the new label and the new sheet come back", !!cellPatch && cellPatch.cells[input[0]]?.v === 0.123 && cellPatch.cells.Z1?.v === "My note" && patches.some((x) => x.op === "sheet_add" && x.sheet.name === "Notes" && x.sheet.cells.A1?.f === `DCF!${input[0]}*2`), patches.map((x) => x.op));
  check("typing in Excel: the input keeps its blue", cellPatch?.cells[input[0]]?.s?.color === "#0000FF");
  for (const x of patches) applyPatch(doc, x);
  await roundTrip("after the sync", person, doc);
  const only = new Set([person.sheets[0].id]);
  const partial = (await readSnapshot(person.context(), only)).snapshot;
  check("a quick sync reads only the edited sheet and says so", partial.partial === true && partial.sheets.length === 1 && !partial.names);

  // PowerPoint: insert, refresh in place, new and deleted slides, the person's own slides.
  const pres = new MPresentation(2);
  const ctx = pres.context();
  const n = await insertDeck(ctx, MPresentation.file(["A", "B", "C"]), ["s-a", "s-b", "s-c"], 7, pres.slides[0].id);
  check("insert: three slides after the selected one, tagged", n === 3 && pres.slides.map((s) => s.source).join() === "own-0,A,B,C,own-1" && (await linkedSlides(ctx)).map((l) => l.studio).join() === "s-a,s-b,s-c");
  pres.slides.splice(2, 0, { id: "999#", source: "mine", tags: new Map() });
  const r2 = await refreshDeck(ctx, MPresentation.file(["A2", "C2", "D2"]), ["s-a", "s-c", "s-d"], 7);
  check("refresh: slides replaced in place, a deleted one removed, a new one added after the last", r2.replaced === 2 && r2.removed === 1 && r2.added === 1 && pres.slides.map((s) => s.source).join() === "own-0,A2,mine,C2,D2,own-1", { r2, order: pres.slides.map((s) => s.source) });
  check("the exported deck's slide ids start at 256", sourceSlideId(0) === "256#" && sourceSlideId(3) === "259#");
  pres.selected = [pres.slides[1].id];
  await unlinkSelected(ctx);
  const r3 = await refreshDeck(ctx, MPresentation.file(["A3", "C3", "D3"]), ["s-a", "s-c", "s-d"], 7);
  check("an unlinked slide keeps the person's edits; the rest refresh", pres.slides.map((s) => s.source).join() === "own-0,A2,mine,C3,D3,own-1,A3" || pres.slides.map((s) => s.source).join() === "own-0,A2,mine,C3,D3,A3,own-1", { r3, order: pres.slides.map((s) => s.source) });
  const other = await refreshDeck(ctx, MPresentation.file(["X"]), ["s-x"], 8);
  check("slides linked to another model are not touched", other.replaced === 0 && other.added === 1 && pres.slides.some((s) => s.source === "C3"));
}

/* ---------------- Checkpoints ---------------- */
async function checkpointTests() {
  const before = await newDocument("valuation", { ticker: null });
  const after = clone(before);
  const dcfId = after.workbook.order.find((id) => after.workbook.sheets[id].name === "DCF")!;
  const dcf = after.workbook.sheets[dcfId];
  const labelOf = (a: string) => String(dcf.cells[`A${a.replace(/^[A-Z]+/, "")}`]?.v ?? "");
  const wacc = Object.entries(dcf.cells).find(([a, c]) => /^(risk-free|equity risk premium|beta|terminal growth)/i.test(labelOf(a)) && typeof c.v === "number" && !a.startsWith("A"));
  check("found a WACC or growth input to change", !!wacc, Object.keys(dcf.cells).filter((a) => a.startsWith("A")).map((a) => dcf.cells[a].v).slice(0, 40));
  if (!wacc) return;
  dcf.cells[wacc[0]] = { ...wacc[1], v: (wacc[1].v as number) + 0.01 };
  const someFormula = Object.entries(dcf.cells).find(([, c]) => c.f && /SUM\(/.test(c.f))!;
  dcf.cells[someFormula[0]] = { ...someFormula[1], f: `${someFormula[1].f}*1` };
  after.deck.slides[after.deck.order[1]] = { ...after.deck.slides[after.deck.order[1]], title: "Changed title" };
  const d = semanticDiff(before, after);
  check("the diff names the changed input with its row label", d.inputs.length === 1 && d.inputs[0].label === labelOf(wacc[0]).trim().slice(0, 60) && d.inputs[0].cell === wacc[0], d.inputs);
  check("the diff names the changed formula", d.formulas.length === 1 && d.formulas[0].cell === someFormula[0], d.formulas);
  check("the key outputs moved and say by how much", d.outputs.length > 0 && d.outputs.some((o) => o.change !== null && o.change < 0), d.outputs.slice(0, 4));
  check("the changed slide is listed", d.slides.changed.includes("Changed title"));
  check("the summary reads plainly", /Key outputs/.test(summarizeDiff(d)) && /Inputs changed \(1\)/.test(summarizeDiff(d)), summarizeDiff(d));
  check("no changes, no diff", diffIsEmpty(semanticDiff(before, clone(before))));
  // Restore: a later state goes back to the checkpoint exactly, as one undoable set of patches.
  const later = clone(after);
  const extra = addSheet(later, "Extra");
  applyPatch(later, extra.patch);
  for (const p of renameSheet(later, "Summary", "Summary v2")) applyPatch(later, p);
  applyPatch(later, { op: "slide_delete", id: later.deck.order[0] });
  applyPatch(later, { op: "names", names: { NEWNAME: "DCF!$B$2" } });
  const patches = restorePatches(later, before);
  const undo = applyWithUndo(later, patches);
  check("restore returns the workbook exactly", same(later.workbook, before.workbook), { order: later.workbook.order.map((id) => later.workbook.sheets[id].name) });
  check("restore returns the deck exactly", same(later.deck, before.deck));
  applyWithUndo(later, undo);
  check("and the restore can itself be undone", later.workbook.order.some((id) => later.workbook.sheets[id].name === "Extra"));
}

/* ---------------- Brand check ---------------- */
function lintTests() {
  const doc: StudioDocData = { title: "t", workbook: { order: ["s1"], sheets: { s1: { id: "s1", name: "DCF", cells: {} } } }, deck: emptyDeck(), comments: [] };
  const slides: Slide[] = [
    { id: "t", layout: "title", title: "Project Atlas", subtitle: "Discussion materials | March 2024", elements: [] },
    { id: "c", layout: "content", title: "Valuation", elements: [
      { id: "tb", type: "table", x: 0.5, y: 1.3, w: 6, h: 1.2, link: { sheet: "s1", range: "A1:G40" } },
      { id: "tx", type: "text", x: 9, y: 5, w: 5, h: 0.5, size: 16, color: "#FF00AA", text: "A long paragraph of commentary that will not fit into a box this small at sixteen point type, not even close." },
      { id: "m", type: "metric", x: 0.5, y: 3, w: 2, h: 1, label: "", link: { sheet: "s1", range: "C5" } },
    ] },
  ];
  for (const s of slides) { doc.deck.slides[s.id] = s; doc.deck.order.push(s.id); }
  const now = new Date(Date.UTC(2026, 8, 27));
  const issues = lintDeck(doc, now);
  const rules = issues.map((i) => i.rule);
  for (const r of ["stale-cover-date", "missing-source", "off-page", "overflow", "off-palette", "crowded-table", "unlabelled-metric"]) check(`brand check finds ${r}`, rules.includes(r), rules);
  check("errors sort first", issues[0].severity === "error");
  check("keys are unique", new Set(issues.map((i) => i.key)).size === issues.length);
  const fixed = clone(doc);
  for (const p of fixAll(doc, issues)) applyPatch(fixed, p);
  const tx = fixed.deck.slides.c.elements.find((e) => e.id === "tx")! as Extract<Slide["elements"][number], { type: "text" }>;
  check("fixes on one element stack: moved inside, smaller and back on palette", tx.x + tx.w <= 13.333 - 0.3 + 1e-9 && tx.size === 14 && tx.color === undefined, tx);
  check("the cover date is brought up to this month", fixed.deck.slides.t.subtitle === "Discussion materials | September 2026", fixed.deck.slides.t.subtitle);
  check("a source line is added naming the model's sheet", /DCF/.test(fixed.deck.slides.c.sources ?? ""), fixed.deck.slides.c.sources);
  const again = lintDeck(fixed, now).map((i) => i.rule);
  check("after fixing, only what needs a person remains", !again.includes("stale-cover-date") && !again.includes("missing-source") && !again.includes("off-page") && !again.includes("off-palette") && again.includes("crowded-table"), again);
  check("a current cover date is fine", !lintDeck({ ...doc, deck: { ...doc.deck, slides: { ...doc.deck.slides, t: { ...slides[0], subtitle: "September 2026" } } } }, now).some((i) => i.rule === "stale-cover-date"));
}

/* ---------------- Documents ---------------- */
async function documentTests() {
  const doc = await newDocument("valuation", { ticker: null });
  const o = outline(doc);
  check("the outline lists slides by number and rows by label", /Slide 1: /.test(o) && /Sheet "DCF":/.test(o) && /row \d+: /.test(o), o.slice(0, 300));
  check("the outline names the period columns", /periods \(row \d+\): [A-Z]+=/.test(o), o.match(/periods.*$/m)?.[0]);
  const marks: Mark[] = [
    { page: 1, target: "slide", slide: 2, sheet: null, cell: null, quote: "EV", instruction: "Show EV in billions", handwriting: "$bn?" },
    { page: 3, target: "cell", slide: null, sheet: "dcf", cell: "$C$10", quote: null, instruction: "Use 9.5% WACC", handwriting: null },
    { page: 4, target: "general", slide: null, sheet: null, cell: null, quote: null, instruction: "Tighten the whole page", handwriting: null },
    { page: 2, target: "cell", slide: null, sheet: "Nope", cell: "B2", quote: null, instruction: "Check this", handwriting: null },
  ];
  const r = commentsFromMarks(doc, marks, "markup.pdf", "MD");
  const dcfId = doc.workbook.order.find((id) => doc.workbook.sheets[id].name === "DCF");
  check("a slide mark lands on its slide", r.comments[0].target.kind === "slide" && (r.comments[0].target as { slide: string }).slide === doc.deck.order[1] && /written: "\$bn\?"/.test(r.comments[0].text));
  check("a cell mark lands on its cell, sheet matched whatever the case", r.comments[1].target.kind === "cell" && (r.comments[1].target as { sheet: string; cell: string }).sheet === dcfId && (r.comments[1].target as { cell: string }).cell === "C10");
  check("an unplaceable mark lands on its page's slide, and is counted", r.comments[2].target.kind === "slide" && (r.comments[2].target as { slide: string }).slide === doc.deck.order[3] && r.unplaced === 2);
  check("comments say where they came from", r.comments.every((c) => /markup\.pdf p\.\d/.test(c.author)));
  const x: ExtractResult = {
    company: "Atlas Co.", currency: "USD",
    tables: [
      { title: "Income statement", page: 42, unit: "USD millions", periods: ["FY2023A", "FY2024A", "FY2025E"], rows: [
        { label: "Revenue", values: [100, 120, 150], kind: "line" }, { label: "EBITDA", values: [20, 26, null], kind: "total" }, { label: "EBITDA margin", values: [0.2, 0.217, null], kind: "percent" },
      ] },
      { title: "KPIs", page: 7, unit: "units", periods: ["2024", "2025"], rows: [{ label: "Customers", values: [1000, 1300], kind: "line" }] },
    ],
    notes: ["FY2025 is management's budget, unaudited."],
  };
  const t = tablesToSheet(doc, x, "CIM_Atlas.pdf");
  const c = t.sheet.cells;
  check("extracted tables: every figure is a blue, sourced input", t.figures === 9 && c.B6?.v === 100 && c.B6?.src === "CIM_Atlas.pdf, page 42" && c.B6?.s?.color === "#0000FF", { figures: t.figures, B6: c.B6 });
  check("extracted tables: headings, totals and percentages are formatted", c.A4?.v === "Income statement" && c.A5?.v === "USD millions · page 42" && c.B5?.v === "FY2023A" && c.B7?.s?.b === true && c.B7?.s?.bt === "thin" && c.B8?.s?.nf?.includes("%") === true && c.D7 === undefined);
  check("extracted tables: the notes come last and the sheet is named for the file", /unaudited/.test(String(Object.values(c).at(-1)?.v)) && t.sheet.name === "DR CIM Atlas");
}

/* ---------------- Manifest and pairing ---------------- */
function manifestTests() {
  const xml = manifestXml("https://youbank.example");
  const tags: string[] = [];
  let ok = true;
  for (const m of xml.replace(/<\?xml[^>]*\?>/, "").matchAll(/<(\/?)([A-Za-z:_.]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) { if (tags.pop() !== m[2]) ok = false; } else tags.push(m[2]);
  }
  check("the manifest is well-formed XML", ok && tags.length === 0);
  const order = ["<Id>", "<Version>", "<ProviderName>", "<DefaultLocale>", "<DisplayName", "<Description", "<IconUrl", "<HighResolutionIconUrl", "<SupportUrl", "<AppDomains>", "<Hosts>", "<DefaultSettings>", "<Permissions>", "<VersionOverrides"];
  check("the manifest's top-level elements are in schema order", order.every((t, i) => i === 0 || xml.indexOf(t) > xml.indexOf(order[i - 1])));
  check("both hosts, a ribbon button each, all URLs on this deployment", /<Host Name="Workbook"\/>/.test(xml) && /<Host Name="Presentation"\/>/.test(xml) && (xml.match(/xsi:type="ShowTaskpane"/g) ?? []).length === 2 && [...xml.matchAll(/DefaultValue="(https?:[^"]+)"/g)].every((m) => m[1].startsWith("https://youbank.example/")));
  const strings = [...xml.matchAll(/<bt:String id="([^"]+)" DefaultValue="([^"]+)"/g)];
  check("short strings within 125 characters and long ones within 250", strings.every((m) => m[2].length <= (/Tooltip|Description/.test(m[1]) ? 250 : 125)) && (/<Description DefaultValue="([^"]+)"/.exec(xml)?.[1].length ?? 999) <= 250);
  check("the add-in id is a GUID", /<Id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}<\/Id>/.test(xml));
  const codes = new Set(Array.from({ length: 200 }, () => newCode()));
  check("pairing codes look like ABCD-2345 and avoid look-alike characters", [...codes].every((c) => /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/.test(c)) && codes.size > 195);
  check("codes are forgiving to type", normalizeCode(" abcd 2345 ") === "ABCD-2345" && normalizeCode("abcd-2345") === "ABCD-2345" && normalizeCode("abc") === null);
}

async function main() {
  await excelTests();
  await checkpointTests();
  lintTests();
  await documentTests();
  manifestTests();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
