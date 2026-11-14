/**
 * When a thesis's agent should next wake, from what YouBank said about the tick it just ran. Pure, so the
 * cadence rules are tested (test/run.ts) without a Durable Object.
 */
export type TickAnswer = { done: boolean; reason: string | null; status: string; nextTickAt: string | null };
export type Next = { kind: "continue"; delaySec: number } | { kind: "at"; when: Date } | { kind: "retry"; delaySec: number } | { kind: "stop"; why: string };

/** A tick is cut into slices of about 45 seconds; the next slice follows almost at once. */
export const CONTINUE_SEC = 2;
/** Another runner (YouBank's hourly safety net) holds the thesis: look again shortly. */
export const BUSY_SEC = 120;
/** With no next tick named, look again in six hours rather than never. */
export const IDLE_SEC = 6 * 3600;
/** Never sooner than this after a finished tick, however early the next one is stated. */
export const MIN_GAP_SEC = 30;

export function nextAfter(a: TickAnswer, now: Date): Next {
  if (a.status === "gone") return { kind: "stop", why: "the thesis no longer exists" };
  if (a.status !== "running") return { kind: "stop", why: `the thesis is ${a.status}` };
  if (a.reason === "running elsewhere") return { kind: "retry", delaySec: BUSY_SEC };
  if (!a.done) return { kind: "continue", delaySec: CONTINUE_SEC };
  const at = a.nextTickAt ? Date.parse(a.nextTickAt) : NaN;
  if (!Number.isFinite(at)) return { kind: "retry", delaySec: IDLE_SEC };
  return { kind: "at", when: new Date(Math.max(at, now.getTime() + MIN_GAP_SEC * 1000)) };
}

/** After a failed call to YouBank: back off 2, 4, 8… minutes up to an hour; a permanent refusal stops. Pure. */
export function afterFailure(failures: number, permanent: boolean): Next {
  if (permanent) return { kind: "stop", why: "YouBank refused the tick" };
  return { kind: "retry", delaySec: Math.min(3600, 60 * 2 ** Math.min(failures, 6)) };
}
