/**
 * Starting the reading of a document: through Inngest when it is set up and within its allowance,
 * otherwise in this request's remaining time (polling the ML service instead of waiting on its event).
 */
import { after } from "next/server";
import { failureMessage } from "@/lib/errors";
import { sendJob } from "../infra/jobs";
import { mlStatus, noteMlCost } from "../infra/ml";
import { flushUsage } from "../infra/usage";
import { inlineSteps, premiumReadFor, runPremiumRead } from "../premium/reading";
import { setDoc } from "./store";
import { finishIngest, startIngest } from "./uploads";

async function inline(docId: number, deadline: number) {
  try {
    const premium = await premiumReadFor(docId);
    if (premium && (await runPremiumRead(docId, premium, inlineSteps(deadline))) === "done") return;
    const first = await startIngest(docId);
    if ("done" in first) return;
    while (Date.now() < deadline - 15_000) {
      await new Promise((r) => setTimeout(r, 6_000));
      const s = await mlStatus(first.wait.callId).catch(() => null);
      if (s?.done) { noteMlCost(s.costUsd); await finishIngest(docId, { callId: first.wait.callId, task: first.wait.task, correlation: `doc:${docId}`, ok: !!s.ok, result: s.result, error: s.error, costUsd: s.costUsd }); return; }
    }
    await setDoc(docId, { status: "failed", error: "Reading took longer than this request allows; it will work once background jobs are available." });
  } catch (e) {
    await setDoc(docId, { status: "failed", error: failureMessage(e, "edge-ingest-inline").slice(0, 300) });
  } finally {
    await flushUsage().catch(() => undefined);
  }
}

export async function ingest(docId: number): Promise<"queued" | "inline"> {
  const sent = await sendJob("edge/doc.uploaded", { docId }, { id: `edge-doc-${docId}-${Date.now()}` }).catch(() => ({ sent: false as const, reason: "" }));
  if (sent.sent) return "queued";
  after(() => inline(docId, Date.now() + 280_000));
  return "inline";
}
