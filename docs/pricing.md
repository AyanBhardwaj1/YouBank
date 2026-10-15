# Pricing: what YouBank costs to run, and what each plan charges

The prices and AI allowances in `src/lib/billing/plans.ts` are worked out here from what a person on each
plan costs us to serve. The same numbers live in `src/lib/billing/costs.ts`, and `scripts/test-billing.ts`
fails if a price, a cost or a new premium feature pushes a plan below the margin target. To see the full
table, run `pnpm exec tsx scripts/test-billing.ts --table`.

Checked on 5 October 2026; prices revised the same day to the owner's lower price points. Re-checked on
14 October 2026 with every registered feature (premium, maps, crypto, desktop, meetings, calendar, news,
copy trading and Edge's next round) and Edge's background bills: the prices hold, and one Edge feature
moved up a plan (Eva-4B, to Deal Team). Model prices come from `src/lib/ai/pricing.ts` (checked 27 September 2026), and
Edge's paid upgrades from `src/lib/edge/premium.ts` (checked 30 September 2026). The infrastructure and
third-party prices were checked on 5 October 2026 against published 2026 summaries of each vendor's
pricing page; the vendor pages themselves could not be fetched from the build environment. Confirm each
one on the vendor's page before launch.

## The answer

| Plan | Monthly | Yearly (per month) | Seats | AI allowance (per seat) | Typical margin | Margin at the full allowance |
|---|---|---|---|---|---|---|
| Free | $0 | $0 | 1 | $0.75 a day, $3 a month (about 12 answers) | costs $2.09 a month | costs $5.60 a month |
| Campus (.edu) | $0 | $0 | 1 | $2 a day, $10 a month (about 40 answers) | costs $7.76 a month | costs $12.61 a month |
| Pro | **$59** | **$49** | 1 | $6 a day, $25 a month (about 100 answers) | 71.5% monthly, 67.1% yearly | 40.0% monthly, 29.2% yearly |
| Deal Team | **$149** per seat | **$125** per seat | 3 minimum | $12 a day, $60 a month (about 250 answers) | 71.1% monthly, 66.4% yearly | 36.5% monthly, 25.1% yearly |
| Enterprise | not sold monthly | **$299** per seat | 5 minimum | $30 a day, $130 a month (about 540 answers) | 72.3% | 35.1% |

"Answers" means assistant answers on the default model, at about 24 cents each (see below). Margin is
(price − Stripe's fees − cost to serve) ÷ price, per seat. People who need more AI than their allowance
buy an AI credit pack (below) instead of a bigger plan.

**The target.** At typical use, each plan keeps at least 70% of its list price: the monthly price, or the
yearly one for Enterprise, which is only sold yearly. It also keeps at least 65% of the yearly price. Even
for someone who uses the whole AI allowance every month, the margin never goes negative; the test holds
it to at least 25%. All three are checked by the test script.

**Why the prices came down.** The first cost model priced Pro at $119, Deal Team at $229 and Enterprise
at $449, with large allowances ($60, $130 and $300 of model time a month). That kept the margins, but
priced Pro well above what individuals pay for research tools ($25–$120 a month). The owner chose lower
prices with smaller allowances, plus paid top-ups for the people who use more:
- **Pro $59 ($49 yearly)** sits at the top of the owner's $49–59 range. At $49 monthly the yearly price
  would have to fall to about $39, and at $39 the typical person would leave less than the 65% yearly
  target unless the allowance fell below a useful size. $59/$49 keeps a $25 allowance, about 100 answers.
- **Deal Team $149 ($125 yearly)** and **Enterprise $299 (yearly)** are the owner's numbers. Their
  allowances ($60 and $130) are sized so that typical use, which includes autopilot, campaigns and the
  larger Edge models, keeps the target with room for the premium features other work is adding.
- **Allowances fell about 55–60%**, and typical personas were resized to match: a typical person uses
  around 40% of the allowance (Pro: 18 answers, 3 agent runs, a Studio build every other month and a
  mailbox). People who use more buy credits, which carry their own margin.

**The allowance is what makes the price safe.** Model spend is capped per person per day and per
allowance month at the plan's amount (`src/lib/ai/limits.ts`). So the worst case per seat is bounded by
the allowance plus a few dollars of infrastructure. The daily cap stops one runaway run from using up a
month. The allowance month starts on the subscription's billing anniversary (the owner's, for someone on
an assigned seat), or on the 1st (UTC) for Free and Campus.

**Free and Campus are a marketing cost, kept small.** Free keeps the whole terminal, the filings, comps,
the Newsroom and every calculator: none of those call a model, so they cost cents. Its AI allowance is
enough to try the assistant (about a dozen answers a month, three a day). A Free person costs at most
$5.60 a month whatever they do, and about $2 typically; Campus at most $12.61.

## AI credit packs

| Pack | Price | AI it adds (list price) | About | Stripe fees | Margin if every credit is used |
|---|---|---|---|---|---|
| $10 | $10 | $6 | 24 answers | $0.64 | 33.6% |
| $25 | $25 | $15 | 60 answers | $1.15 | 35.4% |
| $50 | $50 | $32 | 130 answers | $2.00 | 32.0% |

- **What they are.** One-time Stripe Checkout payments (`mode: "payment"`), sold to anyone signed in, on
  any plan (Free included). They live in `src/lib/billing/packs.ts`; prices come from
  `STRIPE_PRICE_PACK_AI10`/`AI25`/`AI50`, or an inline price when those are not set.
- **How they are used.** The plan's allowance goes first. Once a person's spend in the allowance month
  passes the plan's monthly amount, each further dollar comes out of their credits, oldest pack first,
  until they are used up. Credits do not expire and are personal (they never pass to a team). While a
  person holds credits, their daily cap is at least $10, so a Free or Pro daily cap does not trap a pack.
- **Why less than face value.** Credits are measured in the same list-price dollars as the allowance, and
  model time is our cost. A pack therefore adds less AI than it costs: the difference pays Stripe (2.9% +
  $0.30, plus 0.5% for Stripe Tax; there is no Billing fee on one-time payments) and leaves at least 30%
  even if every credit is used (`PACK_MARGIN_TARGET`, checked by the test script). Larger packs give a
  little more per dollar. Credits never bought do not cost anything; credits bought and not used are
  all margin.
- **Why packs, not metered overage.** Overage billed in arrears can surprise people and can fail to
  collect; a pack is paid up front, its limit is visible, and the worst case per person stays bounded by
  what they have paid for. Metered overage can be added later as a Stripe metered price on the same
  ledger if customers ask for it.
- **Accounting.** `ai_credit_grants` holds one row per pack (unique on the payment intent, so a webhook
  that arrives twice grants once); `ai_credit_draws` holds the credits used per allowance period, written
  as spend passes the allowance and settled from the usage ledger when the period ends. A refund in
  Stripe (`charge.refunded`) takes back the refunded share of that pack's credits, and so does an open
  or lost dispute (`charge.dispute.created`, `charge.dispute.closed`); a won dispute gives them back.

**Plans plus packs at the full allowance.** A Pro person who uses the whole $25 allowance and then a $25
pack costs us about $32.68 + $15 = $47.68 and pays $59 + $25 = $84: 38.6% after fees. A pack keeps at
least 32% of its own price, so a plan plus packs never falls below the 25% floor the plan keeps on its own.

## Edge's next round: what's free, what's premium and why

Edge's next round (`docs/edge-next.md`) built eight features: the Precedent Engine (E1), Calibrated Claims
(E2), the Alt-Data Pulse (E3), the Deal Radar (E4), Call Desk (E5), the LBO Stress Lab (E6), the Thesis
Agent (E7) and the Voice Analyst (E13). The rule for splitting them: **the part that answers the question
stays free** on every plan, because it runs on free public data, stored scores and in-process maths and
costs us cents; **what is premium is the layer that spends** (a stronger or second model, a GPU, more
paths, more theses, live audio) or is a professional convenience on top. Everything premium has a free
fallback, and every paid call is checked on the server (`requireFeature`) before it spends. Their entries
are in `src/lib/billing/features/edge-next.ts`.

**Free on every plan.**
- E1: the deal database from EDGAR merger filings, similar deals, ranges with their tested bands, `PREC`,
  exports of up to 50 deals, and reading one unread deal on demand (from the person's own allowance).
- E2: a calibrated support dot on every claim, Strict mode and the track record.
- E3: the weekly Pulse for every company (hiring, attention, federal awards, layoff notices, patents) and
  its findings.
- E4: the Radar board for watched companies and the week's movers, sale odds on the company page, and the
  scored track record.
- E5: any call read by the free calibrated classifier, the evasion posterior against earlier calls, and
  the promises ledger settled from XBRL.
- E6: the 1,000-path LBO preview, breach odds by year, the maximum price for a target IRR and the reverse
  stress test.
- E7: one thesis at a time, 14-day horizon, daily checks on the small model, a $0.50 budget (its model calls
  come out of the person's own allowance).
- E13: hold-to-talk with the browser's own speech recognition and voice.

**Premium.**

| Feature (`id`) | Plan | Cost to us | How it is paid and bounded | Why this plan |
|---|---|---|---|---|
| Re-read a deal with the stronger model (`edge.deals-reread`) | Pro | $0.24 a deal | AI allowance (`structured` → `recordUsage`); ten an hour | A model call any individual may want on the deals they rely on; the allowance caps it, so it is safe on the least paid plan |
| Precedent exports beyond 50 (`edge.deals-export`) | Pro | under $0.001 | A perk: stored rows | A professional convenience, not a cost |
| Private precedent library (`edge.deals-private`, planned) | Deal Team | about $0.05 a document | AI allowance once built | Firm documents (CIMs, closing memos) are a team's asset; not built yet, so it unlocks nothing |
| Second-provider claim check (`edge.claims-crosscheck`) | Pro | $0.03 an answer | AI allowance; output capped at 1,500 tokens | The free dots already verify; a second provider is extra assurance an individual analyst will pay for |
| Daily Pulse (`edge.pulse-daily`) | Pro | about $0.20 a month for a full 50-company list | Flat monthly figure; background, opt-in per company, at most 50, shared companies read once, plan re-checked every day, inside the daily pass's deadline | Free sources, but a daily background read per company; weekly stays free for everyone |
| Licensed alternative data (`edge.pulse-licensed`, planned) | Enterprise | the customer's licence | Their own keys | Bring-your-own licences are an Enterprise contract item; not built yet |
| Deal Radar screener (`edge.odds-screener`) | Pro | under $0.001 | A perk: one query over stored scores | Screening every company is the professional workflow; watching your own and the movers stays free |
| Buyer and target odds (`edge.odds-pairs`, planned) | Pro | under $0.001 | A perk | Not built yet |
| Evasion ensemble, Eva-4B (`edge.calls-eva`) | **Deal Team** (was proposed at Pro) | $0.05 a call | GPU time outside the AI ledger, so a server cap: ten a day; off until its licence is confirmed (`EDGE_CALLS_EVA=1`) | GPU spend the allowance cannot bound; on Pro it would eat into the 25% full-allowance floor for little gain, since the free classifier is the calibrated core. Teams reading many calls are who it is for |
| Peer call comparison (`edge.calls-peers`) | Pro | $0.002 | AI allowance | One small-model call over stored summaries |
| LBO refine, 20,000 paths (`edge.lbo-refine`) | Pro | $0.005 a refine | Modal CPU outside the ledger, so server caps: 20 an hour, 25 a day | Cheap enough for any paid individual; the preview stays free |
| More theses (`edge.thesis-plus`) | Pro | about $0.35 a thesis-month (60 ticks twice a day) | AI allowance, run as the owner; each thesis stops at its budget ($5 by default, $25 at most), its horizon (90 days) or 180 ticks; the plan is re-checked every tick and a lapsed thesis pauses | Model spend inside the allowance and a hard budget; the free thesis is the core |
| Weekly deep synthesis (`edge.thesis-deep`) | Pro | $1.00 a weekly pass | AI allowance; refused by the runtime once the thesis's budget would be passed | Inside the allowance, so safe on Pro; one deep thesis uses about a fifth of Pro's $25 a month, as the Plan tab's AI meter shows |
| Team theses (`edge.thesis-team`) | Deal Team | none beyond the ticks | A perk; the owner's allowance and budget pay | Sharing is a team feature |
| Live voice analyst (`edge.voice-realtime`) | Pro | about $0.33 a session ($0.11 a minute, at most $1.10) | AI allowance (two-minute minimum when the key is minted, then the reported minutes, capped at ten); three a day | Inside the allowance; hold-to-talk stays free |

**Background and recurring costs, and what bounds each.**
- **Thesis ticks.** An hourly Inngest run picks up to four due theses. A thesis ticks once a day (twice on
  More theses). Its model calls are recorded as its owner and so count against their allowance; every model
  step is refused before it runs if it would pass the thesis's budget, and the thesis stops at its horizon
  or tick cap (14 free, 180 on More theses). A premium thesis re-checks the plan each tick. No spend reaches
  us outside the owner's allowance; the Inngest executions are in the fixed bills.
- **The daily Pulse.** Only companies a person put on their daily list (at most 50), with the plan
  re-checked every day, inside the daily pass's time limit. Free sources; the compute is the $0.20 flat
  figure above. The weekly pass over the universe is platform work in the Vercel and Neon line.
- **The deal backfill.** Platform AI with no person attached. Off until an administrator switches it on or
  sets `EDGE_BACKFILL_DAILY_USD`; then at most $0.50 a day by default (500 deals a day at most), measured
  from the AI ledger, and it stops when the backlog is read. Counted as its $15 a month ceiling.
- **Deal Radar scoring.** Monthly training and weekly scoring of the universe on Modal CPU (or in
  TypeScript without the ML service). No model tokens. In the Modal line.
- **Modal GPU and CPU for people's clicks.** Eva-4B (one container at most, 60-second idle tail, ten a day
  per person) and the LBO refine (two containers at most, 25 a day per person) run only when a person
  presses them, and only on a plan that includes them. Edge's monthly Modal guard ($25) caps the whole
  app's Modal spend as a backstop.

## Algo trading: what's free, what's premium and why

Backtests, the builder and templates, and paper trading (three strategies, decisions at most daily) are free:
free price data and a little compute, counted as the fixed "Algo trading" line above. What costs us
something, or carries the most risk, is on a plan (`src/lib/billing/features/algo.ts`, docs/algo-trading.md):

| Feature (`id`) | Plan | Cost to us | How it is paid and bounded |
|---|---|---|---|
| Live with approval (`algo.live`) | Pro | $0.10 a month (`flatMonthlyUsd`) | Live strategies' ticks and order calls; broker APIs are free and SnapTrade's per-user fee is `copytrade.broker`'s, one connection shared, so it is not counted twice; at most 10 strategies |
| AI trading agent (`algo.agent`) | Pro | $0.24 a turn | Two structured calls through `recordUsage`, inside the AI allowance; ten turns a minute |
| Autonomous (`algo.autonomous`) | Deal Team | none of its own | The same ticks as `algo.live` |
| More strategies, 15-minute decisions (`algo.more`) | Deal Team | none of its own | Inside `algo.live`'s figure; 25 strategies |

With these registered (and the $2 fixed line), Pro keeps 71.4% monthly and 67.0% yearly at typical use and
28.9% yearly at the full allowance; Deal Team keeps 66.4% yearly at typical use and **25.0%** yearly at the
full allowance (it was 25.1%; algo adds about $0.11 a seat there, leaving about $0.04 of room). Anything
further on Deal Team paid outside the AI ledger needs a price change or a cap.

## Team seats and the reassignment cooldown

Each Deal Team or Enterprise seat carries its own AI allowance. Without a limit, an owner could give a
seat, let its holder use the whole allowance, free it and give it to someone new with a fresh allowance,
again and again, so AI cost per subscription would have no ceiling. So **a freed seat can go to a
different person only 30 days after it was last given** (`src/lib/billing/seats.ts`):
- Freeing a seat any way counts: taken back by the owner, given up by the holder, the holder leaving the
  team, or the team being deleted. `seat_history` (`drizzle/0024_seat_cooldown.sql`) remembers every seat
  given and has no foreign key to the team, so none of these erase it.
- Someone who held a seat in the last 30 days and holds none now still counts against the seat count until
  their 30 days pass. At most (seats − 1) different people share the plan's allowances in any 30 days, plus
  any seats the owner adds and pays for.
- Giving the seat back to the same person is always allowed.
- Seats taken back because the paid seat count went down do not cool: they are no longer paid for, and
  raising the count again is a new payment.
- The seats API refuses with the date ("This seat can be given to someone else on November 13, 2026."), and
  the Plan tab lists freed seats with the date each can go to someone else.
- Administrators (`ADMIN_EMAILS`) are exempt.

## Unit costs

What each thing costs us every time it happens. Model calls are priced from `src/lib/ai/pricing.ts` with
the token shape stated, so a list price change there moves these too.

| Unit | Cost (US$) | Per | Source |
|---|---|---|---|
| Assistant answer on the default model: two calls, 20k tokens in (60% cached), 3k out | 0.242 | answer | gpt-6-astra $10 / $1 cached / $50 per M tokens (pricing.ts, 2026-09-27) |
| Agent run or AI workflow: six turns of 25k in (72% cached), 2k out | 1.128 | run | same |
| Studio build, a model and deck: fourteen turns of 30k in (80% cached), 2.5k out | 2.926 | build | same |
| Deep answer from the largest model at Max reasoning: claude-fable-5-1, 40k in, 15k out | 1.053 | answer | claude-fable-5-1 $10 / $0.25 / $50 (pricing.ts) |
| Reading one incoming email: gpt-5.6-luna, 4k in, 0.5k out | 0.0014 | email | gpt-5.6-luna $0.20 / $1.20 (pricing.ts); routed by `src/lib/ai/route.ts` |
| Drafting one reply: gpt-5.6-terra, 8k in, 0.8k out | 0.018 | draft | gpt-5.6-terra $2 / $12 (pricing.ts) |
| Keeping a mailbox in sync: the five-minute heartbeat, about 1.2 CPU-hours and 0.5 Neon CU-hours a month | 0.21 | mailbox-month | Vercel active CPU $0.128/h; Neon $0.106/CU-h |
| Edge document answer on the small model (gpt-6-luna, 10k in, 1k out) with Voyage rerank | 0.0023 | answer | pricing.ts; Voyage rerank-3 $0.05/M tokens, first 200M free (premium.ts, 2026-09-30) |
| Edge answer on the larger model (gpt-5.6-sol, 10k in, 1.5k out) | 0.07 | answer | premium.ts |
| Cohere Rerank 4, when used in place of Voyage | 0.0025 | search | $2.00–$2.50 per 1,000 searches (premium.ts) |
| Reading a 100-page document: embeddings, parsing on Modal, storage | 0.003 | document | text-embedding-3-small $0.02/M; Modal CPU $0.047/core-hour; R2 $0.015/GB-month |
| LlamaParse on a hard 100-page PDF (planned) | 0.375 | document | $1.25 per 1,000 credits after 10,000 free (premium.ts); about 3 credits a page assumed |
| Speaker-labelled transcript of an hour of audio (planned) | 0.36 | hour | OpenAI $0.006/minute (premium.ts) |
| Satellite ground check on Modal (about 40 L4 GPU-seconds) | 0.009 | check | Modal L4 $0.80/h (premium.ts) |
| 3D map session on Google Photorealistic 3D Tiles | 0.006 | session | Map Tiles API $6.00 per 1,000 root tile requests up to 100,000 |
| LiDAR or terrain job on Modal (about 8 CPU-minutes) | 0.006 | job | Modal CPU $0.047/core-hour |
| Satellite-imagery AI: a GPU pass and a written read-out | 0.255 | analysis | Modal L4; default model as above |
| CoinGecko paid-tier call | 0.00026 | call | Analyst plan $129 a month for 500,000 credits |
| Blockchain RPC call on Alchemy (about 25 compute units) | 0.00001 | call | $0.45 per million compute units, pay as you go |
| Neon compute | 0.106 | CU-hour | Neon Launch, no monthly minimum since December 2025 |
| Neon storage | 0.35 | GB-month | Neon Launch |
| Vercel function CPU | 0.128 | CPU-hour | Vercel Pro on-demand active CPU |
| Vercel data transfer beyond 1 TB | 0.15 | GB | Vercel Pro, Fast Data Transfer |
| Inngest step executions beyond 1M | 0.00005 | execution | Inngest Pro, $50 per extra million |
| Cloudflare R2 storage (no egress fees) | 0.015 | GB-month | R2 standard storage; 10 GB, 1M class A and 10M class B operations a month free |

**Not in any plan.** These are sold at cost on request, or need a licence first:
- Planet scene purchases: PlanetScope about $2.25/km² with a 250 km² minimum, about $560 an order; SkySat
  archive $6/km² with a 25 km² minimum. Searching and thumbnails come with any Planet account and are
  free per use.
- Carbon Mapper commercial terms and the EOG Nightfire licence: priced on request.
- A redistribution licence for market data: needed before paid plans launch (see the README's known gaps).
- An SSO provider for Enterprise: not built yet.

## Fixed monthly bills

These do not grow with each person. They are spread over **200 paying seats**, the launch-scale
assumption in `PAYING_SEATS`.

| Bill | US$ a month |
|---|---|
| Vercel Pro, two developer seats (each includes $20 of usage) | 40 |
| Inngest Pro (1M executions, once past the free 50,000) | 99 |
| Market data, FMP Starter | 19 |
| CoinGecko Analyst, when the crypto work turns the paid tier on | 129 |
| Helius Developer (Solana RPC), when turned on | 49 |
| Desktop app signing: Apple Developer Program ($99 a year), Windows code signing (about $10 a month) | 18.25 |
| Transactional email for receipts and invites (Resend Pro). Mail people send goes through their own mailbox, so it costs us nothing | 20 |
| Edge: reading the deal database (platform AI, no person attached). At most $0.50 a day while the backfill runs, about two months; about $1.50 a month after | 15 |
| Edge: background passes on Modal (Deal Radar's monthly training and weekly scoring, the claim checker's NLI) | 6 |
| Edge: background passes on Vercel and Neon (the weekly Pulse over about 2,000 companies and the daily lists, Deal Radar re-reading filings, thesis ticks, Call Desk's daily pass): about 6 CPU-hours and 10 compute-hours | 1.83 |
| Edge: platform data (R2 capped at 9 GB by the guard; about 100 MB of deals, series and forecasts in Postgres) | 0.17 |
| Algo trading: paper strategy ticks for everyone, Free included (decisions at most daily, batched in Inngest steps; under $1 of CPU and Neon, counted at $2) | 2 |
| **Total** | **399.25**, or **$2.00 per seat** |

The four Edge lines are the shared work no one clicks for (see "Edge's next round" below for how each is
bounded). They are counted at list price even where a free tier covers them today: R2's first 10 GB, and
Modal's $30 monthly credit, which the Edge guard (`EDGE_MODAL_MONTHLY_USD`, $25) keeps Edge inside. Inngest
needs no new line: Edge's next round adds about 10,000–15,000 executions a month (about 720 hourly thesis
runs plus the ticks, 180 backfill slices, 500 Pulse steps and 360 Deal Radar steps), inside Inngest Pro's
million and under the 45,000 guard (`EDGE_INNGEST_MONTHLY`).

Free and Campus users are not charged a share; their use is a marketing cost. With only 50 paying
seats, each seat's share is $7.95, $5.96 more than above. At the lower prices that matters more: it takes
10.1 points off Pro's monthly margin (71.5% to 61.4% at typical use) and 4.0 points off Deal Team's.
CoinGecko and Helius ($178 of the total) are only paid for once the crypto work switches their paid tiers
on, and the deal backfill's $15 only while it runs; without all three the fixed total is $204 a month,
and at 50 seats Pro loses 3.6 points (to 67.9%), not 10.1. Until paying seats pass about 100, keep those
two tiers off and run the backfill before launch.

## Who does what in a month

About 21 working days. Heavy is set high on purpose: the AI part is capped at the allowance, so heavy
means "uses the whole allowance".

| Plan | Light | Typical | Heavy |
|---|---|---|---|
| Free | 3 answers, 2 Edge answers | 6 answers, 4 Edge answers | runs into the $3 allowance |
| Campus | 8 answers, 1 run, 5 Edge answers | 20 answers, 2 runs, 10 Edge answers, 2 documents | runs into the $10 allowance |
| Pro | 10 answers, 1 run, 5 Edge answers, a mailbox (150 emails read, 20 drafts) | 18 answers, 3 runs, a Studio build every other month, 10 Edge answers, 3 documents, a mailbox (300 read, 40 drafts) | runs into the $25 allowance |
| Deal Team | 15 answers, 2 runs, 10 Edge answers, a mailbox (300 read, 60 drafts) | 45 answers, 8 runs, 3 Studio builds every two months, 1 deep answer, 25 Edge answers, 5 documents, 10 ground checks, autopilot (600 read, 150 drafts) | runs into the $60 allowance |
| Enterprise | 25 answers, 4 runs, 15 Edge answers, a mailbox | 80 answers, 15 runs, 4 Studio builds, 4 deep answers, 40 Edge answers (half on the larger model), 20 documents (5 hard PDFs), 4 hours of transcripts, 20 ground checks, autopilot (800 read, 200 drafts) | runs into the $130 allowance |

Infrastructure per person, by level (Neon CU-hours / storage, Vercel CPU-hours / transfer, Inngest
executions, R2 storage):
- light: 0.2 / 0.05 GB, 0.1 h / 0.5 GB, 200, 0.1 GB, about $0.14;
- typical: 0.8 / 0.25 GB, 0.4 h / 2 GB, 2,000, 0.5 GB, about $0.63;
- heavy: 3 / 1 GB, 1.5 h / 8 GB, 10,000, 3 GB, about $2.60.

**Premium features from the other work flow in automatically.** 3D maps, crypto, the desktop app,
the calendar, the meeting copilot, the Newsroom, copy trading, Edge's next round and larger models each
register their features in `src/lib/billing/features/`: an area's own file (`premium.ts`, `maps.ts`,
`crypto.ts`, `desktop.ts`, `meetings.ts`, `calendar.ts`, `news.ts`, `copytrade.ts`, `edge-next.ts`, `algo.ts`), each
spread into `FEATURES` in `features/index.ts` (the test checks all ten are). Anything in `FEATURES` with
`metered: true` and a `costPerUseUsd` is costed by `costToServe()` through `meteredFeatures(plan)`: 4
uses a month of every metered feature a plan unlocks at typical use, 20 at heavy, on every plan at or above
its `minPlan`. Nobody edits `costs.ts`. `scripts/test-billing.ts` checks this by registering a test
feature the same way, and fails if any metered feature has no `costPerUseUsd` or pushes a plan below
target. The room left at typical use, per seat per month, is about $0.87 on Pro (1.5 points of $59),
$1.66 on Deal Team and $6.93 on Enterprise. At the full allowance it is $2.04 on Pro (yearly), $30 on
Enterprise, and only **$0.15 on Deal Team (yearly)**: Deal Team's full-allowance yearly margin is 25.1%,
just above the 25% floor, because most of the features paid outside the AI ledger start there (the
notetaker bot, Planet imagery, Dune, Eva-4B). The next such feature on Deal Team needs a server-side cap
low enough to fit, or a plan above it, or it fails the test. A feature whose model calls go through the
usage ledger is also capped by the AI allowance, so the model counts it twice and errs high.

## Cost to serve and margins

Per person-month, with the AI part capped at the allowance:

| Plan | Light | Typical | Heavy |
|---|---|---|---|
| Free | $0.87 | $2.09 | $5.60 |
| Campus | $3.21 | $7.76 | $12.61 |
| Pro | $6.47 | $14.11 | $32.68 |
| Deal Team | $9.76 | $36.83 | $88.47 |
| Enterprise | $14.45 | $70.51 | $181.90 |

Stripe takes 2.9% + $0.30 per card charge, 0.7% for Stripe Billing, and 0.5% for Stripe Tax (counted
whether or not tax is switched on, so turning it on never breaks a margin). The $0.30 is spread over the
seats on the invoice (the minimum count) and, for yearly billing, over twelve months.

| Plan | Interval | Price | Fees | Light | Typical | Heavy |
|---|---|---|---|---|---|---|
| Pro | monthly | $59 | $2.72 | 84.4% | 71.5% | 40.0% |
| Pro | yearly | $49 | $2.03 | 82.6% | 67.1% | 29.2% |
| Deal Team | monthly | $149 | $6.21 | 89.3% | 71.1% | 36.5% |
| Deal Team | yearly | $125 | $5.13 | 88.1% | 66.4% | 25.1% |
| Enterprise | yearly | $299 | $12.26 | 91.1% | 72.3% | 35.1% |

Typical and heavy rose from the first table (Pro was $13.10 and $29.74) as the meeting copilot, the
calendar, the Newsroom, copy trading and Edge's next round registered their features: each metered
feature a plan unlocks is counted 4 times a month at typical use and 20 at heavy, and flat fees by
adoption. Most of them record their model spend in the AI ledger and so sit inside the allowance; what
moved the margins is the part paid outside it (copy trading's $2 brokerage connection, Recall's notetaker,
Planet imagery, GPU time) and the fixed bills.

## Levers

- **The allowances** in `plans.ts` move both the worst case and what people get. Operators can override
  every plan at once:
  - `AI_USER_DAILY_USD` and `AI_USER_MONTHLY_USD` replace the plan amounts for everyone. During the beta,
    setting these to the old `5` and `150` keeps the beta's behaviour.
  - `AI_GLOBAL_DAILY_USD` still caps everyone together.
- **The default model.** Moving interactive work from gpt-6-astra to gpt-5.6-sol ($4 / $20) cuts the cost
  of an answer by about 60%. That would let Free and Campus get two to three times more answers from the
  same dollars, or the allowances grow without a price change. Routing Free alone to the smaller model is
  the cheapest way to make Free more generous.
- **Seats at scale.** Fixed bills shrink per seat as paying seats grow. Beyond about 500 seats they are
  under $1.

## How the code uses this

- `src/lib/billing/plans.ts`: prices, minimum seats, the AI allowance per plan, and what each plan
  lists.
- `src/lib/billing/costs.ts`: unit costs, fixed bills, personas, `costToServe`, `margin` and
  `marginTable`. It is pure and safe on the client; the plan page uses `answersFor` for its answer counts.
- `src/lib/billing/packs.ts`: credit packs, allowance periods (billing anniversaries) and the drawdown
  arithmetic; `src/lib/billing/credits.ts` reads and writes the credit tables.
- `src/lib/billing/seats.ts` and `/api/billing/seats`: Deal Team and Enterprise seats and the 30-day
  reassignment cooldown (`seat_history`).
- `src/lib/billing/features/`: the premium feature registry, one file per area; `featuresByArea` groups it
  for `/pricing` and the Plan tab, leaving out features registered as planned.
- `src/lib/ai/limits.ts`: enforces the allowance and then the credits. It reads the person's plan every
  15 seconds (from the subscription, an assigned seat and the profile's email, so Campus and
  administrators work in background runs too) and checks today's and this allowance month's spend from
  the usage ledger. Administrators have no cap.
- Stripe:
  - `src/lib/billing/stripe.ts` and `/api/billing/{checkout,credits,confirm,portal,invoices,webhook,status}`
    handle Stripe; `scripts/stripe-setup.ts` creates the products and prices from `PLANS` and
    `CREDIT_PACKS`, the webhook endpoint and the portal configuration.
  - When a price here changes, run the setup script again. It makes a new Stripe price, and the people
    already on the old one keep it until they change plan.

## Updating

1. Change a unit price or the token shapes in `costs.ts`, or the model prices in `src/lib/ai/pricing.ts`.
2. Run `pnpm exec tsx scripts/test-billing.ts --table`.
3. If a margin falls below target, change the price or the allowance in `plans.ts` (or a pack's credit in
   `packs.ts`).
4. Update the tables above.
5. Run `scripts/stripe-setup.ts` with the live key to publish new prices.

### Premium features and the AI allowance

A premium feature sets `inAiAllowance: true` in its registry entry when its spend is recorded in the
AI usage ledger (`recordUsage`). That spend counts against the person's daily and monthly AI allowance
and their credits, so it can never exceed what the plan includes. The cost model counts it inside the
capped AI budget: at light and typical use it replaces ordinary AI work the persona already does, and
at heavy use it is added and the allowance cap bounds the total. Features paid outside the ledger
(imagery bought per km², GPU time, other licences) leave the flag unset and are added on top of the plan's
cost at every level.

### Flat monthly fees

Some costs are a flat charge per person per month while they use a feature, not a cost per use (SnapTrade
bills about $2 per connected brokerage user; the daily Pulse costs about $0.20 a month of background
compute for a full 50-company list). A registry entry gives these as `flatMonthlyUsd` with `metered: true`
(the test fails otherwise, because the model reads only metered features); the model counts it once a
month, weighted by `FLAT_ADOPTION` (none of the light persona, about a third at typical use, everyone at
heavy use), instead of multiplying it by uses.
