# Reviewer memory (plan review)

## Round 1 (traces/plan/round1_response.md), verbatim top-5 required changes as relayed by the reviewer
1. Ground B2/K2 in real errors: add wrong-field/period, scale, filing-text error types and report recall per type; UI claims only "matches a number in the cited source"; precision is base-rate dependent (85% likely unreachable), so set thresholds after a real-answer audit.
2. Make B2's typing and binding real: USD only against USD fields at declared scale; fix year-masking and "1.2B"; bind by tool result + company, not addSource id; give calc a citable id; v1 = chat answers citing structured data; filing-text figures "cited, not checked".
3. Fix B1/K1 ground truth: company.ts is the agent's own tool path (measures relay, not correctness); hand-check a slice against filings; pin to period (getCompanyData has no as-of); replace the unfalsifiable "tools withheld" floor with run-to-run stability and the routed small-model gap; add a raw frontier model + free EDGAR MCP baseline.
4. Make B3's day-1 check decisive: week 1; report unchanged rate and discard rate per stratum; edit >5% = bad; discards aren't labels; fix α, δ, n in advance (~22 at 0% bad, 65 at 3%, 140 at 5%); falsifier = false-certification rate; state whether decayed counts are used.
5. Right-size M0: K0 internal gate, not a public claim; separate switch for the Nasdaq scrape (MARKET_BACKUP also kills CoinGecko backup and the earnings calendar); meeting consent = mandatory notice + host attestation; PatentsView to backlog; 2–3 weeks with landing copy and fail-closed gate on day 1.
Citation errors: `scripts/test-crm*.ts` doesn't exist (use scripts/test-learning.ts); calc can't reference a source value and issues no id.
Most informative first step: audit 30–50 real chat answers figure by figure (natural error rate and mix).

## Round 2 (traces/plan/round2_response.md) — Score 7/10, almost
Fixed genuinely: B0 audit first; B1 hand-checked + accession/period XBRL slice (bypasses getCompanyData); period pinning; frontier+free-EDGAR-MCP baseline as K1 falsifier; filing text "cited, not checked"; 4 numbers.ts bugs listed (P1-bugs reproduced); bind by tool result+entity; calc citable id; K0→G0; Nasdaq split switch; meeting notice+attestation; PatentsView backlog; test-autopilot.ts exists.
Open / suspicions to re-check in round 3:
1. field_bound (probe-verify-v2.ts:69, field = oracle k.field) catches wrong_field by construction. Real id-citation moves wrong-field into id choice → accepted ~100%. Plan presents 0.031 as evidence for prevention and K2 says "field it states". Need: admit it, K2 → "field it cites", inject wrong-id errors, show field+period in citation chip, B2 emphasis contingent on B0 mix.
2. B3-0 quotes my n (22/65/140, computed at α=δ=10%) as if at α=δ=5%. At 5%/5%: 58 / 613 / never. At α=10%, δ=5%: 28/82/179. Go also needs observed bad rate < α.
3. K2 thresholds set after B0 then tested on B0 (tunable; ~10–20 natural errors total). Thresholds on injected errors pre-build; natural check on fresh answers.
4. Weeks 1–3 overcommitted (M0 + B1 + B0 + B3-0); B2 scope grew (registry, id citations in streamed prose, renderer, calc refs, bug fixes, fallback). No cut line.
5. Minor: K1(a) mixes metric and validity (use test-retest ± binomial noise); K3 bound excludes discards (unstated); known-p simulation dropped; min stratum count; wrong_scale 0.526 hides ÷1000 direction ≈100%; B2 table true-accept column blank for 2 rows (by-construction anyway); entity_typed scale result comes from "$… million" serialiser, not a fix; K4 clock still "after listing".
Watch for: convenient omissions in tables; numbers attributed to the reviewer; results that hold by construction.
