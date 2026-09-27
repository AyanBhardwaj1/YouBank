/**
 * End-to-end check of YouBank for Excel and PowerPoint against a running server and a Neon branch
 * with drizzle/0008_office.sql applied (never production), using the live model:
 *
 *   YOUBANK_DEV_USER=officee2e DATABASE_URL=<branch> pnpm exec next dev --port 3100
 *   BASE=http://localhost:3100 pnpm exec tsx scripts/e2e-office.ts
 *
 * Pairs a device the way the add-in does, links an "Excel" workbook (the in-memory one from
 * mock-office.ts), syncs edits both ways, runs the agent over the bearer token and applies its
 * patches to the workbook as they stream, rebuilds an old state from undo patches (reopening a
 * workbook), inserts and refreshes a deck, checkpoints, the brand check, reads a marked-up page and a
 * data-room PDF, and revokes the device.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import JSZip from "jszip";
import { MBook } from "./mock-office";
import { applyPatches, readSnapshot } from "@/lib/office/excel";
import { same } from "@/lib/studio/checkpoints";
import type { StudioStreamEvent } from "@/lib/studio/agent";
import { applyPatch, type Patch } from "@/lib/studio/ops";
import type { StudioDocData } from "@/lib/studio/types";

const BASE = process.env.BASE ?? "http://localhost:3100";
const TMP = process.env.TMPDIR_E2E ?? "/tmp/youbank-e2e-office";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(TMP, { recursive: true });
let fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}${!cond && detail !== undefined ? `  -> ${JSON.stringify(detail).slice(0, 700)}` : ""}`);
  if (!cond) fail++;
};
let token = "";
async function call(path: string, init: { method?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string>; bearer?: string | null } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  const t = init.bearer === undefined ? token : init.bearer;
  if (t) headers.authorization = `Bearer ${t}`;
  let body = init.body;
  if (init.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(init.json); }
  const res = await fetch(`${BASE}${path}`, { method: init.method ?? (body ? "POST" : "GET"), headers, body });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test responses of many shapes
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, res };
}

/** Headless Chrome with a kill guard (it can hang on some pages). */
function chrome(args: string[], seconds = 40) {
  return new Promise<void>((resolve) => {
    const p = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", ...args], { stdio: "ignore" });
    const t = setTimeout(() => p.kill("SIGKILL"), seconds * 1000);
    p.on("exit", () => { clearTimeout(t); resolve(); });
  });
}

async function main() {
  console.log(`E2E against ${BASE}`);
  // Warm the routes the dev server compiles on first use.
  for (const p of ["/api/office/me", "/office/manifest.xml", "/api/studio"]) await call(p, { bearer: null }).catch(() => undefined);

  /* ---------- Pairing ---------- */
  console.log("\nPairing");
  const start = await call("/api/office/pair/start", { json: { host: "Excel" }, bearer: null });
  check("start gives a code, a poll secret and an approval link", start.status === 200 && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(start.data.code) && start.data.poll.length > 20 && start.data.approveUrl.endsWith(`/office/connect?code=${start.data.code}`), start.data);
  const pending = await call("/api/office/pair/poll", { json: { poll: start.data.poll }, bearer: null });
  check("before approval the add-in waits", pending.data.status === "pending", pending.data);
  const wrong = await call("/api/office/pair/approve", { json: { code: "ZZZZ-ZZZZ" }, bearer: null });
  check("a wrong code is refused", wrong.status === 404, wrong);
  const approve = await call("/api/office/pair/approve", { json: { code: start.data.code.toLowerCase().replace("-", " ") }, bearer: null });
  check("the signed-in person approves the code (typed loosely)", approve.status === 200 && approve.data.host === "Excel", approve.data);
  const again = await call("/api/office/pair/approve", { json: { code: start.data.code }, bearer: null });
  check("a code cannot be approved twice", again.status === 404);
  const got = await call("/api/office/pair/poll", { json: { poll: start.data.poll }, bearer: null });
  check("the add-in collects its token once", got.data.status === "approved" && /^ybo_/.test(got.data.token), got.data.status);
  token = got.data.token;
  const twice = await call("/api/office/pair/poll", { json: { poll: start.data.poll }, bearer: null });
  check("and never again", twice.data.status === "expired", twice.data);
  const me = await call("/api/office/me");
  check("the token signs the add-in in", me.status === 200, me.data);
  check("a bad token is refused", (await call("/api/office/me", { bearer: "ybo_notarealtokennotarealtoken" })).status === 401);

  /* ---------- Link a workbook ---------- */
  console.log("\nExcel: link, round trip, a person's edit");
  const book = new MBook();
  book.type("Sheet1", "A1", "Revenue");
  book.type("Sheet1", "B1", 1000);
  book.type("Sheet1", "C1", "=B1*1.15");
  book.type("Sheet1", "A2", "Growth");
  book.type("Sheet1", "B2", "15%");
  const snap0 = (await readSnapshot(book.context())).snapshot;
  const created = await call("/api/studio", { json: { snapshot: snap0, title: "E2E workbook" } });
  check("a Studio document is made from the open workbook", created.status === 200 && created.data.id > 0, created.data);
  const id = created.data.id as number;
  let got0 = await call(`/api/studio/${id}`);
  check("it holds what Excel holds", got0.data.doc.workbook.sheets[got0.data.doc.workbook.order[0]].cells.C1.f === "B1*1.15" && got0.data.doc.workbook.sheets[got0.data.doc.workbook.order[0]].cells.B2.v === 0.15, got0.data.doc.workbook);
  let cursor = got0.data.cursor as number;
  const noop = await call(`/api/studio/${id}/sync`, { json: { snapshot: snap0, base: cursor } });
  check("syncing an unchanged workbook stores nothing", noop.status === 200 && noop.data.event === null, noop.data);

  // A model from YouBank written into the workbook, as stored in Postgres, reads back unchanged.
  const tpl = await call(`/api/studio/${id}/action`, { json: { action: "template", args: { template: "valuation" } } });
  check("a valuation pack is added over the token", tpl.status === 200 && tpl.data.events.length >= 2, tpl.data);
  const mirror: StudioDocData = got0.data.doc;
  for (const e of tpl.data.events) await applyPatches(book.context(), mirror, e.patches);
  got0 = await call(`/api/studio/${id}`);
  check("the mirror matches the stored document", same(mirror.workbook, got0.data.doc.workbook));
  cursor = got0.data.cursor;
  const snap1 = (await readSnapshot(book.context())).snapshot;
  const rt = await call(`/api/studio/${id}/sync`, { json: { snapshot: snap1, base: cursor } });
  check("after applying the template in Excel, a sync finds nothing to change", rt.data.event === null, rt.data);

  // The person types in Excel.
  const dcf = book.sheets.find((s) => s.name === "DCF")!;
  book.type("DCF", "J1", "Analyst note");
  book.type("Sheet1", "B1", 1250);
  const stale = await call(`/api/studio/${id}/sync`, { json: { snapshot: (await readSnapshot(book.context())).snapshot, base: cursor - 1 } });
  check("a sync from a workbook that is behind is refused (so it cannot undo newer changes)", stale.status === 409, stale.status);
  const snapPartial = (await readSnapshot(book.context(), new Set([dcf.id, book.sheets[0].id]))).snapshot;
  const gz = gzipSync(Buffer.from(JSON.stringify({ snapshot: snapPartial, base: cursor })));
  const synced = await call(`/api/studio/${id}/sync`, { body: gz, headers: { "content-type": "application/json", "x-youbank-encoding": "gzip" } });
  check("the edits come back as one change, gzipped and partial", synced.status === 200 && synced.data.event?.cells === 2 && /Synced from Excel: 2 cells/.test(synced.data.event?.label), synced.data);
  for (const p of synced.data.event.patches as Patch[]) applyPatch(mirror, p);
  const afterSync = await call(`/api/studio/${id}`);
  check("the stored document has the person's edits", afterSync.data.doc.workbook.sheets[afterSync.data.doc.workbook.order[0]].cells.B1.v === 1250);
  check("the history says it came from Excel", afterSync.data.history[0].label.startsWith("Synced from Excel") && afterSync.data.history[0].actorName.length > 0, afterSync.data.history[0]);
  const docAtCursor = structuredClone(afterSync.data.doc) as StudioDocData;
  cursor = afterSync.data.cursor;

  /* ---------- The agent, live ---------- */
  console.log("\nThe agent, streaming into Excel");
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/studio/${id}/agent`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ instruction: "On a new sheet called Check, put Revenue in A1, 100 in B1, and =B1*1.1 in C1. Then bold A1:C1. Be quick.", effort: "fast" }) });
  check("the agent starts over the token", res.ok, res.status);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "", firstPatch = 0, patches = 0, done: Extract<StudioStreamEvent, { t: "done" }> | null = null;
  let chain = Promise.resolve();
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const e = JSON.parse(line) as StudioStreamEvent;
      if (e.t === "patch") { patches++; if (!firstPatch) firstPatch = Date.now(); chain = chain.then(async () => { await applyPatches(book.context(), mirror, e.patches); }); }
      if (e.t === "done") done = e;
      if (e.t === "error") console.log(`    agent error: ${e.message}`);
    }
  }
  await chain;
  console.log(`    ${((Date.now() - t0) / 1000).toFixed(1)}s, first change at ${firstPatch ? ((firstPatch - t0) / 1000).toFixed(1) : "-"}s, ${patches} changes; ${done?.summary.replace(/\s+/g, " ").slice(0, 200)}`);
  const check1 = book.sheets.find((s) => s.name === "Check");
  check("the agent's edits landed in the workbook as they streamed", !!check1 && check1.cells.get("0,1")?.input === 100 && check1.cells.get("0,2")?.formula === "=B1*1.1" && check1.cells.get("0,0")?.fmt.bold === true, check1 ? [...check1.cells.entries()].slice(0, 4) : book.sheets.map((s) => s.name));
  const afterRun = await call(`/api/studio/${id}`);
  const snap2 = (await readSnapshot(book.context())).snapshot;
  const rt2 = await call(`/api/studio/${id}/sync`, { json: { snapshot: snap2, base: afterRun.data.cursor } });
  check("after the run, Excel and Studio agree exactly", rt2.data.event === null, rt2.data);

  // Reopening a workbook later: rebuild the state it last saw from undo patches, then replay.
  const ev = await call(`/api/studio/${id}/events?since=${cursor}&undo=1`);
  check("events since the cursor carry their undo", ev.status === 200 && ev.data.events.length > 0 && ev.data.events.every((e: { undo?: unknown }) => Array.isArray(e.undo)), ev.data.events?.length);
  const base = structuredClone(afterRun.data.doc) as StudioDocData;
  for (const e of [...ev.data.events].reverse()) for (const p of e.undo as Patch[]) applyPatch(base, p);
  check("undoing them from today's document gives exactly the state the workbook last saw", same(base.workbook, docAtCursor.workbook) && same(base.deck, docAtCursor.deck));
  for (const e of ev.data.events) for (const p of e.patches as Patch[]) applyPatch(base, p);
  check("and replaying them brings it back to today", same(base.workbook, afterRun.data.doc.workbook));

  /* ---------- PowerPoint ---------- */
  console.log("\nPowerPoint");
  const deck = await call(`/api/studio/${id}/export?format=pptx&as=base64`);
  check("the deck comes as base64 with its slide ids", deck.status === 200 && deck.data.slides.length >= 4 && deck.data.base64.length > 10_000, { status: deck.status, slides: deck.data.slides?.length });
  const zip = await JSZip.loadAsync(Buffer.from(deck.data.base64, "base64"));
  const pres = await zip.file("ppt/presentation.xml")!.async("string");
  const ids = [...pres.matchAll(/<p:sldId id="(\d+)"/g)].map((m) => Number(m[1]));
  check("its slides are numbered from 256, which is how one slide is re-inserted in place", ids.length === deck.data.slides.length && ids.every((x, i) => x === 256 + i), ids);

  /* ---------- Checkpoints ---------- */
  console.log("\nCheckpoints");
  const cp = await call(`/api/studio/${id}/checkpoints`, { json: { name: "Sent to MD" } });
  check("a checkpoint is saved", cp.status === 200 && cp.data.checkpoint.name === "Sent to MD", cp.data);
  const doc3 = (await call(`/api/studio/${id}`)).data.doc as StudioDocData;
  const dcfId = doc3.workbook.order.find((x) => doc3.workbook.sheets[x].name === "DCF")!;
  const tg = Object.entries(doc3.workbook.sheets[dcfId].cells).find(([a, c]) => /^Terminal growth/i.test(String(doc3.workbook.sheets[dcfId].cells[`A${a.replace(/^[A-Z]+/, "")}`]?.v ?? "")) && typeof c.v === "number")!;
  const edit = await call(`/api/studio/${id}`, { method: "PATCH", json: { patches: [{ op: "cells", sheet: dcfId, cells: { [tg[0]]: { ...tg[1], v: (tg[1].v as number) + 0.005 } } }], undo: [{ op: "cells", sheet: dcfId, cells: { [tg[0]]: tg[1] } }], label: "Raised terminal growth" } });
  check("an edit over the token", edit.status === 200 && edit.data.eventId > 0, edit.data);
  const cmp = await call(`/api/studio/${id}/checkpoints/${cp.data.checkpoint.id}`);
  check("what changed since: the input, with its label", cmp.data.diff.inputs.length === 1 && /Terminal growth/i.test(cmp.data.diff.inputs[0].label), cmp.data.diff.inputs);
  check("what changed since: the outputs it moved", cmp.data.diff.outputs.length > 0 && cmp.data.diff.outputs.some((o: { change: number | null }) => (o.change ?? 0) > 0), cmp.data.diff.outputs.slice(0, 3));
  check("slides are not reported as changed just because Postgres re-sorted their keys", cmp.data.diff.slides.changed.length === 0, cmp.data.diff.slides);
  const rs = await call(`/api/studio/${id}/checkpoints/${cp.data.checkpoint.id}`, { method: "POST" });
  check("restore is one change", rs.status === 200 && rs.data.event?.label === 'Restored checkpoint "Sent to MD"', rs.data);
  const cmp2 = await call(`/api/studio/${id}/checkpoints/${cp.data.checkpoint.id}`);
  check("after restoring there is nothing left to compare", cmp2.data.diff.inputs.length === 0 && cmp2.data.diff.outputs.length === 0 && cmp2.data.diff.formulas.length === 0, cmp2.data.summary);

  /* ---------- Brand check ---------- */
  console.log("\nBrand check");
  const lint = await call(`/api/studio/${id}/action`, { json: { action: "lint" } });
  check("the brand check runs", lint.status === 200 && Array.isArray(lint.data.result), lint.data);
  const d4 = (await call(`/api/studio/${id}`)).data.doc as StudioDocData;
  const content = d4.deck.order.find((x) => d4.deck.slides[x].layout === "content")!;
  const broken = { ...d4.deck.slides[content], sources: "", elements: d4.deck.slides[content].elements.map((e, i) => (i === 0 ? { ...e, y: 6.5 } : e)) };
  await call(`/api/studio/${id}`, { method: "PATCH", json: { patches: [{ op: "slide_upsert", slide: broken }], undo: [{ op: "slide_upsert", slide: d4.deck.slides[content] }], label: "Broke a slide" } });
  const lint2 = await call(`/api/studio/${id}/action`, { json: { action: "lint" } });
  const rules = (lint2.data.result as { rule: string; slide: string }[]).filter((i) => i.slide === content).map((i) => i.rule);
  check("it catches a missing source line and an element in the footer", rules.includes("missing-source") && rules.includes("off-page"), rules);
  const fix = await call(`/api/studio/${id}/action`, { json: { action: "lint_fix" } });
  const left = (fix.data.result as { rule: string; slide: string }[]).filter((i) => i.slide === content).map((i) => i.rule);
  check("fix all repairs them as one change", fix.data.events.length === 1 && !left.includes("missing-source") && !left.includes("off-page"), { events: fix.data.events.length, left });

  /* ---------- Paper in ---------- */
  console.log("\nMarked-up printout → comments");
  const dcfSlide = d4.deck.order.findIndex((x) => /discounted cash flow/i.test(d4.deck.slides[x].title)) + 1;
  writeFileSync(`${TMP}/markup.html`, `<!doctype html><html><body style="margin:0;width:1200px;height:760px;font-family:Arial;background:#fff;position:relative">
    <div style="position:absolute;left:40px;top:30px;font-size:30px;font-weight:bold;color:#0B2545">Discounted cash flow analysis</div>
    <div style="position:absolute;left:1080px;top:38px;font-size:14px;color:#777">${dcfSlide}</div>
    <div style="position:absolute;left:40px;top:90px;width:1120px;border-top:2px solid #C8963E"></div>
    <table style="position:absolute;left:40px;top:120px;font-size:15px;border-collapse:collapse;width:620px">
      ${["Revenue|1,000.0|1,150.0|1,311.0", "EBITDA|200.0|236.0|275.0", "Unlevered free cash flow|96.0|114.3|133.4"].map((r) => `<tr>${r.split("|").map((c, i) => `<td style="padding:6px;border-bottom:1px solid #ddd;${i ? "text-align:right" : ""}">${c}</td>`).join("")}</tr>`).join("")}
    </table>
    <div style="position:absolute;left:720px;top:130px;font-size:17px">Enterprise value ($mm)<br><b style="font-size:30px">2,847.3</b></div>
    <div style="position:absolute;left:705px;top:118px;width:230px;height:80px;border:3px solid #d11;border-radius:50%"></div>
    <div style="position:absolute;left:880px;top:220px;font-family:'Bradley Hand','Marker Felt',cursive;font-size:30px;color:#d11;transform:rotate(-6deg)">show in $bn!</div>
    <div style="position:absolute;left:60px;top:330px;font-family:'Bradley Hand','Marker Felt',cursive;font-size:28px;color:#d11;transform:rotate(-3deg)">Use a 9.5% WACC, not 9.0%</div>
    <div style="position:absolute;left:60px;top:420px;font-family:'Bradley Hand','Marker Felt',cursive;font-size:28px;color:#d11;transform:rotate(2deg)">Add a line for terminal value % of EV</div>
  </body></html>`);
  await chrome([`--screenshot=${TMP}/markup.png`, "--window-size=1200,760", `file://${TMP}/markup.html`]);
  const png = readFileSync(`${TMP}/markup.png`);
  check("made a photo-like marked-up page", png.length > 20_000, png.length);
  const form = new FormData();
  form.set("file", new Blob([png], { type: "image/png" }), "md-markup.png");
  const t1 = Date.now();
  const mk = await call(`/api/studio/${id}/markup`, { body: form });
  console.log(`    ${((Date.now() - t1) / 1000).toFixed(1)}s: ${mk.data.added} comments, ${mk.data.unplaced} unplaced, ${mk.data.illegible} illegible`);
  check("the reviewer's marks become comments", mk.status === 200 && mk.data.added >= 2, mk.data);
  const d5 = (await call(`/api/studio/${id}`)).data.doc as StudioDocData;
  const newComments = d5.comments.filter((c) => /md-markup\.png/.test(c.author));
  console.log(newComments.map((c) => `    · [${c.target.kind === "slide" ? `slide ${d5.deck.order.indexOf(c.target.slide) + 1}` : `${d5.workbook.sheets[c.target.sheet]?.name}!${c.target.cell}`}] ${c.text}`).join("\n"));
  check("they land on the DCF slide and say what the reviewer wants", newComments.some((c) => c.target.kind === "slide" && d5.deck.order.indexOf(c.target.slide) + 1 === dcfSlide) && newComments.some((c) => /9\.5/.test(c.text)) && newComments.some((c) => /bn|billion/i.test(c.text)), newComments.map((c) => c.text));

  console.log("\nData-room PDF → a sheet of sourced inputs");
  writeFileSync(`${TMP}/cim.html`, `<!doctype html><html><body style="font-family:Georgia">
    <h1>Atlas Holdings</h1><p>Confidential Information Memorandum. Prepared for prospective investors.</p><p>Atlas is a provider of industrial software.</p>
    <div style="page-break-after:always"></div>
    <h2>Summary historical financials</h2><p>USD in millions, fiscal years ending December 31</p>
    <table style="border-collapse:collapse;font-size:14px">
      <tr><th></th><th style="padding:4px 14px">FY2022A</th><th style="padding:4px 14px">FY2023A</th><th style="padding:4px 14px">FY2024A</th></tr>
      ${[["Revenue", "812.4", "945.1", "1,102.7"], ["Gross profit", "401.2", "480.6", "575.3"], ["Adjusted EBITDA", "120.5", "151.9", "190.2"], ["Adj. EBITDA margin", "14.8%", "16.1%", "17.2%"], ["Capital expenditures", "(32.1)", "(38.4)", "(45.0)"]]
        .map((r) => `<tr>${r.map((c, i) => `<td style="padding:4px 14px;${i ? "text-align:right" : ""}">${c}</td>`).join("")}</tr>`).join("")}
    </table>
    <p style="font-size:12px">FY2024A adjusted EBITDA excludes $6.3 million of one-time integration costs.</p>
  </body></html>`);
  await chrome(["--no-pdf-header-footer", `--print-to-pdf=${TMP}/atlas-cim.pdf`, `file://${TMP}/cim.html`]);
  const pdf = readFileSync(`${TMP}/atlas-cim.pdf`);
  check("made a two-page CIM", pdf.length > 5_000 && pdf.subarray(0, 4).toString() === "%PDF", pdf.length);
  const form2 = new FormData();
  form2.set("file", new Blob([pdf], { type: "application/pdf" }), "atlas-cim.pdf");
  const t2 = Date.now();
  const ex = await call(`/api/studio/${id}/extract`, { body: form2 });
  console.log(`    ${((Date.now() - t2) / 1000).toFixed(1)}s: ${ex.data.tables} tables, ${ex.data.figures} figures on ${ex.data.sheet?.name}; notes: ${(ex.data.notes ?? []).join(" | ")}`);
  check("the tables come in as a new sheet", ex.status === 200 && ex.data.tables >= 1 && ex.data.figures >= 12, ex.data);
  const d6 = (await call(`/api/studio/${id}`)).data.doc as StudioDocData;
  const dr = d6.workbook.sheets[ex.data.sheet?.id];
  const cells = Object.values(dr?.cells ?? {});
  check("with the figures exactly as printed, sourced to page 2", [812.4, 945.1, 1102.7, 190.2].every((v) => cells.some((c) => c.v === v && c.src === "atlas-cim.pdf, page 2")), cells.filter((c) => typeof c.v === "number").slice(0, 8));
  check("negatives in parentheses and percentages as decimals", cells.some((c) => c.v === -45) && cells.some((c) => c.v === 0.172), cells.filter((c) => typeof c.v === "number" && (c.v < 0 || c.v < 1)).map((c) => c.v));
  check("the adjustment note is kept", (ex.data.notes ?? []).some((n: string) => /integration|one-time|6\.3/i.test(n)), ex.data.notes);

  /* ---------- Devices, pages ---------- */
  console.log("\nDevices and pages");
  const devices = await call("/api/office/devices", { bearer: null });
  const mine = devices.data.devices?.find((d: { host: string }) => d.host === "Excel");
  check("the browser lists the connected Excel", devices.status === 200 && !!mine && mine.lastUsedAt, devices.data);
  const manifest = await call("/office/manifest.xml", { bearer: null });
  check("the manifest points at this deployment", manifest.status === 200 && String(manifest.data).includes(`${BASE}/office/taskpane`) && String(manifest.data).includes('<Host Name="Presentation"/>'));
  const pane = await fetch(`${BASE}/office/taskpane`);
  check("the task pane page loads", pane.status === 200 && (await pane.text()).includes("YouBank"));
  check("the function file loads Office.js", (await (await fetch(`${BASE}/office/commands`)).text()).includes("appsforoffice.microsoft.com/lib/1/hosted/office.js"));
  const setup = await fetch(`${BASE}/office/connect?code=ABCD-2345`);
  check("the connect page loads without onboarding and carries the code", setup.status === 200 && (await setup.text()).includes("ABCD-2345"));
  const revoke = await call(`/api/office/devices?id=${mine.id}`, { method: "DELETE", bearer: null });
  check("the device is disconnected", revoke.status === 200);
  check("and its token stops working at once", (await call(`/api/studio/${id}`)).status === 401);

  console.log(`\n${fail ? `${fail} FAILED` : "all passed"}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
