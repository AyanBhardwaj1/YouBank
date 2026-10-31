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
