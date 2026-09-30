/**
 * Running and refining scenarios from a request: the preview (a thousand paths, in the request) and the
 * refinement (ten thousand statistical paths, or two thousand from the diffusion model on the ML
 * service) in the background. Tables arrive as pasted CSV or a CSV or Excel file from the library.
 */
import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { logError } from "@/lib/errors";
import { mlReady, mlStart, type MlDone } from "../infra/ml";
import { getJson, putJson, r2Ready, readParts, getBytes } from "../infra/r2";
import { tickerReturns } from "./data";
import { shockFromText } from "./drivers";
import { runMarket, type MarketResult, type MarketSpec } from "./market";
import { getScenario, updateScenario } from "./store";
import type { Cell, Col, TableIn } from "./tables";

/** A CSV into a table: a header row, columns typed as numbers when nearly all their values are. Pure. */
export function parseCsv(text: string, maxRows = 20_000): TableIn {
  const lines: string[][] = [];
  let cur: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === "," || ch === "\t" || ch === ";") { cur.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; cur.push(field); field = ""; if (cur.some((c) => c.trim() !== "")) lines.push(cur); cur = []; if (lines.length > maxRows) break; }
    else field += ch;
  }
  if (field !== "" || cur.length) { cur.push(field); if (cur.some((c) => c.trim() !== "")) lines.push(cur); }
  const [head = [], ...body] = lines;
  const toNum = (s: string) => { const t = s.trim().replace(/[$,%\s]/g, "").replace(/^\((.*)\)$/, "-$1"); return t === "" ? null : Number(t); };
  const columns: Col[] = head.map((h, j) => {
    const vals = body.map((r) => (r[j] ?? "").trim()).filter((v) => v !== "");
    const nums = vals.filter((v) => Number.isFinite(toNum(v) as number));
    const distinct = new Set(vals).size;
    const allDistinct = vals.length >= 5 && distinct === vals.length;
    return { name: h.trim() || `Column ${j + 1}`, type: vals.length && nums.length / vals.length >= 0.9 ? "num" : !allDistinct && distinct <= Math.max(20, vals.length * 0.5) ? "cat" : "text" };
  });
  const rows: Cell[][] = body.map((r) => columns.map((c, j) => { const v = (r[j] ?? "").trim(); if (v === "" || /^(n\/?a|null|-|—)$/i.test(v)) return null; if (c.type === "num") { const n = toNum(v); return n !== null && Number.isFinite(n) ? n : null; } return v; }));
  return { columns, rows };
}

/** A library file (CSV or Excel) as a table, for its owner. */
export async function tableFromFile(userId: string, fileId: number): Promise<TableIn> {
  const [f] = await requireDb().select().from(schema.edgeFiles).where(eq(schema.edgeFiles.id, fileId));
  if (!f || f.ownerId !== userId) throw Object.assign(new Error("That file was not found."), { status: 404 });
  const bytes = f.parts ? await readParts(f.r2Key, f.parts) : await getBytes(f.r2Key);
  if (!bytes) throw Object.assign(new Error("That file's contents are gone."), { status: 404 });
  if (/spreadsheetml|excel|xlsx/i.test(f.mime) || /\.xlsx?$/i.test(f.name)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const lines: string[] = [];
    ws?.eachRow((row) => { lines.push((row.values as unknown[]).slice(1).map((v) => { const s = v === null || v === undefined ? "" : typeof v === "object" && v && "result" in v ? String((v as { result: unknown }).result ?? "") : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")); });
    return { ...parseCsv(lines.join("\n")), title: f.name };
  }
  return { ...parseCsv(new TextDecoder().decode(bytes)), title: f.name };
}

/** A market spec's shock from its words, when a person wrote one. */
export async function withShock(spec: MarketSpec & { shockText?: string }): Promise<MarketSpec> {
  if ((spec.driver === "shock" || spec.driver === "event" || spec.driver === "tail") && !spec.shock && spec.shockText) return { ...spec, shock: await shockFromText(spec.shockText, spec.tickers.map((t) => t.toUpperCase())) };
  return spec;
}

/** Refine a saved market scenario: ten thousand statistical paths now, or start the diffusion model and return its call. */
export async function startRefine(userId: string, id: number): Promise<{ done: true } | { callId: string }> {
  const s = await getScenario(userId, id);
  if (!s || s.kind !== "market") throw Object.assign(new Error("Only market scenarios can be refined."), { status: 400 });
  const spec = s.spec as unknown as MarketSpec;
  await updateScenario(id, { status: "refining" });
  if (spec.method === "diffusion" && spec.driver === "none" && mlReady() && r2Ready()) {
    const rets = await tickerReturns(spec.tickers, 3);
    const key = `scen/series/${id}-${Date.now()}.json`;
    await putJson(key, { columns: rets.names, rows: rets.rows });
    const callId = await mlStart("synth.series", { dataKey: key, window: Math.min(120, spec.horizon), n: 2000, seed: spec.seed, kind: "returns" }, `scenario:${id}`);
    return { callId };
  }
  const result = await runMarket({ ...spec, paths: 10_000 });
  await updateScenario(id, { status: "ready", result: result as unknown as Record<string, unknown> });
  return { done: true };
}

/** Finish a diffusion refinement from the ML service's answer. */
export async function finishRefine(userId: string, id: number, done: MlDone | null): Promise<void> {
  const s = await getScenario(userId, id);
  if (!s) return;
  const spec = s.spec as unknown as MarketSpec;
  try {
    if (!done?.ok || !done.result) throw new Error(done?.error ?? "The ML service did not answer in time.");
    const out = await getJson<{ paths: number[][][]; recipe?: string; stats?: unknown }>(String((done.result as { key?: string }).key ?? ""));
    if (!out?.paths?.length) throw new Error("The diffusion model returned no paths.");
    const result: MarketResult = await runMarket({ ...spec, paths: out.paths.length }, { paths: out.paths, recipe: `A denoising diffusion model (a 1-D convolutional network trained on overlapping ${Math.min(120, spec.horizon)}-day windows of the tickers' joint daily returns, on the ML service), ${out.paths.length.toLocaleString("en-US")} generated paths.` });
    await updateScenario(id, { status: "ready", result: result as unknown as Record<string, unknown> });
  } catch (e) {
    logError(e, { where: "edge-scen-refine" });
    await updateScenario(id, { status: "preview" });
  }
}


