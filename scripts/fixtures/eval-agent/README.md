# Finance eval set and real-answer audit

These implement B0 and B1 in `sleep-research/EXPERIMENT_PLAN.md`.

| File | What it is |
|---|---|
| `xbrl-<date>.json` | The machine slice: each company's latest 10-K figures, read from SEC XBRL company facts and pinned to the period and accession. Build it with `scripts/eval-agent-build.mts` |
| `hand-checked.json` | The hand slice: figures a person read from the named filing. Empty until someone fills it in |
| `audit-questions.json` | 40 typical analyst questions for the B0 audit. They have no expected figures; a person labels every figure in the answers |
| `results/` | One JSON file per eval run (`scripts/eval-agent.mts`) |
| `audit/` | One answers file and one worksheet per audit run (`scripts/audit-answers.mts`) |

## Week 1: the B0 audit

1. `pnpm exec tsx --env-file=.env.local scripts/audit-answers.mts`
2. Open `audit/<stamp>.csv` and fill in, for each figure:
   - `correct` (y/n);
   - `error_type`: perturbed, wrong_field, wrong_period, scale, arithmetic, filing_text or other;
   - `origin`: payload, calc, derivation, filing_text or unknown.
3. `pnpm exec tsx scripts/audit-summary.mts audit/<stamp>.csv` reports:
   - the natural error rate;
   - the error mix, with 95% intervals;
   - how the figure check's status lined up with the labels.

## Every night: the B1 eval

1. `EDGAR_USER_AGENT="YourCo you@yourco.com" pnpm exec tsx --env-file=.env.local scripts/eval-agent-build.mts`, once a quarter. Commit the new set and keep the old ones.
2. `pnpm exec tsx --env-file=.env.local scripts/eval-agent.mts scripts/fixtures/eval-agent/xbrl-<date>.json --k 3` reports:
   - pass@1 with a 95% interval;
   - pass^3;
   - the share of figures from data that match their cited source;
   - whether the result moved more than binomial noise since the last run.
3. Add `--baseline` for the "free EDGAR connector" comparison. It gives the same model filing search and filing text only (`FILING_TEXT_ONLY`), with none of YouBank's structured tools.
4. `.github/workflows/eval-agent.yml` runs it nightly once the repository variable `EVAL_NIGHTLY` is `on` and the secrets are set.

Scoring is in `src/lib/ai/evals/score.ts`. An answer passes when it states every expected figure at the precision it wrote it. `scripts/test-evals.ts` tests the scoring.

An `/accuracy` page should come only after four weeks of stable nightly numbers, with each figure linked to its run file.
