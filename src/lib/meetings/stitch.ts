/**
 * Putting a meeting's transcript back together from its pieces. Pure functions, tested in
 * scripts/test-meetings.ts.
 *
 * The desktop app sends audio in chunks of about 30 seconds, each starting a second before the last
 * one ended, so a word cut in half at a boundary is heard whole in one of them. Each chunk is
 * transcribed on its own, so:
 * - times are relative to the chunk and become meeting times by adding the chunk's start;
 * - the overlap is heard twice: the seam goes at the middle of the overlap, and words repeated across
 *   it are dropped once;
 * - a diarizing model's labels ("A", "B") restart with every chunk, so they are kept apart per chunk
 *   ("S3A") until the notes step, which reads the whole meeting, names them;
 * - the person's own voice is known for certain from the microphone: the app sends how loud the
 *   microphone and the system audio were every quarter second, and a segment spoken mostly into the
 *   microphone is "You".
 */
import type { Segment } from "./model";

export type Chunk = { seq: number; startSec: number; durationSec: number; segments: Segment[] };

/** Levels the app measured for one chunk: one byte (0 to 255) per frame for the microphone and the system audio. */
export type Activity = { frameSec: number; mic: number[]; sys: number[] };

export const SELF = "You";

/** A diarizer's anonymous label ("A", "speaker_1", "Speaker 2", "3"), as opposed to a name. Pure. */
export const isAnonymous = (label: string | undefined) => !label || /^[A-Z]$|^(speaker|spk)[\s_-]*\d+$|^\d+$/i.test(label.trim());

/** A chunk's anonymous labels namespaced by the chunk ("A" in chunk 3 is "S3A"); names stay. Pure. */
export function chunkLabel(label: string | undefined, seq: number): string {
  const l = (label ?? "").trim();
  if (!l) return "";
  if (!isAnonymous(l)) return l;
  return `S${seq}${l.replace(/^(speaker|spk)[\s_-]*/i, "").toUpperCase()}`;
}

/** A label the transcript has not named yet ("S3A"), as opposed to "You" or a person's name. Pure. */
export const isChunkLabel = (label: string | undefined) => !!label && /^S\d+[A-Z0-9]+$/.test(label);

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/**
 * The start of `next` with any words that repeat the end of `prev` removed: the same words heard in
 * both chunks' overlap. Two or more words must match (or one long word), so a genuinely repeated short
 * word ("the the") is kept. Pure.
 */
export function dropRepeatedPrefix(prev: string, next: string): string {
  const a = words(prev).map(norm), bw = words(next), b = bw.map(norm);
  const max = Math.min(12, a.length, b.length);
  for (let k = max; k >= 1; k--) {
    let same = true;
    for (let i = 0; i < k; i++) if (a[a.length - k + i] !== b[i] || !b[i]) { same = false; break; }
    if (!same) continue;
    if (k >= 2 || b[0].length >= 5) return bw.slice(k).join(" ");
  }
  return next.trim();
}

/**
 * The whole meeting's segments, in meeting time, from its chunks in any order (a chunk sent twice:
 * the later copy wins). Pure.
 */
export function stitch(chunks: Chunk[]): Segment[] {
  const bySeq = new Map<number, Chunk>();
  for (const c of chunks) bySeq.set(c.seq, c);
  const ordered = [...bySeq.values()].sort((x, y) => x.seq - y.seq);
  const out: Segment[] = [];
  let covered = -Infinity;
  for (const c of ordered) {
    const start = Number.isFinite(c.startSec) ? c.startSec : 0;
    const segs = [...(c.segments ?? [])]
      .filter((s) => s && typeof s.text === "string" && s.text.trim())
      .map((s) => ({
        start: start + Math.max(0, Number(s.start) || 0),
        end: start + Math.max(Number(s.end) || 0, Number(s.start) || 0),
        text: s.text.trim(),
        speaker: chunkLabel(s.speaker, c.seq),
      }))
      .sort((x, y) => x.start - y.start);
    // Where this chunk overlaps what came before, the seam is the middle of the overlap: earlier
    // segments that begin after it give way to this chunk's, which heard them whole.
    const seam = covered > start ? (start + covered) / 2 : start;
    if (covered > start) {
      while (out.length && (out[out.length - 1].start + out[out.length - 1].end) / 2 >= seam) out.pop();
    }
    let first = true;
    for (const s of segs) {
      if (covered > start && (s.start + s.end) / 2 < seam) continue;
      let text = s.text;
      if (first && covered > start && out.length) text = dropRepeatedPrefix(out[out.length - 1].text, text);
      first = false;
      if (!text) continue;
      out.push({ start: s.start, end: s.end, text, ...(s.speaker ? { speaker: s.speaker } : {}) });
    }
    covered = Math.max(covered, start + Math.max(0, c.durationSec || 0), ...segs.map((s) => s.end));
  }
  return out;
}

/**
 * Mark the segments spoken into this computer's microphone as "You", from the levels the app measured
 * (times relative to the chunk). Only when system audio was captured too: with the microphone alone,
 * the other side comes through the speakers into it and the levels say nothing. Pure.
 */
export function labelSelf(segments: Segment[], activity: Activity | null): Segment[] {
  if (!activity || !(activity.frameSec > 0) || !activity.sys.some((v) => v > 0)) return segments;
  const { frameSec, mic, sys } = activity;
  return segments.map((s) => {
    const from = Math.max(0, Math.floor(s.start / frameSec)), to = Math.min(mic.length, Math.ceil(s.end / frameSec));
    let voiced = 0, mine = 0;
    for (let i = from; i < to; i++) {
      const m = mic[i] ?? 0, y = sys[i] ?? 0;
      if (m < 12 && y < 12) continue; // silence
      voiced++;
      if (m > y * 1.5) mine++;
    }
    return voiced >= 2 && mine / voiced >= 0.6 ? { ...s, speaker: SELF } : s;
  });
}

/** Levels as the app sends them: hex, two characters a frame. Pure; bad input gives no levels. */
export function parseLevels(hex: string | null | undefined, max = 2400): number[] {
  if (!hex || !/^(?:[0-9a-f]{2})*$/i.test(hex)) return [];
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length && out.length < max; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

/** Replace labels the notes step named; anonymous ones that stay unnamed read "Speaker". Pure. */
export function nameSpeakers(segments: Segment[], names: { label: string; name: string }[]): Segment[] {
  const map = new Map(names.filter((n) => n.label && n.name.trim()).map((n) => [n.label, n.name.trim()]));
  return segments.map((s) => {
    const named = s.speaker ? map.get(s.speaker) : undefined;
    if (named) return { ...s, speaker: named };
    return isChunkLabel(s.speaker) ? { ...s, speaker: "Speaker" } : s;
  });
}

/** Consecutive segments by the same speaker, close together, as one turn. Pure. */
export function turns(segments: Segment[], gapSec = 2): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && (last.speaker ?? "") === (s.speaker ?? "") && s.start - last.end <= gapSec) {
      last.end = Math.max(last.end, s.end);
      last.text = `${last.text} ${s.text}`;
    } else out.push({ ...s });
  }
  return out;
}

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/**
 * The transcript as a model reads it: "[mm:ss] Speaker: text" per turn. A very long meeting keeps its
 * opening and its end (where decisions and next steps usually are) and says what was cut. Pure.
 */
export function renderTranscript(segments: Segment[], maxChars = 160_000): string {
  const lines = turns(segments).map((t) => `[${mmss(t.start)}] ${t.speaker || "Unknown"}: ${t.text}`);
  const all = lines.join("\n");
  if (all.length <= maxChars) return all;
  const head: string[] = [], tail: string[] = [];
  let used = 0, i = 0, j = lines.length - 1;
  while (i <= j && used < maxChars * 0.4) { head.push(lines[i]); used += lines[i].length + 1; i++; }
  while (j >= i && used < maxChars) { tail.unshift(lines[j]); used += lines[j].length + 1; j--; }
  return [...head, `[… ${j - i + 1} turns from the middle of the meeting left out for length …]`, ...tail].join("\n");
}
