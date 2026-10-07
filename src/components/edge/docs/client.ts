"use client";

/**
 * Documents' client plumbing: asking (the answer streams its progress), uploading in 4 MB parts with
 * retries, and the shapes the screens draw. Fetch helpers are Edge's (shared with the Newsroom).
 */
import type { Citation } from "@/lib/edge/canvas/values";
import type { AskInput, FullAnswer } from "@/lib/edge/docs/answer";
import type { ChangeRow, DocCompare, Radar } from "@/lib/edge/docs/changes";
import type { SpeakerTone, Turn } from "@/lib/edge/docs/tone";
import type { TopicMap } from "@/lib/edge/docs/topics";
import { apiError, errorMessage } from "@/lib/client/errors";

export type { AskInput, ChangeRow, DocCompare, Radar, SpeakerTone, TopicMap, Turn };

/** A citation as the answer pipeline stores it: the passage it quotes and where to open it. */
export type Cite = Citation & { chunkId?: number; lang?: string; fileId?: number | null; source?: string; section?: string; translation?: string };
export type DocAnswer = Omit<FullAnswer, "citations"> & { answerId: number; citations: Cite[] };

export type LibDoc = {
  id: number; source: string; title: string; url: string; status: string; error: string; pages: number; chunks: number; lang: string;
  durationSec: number; mime: string; fileId: number | null; ticker: string; form: string; createdAt: string; mine: boolean; shared: boolean; teamId?: number | null;
};
export type Library = { docs: LibDoc[]; filings: LibDoc[]; usage: { bytes: number; files: number; quotaBytes: number; quotaFiles: number } };

export type PassageView = {
  doc: { id: number; title: string; source: string; url: string; mime: string; lang: string; fileId: number | null; pages: number; durationSec: number; ticker: string; form: string; transcription?: string };
  passage: { id: number; ord: number; page: number; section: string; speaker: string; tStart: number | null; tEnd: number | null; text: string };
  around: { id: number; ord: number; text: string; page: number; tStart: number | null; speaker: string }[];
  raw: string | null;
  tone: { turn: Turn | null; speakers: SpeakerTone[]; overall: { hedging: number; tone: number } } | null;
};

/** What the source viewer opens: a passage, the words to highlight in it, and the citation when there is one. */
export type ViewTarget = { chunkId: number; quote?: string; cite?: Cite };

export const SOURCE_LABEL: Record<string, string> = { sec: "SEC filing", upload: "Upload", audio: "Recording", workspace: "Workspace", newsroom: "Newsroom", web: "Web" };
export const SOURCE_OPTIONS = [
  { value: "sec", label: "SEC filings" }, { value: "uploads", label: "My uploads" }, { value: "audio", label: "Calls and recordings" },
  { value: "workspace", label: "My workspace" }, { value: "newsroom", label: "Newsroom archive" }, { value: "web", label: "The live web" },
];
export const FORM_OPTIONS = ["10-K", "10-Q", "8-K", "DEF 14A", "S-4"];
export const READING = new Set(["queued", "parsing", "indexing"]);

export const fmtBytes = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(b >= 100 * 1024 ** 2 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
export const errorText = (e: unknown) => errorMessage(e);

/** The wait before the next check: `ms` while all is well, doubling with each failure in a row (5 s, 10 s, 20 s…), up to a minute. Pure, for tests. */
export const pollDelay = (ms: number, failures: number) => Math.min(ms * 2 ** Math.min(failures, 8), Math.max(ms, 60_000));

/**
 * Load now (or after `ms` with `wait`), then again every `ms` for as long as `keep` says so. A hidden tab
 * skips its checks and makes one when it is shown again; a failure is retried later (see pollDelay)
 * instead of ending the polling; after `forMs` it stops. Returns the stop function, for an effect's
 * cleanup: it aborts the load in flight, and nothing that arrives afterwards is acted on.
 */
export function poll<T>(load: (signal: AbortSignal) => Promise<T>, keep: (data: T) => boolean, opts: { ms?: number; wait?: boolean; forMs?: number; onError?: (e: unknown) => void } = {}): () => void {
  const { ms = 5000, forMs = Infinity } = opts;
  const ac = new AbortController();
  const until = Date.now() + forMs;
  let failures = 0, due = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = () => { if (!ac.signal.aborted && Date.now() < until) timer = setTimeout(check, pollDelay(ms, failures)); };
  const run = () => load(ac.signal)
    .then((data) => { if (ac.signal.aborted) return; failures = 0; if (keep(data)) later(); })
    .catch((e) => { if (ac.signal.aborted) return; failures++; opts.onError?.(e); later(); });
  const check = () => {
    if (ac.signal.aborted) return;
    if (document.visibilityState === "hidden") due = true;
    else void run();
  };
  const onShow = () => { if (due && document.visibilityState !== "hidden") { due = false; check(); } };
  document.addEventListener("visibilitychange", onShow);
  if (opts.wait) later(); else void run();
  return () => { ac.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", onShow); };
}

let warmedAt = 0;

/** Wake the reranker on the ML service ahead of a question (fire and forget; at most every three minutes). */
export function warmReranker(): void {
  if (Date.now() - warmedAt < 3 * 60_000) return;
  warmedAt = Date.now();
  void fetch("/api/edge/ask/warm", { method: "POST", keepalive: true }).catch(() => undefined);
}

const failure = (res: Response): Promise<Error> => apiError(res);

/** Ask the documents; `onProgress` hears each stage while sources are read and passages found. */
export async function askStream(input: AskInput, onProgress: (message: string) => void, signal?: AbortSignal): Promise<DocAnswer> {
  const res = await fetch("/api/edge/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal });
  if (!res.ok || !res.body) throw await failure(res);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev: { progress?: string; answer?: DocAnswer; error?: string };
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.progress) onProgress(ev.progress);
      if (ev.error) throw new Error(ev.error);
      if (ev.answer) return ev.answer;
    }
    if (done) break;
  }
  throw new Error("The answer was cut off; try again.");
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3, signal?: AbortSignal): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    if (signal?.aborted) throw new Error("Cancelled");
    try { return await fn(); } catch (e) { last = e; if (i < tries - 1) await new Promise((r) => setTimeout(r, 800 * 2 ** i)); }
  }
  throw last;
}

/**
 * Upload a file in parts (two at a time, each retried), then finish it so reading starts. The file is
 * private to the uploader unless `teamId` shares it.
 */
export async function uploadFile(file: File, opts: { teamId?: number | null; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}): Promise<{ docId: number; status: string }> {
  const start = await fetch("/api/edge/files", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: file.name, mime: file.type, bytes: file.size, teamId: opts.teamId ?? null }), signal: opts.signal });
  if (!start.ok) throw await failure(start);
  const { fileId, parts, partBytes } = (await start.json()) as { fileId: number; parts: number; partBytes: number };
  let sent = 0, next = 0;
  const worker = async () => {
    while (next < parts) {
      const n = next++;
      const blob = file.slice(n * partBytes, Math.min(file.size, (n + 1) * partBytes));
      await withRetry(async () => {
        const r = await fetch(`/api/edge/files/${fileId}/part?n=${n}`, { method: "PUT", body: blob, signal: opts.signal });
        if (!r.ok) throw await failure(r);
      }, 3, opts.signal);
      sent += blob.size;
      opts.onProgress?.(file.size ? sent / file.size : 1);
    }
  };
  await Promise.all([worker(), worker()]);
  const done = await withRetry(async () => {
    const r = await fetch(`/api/edge/files/${fileId}/complete`, { method: "POST", signal: opts.signal });
    if (!r.ok) throw await failure(r);
    return (await r.json()) as { docId: number; status: string };
  }, 2, opts.signal);
  return done;
}

/** The first line of an answer's text: the direct answer. */
export const directOf = (a: Pick<DocAnswer, "text">) => a.text.split("\n")[0]?.replace(/^- /, "") ?? "";

/** Plain Markdown for copying an answer into a memo or email: claims with their numbered sources. */
export function answerMarkdown(a: DocAnswer): string {
  const lines = [`**${a.question}**`, "", a.notFound ? a.text : directOf(a), ""];
  if (!a.notFound) for (const c of a.claims) lines.push(`- ${c.text}${c.cites.length ? ` ${c.cites.map((n) => `[${n}]`).join("")}` : " *(analysis)*"}`);
  if (a.citations.length) {
    lines.push("", "Sources:");
    for (const c of a.citations) lines.push(`[${c.n}] ${c.title}${c.page ? `, p. ${c.page}` : ""}${c.tStart !== undefined ? ` at ${Math.floor(c.tStart / 60)}:${String(Math.floor(c.tStart % 60)).padStart(2, "0")}` : ""}: "${c.quote}"${c.url ? ` ${c.url}` : ""}`);
  }
  return lines.join("\n");
}
