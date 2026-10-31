# Plan review, round 2: EXPERIMENT_PLAN.md (revision 2)

Reviewer: the same independent reviewer as round 1. I read the revised plan, `code/probe-verify-v2.ts`,
`runs/probe-verify-v2.json` and the new tracker rows. I checked each change against the code and against my
round-1 memory. I did not use executor notes as evidence.

**Bottom line.** This is a real revision, not a cosmetic one. Most of the round-1 concerns are fixed in substance:
- B0 now runs before any building.
- B1 has ground truth that does not come from the agent's own code path, and a frontier-model-plus-free-EDGAR
  baseline.
- Filing text is scoped out of B2.
- The verifier bugs are listed for fixing.
- K0 is now an internal gate.
- M0 is right-sized.

What remains is narrower, but one problem sits at the centre of B2. The headline result of the v2 probe,
field-bound checking catching 97% of wrong-field errors, holds by construction. The plan presents it as evidence
for the design without saying so. A second problem is that B3's go/no-go uses label counts that are wrong for the
α and δ the plan now chooses.

---

## 1. Round-1 concerns: fixed or sidestepped

| Round-1 concern | Status | Evidence |
|---|---|---|
| Realistic error types, per-type recall | **Fixed** in the probe | v2 adds `wrong_field` and `wrong_scale`. The plan reports them per type, and the table shows openly that entity_typed accepts 100% of wrong-field errors. |
| Precision depends on the base rate; no fixed 85% target | **Fixed** | B2 step 5 |
| Thresholds set after the real-answer audit | **Half fixed** | They are now set after B0, but they are validated on the same B0 set (see §2, item 3) |
| UI says "matches a number in the cited source" | **Fixed for fallback figures**, **overclaimed for id-cited figures** | See §2, item 1 |
| Typing and binding by tool result and company, not `addSource` id; calc gets a citable id | **Fixed** | B2 steps 1–2 |
| Year-mask, "1.2B", SIC and 1000× bugs | **Fixed in the plan** | B2 step 3; tracker row P1-bugs reproduces all four. "SIC collisions" is not a bug in `numbers.ts` itself; typed field matching is what removes it. |
| Filing text marked "cited, not checked" | **Fixed** | K2 wording, B2 step 4 |
| Golden set circular through company.ts | **Fixed** | A hand-checked slice, plus a machine slice read by accession and period that bypasses `getCompanyData` |
| Period pinning | **Fixed** | "Every question names its period". The "re-freeze quarterly" risk line is now mostly moot. |
| The "tools withheld" floor could not fail | **Replaced, but the new falsifier is muddled** | See §2, item 5 |
| Raw frontier model + free EDGAR MCP baseline | **Fixed**, and it is now a falsifier of K1 | K1 (b) |
| B3 label check in week 1, with unchanged, edited, rejected and discard counts | **Fixed** | B3-0 |
| Pre-register α, δ and n; state decayed versus raw counts | **Structurally fixed, numerically wrong** | See §2, item 2 |
| Falsifier as a false-certification rate | **Fixed**, but the known-p simulation was dropped | See §2, item 5 |
| The bound excludes discarded drafts | **Sidestepped** | The discard count is reported, but the K3 claim does not say its bound covers only drafts that were sent |
| "Median active user" over a handful of users | **Not addressed** | |
| K0 as a public claim | **Fixed** (now G0) | |
| Nasdaq switch, meeting notice, PatentsView, test file, M0 budget | **Fixed** | `scripts/test-autopilot.ts` exists; `nasdaq.ts:35`, `free.ts:29` and `calendar.ts:48` are correct |
| K4 clock starts at directory listing | **Not addressed** (minor) | "30 days after listing" is unchanged |

---

## 2. Remaining weaknesses, ranked, with the minimum fix for each

### 1. field_bound's wrong-field catch restates its own definition, and the plan builds on it (critical)

In `probe-verify-v2.ts:69`, field_bound checks the sentence against `{ [field]: … }`. `field` is `k.field`
(:85, :88), and the probe hands it in from the oracle's `KINDS` table: it is the field the sentence *should* state.
A wrong-field error in that mode therefore means "the verifier knows the right field and the number differs". It
is caught by definition. The 3.1% that gets through is only confused values that happen to fall inside rounding,
such as prior-year revenue when growth is near zero.

In the real design (B2 step 2), the model chooses the field id. A wrong-field error is then the model citing
`S3.prior_ltm_revenue` under the words "LTM revenue". The registry renders that field's value faithfully, and
binding accepts it **100% of the time**. That is the entity_typed number, now hidden behind an id. Registry
rendering prevents *retyping* errors (perturbation, scale). It does nothing about *selection* errors (wrong field,
wrong period).

The plan says "Bound to the claimed field: 0.031 … So the design is prevention". The probe's header comment calls
it "what calc-by-reference / field-level citations would give", and that is not what they give. K2's wording,
"bound to the field it **states**", overclaims: the figure is bound to the field it **cites**. The plan does not
acknowledge this anywhere.

A second consequence: once values render from the registry, the "checked rate" for id-cited figures is about 100%
by construction. It then measures how often ids are used, not whether figures are correct.

**Minimum fix:**
- In B2, state plainly that field_bound assumes the correct field is known. Wrong-field and wrong-period errors
  move into the choice of id, and binding does not catch them.
- Reword K2 to "shows exactly the value of the field and period it cites".
- In validation, inject wrong-*id* citations, not wrong digits, and report wrong-field recall for id-cited figures.
  Expect it to be about 0.
- A cheap honest mitigation that needs no new component: show the cited field's name and period in the citation
  chip ("LTM revenue, FY2026 Q2"), so a wrong-id choice is visible to the reader.
- Make B2's emphasis depend on B0's error mix, as the B0 bullet already promises. If selection errors dominate,
  registry rendering buys little correctness and mainly earns the right to the UI claim.

### 2. B3-0's numbers are wrong for the plan's own α and δ (critical, because they decide a three-week go/no-go)

The plan sets α = 5% and δ = 5%, then quotes "n ≈ 22 at 0%, ≈ 65 at 3%, ≈ 140 at 5%" as "the plan reviewer's rough
figures at these α and δ". Those were my figures at **α = δ = 10%**. At α = δ = 5%, the same approximation gives:

| Observed bad rate | Labels needed |
|---|---|
| 0% | ≈ 58 |
| 3% | ≈ 613 |
| 5% | never (the rate equals α) |

"Bad" also means any edit over 5% (`engine-rules.ts:105-110`). At α = 5%, almost no email stratum will certify.
Read with these numbers, the go/no-go is close to a foregone no-go. Read with the quoted numbers, it could produce
a mistaken go.

**Minimum fix:**
- Choose α and δ first. α = 10% matches today's `certifyBadRate`.
- Write the n-versus-p table for that choice: at α = 10%, δ = 5% it is about 28, 82 and 179.
- Make "go" require both the volume and an observed per-stratum bad rate comfortably below α.
- Correct the attribution.

### 3. K2 thresholds are set and tested on the same B0 set (important)

Thirty to fifty answers hold perhaps 300–500 figures. At a natural error rate of a few percent, that is roughly
10–20 wrong figures, spread over five error types. Fixing thresholds after seeing B0 and then testing recall on B0
lets the falsifier be tuned until it passes. It is also too few errors per type to estimate recall at all.

**Minimum fix:**
- Use B0 only for the base rate, the error mix and the origin shares, and report each with a confidence interval.
- Set the recall thresholds on injected errors (wrong id, perturbation, scale) before B2 is built.
- Run the natural-error check on a fresh batch of answers from B1's harness, not on B0.

### 4. Weeks 1–5 are overcommitted, with no cut line (important)

- **Weeks 1–3** now hold all of M0 (which I sized at 2–3 weeks), B1 (about 1.5 weeks, now including a hand-checked
  slice and an independent XBRL reader), B0, and B3-0.
- **B2 has grown.** It now covers:
  - a figure registry with period ids;
  - id citations in streamed prose;
  - registry rendering;
  - calc resolving references;
  - four bug fixes in `numbers.ts`;
  - the fallback matcher;
  - the UI;
  - validation.

  That is in weeks 3–5.

**Minimum fix:** add one sentence on priority if weeks slip. My suggestion: B2 on chat takes precedence over B3
step 2 (the second action type), and B4 is dropped first. The fallback matcher should ship before registry
rendering if time runs short, because it alone makes the `Landing.tsx:110` rewording true.

### 5. Smaller items, each with a one-line fix

- **K1 (a) mixes a metric with a validity test.** "Can't … detect run-to-run instability (pass^3 vs pass@1 gap)"
  makes a genuinely stable model look like a failed harness. The routed small model may also truly match the
  default on retrieval tasks. *Fix:* the falsifier becomes "two runs of the same configuration differ by more than
  the binomial noise (about ±6 points at n ≈ 250)". Report the small-model gap as a sensitivity result, not a
  pass/fail.
- **K3's claim omits discards.** *Fix:* state that the bound covers drafts the person would have sent. Report the
  per-stratum discard share alongside it, and do not certify a stratum where the discard share is high.
- **The B3 replay has no ground truth for "false certification".** Real labels never reveal the true rate p.
  *Fix:* add the one-hour simulation with known p, which checks the type-I rate directly. Keep the replay on
  held-out labels as the realism check.
- **A median over very few users.** *Fix:* state the minimum number of active strata below which B3-0 reports
  "insufficient data" rather than "go".
- **The plan's scale-error number hides the realistic direction.** `wrong_scale` is half ÷1000 and half ×1000. The
  pool value of 0.526 is about 100% on the ÷1000 half (writing "million" for "billion"; the v1 rerun accepted
  99–100%) and about 0 on the other half. *Fix:* report the two directions separately.
- **The true-accept column of the B2 table is filled in only for field_bound.** v2 has 0.990 for the Edge check
  and 1.000 for entity_typed. These true-accept values are by construction anyway: the payload money string and
  the answer writer use the same formatter, and field_bound checks against a one-field passage. *Fix:* fill the
  column and footnote that it comes from the formatter.
- **entity_typed's good scale result comes from the probe's serialiser,** which writes `"$1,950.3 million"` with a
  currency, so the scale tries in `numbers.ts:66` never fire. It does not come from a fix. The plan does list the
  `:66` fix, which is consistent. *Fix:* note that the result assumes the serialiser or that fix.
- **K4's clock still starts at directory listing.** *Fix:* start it at the first public install path.

---

## 3. What is correct and worth saying so

- The v2 probe is otherwise clean. It is seeded and paired across modes, the payload and the figures come from one
  `fields()` source of truth, and the table is reported honestly (entity_typed accepts 100% of wrong-field errors).
- Making B0 and B3-0 the first actions, and treating "B0 may show figures are mostly right" as a live risk, is
  exactly right.
- The citations I re-checked this round hold:
  - `scripts/test-autopilot.ts` exists;
  - `nasdaq.ts:35`, `free.ts:29` and `calendar.ts:48` are as described;
  - `numbers.ts:26` and `:66` are as described.

---

## Remaining required changes

1. State in B2 that field_bound's wrong-field catch is by construction. Reword K2 to "the field it cites". Inject
   wrong-id errors in validation, and show the field and period in the citation chip.
2. Recompute B3-0's n for the chosen α and δ, or set α = 10%. Require an observed bad rate below α as well as
   volume, and correct the misattributed numbers.
3. Set K2's recall thresholds on injected errors before building. Use B0 only for base rate and mix, with
   intervals, and test natural errors on fresh answers.
4. Add a cut line for weeks 1–5. Order: B2 on chat, then B3 step 2, then B4. The fallback matcher ships before
   registry rendering.
5. Make the smaller fixes:
   - a test–retest falsifier for K1;
   - discard wording in K3;
   - the known-p simulation;
   - a minimum stratum count;
   - scale errors split by direction;
   - the true-accept column filled in;
   - K4's clock started at the first install path.

Score: 7/10
Verdict: almost
