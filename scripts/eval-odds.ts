/**
 * The Deal Radar's out-of-time scorecard (E4, docs/edge-next.md): for each horizon and role this round
 * builds (the 12-month target model), the latest model's record against the base rate and a Palepu-style
 * logit, with bootstrap 90% intervals, top-1% lift and the reliability bins, and its track record so far
 * in the forecast ledger.
 *   DATABASE_URL=<test branch> pnpm exec tsx scripts/eval-odds.ts             the stored model's scorecard
 *   DATABASE_URL=... R2_...=... pnpm exec tsx scripts/eval-odds.ts --retrain  retrain the TypeScript model on the latest panel and print its scorecard
 */
export {};

async function main() {
  if (!process.env.DATABASE_URL) { console.log("Needs DATABASE_URL (the test branch): the scorecard is stored with each model version."); return; }
  const { currentModel, getPipeline, loadPanel } = await import("@/lib/edge/odds/train");
  const { trainTs } = await import("@/lib/edge/odds/model");
  const { trackRecord } = await import("@/lib/edge/forecasts/ledger");
  const pct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : `${(v * 100).toFixed(1)}%`);
  const m = await currentModel();
  if (!m) console.log("No ready Deal Radar model yet. Start a run from Edge, Deal Radar (administrators) or POST /api/edge/odds/admin.");
  else {
    const sc = m.metrics.scorecard;
    console.log(`Deal Radar ${m.version} (${m.engine}), trained ${m.trainedAt.toISOString().slice(0, 10)}, horizon 12 months, role: target`);
    console.log(sc?.text ?? "No scorecard stored.");
    if (sc) {
      console.log(`  AUROC ${sc.model.auroc.value?.toFixed(3)}  PR-AUC ${sc.model.prAuc.value?.toFixed(3)}  Brier ${sc.model.brier.value?.toFixed(4)}  skill ${pct(sc.model.skill.value)}  top-1% ${pct(sc.model.lift.rate)} vs ${pct(sc.model.lift.base)}`);
      console.log(`  Palepu-style logit AUROC ${sc.palepu.auroc.value?.toFixed(3)}; beats it: ${sc.beats.palepu}; beats the base rate: ${sc.beats.base}`);
      for (const b of sc.bins) console.log(`  stated ${pct(b.lo)}-${pct(b.hi)}: n ${b.n}, said ${pct(b.meanP)}, happened ${pct(b.rate)} (${pct(b.low)}-${pct(b.high)})`);
    }
    if (m.metrics.calibration) console.log(`Calibration: ${m.metrics.calibration.n} company-months from ${m.metrics.calibration.year} (${m.metrics.calibration.positives} sales).`);
  }
  if (process.argv.includes("--retrain")) {
    const p = await getPipeline();
    if (!p.panelKey) console.log("No panel built yet.");
    else {
      const rows = await loadPanel(p.panelKey);
      const t = trainTs(rows, "eval");
      console.log("error" in t ? t.error : `Retrained (TypeScript logit) on ${rows.length} rows: ${t.scorecard.text}`);
    }
  }
  const track = await trackRecord("deal_target");
  for (const panel of track) console.log(`Track record (${panel.model}): ${panel.verdict} ${panel.pending} still open.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
