# Review loop (plan review; difficulty: hard; reviewer route: same-family subagent, provisional)

## Round 1: score 5/10, verdict almost
Trace: traces/plan/round1_response.md
### Weaknesses (reviewer's ranking)
1. K2 rests on a synthetic ±3–30% perturbation; real errors are wrong field/period, scale, and filing text.
2. B2 typing and binding are not real: verifier bugs (year masking, "1.2B", SIC collisions, 1000× scale tries), and `addSource` id issued before the payload and merged by URL.
3. B1 ground truth is computed by the agent's own tool path; no period pinning; unfalsifiable "tools withheld" floor; missing frontier + free EDGAR MCP baseline.
4. B3 day-1 check not decisive: no pre-registered α/δ/n, no unchanged/discard rates.
5. M0 mis-sized: K0 as a public claim, MARKET_BACKUP coupling, infeasible per-participant consent, PatentsView priority.
### Debate
None. All five were conceded after the executor reproduced the verifier bugs and the MARKET_BACKUP coupling.
### Actions taken
- New probe `code/probe-verify-v2.ts` with realistic error types → `runs/probe-verify-v2.json`. Post-hoc matching accepts wrong-field errors 100% of the time; field binding catches them (0.031 accepted).
- Plan rewritten as revision 2:
  - B0 real-answer audit and B3-0 label check moved to week 1;
  - B2 redesigned as field-bound figures, with detection as a fallback labelled "matches a number in the cited source";
  - B1 ground truth independent of `getCompanyData`, period-pinned, with a frontier + free EDGAR MCP baseline;
  - B3 pre-registers α, δ and n;
  - M0 becomes an internal gate with day-1 items and a separate Nasdaq switch.
### Status: continuing (round 2 sent to the same reviewer with REVIEWER_MEMORY.md)

## Round 2: score 7/10, verdict almost
Trace: traces/plan/round2_response.md (reviewer memory appended to REVIEWER_MEMORY.md by the reviewer)
### Weaknesses (reviewer's ranking)
1. field_bound's 0.031 is true by construction (the probe passes the right field); in the real design the model picks the id, so wrong-field errors pass binding.
2. B3-0 label counts were quoted at the wrong α/δ.
3. K2 thresholds set and tested on B0 (tunable falsifier; ~10–20 natural errors).
4. Weeks 1–5 overcommitted, no cut line.
5. Small items: K1 falsifier, K3 discard exclusion, known-bad-rate simulation, minimum strata, scale-direction asymmetry, true-accept column, typed-payload attribution, K4 clock start.
### Stop check
Score 7 ≥ 6 and verdict "almost" → **stopped (success)** per the loop's rule. This decision came from the reviewer's output.
### Actions taken after the stop (corrections; not re-reviewed)
All five accepted and applied to EXPERIMENT_PLAN.md:
1. K2 reworded to "shown from the source value, with the field and period it cites", explicitly not "correct". B2 says plainly that field_bound is true by construction, adds the field/period chip, and validates with injected wrong-id citations.
2. α = 10%, δ = 5%. Exact one-sided binomial counts were computed by the executor (n = 29 / 29 / 76 at 0 / 3 / 5% observed bad; 59 / 260 / never at 5%/5%); the reviewer's round-1 numbers are attributed to α = δ = 10% by its own method. Go needs at least 3 strata across at least 5 users.
3. K2 thresholds pre-registered on injected errors; B0 used only for base rate and mix, with CIs; natural errors on fresh answers.
4. Cut line added: drop B4 first, then B3's second action type; B2 on chat comes first; ship the fallback matcher before rendering from the store.
5. K1 falsifier is run-to-run within binomial noise; K3 excludes discards; known-bad-rate simulation restored; true-accept column filled; typed-payload attribution and scale asymmetry stated (the asymmetry figure is the reviewer's, not re-run); K4 clock starts at the first public install path.

## Method description
The method is research-to-plan, not an ML paper:
1. Six parallel research tracks and a read-only codebase audit produced 38 candidate moves.
2. A fresh reviewer triaged them, and a second fresh reviewer checked novelty against shipped products.
3. Cheap pilots tested feasibility. The key pilot, P1, measured how a deterministic number checker behaves on chat-style tool payloads under realistic error types (synthetic_proxy, seeded, `code/probe-verify*.ts`).
4. The plan is claim-first: every product claim YouBank wants to make has a falsifier, and two reviewer rounds (hard mode, with memory) tightened it until the reviewer's stop condition was met.
