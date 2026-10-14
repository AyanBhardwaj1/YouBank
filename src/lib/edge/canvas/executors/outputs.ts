/**
 * Output blocks. A cited memo writes only from the numbered evidence wired into it and drops any
 * citation that points at nothing; a signal turns anything into one number and says whether it crossed
 * its line (compared with this block's value in the previous run); an export writes CSV or Excel to R2.
 */
import ExcelJS from "exceljs";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { putObject, r2Ready } from "../../infra/r2";
import { verifyClaims } from "../../claims/verify";
import { logError } from "@/lib/errors";
import { register } from "../engine";
import { crossed, evidenceOf, kindOfValue, metricOf, rowsOf, toCsv, type Evidence, type Memo, type Signal, type Table } from "../values";

const Written = z.object({
  title: z.string().describe("6 to 12 words"),
  paragraphs: z.array(z.object({
    text: z.string().describe("one paragraph; plain, specific, no hype; no citation numbers in the text"),
    cites: z.array(z.number().int()).describe("numbers of the evidence items this paragraph rests on; empty only for a clearly marked judgement"),
  })).min(1).max(10),
  caveats: z.array(z.string()).max(5).describe("limits of the evidence a reader must know"),
});

/** The evidence list as numbered lines for the prompt, and whether any of it is synthetic. Pure. */
export function numbered(evidence: Evidence[]): { text: string; synthetic: boolean } {
  return {
    text: evidence.map((e, i) => `[${i + 1}] ${e.synthetic ? "(SYNTHETIC) " : ""}${e.label}: ${e.text}`).join("\n"),
    synthetic: evidence.some((e) => e.synthetic),
  };
}

/** Paragraphs with citations cleaned (only numbers that exist, in order), as markdown. Pure. */
export function memoMarkdown(w: z.infer<typeof Written>, count: number, synthetic: boolean): string {
  const paras = w.paragraphs.map((p) => {
    const cites = [...new Set(p.cites.filter((n) => n >= 1 && n <= count))].sort((a, b) => a - b);
    // Citations belong in `cites`; any the model also wrote into the text are removed so none are unchecked.
    const text = p.text.replace(/\s*\[\d+(?:\s*[,;-]\s*\d+)*\]/g, "").trim();
    return `${text}${cites.length ? ` ${cites.map((n) => `[${n}]`).join("")}` : " *(analysis)*"}`;
  });
  const caveats = w.caveats.length ? `\n\n**Caveats.** ${w.caveats.join(" ")}` : "";
  const synth = synthetic ? "\n\n*Parts of this memo rest on synthetic data, labeled as such in its sources.*" : "";
  return `${paras.join("\n\n")}${caveats}${synth}`;
}

register("out.memo", {
  async start(ctx) {
    const values = ctx.inputs.in ?? [];
    const evidence = values.flatMap((v) => evidenceOf(kindOfValue(v) ?? "", v)).slice(0, 40);
    if (!evidence.length) throw Object.assign(new Error("Nothing wired in has evidence to write from."), { status: 400 });
    await ctx.progress("gather", `${evidence.length} pieces of evidence`);
    const { text, synthetic } = numbered(evidence);
    const style = ctx.config.style === "memo" ? "a memo of four to eight paragraphs" : "a brief of two to four short paragraphs";
    const audience = typeof ctx.config.audience === "string" && ctx.config.audience.trim() ? ` for ${ctx.config.audience.trim().slice(0, 80)}` : "";
    await ctx.progress("write");
    const r = await structured(Written, "edge-memo",
      "You write for investment professionals. Use only the numbered evidence. Every factual sentence must cite the evidence numbers it rests on. Never invent numbers, names or events. If evidence is labeled SYNTHETIC, say so wherever you use it. If the evidence is thin, say that plainly.",
      `Write ${style}${audience} from this evidence:\n\n${text}`,
      { maxTokens: 2500, timeoutMs: 120_000 });
    await ctx.progress("check");
    const memo: Memo = { title: r.data.title, markdown: memoMarkdown(r.data, evidence.length, synthetic), sources: evidence.map((e, i) => ({ n: i + 1, label: e.label, ...(e.url ? { url: e.url } : {}) })) };
    // Calibrated Claims on each paragraph, against the evidence it cites (dots only; a memo holds nothing back).
    try {
      const paras = r.data.paragraphs.map((p) => ({ text: p.text.replace(/\s*\[\d+(?:\s*[,;-]\s*\d+)*\]/g, "").trim(), cites: [...new Set(p.cites.filter((n) => n >= 1 && n <= evidence.length))] }));
      const v = await verifyClaims(paras.map((p) => ({ text: p.text, analysis: !p.cites.length, cites: p.cites.map((n) => ({ text: evidence[n - 1].text, header: evidence[n - 1].label, quote: "near" as const, rank: 1 })) })), { mode: "balanced", scope: [], memo: true });
      memo.paragraphs = paras.map((p, i) => ({ ...p, support: v.supports[i] }));
      memo.verifier = v.info;
    } catch (e) { logError(e, { where: "edge-memo-claims" }); }
    const uncited = r.data.paragraphs.filter((p) => !p.cites.some((n) => n >= 1 && n <= evidence.length)).length;
    return { outputs: { memo }, summary: `${memo.title} (${r.data.paragraphs.length} paragraphs, ${evidence.length} sources${uncited ? `, ${uncited} marked as analysis` : ""})`, preview: { kind: "text", text: memo.markdown.slice(0, 280) } };
  },
});

register("out.signal", {
  async start(ctx) {
    const v = (ctx.inputs.in ?? [])[0];
    const m = metricOf(kindOfValue(v) ?? "", v);
    if (!m) throw Object.assign(new Error("This input has no number to watch."), { status: 400 });
    // The same block's value in this canvas's previous finished run.
    const [prev] = await requireDb().select({ output: schema.edgeRunSteps.output }).from(schema.edgeRunSteps)
      .innerJoin(schema.edgeRuns, eq(schema.edgeRuns.id, schema.edgeRunSteps.runId))
      .where(and(eq(schema.edgeRunSteps.nodeId, ctx.nodeId), eq(schema.edgeRunSteps.status, "done"), sql`${schema.edgeRuns.canvasId} = (select canvas_id from edge_runs where id = ${ctx.runId})`, sql`${schema.edgeRuns.id} < ${ctx.runId}`))
      .orderBy(desc(schema.edgeRuns.id)).limit(1);
    const previous = (prev?.output as { signal?: Signal } | null)?.signal?.value ?? null;
    const when = typeof ctx.config.when === "string" ? ctx.config.when : "changes";
    const threshold = Number(ctx.config.threshold) || 0;
    const signal: Signal = { metric: m.metric, value: m.value, previous, triggered: crossed(when, m.value, threshold, previous), detail: m.detail };
    const line = when === "changes" ? (previous === null ? "first reading" : signal.triggered ? `changed from ${previous}` : "unchanged") : `${signal.triggered ? "crossed" : "within"} ${when} ${threshold}`;
    return { outputs: { signal }, summary: `${m.metric}: ${m.value} (${line})`, preview: { kind: "stats", items: [{ label: m.metric, value: String(m.value) }, { label: "Status", value: signal.triggered ? "Alert" : "Quiet" }] } };
  },
});

async function xlsx(t: Table): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t.synthetic ? "Synthetic data" : "Data");
  if (t.synthetic) ws.addRow([`SYNTHETIC DATA: ${t.synthetic.recipe}, seed ${t.synthetic.seed}`]);
  ws.addRow(t.columns.map((c) => c.name)).font = { bold: true };
  for (const r of t.rows) ws.addRow(r);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

register("out.export", {
  async start(ctx) {
    const v = (ctx.inputs.in ?? [])[0];
    const t = rowsOf(kindOfValue(v) ?? "", v);
    if (!t) throw Object.assign(new Error("This input cannot be exported as a table."), { status: 400 });
    const format = ctx.config.format === "xlsx" ? "xlsx" : "csv";
    const name = `edge-${ctx.runId}-${ctx.nodeId}${t.synthetic ? "-synthetic" : ""}.${format}`;
    if (!r2Ready()) return { outputs: { table: t }, summary: `${t.rows.length} rows (file storage is off, so the table stays in the run)`, preview: { kind: "stats", items: [{ label: "Rows", value: String(t.rows.length) }] } };
    const body = format === "xlsx" ? await xlsx(t) : new TextEncoder().encode(toCsv(t));
    const key = `exports/${ctx.runId}/${name}`;
    await putObject(key, body, format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv");
    await requireDb().insert(schema.edgeFiles).values({ ownerId: ctx.userId, kind: "export", name, mime: format, bytes: body.byteLength, r2Key: key, status: "ready" }).onConflictDoNothing();
    return { outputs: { file: { name, key, bytes: body.byteLength } }, summary: `${name}: ${t.rows.length} rows`, preview: { kind: "stats", items: [{ label: "Rows", value: String(t.rows.length) }, { label: "Format", value: format.toUpperCase() }] } };
  },
});
