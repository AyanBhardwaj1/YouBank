/**
 * Turning a chunk of meeting audio into transcript segments, behind one interface so the engine can
 * change without touching the copilot.
 *
 * Two engines, picked by what is set up (MEETINGS_TRANSCRIBE forces one: "openai" or "ml"):
 * - OpenAI, when OPENAI_API_KEY is set: `gpt-4o-transcribe-diarize` with `diarized_json`, which labels
 *   speakers within the chunk (A, B…; the stitcher keeps them apart per chunk and the notes step names
 *   them). MEETINGS_TRANSCRIBE_MODEL picks another model (`gpt-4o-transcribe` or
 *   `gpt-4o-mini-transcribe`, plain text without speakers). About $0.006 a minute, recorded in the AI
 *   usage ledger against the person.
 * - The ML service (EDGE_ML_URL), otherwise: Parakeet for English, Whisper otherwise, inside its free
 *   credits, no speaker labels. The chunk goes to R2 for the service to read and is deleted, with the
 *   transcript the service wrote, as soon as the answer is back.
 * Audio is never kept: the bytes live only in this request (and, for the ML service, the seconds it
 * takes to read them).
 */
import { randomUUID } from "node:crypto";
import OpenAI, { toFile } from "openai";
import { recordUsage } from "@/lib/ai/usage";
import { mlRun } from "@/lib/edge/infra/ml";
import { deleteObject, getJson, putObject, r2Ready } from "@/lib/edge/infra/r2";
import type { Segment } from "./model";

export type TranscribeInput = {
  bytes: Uint8Array;
  /** audio/wav for the desktop app's chunks. */
  mime: string;
  durationSec: number;
  /** An ISO 639-1 code when the person set one; otherwise the engine detects it. */
  language?: string;
};

export type TranscribeResult = { segments: Segment[]; engine: string; model: string; costUsd: number };

export interface Transcriber {
  id: "openai" | "ml";
  /** Whether segments come with speaker labels. */
  diarizes: boolean;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}

/** OpenAI's list price per minute of audio for its transcription models (October 2026). */
const PER_MINUTE: Record<string, number> = {
  "gpt-4o-transcribe-diarize": 0.006, "gpt-4o-transcribe": 0.006, "gpt-4o-mini-transcribe": 0.003, "whisper-1": 0.006,
};
export const DEFAULT_OPENAI_MODEL = "gpt-4o-transcribe-diarize";

/**
 * Segments from an OpenAI transcription answer: `diarized_json` (segments with speakers), `verbose_json`
 * (segments) or `json` (text only: one segment for the whole chunk). Pure.
 */
export function segmentsFromOpenAi(res: unknown, durationSec: number): Segment[] {
  const r = (res && typeof res === "object" ? res : {}) as { segments?: unknown; text?: unknown };
  if (Array.isArray(r.segments) && r.segments.length) {
    return r.segments
      .map((s) => s as { start?: unknown; end?: unknown; text?: unknown; speaker?: unknown })
      .filter((s) => typeof s.text === "string" && s.text.trim())
      .map((s) => ({
        start: Math.max(0, Number(s.start) || 0), end: Math.max(Number(s.end) || 0, Number(s.start) || 0), text: String(s.text).trim(),
        ...(typeof s.speaker === "string" && s.speaker.trim() ? { speaker: s.speaker.trim() } : {}),
      }));
  }
  const text = typeof r.text === "string" ? r.text.trim() : typeof res === "string" ? res.trim() : "";
  return text ? [{ start: 0, end: Math.max(0, durationSec), text }] : [];
}

/** Segments from the ML service's transcript JSON (ml/edge_ml.py, audio.transcribe). Pure. */
export function segmentsFromMl(doc: unknown): Segment[] {
  const segs = (doc as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(segs)) return [];
  return segs
    .map((s) => s as { start?: unknown; end?: unknown; text?: unknown })
    .filter((s) => typeof s.text === "string" && s.text.trim())
    .map((s) => ({ start: Math.max(0, Number(s.start) || 0), end: Math.max(Number(s.end) || 0, Number(s.start) || 0), text: String(s.text).trim() }));
}

const extension = (mime: string) => (/wav/.test(mime) ? "wav" : /webm/.test(mime) ? "webm" : /ogg|opus/.test(mime) ? "ogg" : /mpeg|mp3/.test(mime) ? "mp3" : /mp4|m4a/.test(mime) ? "m4a" : "wav");

export const openAiTranscriber = (apiKey: string, model = DEFAULT_OPENAI_MODEL): Transcriber => ({
  id: "openai",
  diarizes: /diarize/.test(model),
  async transcribe(input) {
    const client = new OpenAI({ apiKey, timeout: 90_000, maxRetries: 1 });
    const file = await toFile(input.bytes, `chunk.${extension(input.mime)}`, { type: input.mime });
    const diarize = /diarize/.test(model);
    const res = await client.audio.transcriptions.create({
      file, model,
      ...(diarize ? { response_format: "diarized_json" as const, chunking_strategy: "auto" as const } : { response_format: "json" as const }),
      ...(input.language ? { language: input.language } : {}),
    });
    const costUsd = (PER_MINUTE[model] ?? 0.006) * (Math.max(1, input.durationSec) / 60);
    recordUsage({ feature: "meetings-transcribe", provider: "openai", model, usage: { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 }, extraCostUsd: costUsd });
    return { segments: segmentsFromOpenAi(res, input.durationSec), engine: "openai", model, costUsd };
  },
});

export const mlTranscriber = (): Transcriber => ({
  id: "ml",
  diarizes: false,
  async transcribe(input) {
    if (!r2Ready()) throw Object.assign(new Error("Transcription is not set up yet: it needs file storage for the ML service."), { status: 503 });
    const key = `meetings/tmp/${randomUUID()}.${extension(input.mime)}`;
    await putObject(key, input.bytes, input.mime);
    let transcriptKey = "";
    try {
      const r = await mlRun<{ key?: string; engine?: string; model?: string }>("audio.transcribe", { parts: [key], mime: input.mime, language: input.language || "auto", fileId: 0 }, 150_000);
      transcriptKey = String(r.key ?? "");
      const doc = transcriptKey ? await getJson<unknown>(transcriptKey) : null;
      return { segments: segmentsFromMl(doc), engine: "ml", model: String(r.model ?? r.engine ?? "speech model"), costUsd: 0 };
    } finally {
      await deleteObject(key).catch(() => undefined);
      if (transcriptKey) await deleteObject(transcriptKey).catch(() => undefined);
    }
  },
});

/** The engine to use, or null when none is set up. Pure apart from reading the environment it is given. */
export function pickTranscriber(env: Record<string, string | undefined> = process.env): Transcriber | null {
  const forced = env.MEETINGS_TRANSCRIBE?.trim().toLowerCase();
  const key = env.OPENAI_API_KEY?.trim();
  const ml = !!(env.EDGE_ML_URL?.trim() && env.EDGE_ML_SECRET?.trim());
  const openai = key ? openAiTranscriber(key, env.MEETINGS_TRANSCRIBE_MODEL?.trim() || DEFAULT_OPENAI_MODEL) : null;
  if (forced === "ml") return ml ? mlTranscriber() : null;
  if (forced === "openai") return openai;
  return openai ?? (ml ? mlTranscriber() : null);
}

/** Said to the person (so no setting names: those read as internal and would be withheld). */
export const NO_TRANSCRIBER = "Transcription is not set up on this YouBank yet: it needs an OpenAI key or the ML service. Nothing was recorded.";
