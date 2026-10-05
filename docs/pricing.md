# Pricing: what YouBank costs to run, and what each plan charges

The prices and AI allowances in `src/lib/billing/plans.ts` are worked out here from what a person on each
plan costs us to serve. The same numbers live in `src/lib/billing/costs.ts`, and `scripts/test-billing.ts`
fails if a price, a cost or a new premium feature pushes a plan below the margin target. To see the full
table, run `pnpm exec tsx scripts/test-billing.ts --table`.

Checked on 5 October 2026; prices revised the same day to the owner's lower price points. Model prices come from `src/lib/ai/pricing.ts` (checked 27 September 2026), and
Edge's paid upgrades from `src/lib/edge/premium.ts` (checked 30 September 2026). The infrastructure and
third-party prices were checked on 5 October 2026 against published 2026 summaries of each vendor's
pricing page; the vendor pages themselves could not be fetched from the build environment. Confirm each
one on the vendor's page before launch.

## The answer

| Plan | Monthly | Yearly (per month) | Seats | AI allowance (per seat) | Typical margin | Margin at the full allowance |
|---|---|---|---|---|---|---|
| Free | $0 | $0 | 1 | $0.75 a day, $3 a month (about 12 answers) | costs $2.09 a month | costs $5.60 a month |
| Campus (.edu) | $0 | $0 | 1 | $2 a day, $10 a month (about 40 answers) | costs $7.76 a month | costs $12.61 a month |
| Pro | **$59** | **$49** | 1 | $6 a day, $25 a month (about 100 answers) | 73.2% monthly, 69.1% yearly | 45.0% monthly, 35.2% yearly |
| Deal Team | **$149** per seat | **$125** per seat | 3 minimum | $12 a day, $60 a month (about 250 answers) | 74.5% monthly, 70.4% yearly | 51.8% monthly, 43.5% yearly |
| Enterprise | not sold monthly | **$299** per seat | 5 minimum | $30 a day, $130 a month (about 540 answers) | 74.3% | 44.1% |

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
| **Total** | **374.25**, or **$1.87 per seat** |

Free and Campus users are not charged a share; their use is a marketing cost. With only 50 paying
seats, each seat's share is $7.49, $5.62 more than above. At the lower prices that matters more: it takes
9.5 points off Pro's monthly margin (73.2% to 63.7% at typical use) and 3.8 points off Deal Team's.
CoinGecko and Helius ($178 of the total) are only paid for once the crypto work switches their paid tiers
on; without them the fixed total is $196 a month, and at 50 seats Pro loses 3.5 points (to 69.7%), not 9.5.
Until paying seats pass about 100, keep those two tiers off.

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
the calendar, the meeting copilot, new Edge features and larger models each register their features in
`src/lib/billing/features/`: an area's own file (`premium.ts`, `maps.ts`, `crypto.ts`, `desktop.ts`), or
a new file whose list is spread into `FEATURES` in `features/index.ts`. Anything in `FEATURES` with
`metered: true` and a `costPerUseUsd` is costed by `costToServe()` through `meteredFeatures(plan)`: 4
uses a month of every metered feature a plan unlocks at typical use, 20 at heavy, on every plan at or above
its `minPlan`. Nobody edits `costs.ts`. `scripts/test-billing.ts` checks this by registering a test
feature the same way, and fails if any metered feature has no `costPerUseUsd` or pushes a plan below
target. The room left at typical use, per seat per month, is about $1.90 on Pro (3.2 points of $59),
$6.70 on Deal Team and $12.80 on Enterprise. A feature whose model calls go through the usage ledger is
also capped by the AI allowance, so the model counts it twice and errs high.

## Cost to serve and margins

Per person-month, with the AI part capped at the allowance:

| Plan | Light | Typical | Heavy |
|---|---|---|---|
| Free | $0.87 | $2.09 | $5.60 |
| Campus | $3.21 | $7.76 | $12.61 |
| Pro | $6.35 | $13.10 | $29.74 |
| Deal Team | $9.65 | $31.83 | $65.54 |
| Enterprise | $14.34 | $64.70 | $154.96 |

Stripe takes 2.9% + $0.30 per card charge, 0.7% for Stripe Billing, and 0.5% for Stripe Tax (counted
whether or not tax is switched on, so turning it on never breaks a margin). The $0.30 is spread over the
seats on the invoice (the minimum count) and, for yearly billing, over twelve months.

| Plan | Interval | Price | Fees | Light | Typical | Heavy |
|---|---|---|---|---|---|---|
| Pro | monthly | $59 | $2.72 | 84.6% | 73.2% | 45.0% |
| Pro | yearly | $49 | $2.03 | 82.9% | 69.1% | 35.2% |
| Deal Team | monthly | $149 | $6.21 | 89.4% | 74.5% | 51.8% |
| Deal Team | yearly | $125 | $5.13 | 88.2% | 70.4% | 43.5% |
| Enterprise | yearly | $299 | $12.26 | 91.1% | 74.3% | 44.1% |

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
- `src/lib/ai/limits.ts`: enforces the allowance. It reads the person's plan once a minute (from the
  subscription and the profile's email, so Campus and administrators work in background runs too) and
  checks today's and this month's spend from the usage ledger. Administrators have no cap.
- Stripe:
  - `src/lib/billing/stripe.ts` and `/api/billing/{checkout,confirm,portal,webhook,status}` handle
    Stripe; `scripts/stripe-setup.ts` creates the products and prices from `PLANS`.
  - When a price here changes, run the setup script again. It makes a new Stripe price, and the people
    already on the old one keep it until they change plan.

## Updating

1. Change a unit price or the token shapes in `costs.ts`, or the model prices in `src/lib/ai/pricing.ts`.
2. Run `pnpm exec tsx scripts/test-billing.ts --table`.
3. If a margin falls below target, change the price or the allowance in `plans.ts`.
4. Update the tables above.
5. Run `scripts/stripe-setup.ts` with the live key to publish new prices.
