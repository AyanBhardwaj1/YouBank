/**
 * Premium ways of reading an upload, chosen by the person for one document: LlamaParse for a hard PDF
 * (edge.parse-llamaparse) or OpenAI's speaker labels for a recording (edge.transcribe-diarize).
 *
 * The choice is made by a click (on upload, or "read again with…" in the library): the route checks the
 * plan and that the upgrade is set up, then marks the document (`meta.premiumRead`) and starts reading.
 * Reading runs in the background (Inngest, or the rest of the request without it), which re-checks the
 * owner's plan before anything is sent, does the paid work in steps, and clears the mark whatever
 * happens, so a retry or a later re-read never spends again unasked. Anything that goes wrong falls back
 * to the free reader with a note on the document saying why.
 */
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { runAsUser } from "@/lib/ai/context";
import { recordUsage } from "@/lib/ai/usage";
import { requireFeature } from "@/lib/billing/entitlements";
import { canUseById } from "@/lib/billing/use";
import type { CurrentUser } from "@/lib/auth/user";
import { logError, publicMessage } from "@/lib/errors";
import { passagesFromPages, passagesFromTranscript, type Segment } from "../docs/chunk";
import { indexPassages, setDoc } from "../docs/store";
import type { Steps } from "../infra/jobs";
import { getJson, getObject, partKey, partsForRange, putJson, readParts } from "../infra/r2";
import { requireReady, upgradeOn } from "../premium";
import { planPieces, pieceBytes, wavInfo, type Piece, type WavInfo } from "./audio";
import { DIARIZE_CREDIT, diarizeModel, diarizePiece, mergePieces, nameSpeakers, turnsOf, type PieceResult } from "./diarize";
import { LLAMA_MAX_BYTES, llamaBase, llamaCost, llamaTier, llamaUpload, parseLlamaJob, partsFromMarkdown } from "./llamaparse";

export type PremiumRead = "llamaparse" | "diarize";
export const READ_FEATURE: Record<PremiumRead, string> = { llamaparse: "edge.parse-llamaparse", diarize: "edge.transcribe-diarize" };
const READ_UPGRADE: Record<PremiumRead, string> = { llamaparse: "parse-llamaparse", diarize: "transcribe-openai" };
export const isPremiumRead = (v: unknown): v is PremiumRead => v === "llamaparse" || v === "diarize";

type FileRow = typeof schema.edgeFiles.$inferSelect;
type DocMeta = Record<string, unknown> & { premiumRead?: { method: PremiumRead; by: string; at: string } };
const status = (message: string, code: number) => Object.assign(new Error(message), { status: code });

const AUDIO = /^(audio|video)\//;
const PARSEABLE = /^(application\/pdf|image\/|application\/vnd\.openxmlformats-officedocument\.)/;

/** Why a premium reading does not suit a file, or null when it does. Pure. */
export function readMismatch(method: PremiumRead, f: { mime: string; name: string; bytes: number }): string | null {
  if (method === "llamaparse") {
    if (!PARSEABLE.test(f.mime) && !/\.(pdf|png|jpe?g|tiff?|docx|pptx|xlsx)$/i.test(f.name)) return "LlamaParse reads PDFs, scans and Office files; this is not one.";
    if (f.bytes > LLAMA_MAX_BYTES) return "LlamaParse takes files up to 50 MB here; this one stays with the standard reader.";
    return null;
  }
  if (!AUDIO.test(f.mime)) return "Speaker labels are for recordings; this is not one.";
  if (f.bytes > 24 * 1024 * 1024 && !/mpeg|mp3|wav|wave/i.test(f.mime) && !/\.(mp3|wav)$/i.test(f.name)) return "Speaker labels take MP3 and WAV recordings of any length, and other formats up to 24 MB.";
  return null;
}

/**
 * Mark a document for a premium reading, after checking the plan, the upgrade and the file. The caller
 * then starts reading (ingest). Throws 402 for a plan without it, 409 when it is not set up, 400 for a
 * file it does not suit, 404 for a document that is not the person's.
 */
export async function requestPremiumRead(user: Pick<CurrentUser, "id" | "email">, docId: number, method: PremiumRead): Promise<void> {
  await requireFeature(user, READ_FEATURE[method]);
  requireReady(READ_FEATURE[method]);
  const db = requireDb();
  const [doc] = await db.select().from(schema.edgeDocs).where(eq(schema.edgeDocs.id, docId));
  if (!doc || doc.ownerId !== user.id || !doc.fileId) throw status("That document does not exist.", 404);
  const [f] = await db.select().from(schema.edgeFiles).where(eq(schema.edgeFiles.id, doc.fileId));
  if (!f) throw status("That document's file is gone.", 404);
  const why = readMismatch(method, { mime: f.mime, name: f.name, bytes: Number(f.bytes) });
  if (why) throw status(why, 400);
  const meta: DocMeta = { ...(doc.meta as DocMeta), premiumRead: { method, by: user.id, at: new Date().toISOString() } };
  delete meta.premiumNote;
  await setDoc(docId, { meta, status: "queued", error: "" });
}

/** Clear the request (and say why, when it did not happen), so it is never spent twice. */
async function settle(docId: number, note?: string, extra: Record<string, unknown> = {}) {
  const [doc] = await requireDb().select({ meta: schema.edgeDocs.meta }).from(schema.edgeDocs).where(eq(schema.edgeDocs.id, docId));
  if (!doc) return;
  const meta = { ...(doc.meta as DocMeta), ...extra };
  delete meta.premiumRead;
  if (note) meta.premiumNote = note.slice(0, 300);
  await setDoc(docId, { meta });
}

/**
 * The premium reading a document is waiting for, if it may still run: the request is there, the
 * upgrade is still set up and the person who asked still has it in their plan. Otherwise the request is
 * cleared (with a note) and null comes back, and the free reader runs.
 */
export async function premiumReadFor(docId: number): Promise<PremiumRead | null> {
  const [doc] = await requireDb().select({ meta: schema.edgeDocs.meta }).from(schema.edgeDocs).where(eq(schema.edgeDocs.id, docId));
  const want = (doc?.meta as DocMeta | undefined)?.premiumRead;
  if (!want || !isPremiumRead(want.method)) return null;
  if (!upgradeOn(READ_UPGRADE[want.method])) { await settle(docId, "The premium reader was switched off, so the standard reader was used."); return null; }
  if (!(await canUseById(want.by, READ_FEATURE[want.method]))) { await settle(docId, "Your plan no longer includes this reader, so the standard reader was used."); return null; }
  return want.method;
}

/** Steps for the inline path (no Inngest): run now, sleep in this request, give up at the deadline. */
export function inlineSteps(deadline: number): Steps {
  return {
    run: (_id, fn) => fn(),
    sleep: async (_id, d) => {
      const ms = typeof d === "number" ? d : Number(/^(\d+)s$/.exec(d)?.[1] ?? 10) * 1000;
      if (Date.now() + ms > deadline) throw new Error("Reading took longer than this request allows; it will work once background jobs are available.");
      await new Promise((r) => setTimeout(r, ms));
    },
    waitForEvent: async () => null,
  };
}

async function loadFile(docId: number): Promise<{ doc: typeof schema.edgeDocs.$inferSelect; f: FileRow }> {
  const db = requireDb();
  const [doc] = await db.select().from(schema.edgeDocs).where(eq(schema.edgeDocs.id, docId));
  if (!doc?.fileId) throw new Error(`Document ${docId} has no file`);
  const [f] = await db.select().from(schema.edgeFiles).where(eq(schema.edgeFiles.id, doc.fileId));
  if (!f) throw new Error(`File for document ${docId} is gone`);
  return { doc, f };
}

/** Bytes [start, end) of a stored file, read from the 4 MB parts that hold them. */
async function readRange(f: FileRow, start: number, end: number): Promise<Uint8Array> {
  const pieces = partsForRange(Number(f.bytes), start, end - 1);
  const chunks: Uint8Array[] = [];
  for (const p of pieces) {
    const res = await getObject(partKey(f.r2Key, p.n), `bytes=${p.from}-${p.to}`);
    if (!res) throw new Error(`Part ${p.n} of the file is missing`);
    chunks.push(new Uint8Array(await res.arrayBuffer()));
  }
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** A step's failure, already logged, with a message fit for the person. */
class StepFailed extends Error {}

/**
 * A step that never throws inside the job runner: a failure comes back as a value and is raised after,
 * so Inngest does not retry it. A retried upload or transcription would be paid for twice.
 */
async function once<T>(s: Steps, id: string, fn: () => Promise<T>): Promise<T> {
  const r = await s.run(id, async (): Promise<{ ok: true; v: T } | { ok: false; error: string }> => {
    try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, error: publicMessage(e, logError(e, { where: `edge-${id}` })) }; }
  });
  if (!r.ok) throw new StepFailed(r.error);
  return r.v;
}

/**
 * Do the premium reading in steps. "done" when the document is indexed from it; "fallback" when the
 * free reader should run instead (the reason is on the document). Never throws.
 */
export async function runPremiumRead(docId: number, method: PremiumRead, s: Steps): Promise<"done" | "fallback"> {
  try {
    const { doc } = await once(s, `premium-${method}-load`, async () => { const x = await loadFile(docId); return { doc: { ownerId: x.doc.ownerId } }; });
    // Usage and the spend limits count against the person who asked.
    const done = await runAsUser(doc.ownerId, () => (method === "llamaparse" ? llamaRead(docId, s) : diarizeRead(docId, s)));
    if (done) return "done";
  } catch (e) {
    const why = e instanceof StepFailed ? e.message : publicMessage(e, logError(e, { where: `edge-premium-${method}` }));
    await settle(docId, `${method === "llamaparse" ? "LlamaParse" : "Speaker labelling"} did not finish (${why.replace(/\.$/, "")}), so the standard reader was used.`).catch(() => undefined);
  }
  return "fallback";
}

/* ---------------- LlamaParse ---------------- */

async function llamaRead(docId: number, s: Steps): Promise<boolean> {
  const key = process.env.LLAMA_CLOUD_API_KEY?.trim() ?? "";
  const tier = llamaTier();
  const job = await once(s, "llama-upload", async () => {
    const { f } = await loadFile(docId);
    await setDoc(docId, { status: "parsing", error: "" });
    const { url, init } = llamaUpload(await readParts(f.r2Key, f.parts), f.name, f.mime, key, tier);
    const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`LlamaParse answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { id: parseLlamaJob(await res.json()).id };
  });
  for (let k = 0; k < 90; k++) {
    await s.sleep(`llama-wait-${k}`, k < 6 ? "5s" : "10s");
    const r = await once(s, `llama-poll-${k}`, async (): Promise<{ state: "wait" | "done" | "failed"; error?: string }> => {
      // The job is already paid for, so a check that fails is tried again on the next poll.
      const res = await fetch(`${llamaBase()}/api/v2/parse/${encodeURIComponent(job.id)}?expand=markdown`, { headers: { authorization: `Bearer ${key}`, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(60_000) }).catch(() => null);
      if (!res || res.status >= 500 || res.status === 429) return { state: "wait" };
      if (!res.ok) throw new Error(`LlamaParse answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = parseLlamaJob(await res.json());
      if (j.status === "FAILED" || j.status === "CANCELLED") return { state: "failed", error: j.error || j.status.toLowerCase() };
      if (j.status !== "COMPLETED") return { state: "wait" };
      if (!j.pages.length) return { state: "failed", error: "no text came back" };
      recordUsage({ feature: "edge.parse-llamaparse", provider: "llamaparse", model: tier, usage: { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 }, extraCostUsd: llamaCost(j.pages.length, tier) });
      const pages = j.pages.map((p) => ({ n: p.n, text: "", parts: partsFromMarkdown(p.markdown) }));
      await setDoc(docId, { status: "indexing", pages: pages.length });
      await settle(docId, undefined, { readBy: { method: "llamaparse", tier, pages: pages.length, credit: `Read by LlamaParse (${tier.replace("_", " ")} tier)`, at: new Date().toISOString() } });
      await indexPassages(docId, passagesFromPages(pages));
      return { state: "done" };
    });
    if (r.state === "done") return true;
    if (r.state === "failed") throw new Error(`LlamaParse could not read it: ${r.error}`);
  }
  throw new Error("LlamaParse took longer than 15 minutes");
}

/* ---------------- Speaker labels ---------------- */

type Plan = { pieces: Piece[]; wav: { fmt: number[]; dataStart: number; dataBytes: number; blockAlign: number } | null; key: string };

async function diarizeRead(docId: number, s: Steps): Promise<boolean> {
  const plan = await once(s, "diarize-plan", async (): Promise<Plan> => {
    const { f } = await loadFile(docId);
    await setDoc(docId, { status: "parsing", error: "" });
    const head = await readRange(f, 0, Math.min(Number(f.bytes), 65_536));
    const pieces = planPieces(Number(f.bytes), f.mime, f.name, head);
    if (!pieces) throw new Error("this recording is too large to send uncut and is not an MP3 or WAV");
    const w = pieces[0].kind === "wav" ? wavInfo(head, Number(f.bytes)) : null;
    return { pieces, wav: w ? { fmt: [...w.fmt], dataStart: w.dataStart, dataBytes: w.dataBytes, blockAlign: w.blockAlign } : null, key: `${f.r2Key}/premium/diarize` };
  });
  const wav: WavInfo | null = plan.wav ? { ...plan.wav, fmt: Uint8Array.from(plan.wav.fmt) } : null;
  for (const p of plan.pieces) {
    await once(s, `diarize-${p.index}`, async () => {
      const { f } = await loadFile(docId);
      const bytes = pieceBytes(p, await readRange(f, p.start, p.end), wav);
      const name = p.kind === "wav" ? `part-${p.index}.wav` : p.kind === "mp3" ? `part-${p.index}.mp3` : f.name;
      const mime = p.kind === "wav" ? "audio/wav" : p.kind === "mp3" ? "audio/mpeg" : f.mime;
      const r = await diarizePiece(bytes, name, mime);
      await putJson(`${plan.key}/${p.index}.json`, r);
      return { duration: r.duration, segments: r.segments.length };
    });
  }
  await once(s, "diarize-index", async () => {
    const results: PieceResult[] = [];
    for (const p of plan.pieces) results.push((await getJson<PieceResult>(`${plan.key}/${p.index}.json`)) ?? { duration: 0, segments: [] });
    const merged = mergePieces(results);
    if (!merged.length) throw new Error("no speech came back");
    const turns = turnsOf(merged);
    const { names, scores } = await nameSpeakers(turns);
    const segments: Segment[] = merged.map((m) => ({ start: m.start, end: m.end, text: m.text, speaker: names.get(m.label) ?? "" }));
    const duration = results.reduce((t, r) => t + r.duration, 0);
    const transcriptKey = `${plan.key}/transcript.json`;
    await putJson(transcriptKey, { language: "", duration, segments, engine: "openai", model: diarizeModel() });
    await setDoc(docId, { status: "indexing", durationSec: Math.round(duration) });
    await settle(docId, undefined, {
      transcriptKey,
      transcription: { engine: "openai", model: diarizeModel(), credit: DIARIZE_CREDIT },
      turns: turns.slice(0, 400).map((t, i) => ({ from: t.from, t: t.t, speaker: names.get(t.label) ?? "", ...(scores.get(i) ?? { hedging: 0, tone: 0, note: "" }) })),
      readBy: { method: "diarize", pieces: plan.pieces.length, credit: DIARIZE_CREDIT, at: new Date().toISOString() },
    });
    await indexPassages(docId, passagesFromTranscript(segments));
    return { segments: segments.length };
  });
  return true;
}
