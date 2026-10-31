# Experiment tracker

| Run | Block | Config | Eval type | Status | Output path | Wall-clock | Notes |
|---|---|---|---|---|---|---|---|
| P1-pool | Pilot for A1 | Edge `checkNumbers` as-is over all payloads in context; 300 trials × 7 figure kinds × {1,5,15} companies; seed 20261031 | synthetic_proxy | DONE | runs/probe-verify-pool.json | ~30 s | Baseline. Wrong figures (±3–30%) accepted 37–54% on average (max 71%); grows with payload size |
| P1-entity | Pilot for A1 | Only the cited entity's payload, derivations on | synthetic_proxy | DONE | runs/probe-verify-entity.json | ~30 s | False accept still ~36%: the derivation step is the main leak |
| P1-entity_direct | Pilot for A1 | Entity payload, direct matches only | synthetic_proxy | DONE | runs/probe-verify-entity_direct.json | ~30 s | False accept ~3–4%, but ratios stored as raw fractions are never accepted (true-accept min 0.000) |
| P1-entity_typed | Pilot for A1 | Entity payload, direct only, ratios serialised with units | synthetic_proxy | DONE | runs/probe-verify-entity_typed.json | ~30 s | True accept ≥ 0.953 (mean ~0.99), false accept mean ~0.05 (max 0.10, EV/revenue at 1dp rounding) |

Code: `code/probe-verify.ts` (run `pnpm exec tsx sleep-research/code/probe-verify.ts <mode>`).
Compute used: ~2 min CPU total, well within budget.
