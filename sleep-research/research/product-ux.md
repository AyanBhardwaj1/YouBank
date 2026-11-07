# Product, UX and growth frontier for AI-native professional tools (as of 31 Oct 2026)

Run: youbank-frontier-20261031 · Track: product, UX and growth · Author: research agent

**How to read this.** Every claim carries the URL of the search result it came from. Most sources about
2026 product trends are vendor blogs, aggregator pages or secondhand summaries; where a figure could not be
traced to a primary source it is tagged **[UNVERIFIED]**. No statistic here was made up. Where the search
found nothing (for example, adoption numbers for ChatGPT Pulse), the gap is stated. 31 web queries were
run, weighted to May–Oct 2026.

---

## Executive summary

1. **The live shape for professional agents is the "agent inbox": agents work in the background and propose; people approve, edit or reject.**
   LangChain has popularised it as "human-on-the-loop" ([LangChain](https://www.langchain.com/blog/ux-for-agents-part-2-ambient)). Linear builds delegation on the same idea ([Linear docs](https://linear.app/docs/agents-in-linear)). Superhuman says that with its July 2026 Auto Drafts, 60% of drafts went out unedited ([TechCrunch](https://techcrunch.com/2026/07/14/superhumans-new-auto-draft-feature-almost-makes-me-like-ai-replies/), company-reported).
   YouBank has the pieces (the review queue, autopilot, briefs, alerts) but spreads them across modules. It has no single inbox.
2. **ChatGPT and Claude are now finance distribution channels, and competitors.**
   - OpenAI launched ChatGPT for Financial Services on 10 Sep 2026, with Morgan Stanley and Evercore as design partners ([Fortune](https://fortune.com/2026/09/10/openai-courts-wall-street-with-chatgpt-for-financial-services-developed-with-morgan-stanley)).
   - Anthropic shipped ten finance agent templates on 5 May 2026 ([Anthropic](https://anthropic.com/news/finance-agents)).
   - Morningstar and PitchBook run as apps inside ChatGPT ([BusinessWire](https://www.businesswire.com/news/home/20251216478652/en/Morningstar-and-PitchBook-Bring-Trusted-Investing-Intelligence-to-Apps-in-ChatGPT/)).

   Generic research and modelling is being commoditised at the top of the market. YouBank's edge has to be the follow-through, the price, and being where the user already is (MCP).
3. **MCP Apps (Jan 2026) is the cross-host standard for interactive UI generated inside chat.** It runs in ChatGPT, Claude, VS Code, Cursor and Copilot ([WorkOS](https://workos.com/blog/2026-01-27-mcp-apps), [CopilotKit](https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026)). A comps table that YouBank renders once can be shown in its own app and inside both chat apps.
4. **The pricing market has settled on a hybrid of a seat fee plus credits.**
   - Futurum (Aug 2026): buyers rank per-seat last for core software (12.6%) but prefer it for AI add-ons (42.3%) because it is predictable ([Futurum](https://futurumgroup.com/insights/the-pricing-split-why-core-software-and-ai-cant-share-one-commercial-model/)).
   - Hybrid is the largest bucket, at 37% of 230+ SaaS companies ([Enterprise DNA](https://enterprisedna.co/resources/ai-pulse/ai-pulse-2026-08-19-hybrid-seat-plus-credit-confirmed-as-the-market-s-actual-pri), indicative).

   YouBank's seat-plus-allowance-plus-packs model is on trend. The risk is how surprises are communicated: Cursor apologised and refunded after its June 2025 change ([TechBriefly](https://techbriefly.com/2025/07/08/cursor-ai-coding-tool-apologizes-for-pricing-changes/)).
5. **What finance users will pay is bimodal.** Enterprise tools sell at roughly $3k–$10k+ a seat a year (Hebbia estimates, [Sacra](https://sacra.com/chat/h/06c453cc-9871-47c4-bc57-83b47d85c44c/) **[UNVERIFIED]**), while consumer finance AI is free or about $20 a month (Perplexity Finance, [Sid Saladi](https://sidsaladi.substack.com/p/perplexity-finance-101-the-complete)). YouBank's $59 / $149 sits in the gap the brief targets, and nobody in the search results contests it.
6. **What earns trust in finance is source attribution and visible error checks, not fluency.**
   - At a Bloomberg poll, 32% named source attribution as the feature that gave them most confidence, and 30% named built-in error checking ([pulse.bot on Bloomberg survey](https://www.pulse.bot/fintech/blogs/bloomberg-survey-uk-finance-leaders-say-inaccurate-outputs-are-the-biggest-barrier-to-ai-adoption-2e71bf04-ce95-4bb6-babc-7ea2dd816708/)).
   - In Hebbia's survey, 58% want AI to be "flawless" before they depend on it fully ([Hebbia](https://hebbia.com/resources/ai-finance-trust-survey)).
7. **Agents that act on email have had public failures in 2025–26**: the Meta director's inbox deleted by OpenClaw ([OECD.AI](https://oecd.ai/en/incidents/2026-02-23-d55b)), a confidential deal leaked to Zoho's CEO ([Deccan Herald](https://www.deccanherald.com/business/it-was-my-fault-ai-agent-leaks-biz-secrets-to-zohos-vembu-then-apologises-3813417)), and an agent at Who Gives A Crap suspended after a wrong price email ([SmartCompany](https://www.smartcompany.com.au/retail/who-gives-a-crap-suspends-ai-agent-email-error-prices-would-double/)). YouBank's earned-autonomy engine is a real differentiator, but only if people can see it and undo what it does.
8. **Retention, not signups, is the binding constraint for AI apps.**
   - RevenueCat 2026: AI subscription apps keep 21.1% of subscribers after 12 months, against 30.7% for non-AI apps ([Computing](https://computing.co.uk/news/2026/ai-powered-apps-struggle-retain-subscribers)), although they earn 41% more per payer ([ppc.land](https://ppc.land/ai-apps-earn-41-more-per-user-but-churn-30-faster-revenuecat-finds/)).
   - One-third of trial conversions happen on Day 0 ([SaaStr](https://saastr.com/the-top-10-learnings-from-revenuecats-state-of-subscription-apps-how-115000-mobile-apps-deliver-16b-in-revenue-whats-working-whats-quietly-killing-growth)).

   So the first session has to produce a deliverable, and a daily habit has to follow it.
9. **The growth loops that work for prosumer AI**: shared artifacts that carry the brand (Gamma, reported at $100M ARR and 70M users in Nov 2025, [AI Magazine](https://aimagazine.com/news/gamma-ai-presentations-for-100m-users-us-100m-arr-and-prof)); referral credits tied to an activation event (Lovable, [Lovable FAQ](https://lovable.dev/faq/referral/how-it-works/how-referral-works)); campus chapters (Wall Street Prep, [Greenhouse](https://job-boards.greenhouse.io/wallstreetprep/jobs/7922106002)); and programmatic pages, which have to be substantive after Google's March 2026 action on scaled content ([alexcloudstar](https://www.alexcloudstar.com/blog/programmatic-seo-2026-indie-hackers/) **[UNVERIFIED magnitude]**).
10. **Focus: lead with a wedge.** The evidence leans toward a narrow, workflow-owning entry point that earns the right to expand ([VC Cafe](https://www.vccafe.com/2026/01/07/vertical-ai-in-2026-the-good-the-bad-and-the-ugly); [Stax](https://stax.com/insights/how-ai-is-reshaping-vertical-saas)). The successful finance AI companies (Rogo, Hebbia) lead with one job for one buyer.

    **Recommendation:** lead with "cited deal research → outreach that follows through" for boutique advisors and emerging managers, with Campus as the distribution engine. Move copy trading, algo trading and crypto out of the front door into Labs.

---

## 1. AI-native UX patterns that are working in 2026

### 1.1 Ambient agents and the inbox of proposed actions
- **The pattern.** Harrison Chase (LangChain) describes ambient agents as agents that listen to event streams and
  act without a prompt.
  - People stay on the loop: they approve, edit or reject actions, and answer the agent's questions ([Sequoia podcast summary](https://rosetta.to/u/sequoiacapital/ambient-agents-and-the-new-agent-inbox-ft-harrison-chase)).
  - He compares the agent inbox to a customer-support dashboard rather than a chat ([LangChain](https://www.langchain.com/blog/ux-for-agents-part-2-ambient)).
  - Approvals also produce feedback that improves the agent ([Sequoia Inference](https://inferencebysequoia.substack.com/p/ambient-agents-and-the-new-agent)).
- **Linear's delegation model.**
  - Assigning an issue to an agent triggers it, but the human remains the primary assignee and the agent is a
    contributor ([Linear docs](https://linear.app/docs/agents-in-linear)).
  - Linear built the agent's inbox as a mirror of a user's inbox, delivered by webhooks ([Linear blog](https://linear.app/now/our-approach-to-building-the-agent-interaction-sdk)).
  - Cursor and GitHub Copilot accept delegated issues and come back with draft PRs ([Linear changelog mirror](https://linear-web.pages.dev/changelog/2025-10-28-github-copilot-agent)).

  The principle: **the human owns the work and the agent proposes.**
- **Email drafts in Superhuman.** Auto Drafts 2.0 (July 2026) writes replies from the inbox, calendar and web for the person
  to edit and send ([TechCrunch](https://techcrunch.com/2026/07/14/superhumans-new-auto-draft-feature-almost-makes-me-like-ai-replies/)). These figures are company-reported:
  - 40% of drafts sent within a day;
  - 60% sent unedited;
  - about 9 minutes saved per draft ([borncity](https://borncity.com/news/e-mail-ki-superhuman-60-der-antworten-gehen-automatisch-raus/)).
- **Gap.** The search found no 2026 primary data on inbox UX from the major vendors; the
  sources are conceptual.
- **Implication for YouBank.** Relationships already has a review queue, and autopilot, the Newsroom, Calendar briefs and Edge theses all produce
  "things to look at". Merge them into one **Desk inbox** of proposed actions, each with:
  - a provenance line;
  - a confidence and autonomy-level badge;
  - one-key approve, edit or reject.

  Code: a new `src/app/app/inbox/`, plus `src/components/workspace/HomeDashboard.tsx`, `AppNav.tsx`, `Sidebar.tsx`, `MobileTabBar.tsx` and `src/lib/nav.ts`.

### 1.2 Agent task queues and long-running work
- A July 2026 analysis cites long-running background tasks in Claude Cowork and "ChatGPT Work" as the move
  toward "ambient intent layers" ([yage.ai](https://yage.ai/share/proactive-ai-context-infrastructure-en-20260714.html)).
- Rogo's Felix is used email-style: a banker sends Felix a task, then reviews and iterates by reply
  ([Vantaige](https://vantaige.io/ai-tool/rogo-ai)). Felix is reportedly used by about 35,000 finance professionals
  ([idlen.io](https://www.idlen.io/fr/news/rogo-160-millions-serie-d-kleiner-perkins-felix-agent-finance-avril-2026/) **[UNVERIFIED]**).
- **Implication for YouBank.**
  - Let people hand off a task and walk away. A "Run in background" option on Studio builds, deep research and Edge canvases sends the result to the Desk inbox with a push notification.
  - Accept tasks by email: forward a CIM or an email to an address like `desk@` to start a run.

  Code: `src/app/api/inngest`, `src/components/studio`, `src/components/edge`.

### 1.3 Generative UI and MCP Apps
- MCP Apps became an official MCP extension on 26 Jan 2026, built from MCP-UI and OpenAI's Apps SDK ([WorkOS](https://workos.com/blog/2026-01-27-mcp-apps)).
  ChatGPT supports both the Apps SDK and MCP Apps, and so do VS Code, Cursor, Copilot, Goose and Claude ([CopilotKit](https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026)).
- **Taxonomy.** Generative UI comes in three kinds ([CopilotKit](https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026)):
  - static (AG-UI);
  - declarative (A2UI, Open-JSON-UI);
  - open-ended (MCP Apps).

  Google's A2UI has limited production adoption so far.
- **Adoption.** Shopify is cited as running MCP-UI in production. The scale claims are the speaker's own
  ([AI Engineer Europe 2026](https://www.ai.engineer/talks/o-zkvb0iFDQ-mcp-ui-extending-frontier) **[UNVERIFIED scale]**).
- **Implication for YouBank.**
  - Build a small set of declarative "answer components" for the assistant to render instead of Markdown: comps table, football field, filing excerpt with highlights, sale-odds gauge.
  - Reuse the same components as MCP App views in the planned remote MCP server.

  Code: `src/components/ai`, `src/components/terminal/Markdown.tsx`, `src/components/charts`.

### 1.4 Proactive briefings
- OpenAI launched ChatGPT Pulse in Sep 2025: overnight research delivered as morning cards, drawing on chats,
  calendar and email ([TechCrunch](https://techcrunch.com/2025/09/25/openai-launches-chatgpt-pulse-to-proactively-write-you-morning-briefs)).
  **The search found no adoption or retention data for Pulse.**
- **Implication for YouBank.** YouBank already has a morning brief (`HomeBrief`) and Newsroom push (`public/news-sw.js`).
  Make the brief the **daily habit loop**:
  - one card per watchlist name, deal and meeting;
  - each card ends with a proposed action ("draft follow-up to X", "re-run comps: peer filed 10-Q").

  Measure D1/D7 returns from the brief.

### 1.5 Canvas and node workflows
- n8n moved to a spatial canvas in Feb 2026 ([softomate](https://www.softomatesolutions.com/blog/n8n-updates-2026-whats-new/) **[UNVERIFIED]**).
- Krea's Node Agent builds canvas graphs from a prompt and **shows compute cost per node before running**
  ([Krea](https://canvas.krea.ai/blog/ai-workflow-agent)).
- Critics argue canvases are costly to maintain and that "describe the policy, compile the workflow" is better
  ([MightyBot](https://mightybot.ai/blog/real-cost-of-drag-and-drop-workflow-builders-2026/), a vendor). No adoption numbers were found.
- **Implication for YouBank.** Edge canvases should open from a prompt and from templates, not an empty board,
  and show the estimated AI cost per block against the allowance before a run.

  Code: `src/app/app/edge/canvas`, `src/components/edge`, `src/lib/ai/limits.ts`.

### 1.6 Citations UX
- Hebbia Matrix is the reference design ([Dynamic Business](https://dynamicbusiness.com/ai-tools/hebbia-revolutionizes-ai-interface-meet-the-matrix.html), [G2](https://g2.com/products/hebbia/discuss)):
  - rows are documents and columns are questions;
  - every cell has a click-through citation to the exact page and paragraph.

  Reviewers say citation UX gets cumbersome across many projects ([Airframe](https://www.airframe.ai/product/hebbia/analysis)).
- ChatGPT for Financial Services also leads with "detailed citations" ([TechRepublic](https://www.techrepublic.com/article/news-openai-chatgpt-financial-services-banks/)).
- **Implication for YouBank.** Citations are now table stakes. Differentiate on **provenance class**: filed (XBRL), derived (computed from filed),
  vendor (FMP) or estimated, colour-coded per number.

  Code: `src/components/terminal/SourceChip.tsx`, `src/components/studio`.

### 1.7 Undo, audit and trust calibration
- 2026 practitioner guidance converges on a three-tier model ([agenticwire](https://www.agenticwire.news/article/agent-ux-design-patterns), [Towards AI](https://pub.towardsai.net/designing-for-ai-agents-8-ux-patterns-that-build-trust-in-2026-713a0c926933)):
  - low-risk, reversible actions run silently and are logged;
  - medium-risk actions show a preview of intent first;
  - irreversible actions need a hard confirmation *before* they run.

  Other recurring patterns are an "autonomy dial", plain-language action logs and per-action revert. All of this is blog-level guidance, not empirical studies.
- After the OpenClaw incident, the post-incident review found the agent had acted without showing a plan or getting approval
  ([LatestLY](https://www.latestly.com/technology/openclaw-error-meta-director-summer-yue-says-ai-agent-deleted-entire-inbox-in-autonomous-speedrun-after-ignoring-commands-7326912.html)).
- **Implication for YouBank.** The adaptive engine's e-process autonomy certification is stronger than anything in these sources, but it is invisible.
  - Surface a per-contact and per-category **autonomy ladder** ("Drafts only → Send after 10-min hold → Send").
  - Add a send-delay undo window and a plain-English action log.

  Code: `src/components/crm`, the autopilot and adaptive code under `src/lib`.

### 1.8 Voice
- Ramp's vendor data says that as of Oct 2026, 94% of organisations with an AI-dictation vendor use Wispr Flow
  ([Ramp](https://ramp.com/vendors/wispr-flow)).
- Wispr reportedly raised a $280M Series B at a $2B valuation in Aug 2026 ([Wikipedia](https://en.wikipedia.org/wiki/Wispr_Flow) **[UNVERIFIED amount; sources conflict]**).
- Privacy complaints persist: Trustpilot 2.7/5 ([same](https://en.wikipedia.org/wiki/Wispr_Flow)).
- **Implication for YouBank.** Voice is proven as an *input* layer, not as the main interface. YouBank already has hold-to-talk. Extend it on mobile to
  "voice note after meeting → CRM note + follow-up draft + task", processed on the server and stated as not used for training.

---

## 2. Onboarding and activation for complex professional tools

- **Benchmarks (vendor-sourced, directional).**
  - Average B2B SaaS activation is about 37.5% ([Flowjam](https://www.flowjam.com/blog/saas-onboarding-best-practices-2025-guide-checklist)); the median is 38% ([Perspective AI](https://getperspective.ai/blog/2026-customer-onboarding-benchmark-activation-rates-by-industry)).
  - Conversational onboarding cut the median time to first value from 42 to 15 minutes ([Perspective AI](https://getperspective.ai/blog/ai-customer-onboarding-67-percent-adoption-2026-activation-benchmark) **[vendor]**).
- **Conversion is front-loaded.** In RevenueCat's 2026 data, more than 60% of trial conversions happen within a week and about a third on Day 0 ([SaaStr](https://saastr.com/the-top-10-learnings-from-revenuecats-state-of-subscription-apps-how-115000-mobile-apps-deliver-16b-in-revenue-whats-working-whats-quietly-killing-growth)).
  The median AI app converts trials to paid at 8.5%, against 5.6% for non-AI apps ([ppc.land](https://ppc.land/ai-apps-earn-41-more-per-user-but-churn-30-faster-revenuecat-finds/) **[UNVERIFIED in primary]**).
- **Retention curves.**
  - An a16z chart from YipitData (Feb 2026) shows ChatGPT's retention *rising*, from about 37% in month 1 to over 70% by month 24 ([OfficeChai](https://officechai.com/ai/ai-products-retention-curves)). The sample is self-selected ([critique](https://www.mbi-deepdives.com/some-charts-that-caught-my-attention/)).
  - AI subscription apps overall keep 21.1% of subscribers after 12 months, against 30.7% for non-AI apps ([Computing](https://computing.co.uk/news/2026/ai-powered-apps-struggle-retain-subscribers)).
  - Median net dollar retention for AI-native B2B vendors hit 136% in April 2026, then fell for two months ([Tropic](https://www.tropicapp.io/blog/ai-pricing-trends)).
- **Bessemer's archetypes.**
  - "Supernovas" reach about $40M ARR in year 1 and $125M in year 2, at about 25% gross margin and with "fragile retention".
  - "Shooting Stars" grow $3M → $12M → $40M → $103M at about 60% gross margin, with stronger product-market fit ([OpenLink mirror of Bessemer State of AI 2025](https://openlinksw.com/data/html/bessemer-ventures-ai-2025-report-claude.html) **[secondary]**).
- **Activation milestone as the reward trigger.** Lovable pays referral credits when the referred user *publishes* a first site, not when they sign up
  ([Catalaize](https://catalaize.substack.com/p/lovables-path-from-open-source-to)). This defines activation as the first shipped artifact.
- **Gap.** The search found no 2026 data isolating sample data or templates for activation in finance tools.
  Anthropic's and OpenAI's finance launches both lead with ready-to-run templates (pitch builder, comps, KYC) ([Anthropic](https://anthropic.com/news/finance-agents)), which is indirect evidence that templates are how the leaders onboard.
- **Implication for YouBank.**
  - The current six-step survey (`OnboardingWizard.tsx`: Role, Group, Experience, Focus, Style, Goals) puts six choices before any value. Cut it to two (role, and one company or deal you care about), then **generate a cited deliverable in the first minute**: a tear sheet plus comps, or a sale-odds read. Ask the rest progressively.
  - Define activation as "first cited artifact saved or shared within 24 hours" and track it.
  - Offer a **sample deal workspace** with a real public company, a mock data room and a mock mailbox thread, so people can try autopilot without connecting their own mailbox.

---

## 3. Pricing and packaging in 2026

| Signal | Source |
|---|---|
| Buyers rank per-seat last for core software (12.6%) but prefer it for AI add-ons (42.3%), because it is predictable | [Futurum, Aug 2026](https://futurumgroup.com/insights/the-pricing-split-why-core-software-and-ai-cant-share-one-commercial-model/) |
| Hybrid (seat plus usage or credits) is the largest model, at 37% of 230+ SaaS companies (survey pending its primary report) | [Enterprise DNA](https://enterprisedna.co/resources/ai-pulse/ai-pulse-2026-08-19-hybrid-seat-plus-credit-confirmed-as-the-market-s-actual-pri) |
| 78% of IT leaders saw unexpected charges from consumption or AI pricing (Zylo); 58% still pay for AI per seat (ICONIQ) | [SoftwareSeni summary](https://www.softwareseni.com/subscription-pricing-breaks-ai-budgets-and-what-to-do-instead/) **[secondary]** |
| 73% of vendors have added or announced AI surcharges | [Stripo, Jun 2026](https://research.stripo.email/saas-pricing-trends-2026) |
| Bessemer's playbook: hybrid is the default for 41% of AI companies | [Sista.ai](https://sista.ai/de/insights/outcome-based-ai-agent-pricing) **[UNVERIFIED]** |

**Examples**
- **Intercom Fin (outcome-based).**
  - $0.99 per resolution, procedure hand-off or disqualification; $9.99 per qualified lead ([Pavior](https://app.pavior.com/blog/intercom-pricing)).
  - 50-outcome monthly minimum when sold standalone ([DEV](https://dev.to/omar_bni_f6856a8bb0e021e9/intercom-fin-pricing-in-2026-the-real-math-behind-099-62j)).
  - G2 complaints about unpredictable bills ([Insidea](https://insidea.com/software/intercom)).
- **Clay (split credits, 11 Mar 2026).**
  - Data Credits and Actions are now separate pools; marketplace data prices fell 50–90%.
  - Plans are Launch at $185 and Growth at $495 ([JoinValley](https://www.joinvalley.co/blog/clay-pricing-and-credits-explained-2026), [Clay](https://www.clay.com/blog/introducing-clays-new-pricing)).
  - Agency commentary attacked the gating of HTTP API access ([Bitscale](https://ghost.bitscale.ai/clay-pricing-changes-15k-action-limits-higher-costs-and-agency-risk), a vendor).
- **Cursor (the cautionary tale).**
  - In June 2025, fixed request quotas became credit pools tied to API cost. Communication was poor, and there was a public apology with refunds on 4 Jul 2025 ([TechBriefly](https://techbriefly.com/2025/07/08/cursor-ai-coding-tool-apologizes-for-pricing-changes/), [FintechWeekly](https://www.fintechweekly.com/news/cursor-pricing-change-user-backlash-refund)).
- **Harvey.**
  - No public price. Third-party estimates vary widely ($100–$2,000 per user a month), with 20–25 seat minimums and three-year terms ([Bind](https://www.bindlegal.com/resources/comparisons/harvey-pricing-2026/) **[UNVERIFIED]**).
  - ARR passed $100M in Aug 2025 and was about $190–195M by early 2026 ([Sacra](https://sacra.com/research/harvey-at-195m-arr/)).
- **Rogo and Hebbia.** Both are quote-based per seat. Hebbia is estimated at $3–3.5k a seat a year for Lite and about $10k for full access ([Sacra chat](https://sacra.com/chat/h/06c453cc-9871-47c4-bc57-83b47d85c44c/) **[UNVERIFIED]**). Hebbia's "Max" dealmaking agent (Aug 2026) has no published price ([UsagePricing](https://usagepricing.com/blueprint/activity/hebbia-2026-08-06-launch)).
- **Perplexity Finance.** Free core, with free SEC filings and CSV export; Pro is about $20 a month ([Sid Saladi](https://sidsaladi.substack.com/p/perplexity-finance-101-the-complete) **[secondary]**). It also links brokerage accounts through Plaid ([PYMNTS](https://www.pymnts.com/?p=3554235)).

**What finance users tolerate.**
- Enterprise finance buys per seat, by quote, with annual prepay.
- Individuals compare against $20 chatbots and $25–$120 terminals.
- Buyers say they want **predictability for AI spend** (Futurum).

**Implication for YouBank.** The Free / Campus / Pro / Deal Team / Enterprise structure plus credit packs matches the market's hybrid default. Three changes:
1. **Show cost before running anything expensive**, in "answers" and dollars, against the remaining allowance. This follows Krea's per-node preview and avoids a Cursor-style surprise.
2. **Pilot one outcome-priced add-on** where the outcome is unambiguous and the buyer is a small firm: for example, autopilot on Deal Team billed per meeting booked from a campaign. Keep the seat as the anchor.
3. **Do not publish a "contact sales" wall for Deal Team.** Transparent prices are an advantage against Rogo and Hebbia.

Code: `src/components/ai/AiUsage.tsx`, `src/components/billing`, `src/components/marketing/Pricing.tsx`, `src/lib/billing/*`, `docs/pricing.md`.

---

## 4. Growth loops for finance and prosumer tools

### 4.1 Campus and student programmes
- **Bloomberg for Education** gives students self-paced certificate courses whose completions go on CVs and
  LinkedIn. Schools with three or more Terminals join the programme automatically ([NUS factsheet](https://bizfdb.nus.edu.sg/wp-content/uploads/sites/88/2022/09/Bloomberg-for-Education-Factsheet.pdf), [BU](https://library.bu.edu/bcer/about-certificates)). No enrolment figures were found.
- **Wall Street Prep** recruits "Chapter Presidents" for Young Leaders in Finance clubs. Reported perks are $500 on club registration, $500 on completing events, and all WSP courses ([Greenhouse](https://job-boards.greenhouse.io/wallstreetprep/jobs/7922106002)).
- **Koyfin** has a $0 tier and school-wide student pricing ([Koyfin schools](https://Koyfin.com/use-cases/schools-universities/)), plus a 10% friend referral discount ([Koyfin](https://www.koyfin.com/get-discount-from-a-friend)).
- **Shortcut** markets heavily on finance benchmarks, including a Wall Street Prep-run comparison ([Shortcut](https://shortcut.ai/blog/posts/wsp-ranked-1), self-published).
- **Implication for YouBank.** Campus is free with a .edu address. Add:
  - a **certificate** ("YouBank Deal Desk: comps, DCF and LBO on real filings"), graded by the product and shareable to LinkedIn;
  - **club chapters**, with a team workspace for the investment club and a leaderboard on stock pitches;
  - a **graduation offer** (Campus → Pro at a discount for the first year).

  Code: `src/app/for/[role]` (students), a new `src/app/campus/`, `src/lib/billing/plans`.

### 4.2 Shareable artifacts
- Gamma reported $100M ARR, 70M users and a 50-person team in Nov 2025 ([AI Magazine](https://aimagazine.com/news/gamma-ai-presentations-for-100m-users-us-100m-arr-and-prof)).
  Growth is attributed to word of mouth and branded shared decks ([yespress](https://yespress.io/gamma) **[UNVERIFIED]**).
- Lovable runs community templates that can be remixed as a growth loop ([Catalaize](https://catalaize.substack.com/p/lovables-path-from-open-source-to)).
- **Implication for YouBank.** Published Edge stories are currently `robots: { index: false }` (`src/app/story/[slug]/page.tsx`), and Studio outputs have no public share.
  - Add **public, indexable, branded tear sheets and comps** with a "Remix in YouBank" button that copies the artifact into a new user's workspace on sign-up.
  - Add Open Graph images to them, as Newsroom stories already have.

### 4.3 SEO on company pages
- Investing.com is the canonical programmatic finance site, with hundreds of thousands of auto-generated ticker pages ([Gracker](https://gracker.ai/case-studies/investing) **[vendor]**).
- Google's March 2026 enforcement against scaled content abuse reportedly cut traffic 50–80% for low-value programmatic sites ([alexcloudstar](https://www.alexcloudstar.com/blog/programmatic-seo-2026-indie-hackers/) **[UNVERIFIED]**).
  The same 2026 commentary advises pruning or noindexing weak pages ([mean.ceo](https://blog.mean.ceo/?p=10667)).
- **Implication for YouBank.** `src/app/sitemap.ts` lists only the landing, pricing, role and Newsroom pages; there are no company pages. YouBank has 328 tools on EDGAR/XBRL with provenance, which is exactly the "substantive, unique data" Google rewards.
  - Ship public `/c/[ticker]` pages covering the latest filings, XBRL financials with source chips, peer comps, Form D activity and Newsroom stories.
  - Index only names with real coverage.

  Code: a new `src/app/c/[ticker]/page.tsx` plus `opengraph-image.tsx`, `src/app/sitemap.ts`, `src/app/api/company/[ticker]`.

### 4.4 Distribution inside ChatGPT and Claude
- Morningstar and PitchBook apps went live in ChatGPT in Dec 2025 for licensed users ([Morningstar](https://newsroom.morningstar.com/news/news-details/2025/Morningstar-and-PitchBook-Bring-Trusted-Investing-Intelligence-to-Apps-in-ChatGPT/default.aspx)).
  PitchBook is a data partner for ChatGPT for Financial Services (Sep 2026) ([Enid News/BusinessWire](https://www.enidnews.com/region/pitchbooks-private-market-intelligence-now-accessible-within-chatgpt-for-financial-services/article_148bc187-52f2-5038-8f32-3179e2b9fa0b.html)).
- Claude's connector directory reportedly had 369 connectors by 19 Jun 2026 ([claude-for-operators](https://claude-for-operators.pages.dev/reference/connector-directory/) **[third-party count]**).
  Era became the first personal-finance connector ([FF News](https://ffnews.com/newsarticle/era-becomes-the-first-personal-finance-connector-in-anthropics-claude-directory-and-every-other-mcp-compatible-agent/)).
  Anthropic's May 2026 finance launch added FactSet, S&P Capital IQ, Moody's and Dun & Bradstreet connectors ([Anthropic](https://anthropic.com/news/finance-agents)).
- **Implication for YouBank.**
  - The roadmap's remote MCP server should ship as a **free-tier acquisition channel**: filings, XBRL, Form D and precedents, each with citations.
  - Rich MCP App views should carry an "Open in YouBank" deep link.
  - The paid tools in the server should be premium Edge layers and the follow-through (drafts, campaigns).
  - List it in both directories. This is the cheapest path into the screens of ChatGPT for Financial Services and Claude users.

### 4.5 Referral
- Lovable gives bonus credits to both sides on a paid sign-up ([Lovable FAQ](https://lovable.dev/faq/referral/how-it-works/how-referral-works)), and credits on the referee's first publish ([Catalaize](https://catalaize.substack.com/p/lovables-path-from-open-source-to)).
- **Implication for YouBank.** Give both sides a credit pack ($6 of AI use, the $10 pack's value) when the referee *activates*, meaning they create their first cited artifact. On Pro purchase, give a larger pack.

  Code: `src/app/api/billing/credits`, `src/components/settings`.

---

## 5. Mobile and desktop

- **iOS web push.** It works only for PWAs added to the home screen (since iOS 16.4), and only after a permission prompt the user taps ([Monterail](https://www.monterail.com/blog/pwa-for-apple-ios)).
  - Background delivery is less reliable than native ([MobiLoud](https://www.mobiloud.com/blog/progressive-web-apps-vs-native-apps) **[vendor]**).
  - Push inside a WKWebView wrapper is unreliable ([Webscraft](https://webscraft.org/blog/pwa-chi-nativniy-dodatok-u-2026-porivnyannya-stsenariyi-viboru-ta-realniy-keys?lang=en)).
- **What finance professionals want on mobile.**
  - The search found **no survey of dealmakers' mobile workflows** (gap).
  - Indirect evidence: ChatGPT Pulse launched mobile-first ([TechCrunch](https://techcrunch.com/2025/09/25/openai-launches-chatgpt-pulse-to-proactively-write-you-morning-briefs)); Rogo has an iOS app in the Finance category ([App Store](https://apps.apple.com/app/id6745538983)); Felix's email-style hand-off suits a phone ([Vantaige](https://vantaige.io/ai-tool/rogo-ai)).
  - Reasoned conclusion: on the phone, people **read briefs, approve or reject proposed actions, and dictate notes**. They do not build models there.
- **Implication for YouBank.**
  - YouBank is already fully responsive and has a Newsroom service worker (`public/news-sw.js`). The search found **no web app manifest** in `src/app` (no `manifest.ts`), and iOS needs one before a home-screen PWA can receive push.
  - Ship `src/app/manifest.ts`, an install prompt, and push for Desk-inbox items. Approve or reject straight from the notification action where the platform allows it.
  - Defer a native wrapper until push reliability data from the PWA says otherwise.

---

## 6. Trust and brand for an AI that touches money and email

**What builds trust**
- **Source attribution and visible checks.**
  - At a Bloomberg AI in Finance Summit poll, 32% named source attribution, 30% built-in error checking and 25% human oversight as what gave them most confidence ([pulse.bot](https://www.pulse.bot/fintech/blogs/bloomberg-survey-uk-finance-leaders-say-inaccurate-outputs-are-the-biggest-barrier-to-ai-adoption-2e71bf04-ce95-4bb6-babc-7ea2dd816708/)).
  - In AlphaSense's survey, 62% had been hurt by at least one bad AI output, and accuracy ranked above privacy and speed ([AlphaSense](https://www.alpha-sense.com/press/new-report-ai-trust-is-rising-in-finance-and-business/)).
- **A high bar.** In Hebbia's survey of 509 US finance professionals (Feb–Mar 2026), 63% trust AI over a coworker to catch model errors, but 58% want it to be flawless before relying on it fully ([Hebbia](https://hebbia.com/resources/ai-finance-trust-survey); vendor survey).
- **Accuracy framed by benchmarks.**
  - Anthropic markets Opus 4.7 at 64.37% on the Vals AI Finance Agent benchmark ([Anthropic](https://anthropic.com/news/finance-agents)).
  - Shortcut publishes head-to-heads it ran itself ([Shortcut](https://shortcut.ai/cases/shortcut-vs-claude-for-excel-ankura-office-of-the-cfo-benchmark)) and admits it "is not 100% accurate".
  - Openly showing the benchmark and its gaps has become the norm. YouBank's README already cites the Vals Excel benchmark.

**How products lost trust (2025–26)**
- **OpenClaw and the Meta director's inbox (Feb 2026).** The agent deleted hundreds of emails after losing its instruction during context compaction; it had acted without a plan or approval ([OECD.AI](https://oecd.ai/en/incidents/2026-02-23-d55b)).
- **Leak to Zoho's CEO (Nov 2025).** A startup's browser agent emailed confidential acquisition details to Zoho's CEO, then sent its own apology ([Deccan Herald](https://www.deccanherald.com/business/it-was-my-fault-ai-agent-leaks-biz-secrets-to-zohos-vembu-then-apologises-3813417)). A deal leak is the exact nightmare for M&A users.
- **Who Gives A Crap (Jul 2026).** Its agent falsely confirmed a doubled price, the company suspended it, and a correcting email went out ([SmartCompany](https://www.smartcompany.com.au/retail/who-gives-a-crap-suspends-ai-agent-email-error-prices-would-double/)).
- **Cursor (2025).** Trust in the pricing was lost through communication, not the product ([TechBriefly](https://techbriefly.com/2025/07/08/cursor-ai-coding-tool-apologizes-for-pricing-changes/)).
- **Wispr Flow.** Privacy concerns hold its Trustpilot rating down despite strong adoption ([Wikipedia](https://en.wikipedia.org/wiki/Wispr_Flow)).

**Implications for YouBank**
1. **Confidentiality guardrail on outbound mail.** Block or hold any autopilot or campaign send that mentions a deal codename, a data-room document, or a company on a "restricted" list, unless the recipient is inside the deal. This addresses the Zoho failure mode directly.
2. **Public trust page.** Publish the autonomy policy ("what autopilot will not send", already in the README), the provenance classes, the benchmarks with their failure rates, and the incident policy.
3. **Brand separation.** Copy trading, algo trading and crypto under the same brand as a deal desk that writes emails for you widen the trust surface, and add regulatory exposure (investment advice, broker integrations) that boutique advisors will not want next to their mailbox. Keep them in a "Labs" area, off the landing page.

Code: `src/components/marketing/Landing.tsx`, a new `src/app/trust/`, `src/lib/nav.ts` defaults.

---

## 7. Focus vs breadth: what to lead with

**Evidence**
- **For a wedge.**
  - The vertical-AI thesis says AI is a strong wedge because buyers accept it, and the wedge then "earns the right to expand into core workflows" ([VC Cafe, Jan 2026](https://www.vccafe.com/2026/01/07/vertical-ai-in-2026-the-good-the-bad-and-the-ugly)).
  - Vertical AI competes for labour budgets, not IT budgets ([Nasdaq / Bessemer](https://www.nasdaq.com/articles/rip-legacy-cloud-long-live-vertical-ai)).
  - Durability comes from owning persistent operational state ([Stax](https://stax.com/insights/how-ai-is-reshaping-vertical-saas)).
  - Guides warn that a general AI assistant is "the fastest path to failure" ([semnexus](https://semnexus.com/go-to-market-gtm-strategy-ai-startups/), low authority).
- **Against a wedge.**
  - One founder argues the wedge is dead, because building software is cheap and incumbents are hostile ([Bearing](https://bearing.substack.com/p/vertical-ai-maximalism)).
  - A page attributed to Mike Vernal argues the wedge → suite → platform sequence is compressing ([aperture-daq](https://aperture-daq.pages.dev/wiki/product-trends/three-act-playbook-death) **[UNVERIFIED attribution]**).
  - YC talks about "20X companies" built by small AI-native teams ([podwise](https://podwise.ai/episodes/7200607)).
  - Note that these argue about *building* broadly, not about *leading the go-to-market* broadly.
- **Market behaviour.**
  - Rogo leads with one job for one buyer: investment-bank research and pitch work via Felix, sold to Rothschild, Jefferies, Lazard, Moelis and Nomura ([beri.net](https://www.beri.net/tag/Kleiner%20Perkins)), and reportedly passed $50M ARR ([Digg citing The Information](https://digg.com/ai/gpp9r7ys) **[UNVERIFIED]**).
  - Harvey stayed on legal ([Sacra](https://sacra.com/research/harvey-at-195m-arr/)).
  - OpenAI and Anthropic now cover generic research, comps and decks for banks themselves ([Fortune](https://fortune.com/2026/09/10/openai-courts-wall-street-with-chatgpt-for-financial-services-developed-with-morgan-stanley); [Anthropic](https://anthropic.com/news/finance-agents)).
  - A European analysis expects most AI SaaS to end up as components inside platforms ([Breega](https://www.breega.com/insights/european-saas-2026-consolidation-ai-integration)).
- **No independent data compares compound and wedge-first AI startup outcomes** (stated gap).

**Reasoned recommendation**
1. **Lead with one job:** *"Cited deal research that follows through: from a filing to a sent, tracked email."*
   - The buyer is the boutique advisor or emerging manager, which matches the README's "firms in between".
   - The aha moment is a comps or buyer list with citations that turns into personalised outreach drafted in their voice, queued for approval.
   - This combination is what neither ChatGPT for Financial Services (no follow-through, enterprise-only) nor Superhuman (no finance data) offers.
2. **Students are the distribution wedge, not a revenue segment.** Campus feeds Pro at graduation and seeds firms.
3. **Support modules stay but are not marketed up front:** Studio (as the output format), Edge (as the "unfair data" upsell), Calendar and Meetings (they feed the inbox).
4. **Move to Labs:** Quant, fund copies (13F copy trading), algo trading and crypto. Remove them from the landing page and the default pins, and keep them reachable from the sidebar search. Revisit with usage data. They dilute the "deal desk" message, carry different regulatory and trust risk, and compete with free or retail-priced tools.

Measure the decision. Activation and D30 retention by entry module should decide which modules earn front-door space.

---

## Product moves for YouBank

Each move gives the evidence, the metric it should move, and the code it touches.

1. **Desk inbox of proposed actions.**
   - What: one queue merging Relationships review, autopilot holds, Newsroom alerts, Calendar and meeting follow-ups, and Edge thesis triggers. Approve, edit or reject; provenance and an autonomy badge on each item; keyboard and swipe.
   - Evidence: LangChain agent inbox; Linear delegation; Superhuman reports 60% of drafts sent unedited.
   - Metric: approved actions per weekly active user; acceptance rate; D30 retention.
   - Touches: a new `src/app/app/inbox/page.tsx`, `src/components/workspace/{HomeDashboard,AppNav,Sidebar,MobileTabBar}.tsx`, `src/lib/nav.ts`, `src/app/api/crm`.
2. **Onboarding to a first deliverable in under 2 minutes.**
   - What: cut the six-step survey to role plus one ticker or deal, then auto-generate a cited tear sheet and comps. Ask the rest progressively. Offer a sample deal workspace with a mock mailbox for trying autopilot.
   - Evidence: about a third of conversions on Day 0 (RevenueCat); TTFV benchmarks; Lovable's activation defined as first publish.
   - Metric: activation, defined as a cited artifact saved within 24 hours; time to first value.
   - Touches: `src/components/workspace/OnboardingWizard.tsx`, `src/app/onboarding/page.tsx`, `HomeDashboard.tsx`.
3. **Morning brief as the habit loop, plus PWA push.**
   - What: add `manifest.ts` so iOS can install the PWA and get push. Each brief card ends in a proposed action that lands in the Desk inbox.
   - Evidence: ChatGPT Pulse launched mobile-first; iOS push requires a home-screen PWA.
   - Metric: DAU/WAU; D7 retention; push opt-in rate.
   - Touches: a new `src/app/manifest.ts`, `public/news-sw.js`, `src/components/news/HomeBrief.tsx`, `NewsSettings.tsx`, `src/lib/news/deliver.ts`.
4. **Public company pages `/c/[ticker]`.**
   - What: filings, XBRL financials with source chips, peers, Form D and news, with Open Graph images. Index only names with real coverage.
   - Evidence: Investing.com's programmatic model; Google's 2026 action against thin scaled pages.
   - Metric: organic sessions and sign-ups per week.
   - Touches: a new `src/app/c/[ticker]/{page,opengraph-image}.tsx`, `src/app/sitemap.ts`, `src/app/api/company/[ticker]`.
5. **Shareable, remixable artifacts.**
   - What: public tear sheets, comps and Edge stories carrying "Made with YouBank" and a "Remix" button that clones them into a new workspace. Published stories become indexable.
   - Evidence: Gamma's branded-share loop **[UNVERIFIED attribution]**; Lovable's remixable templates.
   - Metric: share rate per active user; sign-ups from shared links (viral coefficient).
   - Touches: `src/app/story/[slug]/page.tsx` (drop `index:false` for public stories), `src/components/edge/story/StoryView.tsx`, `src/components/studio`.
6. **Remote MCP server and MCP App views, listed in both directories.**
   - What: a free tier for filings, XBRL and precedents with citations; paid tools for the follow-through; "Open in YouBank" deep links.
   - Evidence: the MCP Apps standard; Claude's directory at 369+ connectors; Morningstar and PitchBook inside ChatGPT; ChatGPT for Financial Services.
   - Metric: sign-ups attributed to the connector; MCP monthly active users; paid conversion.
   - Touches: a new `src/app/api/mcp/route.ts`, the tool registry under `src/lib`, components reused from `src/components/charts`.
7. **Generative answer components.**
   - What: the assistant returns typed components (comps table, football field, filing excerpt, sale-odds gauge) instead of Markdown.
   - Evidence: the generative UI taxonomy; reuse inside MCP Apps.
   - Metric: follow-up actions per answer (export, add to Studio, draft email).
   - Touches: `src/components/ai`, `src/components/terminal/Markdown.tsx`, `src/components/charts`.
8. **Provenance classes on every number.**
   - What: filed, derived, vendor or estimated, colour-coded, with a click to the filing paragraph. Studio cells inherit them.
   - Evidence: source attribution was the top trust driver in the Bloomberg poll at 32%; Hebbia's per-cell citations.
   - Metric: citation clicks per answer; thumbs-down rate; Pro conversion.
   - Touches: `src/components/terminal/SourceChip.tsx`, `src/components/studio`, `src/components/terminal/Markdown.tsx`.
9. **Visible autonomy ladder and undo.**
   - What: show each contact's or category's level and the evidence that earned it. Hold sends 10 minutes with undo. A plain-English action log.
   - Evidence: the OpenClaw and Who Gives A Crap incidents; tiered-risk UX guidance.
   - Metric: autopilot opt-in rate; unsend rate; incidents (target 0).
   - Touches: `src/components/crm`, the autopilot and adaptive modules under `src/lib`, `src/components/settings`.
10. **Confidential-deal guardrail on outbound mail.**
    - What: detect deal codenames, data-room content and restricted names in drafts, and hold any send to recipients outside the deal.
    - Evidence: the Zoho deal leak.
    - Metric: blocked risky sends (logged); Enterprise and Deal Team win rate.
    - Touches: the Relationships drafting and send path under `src/lib`, `src/components/crm`.
11. **Cost preview before expensive runs.**
    - What: show "about N answers / $X of your $Y left" before deep research, Studio builds and canvas runs.
    - Evidence: Krea's per-node cost preview; Zylo's 78% unexpected charges; the Cursor backlash.
    - Metric: credit-pack attach rate; billing complaints and refunds; run abandonment.
    - Touches: `src/components/ai/AiUsage.tsx`, `src/app/app/edge/canvas`, `src/components/studio`, `src/lib/ai/limits.ts`.
12. **Pilot an outcome-priced add-on on Deal Team.**
    - What: for example, a charge per meeting booked from a campaign, with the seat price unchanged.
    - Evidence: Intercom Fin's $0.99 outcomes; buyers favour consumption and outcome pricing for non-AI software (Futurum).
    - Metric: Deal Team conversion and expansion revenue.
    - Touches: `src/lib/billing/features`, `src/lib/billing/costs.ts`, `docs/pricing.md`, `scripts/test-billing.ts`.
13. **Campus programme with certificate and chapters.**
    - What: a product-graded certificate shareable to LinkedIn, team workspaces for clubs, paid chapter leads, and a graduation discount to Pro.
    - Evidence: Bloomberg's certificates; Wall Street Prep's chapter presidents; Koyfin's school pricing.
    - Metric: Campus sign-ups; certificate shares; Campus → Pro conversion at graduation.
    - Touches: `src/app/for/[role]`, a new `src/app/campus/`, `src/components/workspace/TeamClient.tsx`, the billing plans.
14. **Referral credits triggered by activation.**
    - What: both sides get a $10 credit pack when the referee saves a first cited artifact, and more on Pro purchase.
    - Evidence: Lovable's publish-triggered credits; Koyfin's referral discount.
    - Metric: share of sign-ups from referrals; activated referees.
    - Touches: `src/app/api/billing/credits`, `src/components/settings`, `src/components/workspace/SettingsClient.tsx`.
15. **Narrow the front door and create Labs.**
    - What: the landing page, role pages and default pins lead with research → outreach. Quant, fund copies, algo trading and crypto move to Labs: reachable from search, not pinned, not on `/`. Add a public `/trust` page.
    - Evidence: the wedge-then-expand thesis; Rogo and Harvey focus; ChatGPT and Claude commoditising generic research; the trust surface.
    - Metric: landing conversion; activation by entry module; D30 retention.
    - Touches: `src/components/marketing/{Landing,RolePage}.tsx`, `src/lib/nav.ts`, `src/components/workspace/Sidebar.tsx`, a new `src/app/trust/page.tsx`.
