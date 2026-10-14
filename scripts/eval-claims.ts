/**
 * Calibrated Claims' evaluation (E2): fits the combiner on the fit half of the calibration fixture, picks
 * Strict's lines, and reports on the held-out half the AUROC of support, the expected calibration error,
 * and the unsupported rate achieved above the 2%, 5% and 10% lines with 90% intervals.
 *
 *   pnpm exec tsx scripts/eval-claims.ts            print the report
 *   pnpm exec tsx scripts/eval-claims.ts --write    also write src/lib/edge/claims/model.json (the shipped combiner)
 *   pnpm exec tsx scripts/eval-claims.ts --nli      score each claim-passage pair with the deployed docs.verify
 *                                                   (needs EDGE_ML_URL and EDGE_ML_SECRET) and fit with NLI
 *
 * No network without --nli; no database.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fitCombiner, strictFooter, type Labelled } from "../src/lib/edge/claims/combine";
import { claimFeatures, FEATURES, type CitedPassage, type FeatureName } from "../src/lib/edge/claims/features";
import { mlRun } from "../src/lib/edge/infra/ml";

type Row = { id: string; claim: string; analysis: boolean; scope: { name: string; ticker: string }[]; cites: CitedPassage[]; supported: number; split: "fit" | "held"; set: string; version: string };

export function loadFixture(): Row[] {
  return readFileSync(path.join(__dirname, "fixtures", "claims.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const rows = loadFixture();
  if (args.has("--nli")) {
    const pairs = rows.flatMap((r) => r.cites.map((c) => ({ premise: `${c.header}\n${c.text}`, hypothesis: r.claim })));
    const out: number[] = [];
    for (let i = 0; i < pairs.length; i += 64) out.push(...((await mlRun<{ entail: number[] }>("docs.verify", { pairs: pairs.slice(i, i + 64) })).entail));
    let k = 0;
    for (const r of rows) for (const c of r.cites) c.nli = out[k++];
  }
  const features: FeatureName[] = FEATURES.filter((f) => f !== "nli" || args.has("--nli"));
  const labelled: Labelled[] = rows.map((r) => ({ features: claimFeatures({ text: r.claim, analysis: r.analysis, cites: r.cites }, r.scope).features, supported: r.supported, split: r.split }));
  const set = { name: rows[0]?.set ?? "template", version: rows[0]?.version ?? "v1", claims: rows.length, supported: rows.filter((r) => r.supported).length, fittedAt: new Date().toISOString(), note: "Template-generated claims with invented companies (scripts/gen-claims-fixture.ts); to be replaced by labelled claims from real answers." };
  const model = fitCombiner(labelled, features, set, `claims-${set.version}${args.has("--nli") ? "-nli" : ""}`);
  console.log(`Calibration set ${set.name} ${set.version}: ${set.claims} claims, ${set.supported} supported; features ${features.join(", ")}`);
  console.log(`Held-out: ${model.quality.heldOut} claims · AUROC ${model.quality.auroc.toFixed(3)} · ECE ${(model.quality.ece * 100).toFixed(1)}%`);
  for (const l of model.lines) {
    const h = l.heldOut;
    console.log(`  alpha ${(l.alpha * 100).toFixed(0)}%: line ${l.tau === null ? "none (too few claims)" : l.tau.toFixed(3)} · held-out above it ${h.n} claims, ${h.unsupported} unsupported (${Number.isFinite(h.rate) ? (h.rate * 100).toFixed(1) : "-"}%${h.ci ? `, 90% CI ${(h.ci[0] * 100).toFixed(1)}-${(h.ci[1] * 100).toFixed(1)}%` : ""})`);
  }
  console.log(`Footer at 5%: ${strictFooter(model, 0.05)}`);
  console.log(`Weights: ${model.logistic.features.map((f, i) => `${f} ${(model.logistic.w[i]).toFixed(2)}`).join(", ")}`);
  if (args.has("--write")) {
    writeFileSync(path.join(__dirname, "..", "src", "lib", "edge", "claims", "model.json"), JSON.stringify(model, null, 1) + "\n");
    console.log("Wrote src/lib/edge/claims/model.json");
  }
}

if (process.argv[1]?.endsWith("eval-claims.ts")) main().catch((e) => { console.error(e); process.exit(1); });
