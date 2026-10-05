/**
 * Uploads and recordings. A file arrives in 4 MB parts (under Vercel's body limit; the storage bucket
 * cannot accept browser uploads directly), within the person's quota. Then it is read: plain text,
 * CSV, HTML, Markdown and email here; PDFs (with OCR for scans), Word, PowerPoint, Excel and Outlook
 * messages by the ML service; audio and video are transcribed there, and a model names the speakers
 * and marks hedging and tone turn by turn. The passages are embedded and the document is searchable.
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { logError } from "@/lib/errors";
import { getBytes, getJson, listKeys, partKey, PART_BYTES, putObject, r2Ready, readParts } from "../infra/r2";
import { withinFreeTier } from "../infra/usage";
import { MlUnavailable, mlReady, mlStart, type MlDone } from "../infra/ml";
import { small } from "../models";
import { passagesFromPages, passagesFromTranscript, splitText, type ParsedPage, type Segment } from "./chunk";
import { indexPassages, setDoc, upsertDoc, uploadUsage, type DocRow } from "./store";

export const AUDIO = /^(audio|video)\//;
const TEXT = /^(text\/|application\/(json|csv|xml|x-ndjson))/;
const EMAIL = /^message\/rfc822$|\.eml$/i;
export const MAX_UPLOAD = 200 * 1024 * 1024;

type FileRow = typeof schema.edgeFiles.$inferSelect;
const status = (message: string, code: number) => Object.assign(new Error(message), { status: code });

/** Guess a type from the name when the browser gives none. Pure. */
export function mimeOf(name: string, given: string): string {
  if (given && given !== "application/octet-stream") return given;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", txt: "text/plain", md: "text/markdown", html: "text/html", htm: "text/html", json: "application/json",
    eml: "message/rfc822", msg: "application/vnd.ms-outlook", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", tif: "image/tiff", tiff: "image/tiff", bmp: "image/bmp",
    xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac", wma: "audio/x-ms-wma",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Start an upload: checks the quota and returns the file and how many parts to send. */
export async function createUpload(userId: string, input: { name: string; mime: string; bytes: number; teamId?: number | null }): Promise<{ file: FileRow; parts: number; partBytes: number }> {
  if (!r2Ready()) throw status("File storage is not set up yet.", 503);
  const bytes = Math.floor(Number(input.bytes));
  if (!Number.isFinite(bytes) || bytes <= 0) throw status("That file is empty.", 400);
  if (bytes > MAX_UPLOAD) throw status("Files can be up to 200 MB each during the beta.", 413);
  const [use, free] = await Promise.all([uploadUsage(userId), withinFreeTier("r2")]);
  if (!free.ok) throw status(free.reason!, 507);
  if (use.files >= use.quotaFiles) throw status(`The beta allows ${use.quotaFiles} files each; remove some to add more.`, 429);
  if (use.bytes + bytes > use.quotaBytes) throw status(`That would pass your ${Math.round(use.quotaBytes / 1048576)} MB beta quota (${Math.round(use.bytes / 1048576)} MB used).`, 429);
  const name = input.name.replace(/[\\/]/g, "_").slice(0, 200) || "upload";
  const mime = mimeOf(name, input.mime);
  const parts = Math.max(1, Math.ceil(bytes / PART_BYTES));
  const r2Key = `uploads/${userId.slice(0, 12).replace(/[^A-Za-z0-9]/g, "")}/${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const [file] = await requireDb().insert(schema.edgeFiles).values({ ownerId: userId, teamId: input.teamId ?? null, kind: "upload", name, mime, bytes, r2Key, parts, status: "uploading" }).returning();
  return { file, parts, partBytes: PART_BYTES };
}

export async function ownFile(userId: string, fileId: number): Promise<FileRow> {
  const [f] = await requireDb().select().from(schema.edgeFiles).where(eq(schema.edgeFiles.id, fileId));
  if (!f || f.ownerId !== userId) throw status("That file does not exist.", 404);
  return f;
}

export async function putPart(userId: string, fileId: number, n: number, body: Uint8Array): Promise<void> {
  const f = await ownFile(userId, fileId);
  if (f.status !== "uploading") throw status("That upload is already finished.", 409);
  if (!Number.isInteger(n) || n < 0 || n >= f.parts) throw status("That part does not belong to this upload.", 400);
  if (body.byteLength > PART_BYTES || (n < f.parts - 1 && body.byteLength !== PART_BYTES)) throw status("Parts must be exactly 4 MB, except the last.", 400);
  await putObject(partKey(f.r2Key, n), body, "application/octet-stream");
}

/** Finish an upload: every part must be there. Creates the document and starts reading it. */
export async function completeUpload(userId: string, fileId: number): Promise<DocRow> {
  const f = await ownFile(userId, fileId);
  if (f.status === "uploading") {
    const keys = await listKeys(`${f.r2Key}/p/`, f.parts + 5);
    if (keys.length !== f.parts) throw status(`${f.parts - keys.length} part${f.parts - keys.length === 1 ? " is" : "s are"} missing; send them again.`, 409);
    await requireDb().update(schema.edgeFiles).set({ status: "stored" }).where(eq(schema.edgeFiles.id, f.id));
  }
  return upsertDoc({ ownerId: userId, teamId: f.teamId, source: AUDIO.test(f.mime) ? "audio" : "upload", externalId: `file:${f.id}`, title: f.name, fileId: f.id, mime: f.mime, meta: { bytes: f.bytes } });
}

/** Fetch audio from a public link (a podcast episode, a conference webcast file) into storage, like an upload. */
export async function importAudioUrl(userId: string, url: string, title: string): Promise<DocRow> {
  let u: URL;
  try { u = new URL(url); } catch { throw status("That is not a link.", 400); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw status("Only web links can be imported.", 400);
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(u.hostname)) throw status("YouTube does not allow downloading its videos; upload the recording or a direct audio link instead.", 400);
  const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) throw status(`The link answered ${res.status}.`, 400);
  const type = (res.headers.get("content-type") ?? "").split(";")[0];
  if (!AUDIO.test(type) && !/\.(mp3|m4a|wav|mp4|webm|ogg)(\?|$)/i.test(u.pathname)) throw status("That link is not an audio or video file.", 400);
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > MAX_UPLOAD) throw status("Recordings can be up to 200 MB each during the beta.", 413);
  const name = title.trim() || decodeURIComponent(u.pathname.split("/").pop() || "recording");
  const { file } = await createUpload(userId, { name, mime: AUDIO.test(type) ? type : mimeOf(name, ""), bytes: size || PART_BYTES });
  // Stream into 4 MB parts as it downloads.
  const reader = res.body.getReader();
  let buf = new Uint8Array(0), n = 0, total = 0;
  const flush = async (final: boolean) => {
    while (buf.byteLength >= PART_BYTES || (final && buf.byteLength)) {
      const piece = buf.slice(0, PART_BYTES);
      buf = buf.slice(piece.byteLength);
      await putObject(partKey(file.r2Key, n++), piece);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_UPLOAD) throw status("Recordings can be up to 200 MB each during the beta.", 413);
    const next = new Uint8Array(buf.byteLength + value.byteLength);
    next.set(buf); next.set(value, buf.byteLength); buf = next;
    await flush(false);
  }
  await flush(true);
  await requireDb().update(schema.edgeFiles).set({ status: "stored", bytes: total, parts: n, meta: { url } }).where(eq(schema.edgeFiles.id, file.id));
  return upsertDoc({ ownerId: userId, source: "audio", externalId: `file:${file.id}`, title: name, url, fileId: file.id, mime: file.mime, meta: { bytes: total, url } });
}

/* ---------------- Reading ---------------- */

const partKeys = (f: FileRow) => Array.from({ length: f.parts }, (_, i) => partKey(f.r2Key, i));

/** Text formats read here, without the ML service. Pure-ish (parsing only). */
export async function readSimple(mime: string, name: string, bytes: Uint8Array): Promise<ParsedPage[] | null> {
  const text = new TextDecoder().decode(bytes);
  if (EMAIL.test(mime) || /\.eml$/i.test(name)) {
    const m = await simpleParser(Buffer.from(bytes));
    const head = [`From: ${m.from?.text ?? ""}`, `To: ${Array.isArray(m.to) ? m.to.map((t) => t.text).join(", ") : m.to?.text ?? ""}`, `Date: ${m.date?.toISOString() ?? ""}`, `Subject: ${m.subject ?? ""}`].join("\n");
    const att = m.attachments.length ? `\n\nAttachments: ${m.attachments.map((a) => a.filename).join(", ")}` : "";
    return [{ n: 1, text: `${head}\n\n${m.text ?? ""}${att}` }];
  }
  if (mime === "text/csv" || /\.csv$/i.test(name)) {
    const rows = text.split(/\r?\n/).filter(Boolean).slice(0, 5000).map((l) => l.split(","));
    return [{ n: 1, text: "", tables: [rows] }];
  }
  if (mime === "text/html") {
    const { partsFromHtml } = await import("./html");
    return [{ n: 1, text: "", parts: partsFromHtml(text) }];
  }
  if (TEXT.test(mime)) return [{ n: 1, text }];
  return null;
}

const Speakers = z.object({
  turns: z.array(z.object({
    from: z.number().int().describe("index of the first segment of this turn"),
    speaker: z.string().describe("the speaker's name and role if said (e.g. 'Jane Doe, CFO', 'Operator', 'Analyst, Morgan Stanley'), else 'Speaker 1' and so on"),
    hedging: z.number().describe("0 to 1: how much the turn hedges (maybe, we expect, could, subject to)"),
    tone: z.number().describe("-1 negative to 1 positive"),
    note: z.string().describe("a few words on anything notable in tone, or empty"),
  })).max(400),
});

/** Name the speakers of a transcript and mark hedging and tone per turn (one small model call). */
export async function attributeSpeakers(segments: Segment[]): Promise<{ segments: Segment[]; turns: { from: number; speaker: string; hedging: number; tone: number; note: string }[] }> {
  if (!segments.length) return { segments, turns: [] };
  const lines = segments.slice(0, 1500).map((s, i) => `${i}: ${s.text.trim()}`).join("\n").slice(0, 120_000);
  try {
    const r = await structured(Speakers, "edge-speakers",
      "You read transcripts of earnings calls, conferences and meetings. Split the numbered segments into speaker turns. Use names and roles only when the transcript states them (an operator introduces speakers; people introduce themselves); otherwise use Speaker 1, Speaker 2. Never guess identities.",
      lines, { override: small(), maxTokens: 6000, timeoutMs: 120_000 });
    const turns = r.data.turns.filter((t) => t.from >= 0 && t.from < segments.length).sort((a, b) => a.from - b.from);
    const out = segments.map((s, i) => { const t = [...turns].reverse().find((x) => x.from <= i); return { ...s, speaker: t?.speaker ?? "" }; });
    return { segments: out, turns };
  } catch (e) {
    logError(e, { where: "edge-speakers" });
    return { segments, turns: [] };
  }
}

export type IngestStart = { done: true } | { wait: { callId: string; task: "docs.parse" | "audio.transcribe" } };

/** Begin reading a document: small text formats finish here; the rest start an ML task to wait on. */
export async function startIngest(docId: number): Promise<IngestStart> {
  const db = requireDb();
  const [doc] = await db.select().from(schema.edgeDocs).where(eq(schema.edgeDocs.id, docId));
  if (!doc?.fileId) throw new Error(`Document ${docId} has no file`);
  const [f] = await db.select().from(schema.edgeFiles).where(eq(schema.edgeFiles.id, doc.fileId));
  if (!f) throw new Error(`File for document ${docId} is gone`);
  await setDoc(docId, { status: "parsing", error: "" });
  if (!AUDIO.test(f.mime) && f.bytes < 30 * 1024 * 1024) {
    const pages = await readSimple(f.mime, f.name, await readParts(f.r2Key, f.parts));
    if (pages) { await setDoc(docId, { status: "indexing", pages: pages.length }); await indexPassages(docId, passagesFromPages(pages)); return { done: true }; }
  }
  if (!mlReady()) throw new MlUnavailable("Reading this kind of file needs the ML service, which is not set up yet.");
  const task = AUDIO.test(f.mime) ? "audio.transcribe" as const : "docs.parse" as const;
  const input = task === "audio.transcribe" ? { parts: partKeys(f), mime: f.mime, language: "auto", fileId: f.id } : { parts: partKeys(f), mime: f.mime, name: f.name, ocr: "auto", fileId: f.id };
  return { wait: { callId: await mlStart(task, input, `doc:${docId}`), task } };
}

type Parsed = { pages: { n: number; text: string; tables?: string[][][] }[]; meta?: { pages?: number; lang?: string; ocrPages?: number; title?: string } };
type Transcript = { language?: string; duration?: number; segments: Segment[]; engine?: string; model?: string; fallback?: unknown };

/** The credit NVIDIA's licence (CC BY 4.0) asks for wherever a Parakeet transcript is used. */
export const PARAKEET_CREDIT = "Speech recognition: NVIDIA Parakeet TDT 0.6B v2 (CC BY 4.0)";

/**
 * Who transcribed a recording, as the ML service reports it (Parakeet for English, Whisper otherwise, and
 * any fallback), with the line to show for it; null when it did not say. Pure.
 */
export function transcriptionOf(r: { engine?: unknown; model?: unknown; fallback?: unknown } | null | undefined): { engine: string; model: string; fallback?: string; credit: string } | null {
  const engine = typeof r?.engine === "string" ? r.engine.trim().toLowerCase() : "";
  const model = typeof r?.model === "string" ? r.model.trim() : "";
  if (!engine && !model) return null;
  const fallback = r?.fallback ? (typeof r.fallback === "string" ? r.fallback : JSON.stringify(r.fallback)).slice(0, 200) : "";
  const credit = engine === "parakeet" ? PARAKEET_CREDIT : `Speech recognition: ${engine === "whisper" ? "Whisper" : engine || "speech model"}${model ? ` (${model})` : ""}`;
  return { engine, model, ...(fallback ? { fallback } : {}), credit };
}

/** Finish reading from the ML task's answer: passages, embeddings, and what the document is. */
export async function finishIngest(docId: number, done: MlDone | null): Promise<void> {
  if (!done) { await setDoc(docId, { status: "failed", error: "The ML service did not answer in time; try again." }); return; }
  if (!done.ok || !done.result) { await setDoc(docId, { status: "failed", error: (done.error ?? "Could not read this file").slice(0, 300) }); return; }
  const [doc] = await requireDb().select().from(schema.edgeDocs).where(eq(schema.edgeDocs.id, docId));
  if (!doc) return;
  const key = String(done.result.key ?? "");
  if (done.task === "audio.transcribe") {
    const t = await getJson<Transcript>(key);
    if (!t?.segments?.length) { await setDoc(docId, { status: "failed", error: "No speech found in the recording." }); return; }
    await setDoc(docId, { status: "indexing", lang: t.language ?? "", durationSec: t.duration ?? 0 });
    const { segments, turns } = await attributeSpeakers(t.segments);
    const transcription = transcriptionOf(done.result) ?? transcriptionOf(t);
    await setDoc(docId, { meta: { ...doc.meta, transcriptKey: key, ...(transcription ? { transcription } : {}), turns: turns.slice(0, 400).map((x) => ({ ...x, t: segments[x.from]?.start ?? 0 })) } });
    await indexPassages(docId, passagesFromTranscript(segments));
    return;
  }
  const p = await getJson<Parsed>(key);
  if (!p?.pages?.length) { await setDoc(docId, { status: "failed", error: "No text found in the file." }); return; }
  await setDoc(docId, { status: "indexing", pages: p.meta?.pages ?? p.pages.length, lang: p.meta?.lang ?? "", meta: { ...doc.meta, parsedKey: key, ocrPages: p.meta?.ocrPages ?? 0 } });
  await indexPassages(docId, passagesFromPages(p.pages.map((x) => ({ n: x.n, text: x.text, tables: x.tables }))));
}

/** The raw bytes of a small file (for the fallback reader and tests). */
export async function fileBytes(f: FileRow): Promise<Uint8Array | null> {
  return f.parts ? readParts(f.r2Key, f.parts) : getBytes(f.r2Key);
}

export { splitText };
