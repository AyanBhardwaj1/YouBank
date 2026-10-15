"use client";

import { readError } from "./errors";

/** A stream that broke before it ended. Its message is meant for people. */
export class StreamDropped extends Error {
  constructor() {
    super("The connection dropped before the answer finished. Check your connection and try again.");
    this.name = "StreamDropped";
  }
}

/** Read a text/event-stream response and call onEvent for each JSON `data:` line. Resolves when the stream ends. */
export async function readSse(res: Response, onEvent: (ev: Record<string, unknown> & { type: string }) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      // The connection dropped mid-answer (browsers say "network error", "Error in body stream", "Load
      // failed"): say that, in words, rather than the browser's. A cancel by the person passes through.
      if ((e as { name?: string } | null)?.name === "AbortError") throw e;
      throw new StreamDropped();
    }
    const { value, done } = chunk;
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try { onEvent(JSON.parse(line.slice(6))); } catch { /* skip malformed */ }
      }
    }
  }
}

/** A failed response's message, safe to show (see lib/client/errors). */
export async function errorOf(res: Response): Promise<string> {
  return readError(res);
}
