# Plan review, round 1: EXPERIMENT_PLAN.md

Reviewer: independent (staff engineer and fintech product lead). I did not write this plan. I read PROBLEM_ANCHOR.md,
EXPERIMENT_PLAN.md, EXPERIMENT_TRACKER.md, `code/probe-verify.ts`, all four `runs/probe-verify-*.json`, both prior
reviews, and the cited code under `src/`. I re-ran the probe with extra modes and error types from a scratch copy.
`src/` and the probe file were not changed.

**Bottom line.** The plan is well built. It names a claim for each block, gives each one a falsifier, and puts B3
behind a one-day go/no-go check. Those are the right instincts. Its weakest link is B2, which is the core of the
anchor's "numbers demonstrably right". The B2 redesign rests on a synthetic pilot that injects the one kind of error
a value matcher catches easily (a 3–30% relative perturbation). It never tests the errors LLMs actually make on
financial data: the wrong field, the wrong period, the wrong scale, or a number that happens to match one in a
filing. When I re-ran the probe with those errors, the "working" variant accepts most of them. K2's falsifier is
also built so that it will probably fire whatever the verifier's quality, because precision depends on the base
rate. K1's golden set is circular, and it rots at the next 10-Q. All of these can be fixed with edits to the plan
and about two days of real-answer labelling. None needs new components.

---

## 0. Citations checked (14)

| Plan citation | Verdict | What I saw |
|---|---|---|
| `Landing.tsx:110` "source link on every figure" | Correct | FAQ answer at :110, including "If a number is derived, the method is stated" |
| `Landing.tsx:168` "earns the right to send" | Correct | Hero copy at :168 |
| `crm/send.ts:95` only send path, no headers | Correct | `mailbox.send({to, subject, body, inReplyTo, references, providerThreadId})` at :94–95 |
| `autopilot-rules.ts:174` inbound list-unsubscribe only | Correct | `if (get("list-id") \|\| get("list-unsubscribe")) return true;` |
| `autopilot.ts:101` `.catch(() => null)` fails open | Correct | Exactly as stated |
| `meetings/pipeline.ts:68-76` host-only consent | Correct | `consent: { by: user.email, noticeCopied: !!…, auto: … }` |
| `auth/server.ts:51` | Correct | `plugins: [nextCookies()]`; `two-factor` is present in `node_modules/better-auth/dist/plugins` |
| `market/nasdaq.ts:34-35` defaults on | Correct, but the fix as written breaks other things | `backupEnabled()` also gates the CoinGecko backup (`market/free.ts:29`) and the earnings calendar (`news/calendar.ts:48`). Setting `MARKET_BACKUP=off` switches those off too. The Nasdaq scrape needs its own switch. |
| `patentsview.ts:25` | Correct | `search.patentsview.org`. The triage already noted it only runs with a key. |
| `tools.ts:42-61` `summarize()` emits raw fractions | Correct | `gross_margin: d.grossMargin` and so on are unrounded fractions (`metrics.ts:42`) |
| `tools.ts:238-246` "`calc` already supports variables" (A2) | Correct as written, **wrong as used** | `calc` takes literal numbers plus `name = expr` variables. It has no way to *reference a source value*, and it issues no source id an answer could cite. "The verifier re-runs that calc" therefore needs calc to return a citable id. Re-running proves only the arithmetic; the inputs still have to be matched to payloads. |
| `ToolCtx.addSource` as the place to record payloads (B2 part 1) | **Wrong design point** | `addSource(label, url)` runs *before* the payload exists (`tools.ts:44,48,85`), so it cannot record the payload. It also deduplicates by URL alone (`agent.ts:72`). Every FMP price source has the URL `https://financialmodelingprep.com/` (`tools.ts:38`), so all companies' price, market cap and EV share one `[Sx]`. Binding by source id therefore fails for valuation figures. |
| `engine-rules.ts:118-133`, `engine.ts:116,393` | Correct | Demotion-only e-process; Bayesian bound at 90% confidence, bad rate ≤ 10%, n ≥ 20 (`TRUST`, :45); `trustGate` blocks only probation; "trusted" only feeds suggestions |
| `studio/agent.ts:200-211`, `model.json` (468 template claims) | Correct | As stated |
| "existing `scripts/test-crm*.ts` style" (M0.2) | **Does not exist** | No `scripts/test-crm*`. The trust tests live in `scripts/test-learning.ts` and `scripts/e2e-engine.ts`. |

The triage table was accurate wherever I re-checked it.

---

## 1. Claims the planned work cannot support as written

**K0, "nothing … creates legal exposure we know about".** This cannot be supported and should not be a claim.
It depends on M0.7, which is counsel and owner decisions outside engineering (CASA for `gmail.readonly` takes
months). It is also unfalsifiable from the outside, and as public copy it is the AI-washing exposure M0.6 is trying
to remove. Keep the list as an internal launch gate ("M0 closed before charging"), not as a claim.

**K1, "we measure our answers' accuracy and reliability … every night".** Three problems.
- *Circular ground truth.* Golden set (a) is "computed by `src/lib/company.ts` itself". The agent's
  `get_company_financials` calls the same code (`getCompanyData`, `company.ts:132`). The harness therefore measures
  whether the agent relays its tool faithfully, not whether the number is right. A concept-chain bug in
  `resolveRevenue` or `ltmOf` would score 100%. "Demonstrably right" needs some ground truth that does not come from
  company.ts.
- *Nightly rot.* `getCompanyData(ticker)` takes no as-of date, so "LTM revenue" changes the day a company files its
  next 10-Q. Across 40 tickers, that happens almost weekly during earnings season. "Re-freeze quarterly" (Risks) is
  too slow. The nightly score will drop for reasons that have nothing to do with the model.
- *A falsifier that cannot fail.* "Can't tell the current model from one with tools withheld (gap < 10 pts)" will
  always pass, because a model with no tools cannot answer XBRL questions at all. It also tests nothing about
  "reliability" or "reproducible".

**K2, "every figure … is checked against the source it cites".** This is the most serious problem.
- *What it checks.* The verifier can establish "this number appears in the cited source". It cannot establish
  "this number is the figure the sentence names". The plan's UI and K2 wording should say the narrow thing, as the
  novelty review suggested (Vaquill-style scope).
- *Precision depends on the base rate, so the falsifier is unreachable by construction.* Precision of the
  "unverified" flag = e·r / (e·r + (1−e)·f), where e is the base error rate, r is recall and f is the false-flag
  rate. Take P1's best numbers (f ≈ 1%, r ≈ 95%) and a plausible natural error rate of e = 3%: precision is about
  75%, below 85%. At e = 2% and f = 2% it is about 48%. Two further effects push f up on real answers. Figures that
  are legitimately derived without `calc` are flagged by design under part 3. Values that are masked as years (§3)
  are flagged too. The plan also mixes injected errors into the same 200-figure set, which makes precision a
  function of how many errors were injected.
- *Recall of injected errors measures the wrong errors.* Recall on "injected wrong numbers" will look excellent if
  the injections are the P1 perturbations. On realistic error types it is poor (§3).
- *Filing text is outside what P1 showed.* Chat answers also cite `read_filing` and `search_filing` text, which is
  one source with hundreds of numbers. Entity binding does not shrink that pool. In my simulation (§3), direct-only
  matching accepts a wrong figure 19% / 47% / 71% of the time against 100 / 500 / 2,000 numbers in the text. The
  falsifier "verified rate rises with payload size" will fire on every filing-cited answer.

**K3, "acts on its own only after it has earned it … with a stated error bound".**
- *Volume is not the binding constraint; the bad rate is.* "Bad" means any edit over 5%, or any changed critical
  field (`engine-rules.ts:105-110`). If a stratum's true bad rate p is above α = 10%, it never certifies, at any
  volume. Even below α, an anytime-valid test needs roughly log(1/δ)/KL(p‖α) labels. At δ = 0.1 that is about 22
  labels at p = 0, about 65 at p = 3%, and about 140 at p = 5%, per stratum. The day-1 check must report the
  observed per-stratum unchanged rate alongside volume, and must state α, δ and the required n before the query is
  run.
- *Discards are excluded from labels.* `engine-rules.ts:101-103` says "Discards are not labels". A user who
  discards bad drafts rather than editing them makes the stratum look clean, and under autopilot those drafts would
  be sent. The bound covers only drafts that were sent. Either say that in the claim, or measure the discard rate
  per stratum in the same query and show it is small.
- *An ill-posed falsifier.* "The realised error rate … must stay ≤ α at every stopping time in replay" will be
  violated by chance at small n even under a valid procedure. The guarantee is probabilistic: P(certified while
  p > α) ≤ δ. Test it as a type-I rate, using (i) a simulation with known p, and (ii) replay checked on labels held
  out after certification.
- *Decay versus validity.* The 90-day half-life decay (`TRUST.halfLifeDays`) is not compatible with an
  anytime-valid e-process. Say which one certification uses.
- *"Median active autopilot user"* is noise if there are only a handful of active users. Put a minimum user count
  in the falsifier, or decide per stratum from rates.

**K4.** The claim is supportable, but the window is not under the engineer's control. "30 days after listing" can
fall entirely outside the 8 weeks, because directory review time is unknown. Start the clock at the first public
install path (a custom-connector URL plus attributed deep links), not at directory listing.

---

## 2. Baselines a skeptical buyer or investor will ask for

1. **The anchor's own competitor, the raw lab model, on the same golden set.** The anchor's thesis is that
   YouBank's numbers are more demonstrably right than what Claude or ChatGPT give. Run the same frontier model
   with only a free EDGAR MCP server, such as the hosted keyless `secedgar.caseyjhand.com/mcp` the novelty review
   found. Without this, K1 cannot answer "why not just use Claude?".
2. **Ground truth independent of company.ts.** Hand-check a slice of golden set (a) against the filing itself,
   using the accession numbers the plan already stores. For example, 40 tickers × 2 figures. This also measures
   company.ts's own error rate, which is part of "numbers right".
3. **The natural error rate of today's answers, broken down by error type**, before any verifier. This is needed
   to interpret K2's precision at all, and to know whether the verifier's flags will mostly be noise.
4. **B3: the current Bayesian rule and a fixed-threshold ladder** ("95% over 50", as MultiMail does) in the same
   replay as the anytime-valid rule. Report time-to-certify and false certifications for each. This shows what
   the stronger guarantee costs in user wait, which is the number that decides whether anyone ever earns autonomy.
5. *Optional:* one public set, such as the FinanceBench open subset or the Vals public 50, so that "Fintool says
   90%" has a comparable figure. Keep it small. It is a comparison, not a new harness.

---

## 3. Confounds, leakage and metrics, with a close look at P1

**What P1 does support, plainly.** The free pairwise-derivation step is the main leak. At one company, pool and
entity modes give identical results (as they should). Of the false accepts there, 146 of 167 for revenue, and all
of them for the pct and x figures, come through derivations. Thirty numbers generate thousands of candidate
derivations, and almost any figure lands near one. This finding is robust to everything below, and part 3 ("no
free pairwise derivations") is justified. The probe is also seeded and paired across modes, with the same
companies and the same perturbations, which is good practice.

**What P1 does not support:**

1. **The error model is the easiest possible one.** Wrong figures are `value × (1 ± U(3%, 30%))`. I re-ran the
   `entity_typed` variant with realistic error classes. Code: a scratch copy of `probe-verify.ts`, same seed.
   - *Wrong field or wrong period* from the same payload: prior-year revenue reported as LTM, OCF reported as FCF,
     operating margin reported as gross margin, market cap reported as EV. The mean false accept is **94%**. For
     most kinds it is 97–100%, and for EV/revenue (written as P/E) it is about 62%. Value-only matching cannot
     see these errors.
   - *1000× scale error* ("$1.2 million" for $1.2 billion): **99–100% accepted** on every USD figure.
     `sameNumber` tries the scales [1, 1e3, 1e6] when the payload number has no unit (`numbers.ts:66`), so a
     payload in USD millions matches a claim written in thousands or millions alike. A scale slip is a classic
     LLM error on XBRL.
   - *Coincidence in filing text:* 19–71% (see K2 above).

   The headline "wrong ones ~5%" is real only for the injected class. Recall must be reported per error class,
   and the plan should state which classes B2 does not catch.
2. **"Typed" is not an unfair baseline, but its true-accept rate is partly by construction.** The answer writer
   (`pct()` and `x()`, probe :62–63) and the typed serialiser (`P()` and `X()`, :47–48) both use `toFixed(1)`, so
   pct and x true-accept is exactly 1.000. The pct false-accept rate of about 0 also follows from applying a
   relative perturbation to values of 30–85%: the smallest shift is about one point, far outside the ±0.05
   tolerance. Real answers write "67%", "67.25%", or a margin the payload does not contain.
3. **Entity binding was only tested on single-entity payloads.** The plan's ablations never combined pool with
   typed, direct-only matching. I ran that combination. False accepts go **4.6% → 11.0% → 18.2%** at 1 / 5 / 15
   companies, against roughly 5% flat for entity binding. So binding (part 1) does matter for multi-company
   payloads. But as noted in §0, it cannot be keyed on today's source ids: FMP sources collapse into one id, and
   `get_trading_comps`'s `peer_median` belongs to no row. In entity modes the payload is fixed at 30 numbers, so
   the "does not rise with payload size" check is trivially true there and tests nothing.
4. **A real verifier bug, never diagnosed: payload values from 1900 to 2099 are masked as years.** The masker
   regex `\b(?:19|20)\d{2}(?!…million|billion…)` (`numbers.ts:26`) blanks `"revenue":1987.3` down to `3`. I
   confirmed that `$1987 million` and `$2.0 billion` both fail against that payload. This is why USD true-accept in
   P1 is 0.973–0.987 instead of 1, and the tracker never explained the gap. It affects about 2% of USD-millions
   values on real data, and every one of them becomes a false "unverified" flag.
5. **Formatted comps money never verifies.** `get_trading_comps` already serialises `ltm_revenue` with
   `fmtMoney` as `"1.2B"` (`metrics.ts:75`). With no `$`, a single-letter suffix is kept as the count 1.2
   (`numbers.ts:40-41`). I confirmed that both "$1.2 billion" and "$1,200 million" fail against it. Comps is
   probably the most-used chat tool.
6. **Distractor numbers are missing from the synthetic payload.** The real `summarize()` payload also carries the
   SIC code, `fye`, a 600-character description, `quarterly_revenue` strings, `rule_of_40` and more multiples. I
   confirmed that SIC "7372" verifies a false "$7.4 billion" (as 7,372 × 1e6). Typing should mean that the
   verifier matches a USD claim only against USD fields, at the payload's declared scale (`_usd_mm`). That is
   B2 part 2 done fully, not a new component. It also removes the 1000× hole and the SIC coincidence.
7. **Statistics are adequate.** One seed with n = 300 per cell gives ±2.5 points around 5%, and the "max 0.10"
   is the largest of 21 cells, so it is mostly noise. That is acceptable for a pilot. It does not need more seeds;
   it needs the real error classes.

**Changing the payload is a model-input change.** Serialising "67.3%" in `summarize()` changes what the model reads
on every surface. Re-run B1 before and after that change.

---

## 4. Sequencing for one engineer over about 8 weeks

- **M0 is two to three weeks of work, not one to one and a half.** It contains an RFC 8058 one-click POST endpoint
  with opt-out storage, DMARC pre-checks, a redesign of meeting consent, 2FA enforced on three flows, and an
  analytics view. Opt-out honouring already exists (`send.ts:62-65`), which removes one piece.
- **Mis-prioritised.**
  - *PatentsView (M0.9)* is hygiene unrelated to the anchor and runs only with a key. Move it to the backlog.
  - *Nasdaq (M0.5)* needs its own switch (§0), not `MARKET_BACKUP=off`.
  - *Meeting consent (M0.3).* "Consent stored per participant" and "recording stops when someone objects" have no
    mechanism in desktop capture, because participants never touch YouBank. A buildable version: make the notice
    mandatory instead of optional, let auto-start no longer skip it, store the host's attestation and the
    attendee list, and settle the two-party-consent question with counsel.
- **Missing from week 1.**
  - *The B3 label query.* Move it from M3 to day 1, extended with the unchanged rate and the discard rate. It is a
    single query, and it decides whether weeks 5–7 exist.
  - *The landing copy change (M0.6).* Do it on day 1, because it is the cheapest legal fix.
  - *Golden-set construction* can start in week 1 alongside M0. It is data work an agent can do.
- **Cut B2's surfaces to chat, with structured payloads only, for this window.** Treat figures that cite filing
  text as "cited, not checked" until there is evidence that a check works there. Workflows, memos and Studio
  tie-out cannot fit in two weeks together with payload plumbing, units, citable calc and 200 labels.
- **Even if B3's volume check fails**, keep step 2 (auto-send requires a certificate). It is small, and it is what
  makes `Landing.tsx:168` true. Otherwise M0.6 must reword that line permanently.
- *A missing line:* nightly cost. Take k = 3 over the whole set on a frontier model. Estimate it and choose nightly
  versus weekly before committing to "every night".

---

## 5. The single most informative thing to do first

**Audit 30–50 real chat answers on golden-set questions, figure by figure.** Run them in the owner's environment
and log the raw tool payloads. Label every figure on four things:
- correct or wrong;
- the error type (perturbation, wrong field or period, scale, wrong entity, fabricated);
- where it came from (a literal payload value, a `calc` output, a free derivation, or filing text);
- whether direct, field-typed matching would accept it.

That is about 300–500 figures and one to two days of work. It gives, all at once:
- the natural error rate and error mix that K2's metric needs;
- the share of figures that part 3 would flag (the unverified rate users would see);
- the share of figures citing filing text;
- whether the K2 thresholds are reachable at all.

It also exercises the B1 questions. If wrong-field errors dominate, B2 should lean on `calc` with references
(prevention) rather than post-hoc matching, and the plan should know that before week 3, not after.

---

## Required changes (in priority order)

1. **Re-ground B2/K2 on real errors.** Add wrong-field/period, scale and filing-text classes to the P1 probe.
   Report recall per class. Say what the check cannot catch ("matches a number in the cited source"). Split the
   metrics: false-flag rate and precision on natural figures only, and recall on injected plus natural errors by
   class. Set the thresholds after the real-answer audit, not before.
2. **Specify B2's typing and binding so they actually work.**
   - Match USD claims only against USD fields, at the declared scale.
   - Fix the year-masking of 1900–2099 values and the `"1.2B"` parse for payload numbers.
   - Bind figures by tool result and entity, not by `addSource` id: ids are minted before payloads exist and
     deduplicate on URL.
   - Give `calc` a citable id.
   - Scope v1 to structured payloads on chat.
3. **Fix B1/K1 ground truth.**
   - Pin questions to a period, so a new 10-Q does not change the answer.
   - Hand-check a slice against filings, independently of company.ts.
   - Replace the tools-withheld falsifier with test–retest stability plus the routed-small-model gap.
   - Add the raw-frontier-model-plus-free-EDGAR-MCP baseline.
4. **Make B3's day-1 check decisive.** Move it to week 1. Report the per-stratum unchanged rate and discard rate
   together with volume. Fix α and δ and the required n in advance. Restate the replay falsifier as a type-I rate
   (simulation with known p, plus a held-out replay). State whether certification uses decayed counts.
5. **Right-size M0.**
   - Drop K0 as a claim and keep it as a launch gate.
   - Give Nasdaq its own off switch.
   - Make meeting consent a mandatory notice plus host attestation.
   - Move PatentsView to the backlog.
   - Point the M0.2 test at `scripts/test-learning.ts`.
   - Budget two to three weeks, with the landing copy and the fail-closed gate on day 1.

Score: 5/10
Verdict: almost
