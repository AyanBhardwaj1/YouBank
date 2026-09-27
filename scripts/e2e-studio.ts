/**
 * End-to-end Studio check with the live model: the agent builds a valuation pack with a linked deck,
 * builds a custom sheet and slide by hand, turns a reviewer comment, and a run is undone. Then the
 * stored document is exported to .xlsx and .pptx. Point DATABASE_URL at a Neon branch with
 * drizzle/0007_studio.sql applied, never production:
 *
 *   DATABASE_URL=<branch url> OPENAI_API_KEY=... pnpm exec tsx scripts/e2e-studio.ts
 */
import JSZip from "jszip";
import { runStudioAgent, type StudioStreamEvent } from "@/lib/studio/agent";
import { auditWorkbook } from "@/lib/studio/audit";
import { newDocument } from "@/lib/studio/create";
import { commit, createDoc, docData, requireDoc, undoForRun } from "@/lib/studio/db";
import { tieOut } from "@/lib/studio/deck";
import { Engine } from "@/lib/studio/engine";
import { exportPptx } from "@/lib/studio/pptx";
import { newId } from "@/lib/studio/types";
import { exportXlsx, importXlsx } from "@/lib/studio/xlsx";

const user = { id: `e2e-studio-${Date.now()}`, email: "e2e@example.com", name: "E2E" };
let fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}${!cond && detail !== undefined ? `  -> ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
  if (!cond) fail++;
};

async function run(docId: number, instruction: string) {
  const events: StudioStreamEvent[] = [];
  const started = Date.now();
  let firstPatch = 0;
  await runStudioAgent({ user, docId, instruction, emit: (e) => { if (e.t === "patch" && !firstPatch) firstPatch = Date.now(); events.push(e); } });
  const done = events.find((e) => e.t === "done") as Extract<StudioStreamEvent, { t: "done" }> | undefined;
  const tools = events.filter((e) => e.t === "tool" && e.status === "start").map((e) => (e as { name: string }).name);
  const errors = events.filter((e) => e.t === "error").map((e) => (e as { message: string }).message);
  console.log(`\n> ${instruction}\n  ${((Date.now() - started) / 1000).toFixed(1)}s total, first change after ${firstPatch ? ((firstPatch - started) / 1000).toFixed(1) : "-"}s, ${events.filter((e) => e.t === "patch").length} commits; tools: ${tools.join(", ")}`);
  if (errors.length) console.log(`  errors: ${errors.join(" | ")}`);
  console.log(`  summary: ${(done?.summary ?? "").replace(/\s+/g, " ").slice(0, 700)}`);
  return { events, done, tools, errors };
}

void (async () => {
  const d = await newDocument("blank", { title: "E2E Studio" });
  const row = await createDoc(user, { ...d, kind: "blank" });
  console.log(`doc ${row.id} for ${user.id}`);

  // 1. A standard pack, from SEC data, with a linked deck.
  const r1 = await run(row.id, "Build a valuation pack for SNOW with a linked deck.");
  let doc = docData(await requireDoc(user, row.id));
  let e = new Engine(doc.workbook);
  const names = doc.workbook.order.map((id) => doc.workbook.sheets[id].name);
  check("the agent used build_model", r1.tools.includes("build_model"), r1.tools);
  check("DCF, comps and summary sheets exist", ["DCF", "Comps", "Summary"].every((n) => names.includes(n)), names);
  check("a linked deck of five or more slides", doc.deck.order.length >= 5, doc.deck.order.length);
  const dcf = doc.workbook.order.find((id) => doc.workbook.sheets[id].name === "DCF")!;
  const px = e.get(dcf, "C53");
  check("the DCF produces a share price", typeof px === "number" && px > 0, px);
  check("no model errors after the run", auditWorkbook(e).filter((i) => i.severity === "error").length === 0, auditWorkbook(e).filter((i) => i.severity === "error").slice(0, 5));
  check("the deck ties to the model", tieOut(doc.deck, e).filter((i) => i.severity === "error").length === 0, tieOut(doc.deck, e));

  // 2. Custom work: a bridge built with formulas, and a waterfall slide linked to it.
  const r2 = await run(row.id, "On a new sheet called Bridge, build an enterprise value to equity value bridge that links to the DCF sheet with formulas (enterprise value, less debt, plus cash, equals equity value, then per share). Format it like a banker, then add a slide titled 'Equity value bridge' with a waterfall chart linked to the bridge.");
  doc = docData(await requireDoc(user, row.id));
  e = new Engine(doc.workbook);
  const bridge = doc.workbook.order.find((id) => doc.workbook.sheets[id].name.toLowerCase() === "bridge");
  const bridgeCells = bridge ? Object.values(doc.workbook.sheets[bridge].cells) : [];
  check("a Bridge sheet with formulas linking to the DCF", !!bridge && bridgeCells.some((c) => c.f && /DCF!/i.test(c.f)), bridgeCells.slice(0, 12));
  check("its equity value matches the DCF", !!bridge && Object.keys(doc.workbook.sheets[bridge].cells).some((a) => { const v = e.get(bridge, a); const eq = e.get(dcf, "C50"); return typeof v === "number" && typeof eq === "number" && Math.abs(v - eq) < 0.01 && !!doc.workbook.sheets[bridge].cells[a].f; }));
  const wf = doc.deck.order.map((id) => doc.deck.slides[id]).find((s) => s.elements.some((x) => x.type === "chart" && x.kind === "waterfall"));
  check("a slide with a linked waterfall chart", !!wf && wf.elements.some((x) => x.type === "chart" && x.kind === "waterfall" && (!!x.link || !!x.series?.length)), doc.deck.order.map((id) => doc.deck.slides[id].title));
  check("no model errors after the custom build", auditWorkbook(e).filter((i) => i.severity === "error").length === 0, auditWorkbook(e).filter((i) => i.severity === "error").slice(0, 5));

  // 3. Turning a reviewer's comment.
  const summarySlide = doc.deck.order.find((id) => /valuation summary/i.test(doc.deck.slides[id].title)) ?? doc.deck.order[1];
  const comment = { id: newId("cm"), target: { kind: "slide" as const, slide: summarySlide }, text: "Use a 3.5% terminal growth rate and make sure every page reflects it.", author: "MD", at: new Date().toISOString() };
  await commit(row.id, doc, [{ op: "comments", comments: [...doc.comments, comment] }], { actor: user.id, actorName: "MD", label: "Commented" });
  const r3 = await run(row.id, "Turn all open comments and resolve them.");
  doc = docData(await requireDoc(user, row.id));
  e = new Engine(doc.workbook);
  check("terminal growth is now 3.5%", Math.abs((e.get(dcf, "C42") as number) - 0.035) < 1e-9, e.get(dcf, "C42"));
  check("the comment is resolved with a note", doc.comments.some((c) => c.id === comment.id && c.resolved && !!c.resolution), doc.comments);
  void r3;

  // 4. Undo the custom build: the Bridge sheet goes, everything else stays.
  const r2run = r2.done?.runId ?? "";
  const undo = await undoForRun(row.id, r2run);
  await commit(row.id, doc, undo, { actor: user.id, actorName: "E2E", label: "Undid a run" }, e);
  doc = docData(await requireDoc(user, row.id));
  check("undoing the run removes the Bridge sheet and its slide", !doc.workbook.order.includes(bridge ?? "") && !doc.deck.order.includes(wf?.id ?? ""), { sheets: doc.workbook.order.map((id) => doc.workbook.sheets[id].name), slides: doc.deck.order.map((id) => doc.deck.slides[id].title) });
  e = new Engine(doc.workbook);
  check("…and keeps the later comment change", Math.abs((e.get(dcf, "C42") as number) - 0.035) < 1e-9, e.get(dcf, "C42"));

  // 5. Files from the stored document.
  const xlsx = await exportXlsx(doc, e);
  const back = await importXlsx(xlsx, "e2e.xlsx");
  const dcf2 = back.workbook.order.find((id) => back.workbook.sheets[id].name === "DCF")!;
  check("the exported workbook recomputes to the same price", Math.abs((new Engine(back.workbook).get(dcf2, "C53") as number) - (e.get(dcf, "C53") as number)) < 1e-6);
  const pptx = await exportPptx(doc, e);
  const zip = await JSZip.loadAsync(pptx);
  check("the exported deck has every slide", Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length === doc.deck.order.length);
  console.log(`\n${fail ? `${fail} FAILED` : "all checks passed"}`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
