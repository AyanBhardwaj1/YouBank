/**
 * Live updates without a socket service. Vercel cannot hold a connection open forever, so a stream
 * route follows an append-only log by polling it and closes after STREAM_LIFETIME_MS; the browser
 * reconnects with Last-Event-ID and misses nothing. Three things keep that cheap with many people
 * watching:
 * - every connection following the same log on an instance shares one poll;
 * - the pace follows activity: every second while things change, easing to every five seconds after
 *   a quiet minute (STREAM_MODE=slow stretches both five times: the lever if database load spikes);
 * - the browser closes its stream while the tab is hidden and resumes from its last event on return.
 */

export const STREAM_LIFETIME_MS = 120_000;
/** A comment line now and then, so proxies never see an idle connection and closed readers are noticed. */
export const KEEPALIVE_MS = 25_000;
/** Entries fetched per poll; a full page means more are waiting, so the next poll runs at once. */
export const FEED_PAGE = 200;

export const streamSlow = () => (process.env.STREAM_MODE ?? "").trim().toLowerCase() === "slow";

/** How long to wait before the next poll, given how long the log has been quiet. Pure, for tests. */
export function pollDelay(quietMs: number, slow = streamSlow()): number {
  const base = quietMs < 15_000 ? 1_000 : quietMs < 60_000 ? 2_500 : 5_000;
  return slow ? base * 5 : base;
}

/** What one poll found: new entries, and optionally the current state of something small (who is here). */
export type Batch<E, X> = { events: E[]; extra?: X };
type Sub<E, X> = { cursor: number; deliver: (b: Batch<E, X>) => void };
type Feed<E, X> = { subs: Set<Sub<E, X>>; load: (since: number) => Promise<Batch<E, X>>; quietSince: number; wake: (() => void) | null };

// Entries are typed per key by the caller; the map itself cannot know them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const feeds = new Map<string, Feed<any, any>>();

/**
 * Follow a log from `cursor`: `deliver` receives every later entry in order, plus `extra` on each poll.
 * Connections following the same `key` on this instance share one poll, so `load` must return the same
 * thing for the same key. Returns the function that stops following.
 */
export function follow<E extends { id: number }, X = undefined>(
  key: string, cursor: number, load: (since: number) => Promise<Batch<E, X>>, deliver: (b: Batch<E, X>) => void,
): () => void {
  const sub: Sub<E, X> = { cursor, deliver };
  let feed = feeds.get(key) as Feed<E, X> | undefined;
  if (feed) {
    feed.subs.add(sub);
    feed.wake?.(); // a newcomer gets its first poll now, not after the idle wait
  } else {
    feed = { subs: new Set([sub]), load, quietSince: Date.now(), wake: null };
    feeds.set(key, feed);
    void run(key, feed);
  }
  const f = feed;
  return () => {
    f.subs.delete(sub);
    if (f.subs.size === 0) {
      if (feeds.get(key) === f) feeds.delete(key);
      f.wake?.();
    }
  };
}

/** A write on this instance: its followers poll at once and at the fast pace again. */
export function touch(key: string) {
  const f = feeds.get(key);
  if (!f) return;
  f.quietSince = Date.now();
  f.wake?.();
}

/** How many logs this instance is following (for the load test and logs). */
export const followedCount = () => feeds.size;

async function run<E extends { id: number }, X>(key: string, f: Feed<E, X>) {
  while (f.subs.size > 0) {
    const since = Math.min(...[...f.subs].map((s) => s.cursor));
    let batch: Batch<E, X> = { events: [] };
    try { batch = await f.load(since); } catch { /* a transient database error: the next poll retries */ }
    if (batch.events.length) f.quietSince = Date.now();
    for (const s of f.subs) {
      // Someone who joined during this poll with an older cursor is served by the next one.
      if (s.cursor < since) continue;
      const fresh = batch.events.filter((e) => e.id > s.cursor);
      if (fresh.length) s.cursor = fresh[fresh.length - 1].id;
      if (fresh.length || batch.extra !== undefined) {
        try { s.deliver({ events: fresh, extra: batch.extra }); } catch { /* one reader's failure is its own */ }
      }
    }
    if (batch.events.length >= FEED_PAGE || f.subs.size === 0) continue;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, pollDelay(Date.now() - f.quietSince));
      f.wake = () => { clearTimeout(t); resolve(); };
    });
    f.wake = null;
  }
  if (feeds.get(key) === f) feeds.delete(key);
}

/**
 * The SSE plumbing both stream routes share: frames with ids (so Last-Event-ID resumes), a keep-alive,
 * a planned close after the lifetime, and clean-up when the reader goes away.
 */
export function sseStream(req: Request, start: (frame: (id: number, type: string, data: unknown) => void) => () => void, lastId: () => number): Response {
  const enc = new TextEncoder();
  let finish = () => undefined as void;
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (text: string) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(text)); } catch { finish(); }
      };
      const frame = (id: number, type: string, data: unknown) => send(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      // Reconnect a second after a planned close, rather than the browser's default three.
      send("retry: 1000\n\n");
      const stop = start(frame);
      const keepalive = setInterval(() => send(": ping\n\n"), KEEPALIVE_MS);
      const lifetime = setTimeout(() => finish(), STREAM_LIFETIME_MS);
      finish = () => {
        if (closed) return;
        clearInterval(keepalive);
        clearTimeout(lifetime);
        stop();
        // Tell the browser this was a planned close, not a failure.
        try { controller.enqueue(enc.encode(`id: ${lastId()}\nevent: bye\ndata: {"reason":"rotate"}\n\n`)); } catch { /* gone */ }
        closed = true;
        try { controller.close(); } catch { /* closed */ }
      };
      req.signal.addEventListener("abort", () => finish());
    },
    cancel() { finish(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" } });
}

/** Where a stream resumes: the browser's Last-Event-ID on a reconnect, else ?since=, else the start. */
export function resumeFrom(req: Request): number {
  const n = Number(req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("since") ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
