/**
 * Edge into Studio, reviewed before it lands. A push carries Edge results (findings, a deal's
 * footprint, a relationship graph, a ranking, a scenario, a table, a cited answer or a memo) to one
 * Studio model. Opened in Studio (or in the Office add-in linked to that model) it shows exactly what it
 * would add: new sheets and slides only, never edits to the person's own cells. Only "Accept" commits
 * it, as one run that can be undone like the agent's; "Dismiss" drops it. A newer push from the same
 * source replaces a pending one.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { commit, createDoc, docData, finishRun, requireDoc, requireDocAccess, startRun } from "@/lib/studio/db";
import { addSheet, applyPatch, describePatches, writeRange, type Patch } from "@/lib/studio/ops";
import { emptyDeck, newId, type Scalar, type Slide, type SlideEl, type StudioDocData } from "@/lib/studio/types";
import { kindOfValue, rowsOf, type Answer, type GraphValue, type Memo, type ProformaValue, type Ranking, type Scenario, type Signal, type Table } from "./canvas/values";

export type PushItem = { kind: string; label: string; value: unknown };
export type PushRow = typeof schema.edgePushes.$inferSelect;

const M = 0.5, BODY_W = 13.333 - 2 * M;
const el = (e: Record<string, unknown>) => ({ ...e, id: newId("el") }) as SlideEl;
const fmt = (v: number, dp = 0) => v.toLocaleString("en-US", { maximumFractionDigits: dp });
/** Text never becomes a formula in someone's model. */
const safe = (v: unknown): Scalar => (typeof v === "string" ? (/^[=+@]/.test(v) ? ` ${v}` : v.slice(0, 2000)) : typeof v === "number" && Number.isFinite(v) ? v : typeof v === "boolean" ? v : null);
const plain = (md: string) => md.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/^#+\s*/gm, "");

/** The table a pushed value becomes on its own sheet, when it has rows. Pure. */
export function pushTable(kind: string, v: unknown): Table | null {
  if (!v || typeof v !== "object") return null;
  switch (kind) {
    case "scenario": {
      const s = v as Scenario;
      return { title: s.title, synthetic: { recipe: s.recipe, seed: s.seed, realism: s.realism }, columns: [{ name: "measure", type: "text" }, { name: "value", type: "text" }], rows: s.stats.map((x) => [x.label, x.value]) };
    }
    case "answer": {
      const a = v as Answer;
      return { columns: [{ name: "n", type: "num" }, { name: "source", type: "text" }, { name: "page", type: "num" }, { name: "quote", type: "text" }, { name: "link", type: "text" }], rows: a.citations.map((c) => [c.n, c.title, c.page ?? null, c.quote, c.url ?? ""]) };
    }
    case "graph": {
      const g = v as GraphValue;
      const name = new Map(g.nodes.map((n) => [n.id, n.ticker ? `${n.name} (${n.ticker})` : n.name]));
      return { columns: [{ name: "from", type: "text" }, { name: "relation", type: "text" }, { name: "to", type: "text" }], rows: g.links.slice(0, 2000).map((l) => [name.get(l.s) ?? String(l.s), l.kind.replace("_", " "), name.get(l.d) ?? String(l.d)]) };
    }
    case "proforma": {
      const p = v as ProformaValue;
      const t = rowsOf(kind, v)!;
      return { columns: [{ name: "company or county", type: "text" }, { name: "plants / HHI before", type: "num" }, { name: "MMcfd / HHI after", type: "num" }, { name: "pipeline km / change", type: "num" }, { name: "screen", type: "text" }], rows: [...p.parties.map((x) => [x.label, x.plants, Math.round(x.capacityMMcfd), Math.round(x.pipelineKm), ""]), ["Together", p.combined.plants, Math.round(p.combined.capacityMMcfd), Math.round(p.combined.pipelineKm), `${Math.round(p.combined.capacityShare * 100)}% of mapped capacity`], ...t.rows] };
    }
    default: return rowsOf(kind, v);
  }
}

/** The slide a pushed value becomes, reading from its sheet where it has one. Pure. */
export function pushSlide(kind: string, v: unknown, label: string, sheet: { id: string; range: string } | null, source: string): Slide | null {
  const base = { id: newId("sl"), layout: "content" as const, sources: source };
  switch (kind) {
    case "proforma": {
      const p = v as ProformaValue;
      const high = p.counties.filter((c) => c.flag === "high").length;
      return { ...base, title: `Pro-forma footprint: ${p.parties.map((x) => x.label).join(" + ")}`, elements: [
        ...[["Processing together (MMcfd)", fmt(p.combined.capacityMMcfd)], ["Share of mapped capacity", `${Math.round(p.combined.capacityShare * 100)}%`], ["Counties screening high", String(high)]].map(([l, val], i) => el({ type: "metric", x: M + i * ((BODY_W - 0.5) / 3 + 0.25), y: 1.35, w: (BODY_W - 0.5) / 3, h: 1.15, label: l, value: val })),
        el({ type: "table", x: M, y: 2.8, w: BODY_W, h: 2.4, header: true, size: 11, rows: [["Company", "Plants", "MMcfd", "Pipeline km"], ...p.parties.map((x) => [x.label, String(x.plants), fmt(x.capacityMMcfd), fmt(x.pipelineKm)])] }),
        el({ type: "text", x: M, y: 5.4, w: BODY_W, h: 1.4, size: 12, text: p.divestitures.length ? `Likely divestitures: ${p.divestitures.slice(0, 4).map((d) => `${d.plant} (${d.company}, ${fmt(d.capacityMMcfd)} MMcfd, ${d.county})`).join("; ")}.` : `Both operate in ${p.overlap.counties} counties; no county screens high enough to suggest a divestiture.` }),
      ] };
    }
    case "ranking": {
      const r = v as Ranking;
      const top = r.items.slice(0, 8);
      return { ...base, title: `${r.finding} for ${r.subject}`, elements: [
        el({ type: "chart", kind: "bar", x: M, y: 1.3, w: 7.4, h: 5.3, title: "Model score", data: { labels: top.map((i) => i.ticker || i.name), series: [{ name: "Score", values: top.map((i) => Math.round(i.score * 1000) / 1000) }] } }),
        el({ type: "text", x: 8.2, y: 1.3, w: 4.6, h: 5.3, size: 11, bullets: true, text: top.slice(0, 4).map((i) => `${i.name}: ${i.reasons.slice(0, 2).join("; ") || "ranked on the wider network"}`).join("\n") }),
      ], sources: `${source}${r.scorecard ? ` ${r.scorecard}.` : ""} A ranking from a model trained on past deals, not a forecast.` };
    }
    case "scenario": {
      const s = v as Scenario;
      const fan = s.fan?.[0];
      const step = fan ? Math.max(1, Math.ceil(fan.p50.length / 24)) : 1;
      const idx = fan ? fan.p50.map((_, i) => i).filter((i) => i % step === 0 || i === fan.p50.length - 1) : [];
      return { ...base, title: `Scenario (synthetic): ${s.title}`, elements: [
        ...s.stats.slice(0, 3).map((x, i) => el({ type: "metric", x: M + i * ((BODY_W - 0.5) / 3 + 0.25), y: 1.35, w: (BODY_W - 0.5) / 3, h: 1.15, label: x.label, value: x.value })),
        ...(fan ? [el({ type: "chart", kind: "line", x: M, y: 2.75, w: BODY_W, h: 3.9, title: `${fan.label}: simulated range`, data: { labels: idx.map((i) => `Day ${i}`), series: [{ name: "5th percentile", values: idx.map((i) => fan.p5[i]) }, { name: "Median", values: idx.map((i) => fan.p50[i]) }, { name: "95th percentile", values: idx.map((i) => fan.p95[i]) }] } })] : []),
      ], sources: `SYNTHETIC: ${s.paths.toLocaleString("en-US")} simulated paths, ${s.recipe}, seed ${s.seed}. ${source}` };
    }
    case "findings": {
      if (!sheet) return null;
      return { ...base, title: label || "What changed on the ground", elements: [el({ type: "table", x: M, y: 1.3, w: BODY_W, h: 5.4, header: true, size: 9, link: sheet })] };
    }
    case "answer": {
      const a = v as Answer;
      return { ...base, title: a.question.slice(0, 120), elements: [el({ type: "text", x: M, y: 1.3, w: BODY_W, h: 5.4, size: 12, bullets: !a.notFound, text: a.notFound ? "The documents do not answer this." : a.claims.slice(0, 8).map((c) => `${c.text}${c.cites.length ? ` [${c.cites.join(", ")}]` : c.analysis ? " (analysis)" : ""}`).join("\n") })],
        sources: `${a.citations.slice(0, 6).map((c) => `[${c.n}] ${c.title}${c.page ? `, p. ${c.page}` : ""}`).join("; ")}. ${source}` };
    }
    case "memo": {
      const m = v as Memo;
      return { ...base, title: m.title.slice(0, 120), elements: [el({ type: "text", x: M, y: 1.3, w: BODY_W, h: 5.4, size: 12, text: plain(m.markdown).slice(0, 2400) })], sources: `${m.sources.slice(0, 8).map((s) => `[${s.n}] ${s.label}`).join("; ")}. ${source}` };
    }
    case "signal": {
      const s = v as Signal;
      return { ...base, title: s.metric, elements: [el({ type: "metric", x: M, y: 1.4, w: 5, h: 1.3, label: s.metric, value: fmt(s.value, 2) }), el({ type: "text", x: M, y: 3, w: BODY_W, h: 1.5, size: 13, text: `${s.triggered ? "Crossed its line. " : ""}${s.detail}` })] };
    }
    default: return null;
  }
}

/** The sheets and slides a push adds to a document, as Studio patches (built on a copy). Pure. */
export function pushPatches(doc: StudioDocData, items: PushItem[], source: string): Patch[] {
  const work: StudioDocData = JSON.parse(JSON.stringify(doc));
  const patches: Patch[] = [];
  const add = (p: Patch) => { applyPatch(work, p); patches.push(p); };
  for (const it of items) {
    const kind = it.kind || kindOfValue(it.value) || "";
    const table = pushTable(kind, it.value);
    let sheet: { id: string; range: string } | null = null;
    if (table && table.rows.length) {
      const { patch, sheet: s } = addSheet(work, `Edge ${it.label || kind}`.slice(0, 31));
      add(patch);
      const note = table.synthetic ? [`SYNTHETIC DATA: ${table.synthetic.recipe}, seed ${table.synthetic.seed}`] : null;
      const head = note ? 2 : 1;
      const rows = table.rows.slice(0, 2000).map((r) => r.map(safe));
      if (note) add(writeRange(work, s.name, "A1", [note], { i: true, color: "#9A3412" }));
      add(writeRange(work, s.name, `A${head}`, [table.columns.map((c) => c.name)], { b: true, bb: "thin" }));
      if (rows.length) add(writeRange(work, s.name, `A${head + 1}`, rows));
      add(writeRange(work, s.name, `A${head + rows.length + 2}`, [[source]], { i: true, color: "#6B7280" }));
      add({ op: "sheet_meta", sheet: s.id, freeze: { rows: head, cols: 0 } });
      const lastCol = String.fromCharCode(64 + Math.min(26, table.columns.length));
      sheet = { id: s.id, range: `A${head}:${lastCol}${head + Math.min(rows.length, 20)}` };
    }
    const slide = pushSlide(kind, it.value, it.label, sheet, source);
    if (slide) add({ op: "slide_upsert", slide });
  }
  return patches;
}

/** What a push adds, in words, for the review list (described on a copy with the push applied, so new sheets have their names). Pure. */
export function pushSummary(doc: StudioDocData, patches: Patch[]): { text: string; sheets: string[]; slides: string[] } {
  const after: StudioDocData = JSON.parse(JSON.stringify(doc));
  for (const p of patches) applyPatch(after, p);
  return {
    text: describePatches(after, patches),
    sheets: patches.flatMap((p) => (p.op === "sheet_add" ? [p.sheet.name] : [])),
    slides: patches.flatMap((p) => (p.op === "slide_upsert" ? [p.slide.title] : [])),
  };
}

/** Queue a push for a Studio model (a new one when none is given). A pending push from the same source is replaced. */
export async function createPush(user: CurrentUser, p: { docId: number | null; title: string; source: string; items: PushItem[] }): Promise<{ id: number; docId: number }> {
  // Long tables and graphs are cut to what a sheet will take, so the queue stays small.
  const trim = (v: unknown): unknown => {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.rows) && o.rows.length > 2000) return { ...o, rows: o.rows.slice(0, 2000) };
    if (Array.isArray(o.links) && o.links.length > 2000) return { ...o, links: o.links.slice(0, 2000) };
    return v;
  };
  const items = p.items.filter((i) => i.value && typeof i.value === "object").slice(0, 12).map((i) => ({ ...i, value: trim(i.value) }));
  if (!items.length) throw Object.assign(new Error("Nothing wired in can go into a Studio model."), { status: 400 });
  let docId = p.docId;
  if (docId) await requireDocAccess(user, docId, "edit");
  else {
    // Studio needs a sheet to open on; a short note says where the results are waiting.
    const readMe = { id: newId("sh"), name: "Read me", cols: { A: 560 }, cells: {
      A1: { v: p.title.slice(0, 140) || "From YouBank Edge", s: { b: true, size: 14 } },
      A3: { v: "Made by YouBank Edge. Its results wait under \"From Edge\" in the History panel: accept them to add their sheets and slides here, or dismiss them." },
    } };
    const doc = await createDoc(user, { title: p.title.slice(0, 140) || "From Edge", kind: "edge", workbook: { order: [readMe.id], sheets: { [readMe.id]: readMe } }, deck: emptyDeck(), comments: [] });
    docId = doc.id;
  }
  const db = requireDb();
  const target = `studio:${docId}`;
  await db.update(schema.edgePushes).set({ status: "superseded", decidedAt: new Date() })
    .where(and(eq(schema.edgePushes.ownerId, user.id), eq(schema.edgePushes.target, target), eq(schema.edgePushes.source, p.source), eq(schema.edgePushes.status, "pending")));
  const kind = items.length === 1 ? items[0].kind : "bundle";
  const [row] = await db.insert(schema.edgePushes).values({ ownerId: user.id, target, source: p.source.slice(0, 120), kind, payload: { title: p.title.slice(0, 140), items } }).returning({ id: schema.edgePushes.id });
  return { id: row.id, docId };
}

const docOf = (target: string) => (/^studio:\d+$/.test(target) ? Number(target.slice(7)) : null);
const sourceLine = (row: PushRow) => `From YouBank Edge (${row.source.startsWith("run:") ? "canvas run" : row.source.split(":")[0]}), ${row.createdAt.toISOString().slice(0, 10)}.`;

/** Pending pushes for a model the person can see, each with what it would add. */
export async function pendingPushes(user: CurrentUser, docId: number) {
  await requireDocAccess(user, docId, "view");
  const rows = await requireDb().select().from(schema.edgePushes)
    .where(and(eq(schema.edgePushes.target, `studio:${docId}`), eq(schema.edgePushes.status, "pending"))).orderBy(desc(schema.edgePushes.createdAt)).limit(20);
  if (!rows.length) return [];
  // The model itself is read only when something is waiting, to say what each push would add.
  const data = docData(await requireDoc(user, docId, "view"));
  return rows.map((r) => {
    const payload = r.payload as { title?: string; items?: PushItem[] };
    const patches = pushPatches(data, payload.items ?? [], sourceLine(r));
    return { id: r.id, title: payload.title ?? "From Edge", kind: r.kind, source: r.source, createdAt: r.createdAt.toISOString(), mine: r.ownerId === user.id, ...pushSummary(data, patches) };
  });
}

/** Accept (commit as one undoable run) or dismiss a pending push. */
export async function decidePush(user: CurrentUser, id: number, action: "accept" | "dismiss"): Promise<{ status: string; docId: number; label?: string }> {
  const db = requireDb();
  const [row] = await db.select().from(schema.edgePushes).where(eq(schema.edgePushes.id, id));
  const docId = row ? docOf(row.target) : null;
  if (!row || !docId) throw Object.assign(new Error("That push is gone."), { status: 404 });
  const doc = await requireDoc(user, docId, "edit");
  if (row.status !== "pending") throw Object.assign(new Error(`That push was already ${row.status}.`), { status: 409 });
  // Claim it first so two reviewers cannot both apply it.
  const [claimed] = await db.update(schema.edgePushes).set({ status: action === "accept" ? "accepted" : "dismissed", decidedAt: new Date() })
    .where(and(eq(schema.edgePushes.id, id), eq(schema.edgePushes.status, "pending"))).returning({ id: schema.edgePushes.id });
  if (!claimed) throw Object.assign(new Error("Someone else just decided on that push."), { status: 409 });
  if (action === "dismiss") return { status: "dismissed", docId };
  const payload = row.payload as { title?: string; items?: PushItem[] };
  const data = docData(doc);
  const patches = pushPatches(data, payload.items ?? [], sourceLine(row));
  const runId = `edge-${id}`;
  const label = `Edge: ${payload.title ?? "results"}`.slice(0, 200);
  try {
    await startRun(docId, user.id, runId, label, "edge");
    const ev = await commit(docId, data, patches, { actor: "edge", actorName: "Edge", runId, label });
    await finishRun(runId, "done", ev.label, { patches: patches.length });
    return { status: "accepted", docId, label: ev.label };
  } catch (e) {
    await db.update(schema.edgePushes).set({ status: "pending", decidedAt: null }).where(eq(schema.edgePushes.id, id));
    await finishRun(runId, "error", e instanceof Error ? e.message : String(e), {}).catch(() => undefined);
    throw e;
  }
}

/** The person's recent pushes across models, for Edge's own list. */
export async function myPushes(userId: string, limit = 20) {
  return requireDb().select({ id: schema.edgePushes.id, target: schema.edgePushes.target, kind: schema.edgePushes.kind, status: schema.edgePushes.status, createdAt: schema.edgePushes.createdAt })
    .from(schema.edgePushes).where(and(eq(schema.edgePushes.ownerId, userId), inArray(schema.edgePushes.status, ["pending", "accepted"]))).orderBy(desc(schema.edgePushes.createdAt)).limit(limit);
}
