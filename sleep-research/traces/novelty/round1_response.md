# Novelty check, round 1: A1, A4, C1, B2

Run: youbank-frontier-20261031 · Reviewer: independent (did not propose these bets) · Date: 2026-10-31

**How hard I looked.** I ran 20 web searches: 6 for A1, 3 for A4, 7 for C1 and 4 for B2. They covered vendor
pages, arXiv and MCP aggregators (Glama, mcpservers.org, getdrio, skillsplayground), with queries aimed at
May–Oct 2026. I did **not** open the official ChatGPT apps directory or claude.com/connectors, and I did not fetch
any page in full. Every claim below comes from search-result snippets and summaries. A GitHub star-count lookup
failed because this session cannot reach other repositories. "Not found" therefore means "not found in about 20
searches", not "does not exist".

## Summary

| Bet | Overall novelty | One line |
|---|---|---|
| A1 Verify every figure | **LOW** | Kepler (on Claude, profiled by Anthropic in spring 2026) already makes "every number verified and traceable" its core pitch. Per-answer verified badges exist outside finance. YouBank's genuine difference is a post-hoc check on general chat at prosumer price. |
| A4 Finance eval harness | **LOW** (internal) / **MEDIUM** if published honestly | Vendor-reported finance benchmarks are common (Fintool, Rogo, Samaya, Kepler). A fully reproducible one is rare. pass^k comes from τ-bench, and a Jan 2026 paper already argues for consistency metrics in finance. |
| C1 MCP server + app | **LOW** | Free, keyless EDGAR MCP servers exist, including at least one hosted remote instance. Paid and hosted EDGAR connectors work in Claude and ChatGPT. A Form D MCP server exists. The open slot is narrower: an official directory listing plus deal-specific bundles plus a deep link. |
| B2 Earned autonomy | **HIGH as a shipped product; the method is published** | I found no product that gates agent actions on a statistical guarantee learned from the user's approvals. The math is recent and close to what B2 needs: Conformal Selective Acting (May 2026) and Conformal Arbitrage (2025). |

---

## A1. Verify every figure

**Claim 1: finance AI products don't ship deterministic per-figure verification on general chat answers.**
**PARTIALLY ANTICIPATED (strongly).**
- **Closest: Kepler.** It is a financial research platform built on Claude. Anthropic's customer profile "How Kepler
  built verifiable AI for financial services with Claude" dates from about late April 2026, and a Business Wire
  release followed on 21 May 2026. Search summaries say every number entering the system passes a deterministic
  validation check, unverifiable values are removed before users see them, deterministic execution environments
  handle ratios, and an analyst can click a figure to reach its filing, page and line item. The vendor claims 94%
  line-item extraction accuracy against 38–46% for frontier models alone.
  https://claude.com/blog/how-kepler-built-verifiable-ai-for-financial-services-with-claude ·
  https://www.businesswire.com/news/home/20260521369696/en/ ·
  https://quartr.com/customers/how-kepler-made-every-ai-answer-traceable-to-a-primary-source-powered-by-quartr
  - **Exact difference:** Kepler *prevents* bad numbers: deterministic code produces or validates the numbers
    upstream and the model interprets them. A1 *audits after the fact*: it re-parses model-written prose against
    raw tool payloads and reports a rate. Kepler is enterprise research. YouBank would apply the check to general
    chat, workflows and memos at the $59 tier. Note that A2 (calc-by-reference) in the pool is the Kepler-style
    prevention half.
  - **The IDEA_REPORT's prior-work list for A1 omits Kepler.** It is the most important prior for A1 and should be
    added.
- Other examples in the same pattern, each smaller or narrower:
  - Equibles checks every published figure against data by a fixed rule (https://equibles.com/research/methodology).
  - Verif-AI feeds the model pre-extracted figures (https://verif-ai.co.uk/about).
  - FinVerify is a vendor verification layer with self-claimed results (https://finverifyllm.lovable.app/).
  - A Towards AI build log, "I Built a Finance AI That Proves Every Number It Gives You", is a hobby project
    (https://pub.towardsai.net/i-built-a-finance-ai-that-proves-every-number-it-gives-you-9bbd351f1059).
- Research: FinGround (arXiv 2604.23588, Apr 2026, listed as ACL 2026 Industry Track) splits answers into atomic
  claims and recomputes the arithmetic for numerical ones, at 91.4% detection F1 (https://arxiv.org/abs/2604.23588).
  A Sept 2026 paper warns that cross-referencing checks can miss fabricated values that happen to match unrelated
  input numbers (https://arxiv.org/pdf/2609.04806). This is the triage's "large payload inflates the rate" risk, now
  documented in the literature.
- I found no evidence that ChatGPT for Financial Services or Claude for Financial Services runs a per-figure check
  on chat answers. The searches turned up only source-level citations and Claude for Excel cell citations. I did not
  check their official docs directly, so this is [UNVERIFIED].
- The IDEA_REPORT's prior "Perplexity 'auditable financials'" is not confirmed. Search shows that Perplexity
  Finance cites EDGAR filings with clickable links (https://hub-prod.perplexity.ai/hub/blog/answers-for-every-investor),
  but I found no per-figure check. [UNVERIFIED as phrased]

**Claim 2: showing a verified-figure rate per answer is new UX.** **PARTIALLY ANTICIPATED.**
- Per-answer verification badges already exist.
  - Vaquill (legal) shows Verified, Partially Verified or Flagged on each response and states plainly that
    "verified" means only "supported by the cited source" (https://vaquill.ai/docs/guides/answer-verification).
  - The Verity browser extension gives a Verified/Wrong/Unverifiable verdict per response
    (https://peerpush.com/p/verity-ai-truth-revealer).
  - Energent's audit tool recomputes numbers and attaches a pass/fail verdict
    (https://www.energent.ai/ugc/en/tool/ai-answer-verification).
- **Difference:** I found no *numeric* "N of M figures verified" rate on a finance chat surface. That is a real but
  small UX delta over tiered badges, not a new category.

**Positioning.** Don't claim to be the first to verify figures, because Kepler owns that line. Claim "the check runs
on every answer, at prosumer price, and we show you the score." Use Vaquill-style scope language: "matches the
cited source" is not the same as "is the right figure." Report the check's own precision and recall from A4 next to
the rate.

---

## A4. Finance eval harness

**Claim 1: a public, reproducible accuracy page from a finance AI vendor is rare.** **PARTIALLY ANTICIPATED.**
*Public vendor accuracy claims are common. Fully reproducible ones are rare.*
- Fintool publishes a page claiming 90% on the 50-question public subset of Vals' Finance Agent Benchmark,
  self-reported (https://fintool.com/benchmark/finance-agent-benchmark-fintool).
- Rogo's BigFinanceBench releases only a 50-question public subset and grades with LLM judges
  (https://benchmarklist.com/benchmarks/rogo_big_finance_benchmark/).
- Samaya's FrontierFinance is vendor-built (arXiv 2608.11683, per a search summary). [UNVERIFIED detail]
- Kepler's 94% figure appears in a press release.
- Independent: Vals Finance Agent v1.1 and v2 leaderboards. Per the BenchLM mirror, the top score was about 61% in
  Sept 2026 (https://benchlm.ai/benchmarks/financeagentv2).
- The arXiv paper "LLM Output Drift" (2511.07585) states that existing finance benchmarks measure accuracy but not
  reproducibility (https://arxiv.org/pdf/2511.07585).
- **Difference:** a page that publishes the golden set, the harness and pass^k, run nightly, would go beyond any
  vendor page I found. The claim is true only in its narrow "reproducible" form.

**Claim 2: pass^k reliability reporting for finance agents is uncommon.** **PARTIALLY ANTICIPATED.**
- pass^k originates in τ-bench (2024) for retail and airline agents.
- "Replayable Financial Agents" (arXiv 2601.15322, Jan 2026) argues that finance agent benchmarks need
  consistency across repeated runs for regulated deployment (https://arxiv.org/html/2601.15322).
- I found no finance vendor that *reports* pass^k. Uncommon as vendor practice: plausible. Uncommon as an idea in
  finance: no.

**Overall.** As an internal safety net, it isn't meant to be novel, and the triage already said so. It earns
MEDIUM only when combined with C7 as an honest, reproducible public page.

**Positioning.** "Vendor numbers you can rerun." Publish the set, the k, the date and the failures, against Fintool
and Rogo, which publish subset scores only.

---

## C1. Remote MCP server + ChatGPT/Claude app

**Claim 1: there is room for a cited free-regulatory-data connector despite open-source EDGAR MCP servers and paid
vendors.** **PARTIALLY ANTICIPATED, and the plain free EDGAR connector is ALREADY DONE.**

Open-source and free EDGAR MCP servers I found:
- **stefanoamorelli/sec-edgar-mcp** (AGPL-3.0; EdgarTools; XBRL statements; insider data). Star count: 118 on one
  listing, 254 on another [UNVERIFIED current count]. https://pypi.org/p/sec-edgar-mcp ·
  https://www.sourcepulse.org/projects/28073489
- **cyanheads/secedgar-mcp-server** has a *public hosted remote instance* at https://secedgar.caseyjhand.com/mcp.
  Its listing says no API key is required and it uses Streamable HTTP (https://glama.ai/mcp/servers/cyanheads/secedgar-mcp-server).
  This is the closest free competitor to C1's "remote server" shape. I could not confirm its launch date.
- jsconiers/sec-edgar-mcp (https://glama.ai/mcp/servers/jsconiers/sec-edgar-mcp)
- GeekLad/edgar-mcp (https://glama.ai/mcp/servers/GeekLad/edgar-mcp)
- uh-joan/sec-mcp-server (npm, Inline XBRL) (https://lobehub.com/mcp/openpharma-org-sec-mcp-server)
- Others on aggregators: mcpwright/edgar-mcp, danishashko/edgar-mcp, brechanbech/sec-mcp, guptaprakhariitr/sec-edgar-mcp
  (https://www.getdrio.com/mcp/io-github-danishashko-edgar-mcp). No star counts were visible for these.

Hosted or paid EDGAR connectors that work in Claude and/or ChatGPT:
- SEC-API.io remote MCP, documented for ChatGPT developer mode and for Claude
  (https://sec-api.io/resources/how-to-access-sec-financial-data-in-chatgpt)
- Composio SEC EDGAR toolkit for Claude/Cowork and ChatGPT Work (https://composio.dev/toolkits/sec/framework/chatgpt)
- FinancialFilings Claude integration (https://financialfilings.com/integrations/claude/)
- Edgrapi, with a free tier (https://mcpservers.org/ja/servers/paperandbeyond23-gif/edgrapi-skills)
- Vinkius SEC XBRL MCP (https://vinkius.com/apps/sec-xbrl-financial-reporting-mcp)
- Filings Intel and FilingFirehose (https://skillsplayground.com/connectors/com-datakoot-sec-edgar-filings/)

Form D specifically:
- The **SEC Funding Tracker MCP server** (Glama) finds companies that recently raised private capital from Form D
  filings, returning issuer, industry, executives and a filing link (https://glama.ai/mcp/servers/ejsrl8vc5l).
- Apify Form D actors can be called through the Apify MCP server
  (https://apify.com/nexgendata/private-funding-form-d-intelligence.md).
- Form D as a wedge is therefore **PARTIALLY ANTICIPATED**, not empty.

Official directories:
- ChatGPT apps: Morningstar and PitchBook went live in Dec 2025. Both require a subscription.
  (https://www.businesswire.com/news/home/20251216478652/en)
- ChatGPT for Financial Services (Sept 2026) optimises the S&P Global and FactSet MCPs and lists 50+ connectors
  (https://openai.com/index/introducing-chatgpt-financial-services/).
- Claude: a third-party guide counts 369 directory connectors as of June 2026, and Daloopa is listed
  (https://claude-for-operators.pages.dev/reference/connector-directory/).
- **I found no first-party or officially listed SEC EDGAR app in either directory.** I did not open the directories
  themselves, so this is [UNVERIFIED]. If true, it is the real gap: a free, directory-listed, keyless EDGAR + Form D
  app. The gap is "listed and maintained", not "exists".

**Claim 2: it can drive sign-ups.** **Not a novelty claim, and not checkable by search.** I found no public evidence
in either direction on conversion from a data MCP app. The Morningstar and PitchBook apps work as *access for
existing subscribers*, not as acquisition funnels (https://www.investmentnews.com/advisor-tech/chatgpt-launches-embedded-morningstar-and-pitchbook-apps-to-compete-directly-with-standalone-ai-investment-research-tools/265656).
Treat sign-ups as the experiment's outcome metric, not a premise. [UNVERIFIED]

**Overall: LOW.** The triage's objection 2 ("free EDGAR MCP servers already exist") is confirmed and understated:
a hosted keyless remote instance already exists.

**Positioning.** Don't compete as "EDGAR in Claude". Compete as a deal-desk app with these parts:
- Form D raises joined to filings and precedents
- provenance-tagged values
- "open this in YouBank" deep links into a workbook or deal record
- an official directory listing, which hobby servers rarely pursue

Keep FMP/Nasdaq prices out, as the triage says.

---

## B2. Earned autonomy everywhere

**Claim 1: no shipping product gates agent autonomy with statistical guarantees from user labels.**
**NOVEL as far as I could find.** I ran 4 targeted searches. I did not check Lindy, Fyxer, Superhuman or Agentforce
docs directly.
- **Closest shipping product: Claude Code auto mode.** It launched on 24 Mar 2026 and became the default for
  Pro/Max/Team on 14 Aug 2026. A classifier gates each tool call, and the session falls back to manual approval
  after 3 consecutive or 20 total blocks (https://letsdatascience.com/news/anthropic-makes-auto-mode-default-in-claude-code-60dcee63).
  - **Difference:** a fixed classifier of action risk, not a per-user certificate learned from that user's
    approvals, and with no stated statistical guarantee.
- Anthropic's "Measuring AI Agent Autonomy in Practice" (Feb 2026) observes that users' auto-approve share rises
  with experience, from about 20% to over 40–50%. The secondary figures conflict.
  (https://gu-log.vercel.app/en/posts/en-clawd-picks-20260218-anthropic-agent-autonomy-research)
  This is humans granting trust, not a system certifying it.
- Heuristic ladders already exist:
  - MultiMail promotes an agent at more than 95% approval over 50+ decisions
    (https://multimail-site.pages.dev/use-cases/how-to-set-up-email-oversight).
  - Prmptree offers a five-level "trust dial"
    (https://aiindigo.com/tutorials/getting-started-with-prmptree-automate-email-with-controlled-ai-autonomy).
  - A blog promotes a category after about 10 unedited drafts (https://zackproser.com/blog/inbound-classifier-trigger-dev).
  - Decagon has a "graduated autonomy" glossary entry (https://decagon.ai/glossary/what-is-graduated-autonomy).
  - **Difference:** all of these are fixed thresholds with no error guarantee. The "earned autonomy" *framing* is
    common. The *certified* version is what I did not find.

**Claim 2: research exists but is not productised.** **CORRECT.** The research is recent and close.
- **Conformal Selective Acting** (Khosravi & Huo, arXiv 2605.20270, May 2026; NeurIPS 2026 poster) runs a
  Ville-type e-process per threshold, giving an anytime-valid certificate on *one operator's own deployment stream*
  for regulated settings (https://arxiv.org/html/2605.20270). This is nearly B2's math. The difference is that its
  labels are verifiable rewards, not human approvals, and it does not cover multi-action-type ladders.
- **Conformal Arbitrage** (arXiv 2506.00911, 2025) uses a CRC-calibrated threshold to decide between acting and
  deferring to a guardian, and the guardian can be a human (https://arxiv.org/html/2506.00911).
- **E-valuator** (Dec 2025) applies sequential tests over agent trajectories and is on PyPI
  (https://pypi.org/project/e-valuator/0.1.1/). Its evidence comes from verifier scores, not users.
- "When Should an AI Workflow Release?" (arXiv 2605.12947) covers e-value release decisions
  (https://arxiv.org/pdf/2605.12947).
- I found no paper that uses *end-user approve/edit labels* as the evidence stream for an action-gating
  certificate. That combination looks open.

**Overall: HIGH as a shipped product. The novelty is productisation, not method.** Two caveats from the triage still
decide whether it is real:
- The in-repo email version is advisory and is not anytime-valid.
- Per-user label volume is small. At low volume, a valid certificate takes many approvals to earn, so most users
  may never graduate. B2's failure mode ("a badge nobody earns") is a statistical-power problem, not a novelty
  problem.

**Positioning.** "Auto mode that you can audit." Against Claude Code's classifier and fixed approval-count ladders,
the pitch is: "this scope sends on its own because your last N approvals certify an error rate of at most α, and
it demotes itself the moment the evidence turns." Cite CSA as the method, and make the claim true in email before
generalising it.
