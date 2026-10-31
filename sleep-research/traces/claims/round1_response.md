# Claims audit, round 1: NARRATIVE_REPORT.md R1–R7

Auditor: independent (did not do the work). Date: 2026-10-31.

**What I re-ran.** From /home/user/YouBank:
- `code/verifier-bugs.ts`, `code/probe-verify-v2.ts` and `code/certification-n.py`. All three outputs are byte-identical to `runs/verifier-bugs.txt`, `runs/probe-verify-v2.json` and `runs/certification-n.txt`.
- I recomputed the v1 means from `runs/probe-verify-*.json` (pool: 0.369 / 0.521 / 0.543). They match.
- I added one script, `traces/claims/audit-v2-identical.ts`. It is the v2 probe unchanged (same seed, same RNG order, every rate reproduces) plus a counter for "wrong" figures whose sentence comes out identical to the true sentence.

**What I read.** Every file:line in R4, `src/lib/edge/claims/numbers.ts`, `src/lib/ai/tools.ts` `summarize()`, `research/market.md`, `traces/novelty/round1_response.md`, `EXPERIMENT_PLAN.md` §B2/§B3, and the triage and plan traces.

**Scope.** R1 and R2 rest on one seed of a synthetic_proxy. That is 300 random company draws giving 2100 / 1800 / 1200 sentences per cell, not independent real answers. The report says so for R1. R2's "cannot" and "fix" and R1's "many" need the same qualifier.

---

## R1. "Reusing Edge's number checker as-is on chat answers would pass many wrong figures."

- **claim_supported:** partial (the mechanism is shown; the rates are synthetic).
- **What the results support:**
  - Every number reproduces: perturb 0.523, wrong_field 0.987, wrong_scale 0.526, true accept 0.990, and v1 0.369 → 0.521 → 0.543.
  - The probe's payload is a fair subset of the real `get_company_financials` shape (`src/lib/ai/tools.ts:49-60`: USD mm as bare numbers, ratios as fractions). The real payload carries more numbers (`sic`, a 600-char description, quarterly revenue strings, filing dates), so the pool leak is unlikely to be smaller in practice.
  - The verdict comes from deterministic code, so "the checker as-is accepts a large share of near-miss figures" is well supported as a mechanism.
- **What the results don't support:**
  - The 52.3% depends on the arbitrary uniform ±3–30% perturbation. It is not a rate for real chat errors, and the report's own Limitations section says so. The headline sentence should carry "in a synthetic probe".
  - The 98.7% wrong-field accept is not an empirical finding. It holds by construction: the wrong-field value is another field of the same company and is always in the payload, so any value-only matcher accepts it. Presenting it next to the other two rates overstates what was measured.
  - "Rising with payload size": the rise is 1 → 5 companies (0.369 → 0.521). From 5 → 15 it is 0.521 → 0.543, about 2 SE on different draws. The bigger leak is the pairwise derivations: v1 `entity` mode, with one company and derivations on, is already 0.36 at every size. The report doesn't say that the derivation step is the main leak (the tracker does).
  - Minor: 45 of 2100 "perturbed" sentences print identically to the true sentence (for example, a small multiple ×1.03 rounds to the same "1.2x"). That has a negligible effect on 0.523.
- **Missing evidence:** real answers (B0), more than one seed, and the split of false accepts into direct vs derived for v2 (v1 has it).
- **Suggested revision:** "In a synthetic probe shaped like `get_company_financials` (one seed, 300 company draws), Edge's checker as-is accepted 52% of figures perturbed by 3–30% (5 companies in context), mostly through its pairwise derivations. It also accepted 53% of 1000× scale errors, and, by construction, any wrong-field figure whose value is in the payload."
- **confidence:** high.

## R2. "Post-hoc number matching cannot catch wrong-field or wrong-period errors. Typed, entity-scoped payloads fix perturbation and scale errors."

- **claim_supported:** partial.
- **What the results support:**
  - entity_typed reproduces as 1.000 / 0.037 / 0.008, and field_bound as 0.031.
  - The field_bound honesty note is accurate: the probe passes the correct field from its own answer key (`probe-verify-v2.ts:69`), and `EXPERIMENT_PLAN.md` §B2 says so.
- **What the results don't support:**
  - **"Cannot" is a logical point, not a measured one.** Value-only matching cannot separate two fields with the same value in the cited payload, and the probe's wrong-field values are always in the payload, so 1.000 is guaranteed. That is a fine argument, but the report presents it as a result. The scope also needs the condition "when the confused value is in the cited payload". "Wrong-period" was tested with exactly one swap (prior-year LTM revenue for LTM revenue).
  - **"Typed, entity-scoped" names two of the three changes.** entity_typed also turns derivations off (`found === checked`; `probe-verify-v2.ts:71`). The v1 evidence says derivations are the main leak: entity-scoped with derivations on stays at a false-accept rate of about 0.36, and turning derivations off brings it to about 0.03–0.04. Typing mainly restores true accepts for ratios (entity_direct has min true accept 0.000) and removes the count→usd scale tries that let 1000× errors through.
  - **The 1.000 true accept has a hidden cost.** With derivations off, any figure that is not stored verbatim in the payload is rejected. In the probe every claimed figure is a stored field, so this cost cannot appear. Real answers that compute a growth rate or a ratio would fail.
  - **"Fix" overstates a reduction to 3.7% / 0.8%.** The residual is also partly a scoring artifact: 45 of the 78 entity_typed perturb accepts, and 38 of the 56 field_bound wrong-field accepts, are sentences identical to the true sentence (`traces/claims/audit-v2-identical.ts`). The real residual false accept for entity_typed perturb is about 33/2055 ≈ 1.6%. That helps the claim's direction, but the grader should drop "wrong" figures that print the same as the truth.
- **Missing evidence:** a run with derivations on plus typing, to isolate the typing effect; a set of legitimately derived figures, to measure the true-accept cost of turning derivations off; more than one seed.
- **Suggested revision:** "By construction, matching values alone cannot catch a wrong-field or wrong-period figure whose value sits in the cited payload (probe: 100% accepted). In the synthetic probe, checking only the cited company's payload, with typed money and ratios and without pairwise derivations, cut false accepts from 52% to about 4% for ±3–30% errors (about 2% after removing wrong figures that print identically to the truth) and from 53% to 1% for 1000× errors. This assumes every figure is stored in the payload; derived figures would then need calc-by-reference."
- **confidence:** high.

## R3. Four verifier bugs, reproduced.

- **claim_supported:** yes. All four reproduce, and the mechanisms are in the code.
- **What the results support:**
  - Year masking: `numbers.ts:26` blanks "1950" in "1950.3", leaving ".3". "$2.0 billion" and "$1,950 million" against 1950.3 both come back missing.
  - "1.2B": a bare single-letter scale without a currency stays a count (`numbers.ts:40-41`).
  - SIC "7372" backs "$7.4 billion": the count→usd scale tries at `numbers.ts:66` multiply 7372 by 1e6, which is within 5e7 of 7.4e9. This bug is real-world: the actual payload carries `sic: "7372 …"` (`src/lib/ai/tools.ts:50`).
  - The 1000× scale error comes from the same scale tries. It also accepts 1e6× errors.
- **What the results don't support:** nothing is overstated. Two clarifications would help a reader:
  - Bugs 1 and 2 cause false rejects (the safe direction), while bugs 3 and 4 cause false accepts.
  - Bug 2 is documented, intended behaviour (comment at `numbers.ts:41`). It is a design choice that hurts chat text, not an accident.
- **Missing evidence:** none for the claim as stated.
- **Suggested revision:** add "(1–2 cause false rejects, 3–4 false accepts; 2 is documented intended behaviour)".
- **confidence:** high.

## R4. Liabilities in the shipped code. Every file:line checked.

- **claim_supported:** yes, with two small corrections.
- **Verified:**
  - `autopilot.ts:101` reads `trustGate(...).catch(() => null)`. A null hold means auto-send proceeds, so the gate fails open. `trustGate` (`engine.ts:112-124`) does DB work that can throw.
  - `auth/server.ts:51` is `plugins: [nextCookies()]`. A grep finds no twoFactor, passkey or organization use in `src`.
  - `nasdaq.ts:35` defaults `MARKET_BACKUP` to on, and the same `backupEnabled()` gates `free.ts:29` (CoinGecko) and `news/calendar.ts:48` (earnings).
  - `model.json` says `"name": "template", "claims": 468`, "Template-generated claims with invented companies". The fixture has 468 rows, all `set: template`.
  - `Landing.tsx:110` says "the source link on every figure … if a number is derived, the method is stated", and `:168` says "earns the right to send on its own".
  - `autopilot-rules.ts:174` is the only List-Unsubscribe code, and it is inbound detection.
- **Corrections:**
  - `send.ts:95` is `} finally {`. The `mailbox.send(...)` call is at **`send.ts:94`** (an off-by-one inherited from the triage trace).
  - "The only send path" is too broad. `src/lib/news/deliver.ts:29` also sends mail, though only to the user's own address, so the point stands for mail to contacts. Say "the only CRM send path".
  - The report omits that opt-outs are honoured (`send.ts:63-65`). The gap is the header and footer, not opt-out handling.
- **What the results don't support:** "Auth uses only `nextCookies()`" states a fact but not why it is a liability. The research file's point (`research/platform.md:273-274`) is that there is no 2FA, passkeys, organizations, SSO or SCIM.
- **Suggested revision:** fix the line to `send.ts:94`, say "the only CRM send path (opt-outs are honoured; no List-Unsubscribe header or footer)", and write "Auth has no 2FA, passkeys, orgs or SSO; Better Auth runs with only `nextCookies()` (`server.ts:51`)".
- **confidence:** high. "Beyond what the code enforces" for `Landing.tsx:110` is medium: I confirmed that sources are attached per tool payload (`ctx.addSource`), not per figure, but I did not audit every chat rendering path.

## R5. Market position.

- **claim_supported:** partial.
- **What the results support:** `research/market.md` states each event as reported: Anthropic's 10 finance agent templates on 5 May 2026 (line 16), ChatGPT for Financial Services on 10 Sept 2026 (line 17), and FactSet, LSEG, PitchBook, Daloopa and S&P on MCP (lines 20-22, 68-77). The "very little between ~$300/month and ~$10K/seat/year" line is the file's own conclusion (line 39).
- **What the results don't support:**
  - "Several prices are tagged [UNVERIFIED]" understates the hedging. **Every** price in the ~$10K+ band is [UNVERIFIED] in market.md: Bloomberg about $32K, AlphaSense $10–30K, Grata, SourceScrub and Axial (lines 33-35, 133-137). One side of the "split" therefore rests entirely on unverified aggregator figures.
  - The top of the low band is contested: Koyfin's top tier is $299 per PricingSaaS and $359 per CostBench (line 75).
  - The file also lists a middle band, which the report drops: Rogo at about $3.3K/seat/year (a Sacra estimate) and Axial at $5K–15K [UNVERIFIED] (lines 132, 137).
  - All facts came from search snippets, since page fetches were blocked (line 5). The launch dates are not tagged [UNVERIFIED], but they are snippet-sourced.
- **Missing evidence:** a primary-source price for any enterprise seat, and the quote-only vendors (ChatGPT FS, Hebbia, Quartr), which are absent by definition.
- **Suggested revision:** "Published prices cluster at $0–~$360/month (prosumer) and ~$10K+/seat/year (enterprise; every figure in that band is [UNVERIFIED], from aggregators), with few published prices between (Rogo ~$3.3K est., Axial $5–15K [UNVERIFIED]); the enterprise AI offerings are quote-only."
- **confidence:** medium (checked against the research file, not against the web).

## R6. Novelty of the chosen bets.

- **claim_supported:** partial. The ratings match `traces/novelty/round1_response.md`, but the report drops its key qualifiers.
- **What the results support:** the ratings are LOW / LOW-or-MEDIUM / LOW / HIGH-as-product, and the "not found ≠ doesn't exist" caveat is kept. The details match the novelty file: Kepler as the closest prior for A1, no vendor reporting pass^k, a hosted keyless EDGAR MCP server, and arXiv 2605.20270 as the closest research.
- **What the results don't support:**
  - **Earned autonomy, HIGH.** The novelty file rates it "HIGH as a shipped product; **the method is published**", and says the novelty is "productisation, not method". It rests on **4 searches**, and Lindy, Fyxer, Superhuman and Agentforce were not checked. The file also attaches two caveats: the in-repo version is advisory and not anytime-valid, and low label volume may mean "a badge nobody earns". The report's "~20 searches" is the total across all four bets, which makes the HIGH look better searched than it was.
  - **Kepler.** "Every number validated" is the report's paraphrase. The novelty file says "every number verified and traceable", from search summaries only.
  - **Eval harness.** The novelty file gives MEDIUM only for an honest, reproducible public page: published golden set, harness, pass^k, nightly, combined with C7. "If published with pass^k" narrows that to one ingredient.
  - **Kept hedges.** The novelty file tags the absence of an official EDGAR app in either directory as [UNVERIFIED], since the directories were not opened. The report doesn't use that fact, which is fine.
- **Suggested revision:** "Earned autonomy: HIGH as a product only (the method is published, e.g. arXiv 2605.20270); based on 4 snippet-level searches that did not check Lindy, Fyxer, Superhuman or Agentforce." For the eval harness: "MEDIUM only as a reproducible public page (set, harness, pass^k, nightly)."
- **confidence:** high (a wording comparison against the file).

## R7. Certification sample sizes.

- **claim_supported:** partial. The arithmetic is right for the rule coded; the reading of the table is not.
- **What the results support:** the table matches `runs/certification-n.txt`, and I reproduced it. The 0% column is analytic: 0.9^29 ≤ 0.05 and 0.95^59 ≤ 0.05. "Never" at α = δ = 5% with a 5% observed rate is correct: an observed rate equal to α can never certify a bad rate below α.
- **What the results don't support:**
  - **The 3% column at α = 10% is the 0% number in disguise.** The script uses floor(rate·n) bad drafts, and floor(0.03·29) = 0, so "29 at 3%" means 29 drafts with zero bad. A stratum actually running at 3% bad that sees 1 bad in 34 fails: P(X ≤ 1 | n = 34, p = 0.1) = 0.133.
  - **The "smallest n" is not stable.** Under the same floor rule, certification holds for every larger n only from **n = 46** (3%) and **n = 103** (5%) at α = 10%, and from **n = 336** (3%) at α = 5%. Counting bad drafts with ceil gives 61, 116 and 361.
  - **These are one-look fixed-n tests, but the plan asks for something else.** `EXPERIMENT_PLAN.md` B3 (line 110) requires "an anytime-valid test". Re-checking a binomial test after every label inflates the error rate, and an anytime-valid certificate at a nonzero observed bad rate needs more labels than these numbers. The plan pre-registers both (line 25: exact binomial; line 110: anytime-valid), so the report should say which one the table is for.
  - α and δ are not defined in the report. They are the maximum certified bad rate and the test level.
- **Missing evidence:** n for the anytime-valid test actually planned, and n that holds for all larger sample sizes (or at the expected bad count).
- **Suggested revision:** "Fixed-n exact binomial (one look), α = max certified bad rate, δ = test level. At α = 10%, δ = 5%: 29 reviewed drafts with zero bad. A stratum with ~3% bad needs about 46–61, and ~5% bad about 103–116. At α = δ = 5%: 59 with zero bad, about 336–361 at 3%, never at 5%. The anytime-valid certificate in B3 will need more at nonzero bad rates."
- **confidence:** high.

---

## Report-level notes
- R1–R3 and R7 reproduce exactly. Nothing in `runs/` was misreported. The problems are interpretation and scope, not numbers.
- The two things most likely to mislead a reader:
  - R2 credits "typed, entity-scoped" for a gain that mostly comes from turning derivations off, which has an untested true-accept cost on derived figures.
  - R7's "29 at 3%" is really "29 with zero bad".
