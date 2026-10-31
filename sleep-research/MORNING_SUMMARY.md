# Overnight research: YouBank, frontier market, product, AI and tech
**Outcome:** The research says YouBank should stop widening and prove the two things its landing page already promises: numbers that are right, and an agent that has earned the right to act. Three cheap probes and two review rounds turned that into an 8-week claim-first plan (`EXPERIMENT_PLAN.md`, reviewer 7/10, "almost"). Along the way they found real defects in the shipped code that should be fixed first.

**Why that direction:**
- Anthropic (May 2026) and OpenAI (Sept 2026) now sell finance agents themselves, and the big data vendors all ship MCP connectors. General research is becoming a commodity (`research/market.md`).
- Finance agents still fail mostly on extracting evidence and on arithmetic (`research/ai-agents.md`).

**Chosen roadmap:**
1. **Week 1 checks.** Audit 30–50 real answers figure by figure (B0), and count how many approve/edit/reject labels autopilot gets per user (B3-0).
2. **Launch-gate fixes (M0).** Fail-closed autopilot gate, honest landing copy, email unsubscribe compliance, meeting notice, 2FA, Nasdaq scrape off, analytics view.
3. **Nightly finance eval harness (B1).** Hand-checked, period-pinned, with pass^k and a frontier-model + free-EDGAR baseline.
4. **Field- and period-cited figures (B2).** Show figures from the stored source value, not the model's retyped digits.
5. **Earned autonomy made real (B3), only if B3-0 says go.** The novelty check found no shipping product that does this, although the method is published.
6. **Optional:** a narrow MCP connector with a kill criterion.

**Ran:** about 3 minutes of CPU. Probes P1 v1 and v2 (`code/probe-verify*.ts`), a verifier bug repro and a sample-size calculation, plus npm and network feasibility checks. Synthetic data, one seed.

**Headline results:**
- **Reusing Edge's number checker on chat answers would pass many wrong figures:**

  | Error in the figure | Accepted as correct |
  |---|---|
  | Perturbed by 3–30% | 52.3% |
  | 1000× scale | 52.6% |
  | Wrong field | 98.7% (true by design) |

  Most of the leak is its pairwise-arithmetic step (`runs/probe-verify-v2.json`).
- **Matching numbers after the answer is written can't tell which field a value came from.** So the design shifts to figures shown from the source and labelled with their field and period.
- **Four verifier bugs reproduced** (`runs/verifier-bugs.txt`).
- **Certifying an email category takes ≥ 29 / 61 / 116 reviewed drafts** at 0 / 3 / 5% bad (α 10%, δ 5%; `runs/certification-n.txt`). At α = δ = 5% almost nothing certifies.

**Defects found in shipped code (all re-checked):**
- autopilot's trust gate fails open (`src/lib/crm/autopilot.ts:101`);
- no List-Unsubscribe on CRM mail (`src/lib/crm/send.ts:94`);
- no 2FA (`src/lib/auth/server.ts:51`);
- the unlicensed Nasdaq.com scrape is on by default (`src/lib/market/nasdaq.ts:35`);
- Edge's claim calibration was fitted on synthetic claims;
- landing copy overpromises (`Landing.tsx:110,168`).

**Review:** plan review went 5/10 → 7/10, "almost", after 2 rounds. The reviewer route was **same-family Claude subagents, provisional**: no other model family was available here.

**Claims:** 7 audited. 2 supported (R3 bugs, R4 code defects), 5 narrowed (R1, R2, R5, R6, R7), 0 refuted (`CLAIMS.md`).

**Decided without you:**
- Treated this as product research: no ML training runs.
- Moved the MCP connector from flagship to a bounded experiment after finding a free hosted EDGAR MCP server.
- Picked "earned autonomy" as the high-upside bet.
- Set α = 10% and δ = 5% for certification.

**Needs you:**
1. Gmail OAuth scope (CASA, or send-only plus IMAP).
2. Move to Vercel Pro before charging.
3. FMP display licence with AI-use rights.
4. Counsel on 13F copy trading and algo trading (publisher's exclusion vs an RIA partner) and on recording consent.
5. Allow arxiv.org, vals.ai and sec.gov in the environment's network settings if you want the [UNVERIFIED] figures re-checked.

**Limits:**
- Web searches were capped at about 11–38 per track, and arxiv, Vals and SEC pages were blocked from this sandbox, so many market and paper figures come from search summaries.
- The probes are synthetic. The natural error rate is what B0 will measure.

**Next step:** say "implement the plan" and I'll start with the M0 day-1 fixes and the B0 audit script.
