# Claims audit
Reviewer: fresh same-family subagent (provisional). Trace: traces/claims/round1_response.md. Every number re-run by the auditor reproduced exactly.
The executor mechanically matched each R1/R2 probe number against runs/*.json before the audit; all were found. After the audit, R7 was re-run with the bad count rounded up (runs/certification-n.txt).

| Claim | Supported | Confidence | Evidence files | Revision applied | Trace |
|---|---|---|---|---|---|
| R1 Edge checker reused as-is leaks wrong figures | partial | high | runs/probe-verify-v2.json, runs/probe-verify-{pool,entity,entity_direct}.json | Scoped to "in a synthetic probe"; wrong-field 98.7% labelled as true by design; leak attributed mainly to pairwise derivations, not payload size | traces/claims/round1_response.md |
| R2 Post-hoc matching can't catch wrong-field; typing and entity scope help | partial | high | runs/probe-verify-v2.json, traces/claims/audit-v2-identical.ts | "Cannot" restated as a conditional; the gain attributed mostly to switching off derivations, with its untested cost; ~1.6% real perturb residual; wrong-period tested with one swap; field_bound true by construction | same |
| R3 Four verifier bugs | yes | high | runs/verifier-bugs.txt | Bug directions added; bug 2 documented as intended | same |
| R4 Liabilities in shipped code | yes (with corrections) | high | src file:line citations | send.ts:94; "CRM send path"; opt-outs honoured; auth liability stated | same |
| R5 Market position | partial | medium | research/market.md | All enterprise prices marked [UNVERIFIED]; in-between estimates restored; "gap in published prices" wording | same |
| R6 Novelty | partial | high | traces/novelty/round1_response.md | Qualifiers restored (product-only HIGH on ~4 searches; email-agent products unchecked; MEDIUM only if fully reproducible; Kepler wording as the file's paraphrase) | same |
| R7 Certification n | partial → corrected | high | code/certification-n.py, runs/certification-n.txt | Rounding fixed: 29 / 61 / 116 at α=10%, δ=5%; 59 / 361 / never at 5%/5%; single-look lower bounds; α and δ defined | same |

Integrity audit (Stage 8) was not run as a separate pass. No product experiment was implemented. The pilot code was read by the plan reviewer in two rounds and by the claims auditor, who re-ran it.
