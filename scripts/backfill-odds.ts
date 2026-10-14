/**
 * The Deal Radar's first build, run from a terminal (E4, docs/edge-next.md): the universe scan (under SEC's
 * ten requests a second, through the shared throttle), target events since 2012, the panel, training and a
 * first scoring, advancing the same resumable pipeline the monthly Inngest run uses. Safe to stop and start:
 * each step saves where it got to.
 *   DATABASE_URL=... R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=... EDGAR_USER_AGENT=... \
 *     pnpm exec tsx scripts/backfill-odds.ts [--universe all]
 * With EDGE_ML_URL and EDGE_ML_SECRET set, training runs as LightGBM on the ML service; otherwise the
 * TypeScript logistic model trains here.
 */
export {};

async function main() {
  if (process.argv.includes("--universe") && process.argv[process.argv.indexOf("--universe") + 1] === "all") process.env.EDGE_ODDS_UNIVERSE = "all";
  const { getPipeline, pipelineStep, setPipeline, startPipeline } = await import("@/lib/edge/odds/train");
  const { finalize, scoreSlice } = await import("@/lib/edge/odds/score");
  let p = await getPipeline();
  if (p.stage === "idle") p = await startPipeline();
  for (let i = 0; i < 500 && p.stage !== "score" && p.stage !== "idle"; i++) {
    const next = await pipelineStep(Date.now() + 240_000);
    console.log(`step ${i}: ${next.stage}${next.wait ? " (training on the ML service)" : ""}${next.lastError ? ` (${next.lastError})` : ""}`);
    if (next.wait) await new Promise((r) => setTimeout(r, 60_000));
    p = next;
  }
  if (p.stage !== "score") { console.log(`Stopped at ${p.stage}.`); return; }
  let cursor = 0, scored = 0;
  do { const r = await scoreSlice(cursor, Date.now() + 240_000); scored += r.scored; cursor = r.next; console.log(`scored ${scored}`); } while (cursor);
  console.log(`cards posted: ${(await finalize({ top: 200 })).length}`);
  await setPipeline({ ...p, stage: "idle", finishedAt: new Date().toISOString() });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
