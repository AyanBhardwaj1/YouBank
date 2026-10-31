# Reviewer memory (plan review)

## Round 1 (traces/plan/round1_response.md), verbatim top-5 required changes as relayed by the reviewer
1. Ground B2/K2 in real errors: add wrong-field/period, scale, filing-text error types and report recall per type; UI claims only "matches a number in the cited source"; precision is base-rate dependent (85% likely unreachable), so set thresholds after a real-answer audit.
2. Make B2's typing and binding real: USD only against USD fields at declared scale; fix year-masking and "1.2B"; bind by tool result + company, not addSource id; give calc a citable id; v1 = chat answers citing structured data; filing-text figures "cited, not checked".
3. Fix B1/K1 ground truth: company.ts is the agent's own tool path (measures relay, not correctness); hand-check a slice against filings; pin to period (getCompanyData has no as-of); replace the unfalsifiable "tools withheld" floor with run-to-run stability and the routed small-model gap; add a raw frontier model + free EDGAR MCP baseline.
4. Make B3's day-1 check decisive: week 1; report unchanged rate and discard rate per stratum; edit >5% = bad; discards aren't labels; fix α, δ, n in advance (~22 at 0% bad, 65 at 3%, 140 at 5%); falsifier = false-certification rate; state whether decayed counts are used.
5. Right-size M0: K0 internal gate, not a public claim; separate switch for the Nasdaq scrape (MARKET_BACKUP also kills CoinGecko backup and the earnings calendar); meeting consent = mandatory notice + host attestation; PatentsView to backlog; 2–3 weeks with landing copy and fail-closed gate on day 1.
Citation errors: `scripts/test-crm*.ts` doesn't exist (use scripts/test-learning.ts); calc can't reference a source value and issues no id.
Most informative first step: audit 30–50 real chat answers figure by figure (natural error rate and mix).
