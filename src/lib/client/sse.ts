"use client";

/** Read a text/event-stream response and call onEvent for each JSON `data:` line. Resolves when the stream ends. */
export async function readSse(res: Response, onEvent: (ev: Record<string, unknown> & { type: string }) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
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

export async function errorOf(res: Response): Promise<string> {
  const j = await res.json().catch(() => ({}));
  return (j as { error?: string }).error ?? `HTTP ${res.status}`;
}
