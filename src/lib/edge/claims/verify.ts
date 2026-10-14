/**
 * Calibrated Claims (E2) on a live answer or memo: each claim's features (features.ts), the NLI checker on
 * the ML service when the shipped combiner was fitted with it, the combiner's calibrated support
 * probability, and Strict's line. In Strict mode claims below the line are held back (still shown on
 * request, under "held back"); Balanced shows every claim with its dot. The premium cross-check (a second
 * provider's model judging each claim against its passages) runs only inside a premium scope that holds
 * `edge.claims-crosscheck`; its verdict is shown beside the probability and, in Strict, a claim it rejects is
 * held back too (it is not folded into the probability, which was not calibrated with it).
 *
 * The verifier version and calibration set go into the answer's provenance, so every dot can be traced to
 * the model that drew it.
 */
import { z } from "zod";
import { structured } from "@/lib/ai/agent";
import { availableProviders } from "@/lib/ai/config";
import { premiumOn } from "@/lib/billing/use";
import { logError } from "@/lib/errors";
import { mlReady, mlRun } from "../infra/ml";
import { upgradeOn } from "../premium";
import shipped from "./model.json";
import { dotOf, lineFor, strictFooter, supportOf, type CombinerModel } from "./combine";
import { DEFAULT_ALPHA } from "./conformal";
import { claimFeatures, reasonsOf, type ClaimInput } from "./features";
import type { ClaimSupport, VerifierInfo } from "./types";

export const combiner = (): CombinerModel => shipped as unknown as CombinerModel;

/** NLI entailment for each claim-passage pair, from the ML service; null when it cannot run. */
async function nliFor(claims: ClaimInput[]): Promise<boolean> {
  if (!combiner().features.includes("nli") || !mlReady()) return false;
  const pairs = claims.flatMap((c) => c.cites.map((p) => ({ premise: `${p.header}\n${p.text}`.slice(0, 2000), hypothesis: c.text.slice(0, 600) })));
  if (!pairs.length) return false;
  try {
    const r = await mlRun<{ entail: number[] }>("docs.verify", { pairs: pairs.slice(0, 120) }, 60_000);
    let k = 0;
    for (const c of claims) for (const p of c.cites) p.nli = r.entail[k++] ?? null;
    return true;
  } catch (e) { logError(e, { where: "edge-claims-nli" }); return false; }
}

const Judged = z.object({ claims: z.array(z.object({ n: z.number().int(), verdict: z.enum(["supported", "unsupported", "unclear"]), note: z.string().describe("one short reason") })) });

/** The second provider for a cross-check: the other one from the answer's, when its key is set. Pure but for the environment. */
export function crosscheckModel(answerModel: string): string | null {
  const have = availableProviders();
  const answeredByAnthropic = /^claude/i.test(answerModel);
  if (answeredByAnthropic) return have.includes("openai") ? process.env.EDGE_CROSSCHECK_OPENAI_MODEL?.trim() || "gpt-5.6-luna" : null;
  return have.includes("anthropic") ? process.env.EDGE_CROSSCHECK_MODEL?.trim() || "claude-sonnet-5-5" : null;
}

async function crosscheck(claims: ClaimInput[], answerModel: string): Promise<{ model: string; verdicts: Map<number, NonNullable<ClaimSupport["crosscheck"]>> } | null> {
  const model = crosscheckModel(answerModel);
  if (!model) return null;
  const body = claims.map((c, i) => `(${i + 1}) ${c.text}\n${c.cites.map((p) => `  passage: ${p.header}\n  ${p.text.slice(0, 1500)}`).join("\n")}`).join("\n\n");
  const r = await structured(Judged, "edge-claims-crosscheck", "You check research claims against the passages cited for them. For each numbered claim say supported (the passages state it, numbers, company and period included), unsupported (they contradict it or do not state it) or unclear. Judge only from the passages.", body, { override: { model }, maxTokens: 1500, timeoutMs: 60_000 });
  const verdicts = new Map<number, NonNullable<ClaimSupport["crosscheck"]>>();
  for (const j of r.data.claims) if (j.n >= 1 && j.n <= claims.length) verdicts.set(j.n - 1, { verdict: j.verdict, note: j.note.slice(0, 200), model: r.model });
  return { model: r.model, verdicts };
}

/**
 * Support for each claim, and which Strict holds back. `scope` lists the companies the answer covers (for
 * the entity check). `answerModel` picks the cross-check's other provider.
 */
export async function verifyClaims(claims: ClaimInput[], opts: { mode: "strict" | "balanced"; scope: { name: string; ticker: string }[]; alpha?: number; answerModel?: string; memo?: boolean }): Promise<{ supports: ClaimSupport[]; hold: boolean[]; info: VerifierInfo }> {
  const m = combiner();
  const alpha = opts.alpha ?? DEFAULT_ALPHA;
  const nli = await nliFor(claims);
  let checked: Awaited<ReturnType<typeof crosscheck>> = null;
  if (premiumOn("edge.claims-crosscheck") && upgradeOn("claims-crosscheck")) checked = await crosscheck(claims, opts.answerModel ?? "").catch((e) => { logError(e, { where: "edge-claims-crosscheck" }); return null; });
  const line = lineFor(m, alpha);
  const supports = claims.map((c, i) => {
    const { features, numbers } = claimFeatures(c, opts.scope);
    const p = supportOf(m, features);
    const reasons = reasonsOf(features, numbers);
    return { p, dot: dotOf(p), reasons, ...(checked?.verdicts.get(i) ? { crosscheck: checked.verdicts.get(i)! } : {}) } satisfies ClaimSupport;
  });
  const hold = supports.map((s) => opts.mode === "strict" && ((line?.tau !== undefined && line.tau !== null && s.p < line.tau) || s.crosscheck?.verdict === "unsupported"));
  return {
    supports, hold,
    info: {
      version: m.version, set: `${m.set.name} ${m.set.version}`, mode: opts.mode, alpha, tau: line?.tau ?? null, nli,
      footer: opts.mode === "strict" ? strictFooter(m, alpha) : `Each claim shows its calibrated support (verifier ${m.version}, calibration set ${m.set.name} ${m.set.version}).`,
      held: hold.filter(Boolean).length, ...(checked ? { crosscheck: checked.model } : {}),
      ...(opts.memo ? { note: "Memo paragraphs are scored by the verifier calibrated on answer claims, so their dots are indicative." } : {}),
    },
  };
}
