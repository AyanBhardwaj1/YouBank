/**
 * Background work through Inngest: canvas runs, monitors, document ingestion, graph training and
 * scenario refinement. Each step is retried on failure and recorded, and runs survive a function
 * timeout. Steps are counted against the free tier (50,000 executions a month); past the ceiling new
 * background work is refused with a plain reason and callers fall back to running it in the request.
 */
import { Inngest } from "inngest";
import { addUsage, flushUsage, withinFreeTier } from "./usage";

/** On Vercel a function may run 300 s; Inngest hands a run back to its queue well before that. */
export const inngest = new Inngest({ id: "youbank", checkpointing: { maxRuntime: "240s" } });

export const jobsReady = () => !!process.env.INNGEST_DEV || !!(process.env.INNGEST_EVENT_KEY?.trim() && process.env.INNGEST_SIGNING_KEY?.trim());

export type SendResult = { sent: true; ids: string[] } | { sent: false; reason: string };

/** Queue background work, unless jobs are not set up or the month's allowance is spent. */
export async function sendJob(name: string, data: Record<string, unknown>, opts: { id?: string } = {}): Promise<SendResult> {
  if (!jobsReady()) return { sent: false, reason: "Background jobs are not set up." };
  const free = await withinFreeTier("inngest");
  if (!free.ok) return { sent: false, reason: free.reason! };
  const out = await inngest.send({ name, data, ...(opts.id ? { id: opts.id } : {}) });
  addUsage("inngest", "events", 1);
  return { sent: true, ids: out.ids };
}

/** The part of Inngest's step tools Edge uses; the inline runner (runInline) implements the same. */
export type Steps = {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  waitForEvent: (id: string, opts: { event: string; timeout: string; if?: string }) => Promise<{ data: Record<string, unknown> } | null>;
  sleep: (id: string, duration: string | number) => Promise<void>;
};

/** Wrap Inngest's steps so each executed step counts as one execution (replayed steps do not run again, so they are not counted twice). */
export function metered(step: Steps): Steps {
  return {
    run: (id, fn) => step.run(id, async () => {
      addUsage("inngest", "executions", 1);
      try { return await fn(); } finally { await flushUsage().catch(() => undefined); }
    }),
    waitForEvent: (id, opts) => step.waitForEvent(id, opts),
    sleep: (id, d) => step.sleep(id, d),
  };
}
