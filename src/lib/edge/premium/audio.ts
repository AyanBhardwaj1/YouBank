/**
 * Cutting a recording into pieces a transcription API accepts (OpenAI takes 25 MB a request), without
 * decoding it: there is no ffmpeg in a serverless function. Pure functions, for tests.
 *
 * - MP3 is a run of self-contained frames, so a piece can start at any frame: each piece after the first
 *   skips the bytes before its first whole frame (one frame, about 26 ms, is lost at each cut).
 * - WAV is a header and raw samples, so each piece is a new header with a slice of the samples, cut on a
 *   whole sample frame.
 * - Anything else (M4A, MP4, WebM, OGG) cannot be cut this way: one piece if it fits, else none.
 */

/** Twelve megabytes a piece: about 12 minutes of a 128 kbps MP3, well inside the 25 MB limit and a function's time. */
export const PIECE_BYTES = 12 * 1024 * 1024;
/** The most a single uncut file may be. */
export const WHOLE_MAX_BYTES = 24 * 1024 * 1024;

export type Piece = { index: number; start: number; end: number; kind: "whole" | "mp3" | "wav" };
export type WavInfo = { fmt: Uint8Array; dataStart: number; dataBytes: number; blockAlign: number };

const BITRATES: Record<string, number[]> = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** The length in bytes of an MPEG audio frame whose header starts at `i`, or 0 when there is none. Pure. */
export function mp3FrameLength(b: Uint8Array, i: number): number {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return 0;
  const version = (b[i + 1] >> 3) & 3, layerBits = (b[i + 1] >> 1) & 3;
  if (version === 1 || layerBits === 0) return 0;
  const layer = 4 - layerBits; // 1, 2 or 3
  const bitIdx = b[i + 2] >> 4, rateIdx = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
  if (bitIdx === 0 || bitIdx === 15 || rateIdx === 3) return 0;
  const kbps = BITRATES[`${version === 3 ? 1 : 2}-${layer}`][bitIdx];
  const rate = RATES[version][rateIdx];
  if (layer === 1) return (Math.floor((12 * kbps * 1000) / rate) + pad) * 4;
  const perFrame = layer === 3 && version !== 3 ? 72 : 144;
  return Math.floor((perFrame * kbps * 1000) / rate) + pad;
}

/** Where the first whole MP3 frame starts (one followed by another, or by the end), searching the first 64 KB; -1 when none. Pure. */
export function firstMp3Frame(b: Uint8Array, from = 0): number {
  const stop = Math.min(b.length - 4, from + 65_536);
  for (let i = from; i < stop; i++) {
    const len = mp3FrameLength(b, i);
    if (!len) continue;
    if (i + len === b.length || mp3FrameLength(b, i + len) > 0) return i;
  }
  return -1;
}

const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);

/** A WAV file's format chunk and where its samples are, from its first bytes; null when it is not a WAV this can cut. Pure. */
export function wavInfo(head: Uint8Array, size: number): WavInfo | null {
  if (head.length < 12 || ascii(head, 0, 4) !== "RIFF" || ascii(head, 8, 4) !== "WAVE") return null;
  let i = 12, fmt: Uint8Array | null = null;
  while (i + 8 <= head.length) {
    const id = ascii(head, i, 4), len = u32(head, i + 4);
    if (id === "fmt ") fmt = head.slice(i + 8, i + 8 + len);
    if (id === "data") {
      if (!fmt || fmt.length < 16) return null;
      const blockAlign = u16(fmt, 12);
      if (!blockAlign) return null;
      const dataStart = i + 8;
      return { fmt, dataStart, dataBytes: Math.min(len, size - dataStart), blockAlign };
    }
    i += 8 + len + (len & 1);
  }
  return null;
}

/** A WAV header for `dataBytes` of samples in this format. Pure. */
export function wavHeader(fmt: Uint8Array, dataBytes: number): Uint8Array {
  const out = new Uint8Array(12 + 8 + fmt.length + (fmt.length & 1) + 8);
  const v = new DataView(out.buffer);
  const put = (i: number, s: string) => { for (let k = 0; k < s.length; k++) out[i + k] = s.charCodeAt(k); };
  put(0, "RIFF"); v.setUint32(4, out.length - 8 + dataBytes, true); put(8, "WAVE");
  put(12, "fmt "); v.setUint32(16, fmt.length, true); out.set(fmt, 20);
  const d = 20 + fmt.length + (fmt.length & 1);
  put(d, "data"); v.setUint32(d + 4, dataBytes, true);
  return out;
}

const isMp3 = (mime: string, name: string) => /audio\/(mpeg|mp3)/i.test(mime) || /\.mp3$/i.test(name);
const isWav = (mime: string, name: string) => /audio\/(wav|x-wav|wave|vnd\.wave)/i.test(mime) || /\.wav$/i.test(name);

/**
 * The pieces to send, by byte range of the stored file, or null when the recording is too large to
 * send and cannot be cut. `head` is the file's first bytes (64 KB is plenty), needed for WAV. Pure.
 */
export function planPieces(size: number, mime: string, name: string, head: Uint8Array, piece = PIECE_BYTES): Piece[] | null {
  if (size <= 0) return null;
  if (isWav(mime, name)) {
    const w = wavInfo(head, size);
    if (w) {
      const step = Math.max(w.blockAlign, Math.floor(piece / w.blockAlign) * w.blockAlign);
      const out: Piece[] = [];
      for (let at = 0; at < w.dataBytes; at += step) out.push({ index: out.length, start: w.dataStart + at, end: w.dataStart + Math.min(w.dataBytes, at + step), kind: "wav" });
      return out;
    }
  }
  if (isMp3(mime, name) && size > WHOLE_MAX_BYTES) {
    const out: Piece[] = [];
    for (let at = 0; at < size; at += piece) out.push({ index: out.length, start: at, end: Math.min(size, at + piece), kind: "mp3" });
    return out;
  }
  return size <= WHOLE_MAX_BYTES ? [{ index: 0, start: 0, end: size, kind: "whole" }] : null;
}

/** A piece's bytes ready to send: MP3 pieces after the first start at a whole frame, WAV pieces get their header. Pure. */
export function pieceBytes(p: Piece, bytes: Uint8Array, wav?: WavInfo | null): Uint8Array {
  if (p.kind === "mp3" && p.index > 0) {
    const at = firstMp3Frame(bytes);
    return at > 0 ? bytes.subarray(at) : bytes;
  }
  if (p.kind === "wav" && wav) {
    const head = wavHeader(wav.fmt, bytes.length);
    const out = new Uint8Array(head.length + bytes.length);
    out.set(head); out.set(bytes, head.length);
    return out;
  }
  return bytes;
}
