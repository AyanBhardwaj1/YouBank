/**
 * The Inngest events Quant Edge emits for the algo engine and its own background passes. Event names are part
 * of the contract (docs/quant-edge.md, section 5.1): the algo engine may subscribe to them; neither side calls
 * the other's internals. Sending never fails the caller: without Inngest set up, the event is skipped and the
 * reason returned.
 */
import { sendJob, type SendResult } from "@/lib/edge/infra/jobs";

export const QUANT_EVENTS = {
  signalsPublished: "quant/signals.published",
  targetUpdated: "quant/target.updated",
  trialLogged: "quant/trial.logged",
  riskBudgetUpdated: "quant/riskbudget.updated",
  nightly: "quant/nightly",
  insidersPoll: "quant/insiders.poll",
} as const;

export type QuantEvent = (typeof QUANT_EVENTS)[keyof typeof QUANT_EVENTS];

export async function emit(name: QuantEvent, data: Record<string, unknown>, id?: string): Promise<SendResult> {
  try { return await sendJob(name, data, id ? { id } : {}); }
  catch (e) { return { sent: false, reason: e instanceof Error ? e.message.slice(0, 200) : "send failed" }; }
}
