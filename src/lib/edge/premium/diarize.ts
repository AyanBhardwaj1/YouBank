/**
 * Speaker-labelled transcripts (premium: edge.transcribe-diarize) through OpenAI's
 * gpt-4o-transcribe-diarize. Each piece of a recording (see audio.ts) is sent with
 * response_format "diarized_json" and chunking "auto" (required past 30 seconds), and comes back as
 * segments with start, end, text and a speaker letter. Letters are per request, so "A" in one piece
 * need not be "A" in the next: after all pieces are in, one small-model pass reads the turns and names
 * each piece's letters ("Jane Doe, CFO", "Operator", "Analyst, Morgan Stanley", or "Speaker 2" when no
 * one says), joining the same voice across pieces, and scores each turn's hedging and tone as the free
 * path does. The diarization decides who spoke when; the model only names them.
 */
import OpenAI, { toFile } from "openai";
import { z } from "zod";
import { structured } from "@/lib/ai/agent";
import { guardAi } from "@/lib/ai/limits";
import { aiUser, recordUsage } from "@/lib/ai/usage";
import { logError } from "@/lib/errors";
import type { Segment } from "../docs/chunk";
import { small } from "../models";

export const diarizeModel = () => process.env.EDGE_TRANSCRIBE_MODEL?.trim() || "gpt-4o-transcribe-diarize";
export const USD_PER_MINUTE = 0.006;
export const DIARIZE_CREDIT = "Speech recognition and speaker labels: OpenAI gpt-4o-transcribe-diarize";

export type PieceResult = { duration: number; segments: { start: number; end: number; text: string; speaker: string }[] };

/** OpenAI's diarized answer as a piece result; segments without text are dropped. Pure. */
export function parseDiarized(j: unknown): PieceResult {
  const o = (j ?? {}) as { duration?: unknown; segments?: { start?: unknown; end?: unknown; text?: unknown; speaker?: unknown }[] };
  const segments = (Array.isArray(o.segments) ? o.segments : [])
    .filter((s) => typeof s?.text === "string" && s.text.trim())
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || Number(s.start) || 0, text: String(s.text).trim(), speaker: String(s.speaker ?? "").trim() || "A" }));
  const duration = Number(o.duration) || (segments.length ? segments[segments.length - 1].end : 0);
  return { duration, segments };
}

/** Transcribe one piece. Its cost (by minute) is recorded against the person the work runs for. */
export async function diarizePiece(bytes: Uint8Array, name: string, mime: string): Promise<PieceResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Speaker labels need OPENAI_API_KEY.");
  await guardAi(aiUser());
  const model = diarizeModel();
  const client = new OpenAI({ apiKey, timeout: 240_000, maxRetries: 1 });
  const res = await client.audio.transcriptions.create({
    file: await toFile(bytes, name, { type: mime || "audio/mpeg" }), model,
    response_format: "diarized_json", chunking_strategy: "auto",
  });
  const r = parseDiarized(res);
  recordUsage({ feature: "edge.transcribe-diarize", provider: "openai", model, usage: { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 }, extraCostUsd: (r.duration / 60) * USD_PER_MINUTE });
  return r;
}

/** Pieces in order as one transcript: times run on from each piece's duration, letters become "piece:letter". Pure. */
export function mergePieces(pieces: PieceResult[]): (Segment & { label: string })[] {
  const out: (Segment & { label: string })[] = [];
  let offset = 0;
  pieces.forEach((p, i) => {
    for (const s of p.segments) out.push({ start: offset + s.start, end: offset + s.end, text: s.text, label: `${i}:${s.speaker}` });
    offset += p.duration || (p.segments.length ? p.segments[p.segments.length - 1].end : 0);
  });
  return out;
}

export type DiarTurn = { from: number; label: string; text: string; t: number };

/** Consecutive segments of one label as turns. Pure. */
export function turnsOf(segs: (Segment & { label: string })[]): DiarTurn[] {
  const out: DiarTurn[] = [];
  segs.forEach((s, i) => {
    const last = out[out.length - 1];
    if (last && last.label === s.label) last.text += ` ${s.text}`;
    else out.push({ from: i, label: s.label, text: s.text, t: s.start });
  });
  return out;
}

const Named = z.object({
  speakers: z.array(z.object({ label: z.string().describe("the label as given, e.g. 0:A"), name: z.string().describe("the speaker's name and role if the recording says it ('Jane Doe, CFO', 'Operator', 'Analyst, Morgan Stanley'), else 'Speaker 1', 'Speaker 2' and so on, the same name for the same voice in every part") })),
  turns: z.array(z.object({ i: z.number().int(), hedging: z.number().describe("0 to 1"), tone: z.number().describe("-1 to 1"), note: z.string() })).max(400),
});

/**
 * Names for each label and hedging and tone per turn (one small model call). Labels it does not name
 * become "Speaker n" by order of first appearance, so a failed call still leaves the diarization usable.
 */
export async function nameSpeakers(turns: DiarTurn[]): Promise<{ names: Map<string, string>; scores: Map<number, { hedging: number; tone: number; note: string }> }> {
  const order = [...new Set(turns.map((t) => t.label))];
  const names = new Map(order.map((l, k) => [l, `Speaker ${k + 1}`]));
  const scores = new Map<number, { hedging: number; tone: number; note: string }>();
  if (!turns.length) return { names, scores };
  const lines = turns.slice(0, 400).map((t, i) => `${i} [${t.label}] ${t.text.slice(0, 600)}`).join("\n").slice(0, 120_000);
  try {
    const r = await structured(Named, "edge-speakers",
      "A recording was transcribed in parts by a model that tells voices apart; its labels are part:letter, and letters are only consistent within a part. Name each label: use names and roles only when the recording states them (an operator introduces speakers; people introduce themselves), give the same name to the same voice across parts when the content makes it clear, and otherwise use Speaker 1, Speaker 2. Never guess identities. Then score each numbered turn for hedging (maybe, we expect, could, subject to) and tone.",
      lines, { override: small(), maxTokens: 6000, timeoutMs: 120_000 });
    for (const s of r.data.speakers) if (names.has(s.label) && s.name.trim()) names.set(s.label, s.name.trim().slice(0, 80));
    for (const t of r.data.turns) if (t.i >= 0 && t.i < turns.length) scores.set(t.i, { hedging: Math.max(0, Math.min(1, t.hedging)), tone: Math.max(-1, Math.min(1, t.tone)), note: t.note.slice(0, 200) });
  } catch (e) {
    logError(e, { where: "edge-diarize-names" });
  }
  return { names, scores };
}
