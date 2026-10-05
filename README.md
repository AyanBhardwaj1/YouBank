# YouBank

**The AI deal desk that does the work, and learns how you do it.**

YouBank is a financial research terminal and an email agent for people whose work is deals. It has three
parts:

- **Research.** A terminal with more than 35 functions and 328 tools built on public regulatory data (SEC
  EDGAR filings and XBRL facts, Form D, the Treasury, the BLS, public startup directories) plus market
  prices. Every figure cites its source, and every model shows its working: forecasts with calibrated
  intervals, credit and earnings-quality models, GARCH risk, Monte Carlo valuation and knowledge tracing
  that fits the terminal to how well you know it.
- **Relationships.** An agent that reads your mailbox, drafts replies in your voice, asks you what it cannot
  answer and remembers the answer, runs cold outreach and nurture, and keeps a pipeline current.
- **Autopilot and the adaptive engine.** Autopilot sends on your behalf, but only the kinds of email you
  allow. The adaptive engine decides when a kind of email has earned that, from your own behaviour and
  with a stated error bound.
- **Studio.** A live workbook and deck. The agent builds financial models and pitch books while you watch,
  cell by cell, from SEC data. Slides stay linked to the model, every run is audited and can be undone,
  and it all exports to Excel and PowerPoint. With the add-in it runs inside Excel and PowerPoint too:
  the agent writes into your own workbook live, and decks refresh from the model.

Production: **https://youbank-nu.vercel.app** · Free while in beta.

## Contents

1. [Who it is for](#who-it-is-for)
2. [Features](#features)
   - [Research terminal](#research-terminal)
   - [Tools](#tools)
   - [Company and filing data](#company-and-filing-data)
   - [Private markets](#private-markets)
   - [Newsroom](#newsroom)
   - [AI assistant](#ai-assistant)
   - [Studio: live models and decks](#studio-live-models-and-decks)
   - [Relationships: the email agent](#relationships-the-email-agent)
   - [Autopilot](#autopilot)
   - [The adaptive engine](#the-adaptive-engine)
   - [Teams and live collaboration](#teams-and-live-collaboration)
   - [YouBank for desktop](#youbank-for-desktop)
   - [Site, onboarding and styles](#site-onboarding-and-styles)
3. [Architecture](#architecture)
4. [Data model](#data-model)
5. [Tech stack](#tech-stack)
6. [Running locally](#running-locally)
7. [Environment variables](#environment-variables)
8. [Connecting a mailbox](#connecting-a-mailbox)
9. [Deploying](#deploying)
10. [Testing](#testing)
11. [Security, privacy and compliance](#security-privacy-and-compliance)
12. [Research behind the product](#research-behind-the-product)
13. [Roadmap](#roadmap)
14. [Repository layout](#repository-layout)
15. [Further docs](#further-docs)

---

## Who it is for

The product sits between two groups of tools:

- **General AI assistants.** They will build a DCF for $20 a month, but not from verified data, and they
  do not do the follow-through. In the September 2026 update of Vals AI's Excel Modeling Benchmark,
  frontier models passed only 64% of numerical checks.
- **Platforms that sell the data.** They charge thousands to tens of thousands of dollars a year:
  - Sacra estimates Rogo at about $3,300 per seat a year.
  - Vendr buyer data puts AlphaSense's median contract at $18,375 a year.

  Retail terminals (TIKR, Koyfin) cost $25–$120 a month, but they do not act on anything.

YouBank offers cited, filing-backed work plus an agent that acts on it, priced for the firms in between.

| Who | What YouBank does for them |
|---|---|
| Boutique advisors and placement agents | Comps, buyer lists and teasers without a Capital IQ budget, and an outreach desk that keeps every mandate moving |
| Emerging VC and PE managers | Form D and funding signals on the companies you track, cited diligence, and a pipeline that files itself from your inbox |
| Founders raising or selling | Cold outreach, investor and customer follow-up, and replies to your own team, with autopilot where it has been earned |
| Students recruiting into finance | Real comps and DCFs on real filings, deal walk-throughs, and the same desk they will use on the job |

The terminal and tools are tailored to eight careers:
- investment banking
- private equity
- venture capital
- public markets
- corporate finance
- consulting
- accounting
- students

Each career has its own research, tool pack, watchlists, prompt library and default style.

---

## Features

### Research terminal

`/app/terminal` is a multi-panel terminal driven from the keyboard, with familiar function codes. Company
functions take a ticker (`SNOW WACC`); market functions do not (`ECO`); a few take words
(`EQS profitable software companies growing over 20%`, `PORT AAPL 40 MSFT 30 KO 30`).

**Company**

| Function | What it shows | Models |
|---|---|---|
| `DES` | Description | |
| `FA` | Financial analysis | |
| `GP` | Price chart with 50- and 200-day averages, volume, trend and volatility regime, a price cone | GARCH(1,1) |
| `HP` | Daily price history | |
| `BETA` | Beta four ways, with standard errors and a rolling beta | OLS, Blume, Welch (2022) |
| `RISK` | Volatility now and forecast, VaR and expected shortfall, drawdowns | EWMA, GARCH, Cornish-Fisher, Kupiec backtest |
| `COMPS` | Trading comps | |
| `PREC` | Precedent transactions | |
| `CAP` | Capital structure | |
| `WACC` | Cost of capital from its parts, with a range and a tornado | CAPM, implied-rating spread, Monte Carlo |
| `IRAT` | Implied credit rating and default odds | Altman Z'', Ohlson O-score, Merton distance to default |
| `DDIS` | Debt maturity ladder and refinancing risk | |
| `QUAL` | Earnings quality and red flags | Beneish M, Piotroski F, Sloan accruals |
| `FCST` | Revenue forecast against the Street | M4 combination, conformal intervals |
| `EE` | Earnings: surprises, beat odds, the typical move | Beta-Binomial, conformal quantile |
| `ANR` | Analyst ratings, targets and drift | |
| `DVD` | Dividends and a safety score | |
| `FIL` / `EVT` / `INS` / `XBRL` | Filings, 8-K events, Form 4 insiders, any XBRL concept | |
| `AI` | Assistant | |

**Markets and economy**

| Function | What it shows | Models |
|---|---|---|
| `WEI` / `FXC` / `CMDTY` | World indices, currencies, commodities and crypto | Each move in standard deviations of its own volatility |
| `MOST` / `SECT` / `MA` | Movers, sector performance, M&A filings | |
| `GC` | Treasury curve against a week, a month and a year ago | Nelson-Siegel; the New York Fed recession probit |
| `ECO` | Inflation, jobs, growth and rates, with three-month outlooks | Damped trend, conformal intervals, the Sahm rule |
| `EQS` | A screener over every SEC filer, in plain English | A small model turns words into filters you can edit |
| `PORT` | Portfolio risk: risk shares, correlations, a year of outcomes | Covariance attribution, bootstrap |

**Workspace:** `LEARN` (your mastery of each function, what to learn next, quick quizzes), `PG` (peer
groups), `TOOLS` and `TOOL <id>`.

**What makes it more than a data screen:**
- **Models and sources** on every analytics screen: the method, its assumptions and where the inputs came from.
- **AI read:** a small, cheap model writes a three-bullet read of any screen from its numbers alone.
- **Ask AI** hands a screen's question to the assistant, which has the same models as tools.
- **Knowledge tracing:** typing a command is evidence you know it, clicking a suggestion weaker evidence,
  closing a panel straight away evidence against. Hints fade as mastery grows and the next functions
  unlock when their prerequisites are known (Bayesian knowledge tracing with forgetting).
- **Fast:** every screen but DES and FA loads on demand, data is cached and reused across panels, and
  hovering a function on the strip prefetches its data.
- **Honest about data:** a function whose data the market-data plan does not cover says so and points to
  the ones that work for every US filer.

Type into the command bar, for example `SNOW COMPS`, `CCL IRAT` or `DDOG TOOL dcf`. `/` or Cmd+K focuses it,
`?` lists every function. Each seat gets a function strip for its role. A ticker that is also a code works
with a function after it: `PG DES` is Procter & Gamble.

### Tools

`/app/tools` holds **328 tools**:
- **230 AI workflows** that research and draft;
- **98 calculators** that compute exactly, including an inference pack: a Monte Carlo DCF with correlated
  inputs, a credit scorecard, a forecast with calibrated intervals, a beta estimator, a pipeline forecast,
  an earnings-quality check and a VaR backtest.

Both kinds render into the same 19 kinds of output block:
- headline numbers, tables, bridges and sensitivity grids;
- risk registers, checklists, timelines and question banks;
- drafted emails.

**AI workflows.** A workflow's instructions are a numbered method that names the exact data tools and search
phrases to use. The model streams tool calls and returns JSON that matches the output contract.

**Calculators.** A calculator is a pure `compute(inputs)` function. It recalculates as you type and can be
prefilled from the loaded company's SEC data.

**Saved runs.** Every run is saved with its inputs, output, sources, model and duration. Reopen it from the
library at `/app/tools/<id>?run=<n>`.

How to add tools: [docs/05-tool-pack-authoring.md](docs/05-tool-pack-authoring.md).

### Company and filing data

- **Fundamentals** come from SEC XBRL company facts.
  - LTM is the fiscal year plus year-to-date, less the prior year-to-date.
  - Each figure uses the concept the filer actually used.
  - Restatements are de-duplicated by accession number.
- **Filings** cover EDGAR submissions and full-text search across every filing and exhibit since 2001. That
  includes merger proxies, credit agreements, indentures and comment letters, with 8-K item codes decoded.
- **Insiders** come from Form 4 transactions. Capital structure, precedents, peer groups and saved comps
  sheets are also available.
- **Prices** come from Financial Modeling Prep: quotes, market cap and the 52-week range, and on the
  terminal daily history, estimates, grades, dividends, sectors and M&A filings. The free plan covers
  daily prices for about 87 sample tickers and caps requests per day; FMP Starter (about $19 a month
  billed yearly) covers every US symbol, and a display licence is needed before prices are shown to
  paying users.
- **Backups when FMP is out** (its daily limit, or a ticker the plan does not cover), in order:
  1. **Free sources.** Nasdaq's quote API for every US stock and ETF (history, quotes, market cap,
     dividends, earnings surprises and dates, EPS forecasts, analyst targets and ratings, movers); ETFs
     that track the indices and commodities it does not list (S&P 500 via SPY, gold via GLD); the
     ECB's reference rates for currencies; CoinGecko for crypto; the SPDR sector ETFs for sectors;
     merger filings on SEC EDGAR for deals; and, for dividends outside Nasdaq's listings, dividends per
     share from each company's own 10-K and 10-Q filings. Dividend history is restated for stock splits,
     which the filings reveal as a jump in the cover-page share count.
  2. **AI research.** GPT-5.6 Luna with web search looks up what is still missing (a next earnings
     date, a consensus figure, a price, a description). A figure is kept only if its page is one the
     search retrieved, the quote copied from the page contains it, it is recent enough, and it is
     plausible; when fewer than half survive, one retry goes to GPT-5.4 mini. A lookup costs a few
     cents, is cached for hours and is logged in the usage ledger.
  Every screen shows a "Backup data" badge naming the sources used, marks ETF stand-ins ("via SPY"),
  and lists researched figures with links to their pages. Nasdaq's API is the site's own and is meant
  for personal use, so the backups suit the free beta; `MARKET_BACKUP=off` turns off Nasdaq, the ECB
  rates, CoinGecko and AI research (SEC filings are public domain and stay on). Operators
  can check which layers answer from production at `/api/market/health` (Bearer `CRON_SECRET`).
- **Rates and the economy** come from the Treasury's daily par yield curve and the BLS (both public
  domain), which feed the models, and FRED, which is shown with attribution only: FRED's terms bar using
  its content with machine learning or language models, so it never reaches the assistant or a model.
- **Stated limits:**
  - Consensus estimates are not licensed, so NTM figures are entered by you and marked as manual.
  - Reported EBITDA is operating income plus D&A, not a company-adjusted figure.
  - Fiscal years are not calendarized.

### Private markets

`/app/vc` holds a directory of **18,037 startups** (snapshot of 21 September 2026). Sources:
- Y Combinator, a16z and Thiel Fellows
- Show HN
- SEC Form D
- AI web discovery

It also lists Form D raises with amounts and officers.

A nightly job (`/api/cron/sync`, 06:00 UTC) refreshes the directory:
- Show HN and Form D, for the last three days;
- the YC, a16z and Thiel lists.

### Newsroom

`/app/news` is a news desk for each profile: every group of an investment bank (energy gets EIA reports,
OPEC, pipeline and LNG approvals; restructuring gets bankruptcies and missed coupons; ECM gets IPO
filings and pricings), private equity, venture, public markets, corporate finance, consulting,
accounting and students. Every ten minutes it reads about ninety free sources and turns them into
stories:

- **Publisher feeds.** Bloomberg, the WSJ, the FT, NYT DealBook, CNBC, Axios, Semafor, TechCrunch,
  STAT, the Industry Dive titles, trade press. Headlines and links only; articles are never
  republished. Open pages (not paywalled, allowed by robots.txt) may be read to write a better summary,
  but their text is never stored or shown.
- **Filing signals** from EDGAR's latest-filings feed, often before the press: 8-K items that matter
  (merger agreements, bankruptcies, restatements, auditor changes, changes of control), IPO filings and
  pricings, 13D stakes, tender offers, going-private filings, merger proxies, late filings, and Form D
  raises and fund closes.
- **Regulators and wires.** Federal Register rules (FERC, FDA, SEC, the Fed, FCC…), the Fed, SEC, FDA,
  EIA, BLS and BEA, and the PR Newswire, GlobeNewswire and Business Wire press-release feeds.
- **A radar for every sector.** Early signals before they are news, each linked to its source, a map
  of where they are happening (bubbles by place, arcs for trade flows and cross-state bank deals), and
  the sector's deals. Each person picks a sector; the default is their desk's.
  - Technology: the tech radar (Hugging Face daily papers and trending models, GitHub's fastest-rising
    repositories, Show HN launches).
  - Energy: gas pipelines, LNG terminals and export applications, hydro and nuclear projects moving
    through FERC, DOE and NRC, at each step; EIA analysis and DOE-funded research.
  - Healthcare: new industry Phase 2 and 3 trials with where they enroll (ClinicalTrials.gov), FDA
    approvals with new molecular entities and priority reviews marked (openFDA), and Phase 2 and 3
    results in NEJM, The Lancet, JAMA, Nature Medicine and JCO (PubMed).
  - Financials: bank mergers, acquisitions and changes in control awaiting the Fed, with comment
    deadlines (read from Federal Register notices); FDIC failures; Fed, NBER and arXiv research.
  - Industrials and consumer: ITC anti-dumping and patent import cases with the countries involved,
    Entity List changes and USTR actions; EPA, DOT, OSHA, FTC and CPSC rules; CPSC recalls with
    units, where sold and where made; robotics research.
  - Media and telecom, real estate: FCC, HUD and FHFA rules in motion; networking and housing research.
  Built from public sources, cached a day and refreshed by the Newsroom pass; a source that does not
  answer keeps its last good lane.
- **Research briefs.** Twice a day, a small model with web search looks for each active desk's stories
  that have no feed (Reuters, AP); a story is kept only if its page was retrieved and is recent.

The same event from many outlets becomes one story (headline embeddings plus word and figure overlap,
calibrated on live headlines), ranked for each person by desk fit, importance, watchlist, the
companies where their contacts work, follows, mutes and freshness, with the reason shown. A small model
reads the important stories once: bullets, key numbers, why it matters, companies (tickers checked
against SEC's list) and deal terms. Deals and raises fill a tracker with the premium to the unaffected
close and implied multiples from SEC figures, and advisor league tables.

- **Four editions**, chosen in the header or in Settings: Terminal (a Bloomberg-style wire), Editorial
  (an FT-style magazine), Brief (an Axios-style morning brief with the wire alongside) and Modern (an
  Apple News-style dashboard). With the advanced switch, any look goes with any layout. Stories open in
  a side peek or on their own page; motion is rich, subtle or off (and off under reduced motion).
- **The morning brief**, written once a day per desk with a "for you" section, on Home, in the app, and
  by email (from your own connected mailbox), browser push or Slack.
- **Alerts** for watchlist companies (urgent for a bankruptcy, restatement or takeover), companies
  where your contacts work (also raised in Relationships as a reason to reconnect, drafted on approval),
  $1B+ deals and top stories for your desk, with quiet hours.
- **In the terminal**: `TOP` (your desk's top stories), `CN` (company news), `NI <topic>`, and the
  latest news on `DES`.
- **The AI budget** is capped at $25 a month (`NEWS_AI_BUDGET_USD`), in tiers: personal notes pause
  first, then research, then briefs; past the cap the Newsroom still works without a model.

### AI assistant

**One interface over two providers:**
- **OpenAI:** the Responses API, default model `gpt-6-astra`.
- **Anthropic:** the Messages API, with extended thinking.

You can switch the model and the reasoning depth (low, medium, high or xhigh) per run. The assistant streams
its output, calls function tools, shows reasoning summaries, searches the web and returns structured output.

**Twenty-one tools:**

| Tool | Tool | Tool |
|---|---|---|
| `get_company_financials` | `get_trading_comps` | `search_companies` |
| `search_filing` | `read_filing` | `web_research` |
| `form_d_search` | `search_startups` | `edgar_fulltext_search` |
| `read_document` | `get_recent_filings` | `get_xbrl_series` |
| `get_insider_transactions` | `calc` (exact arithmetic) | `get_price_risk` |
| `get_credit_risk` | `get_earnings_quality` | `get_revenue_forecast` |
| `get_cost_of_capital` | `get_macro_outlook` | `screen_companies` |

The last seven are the terminal's models, so an answer about risk, credit, a forecast or the economy
names the model behind each number and gives a range.

**Cost.** Classification, extraction and summaries route to a small model (GPT-5.6 Luna or Claude Haiku
4.5) and drafting to a mid-sized one, which costs a fraction of the flagship; system prompts are kept
stable so the providers' prompt caches apply; read-only tools run in parallel; and every call's tokens and
cost are recorded and shown in Settings. See [docs/research/ai-inference.md](docs/research/ai-inference.md).

**Modes:** analyst, research, draft, critique, and coach (mock interviews).

### Studio: live models and decks

`/app/studio` is a spreadsheet and slide workspace where the agent does analyst work while you watch. You
can start in three ways:
- describe what you need;
- pick a template and a ticker;
- drop in an .xlsx, .xlsm or .csv.

The terminal's company page also links straight to a new DCF, valuation pack, LBO or comps model for
that ticker.

#### Watching the agent work

- The agent's edits stream to your screen the moment each one is stored. New cells appear in reading
  order and glow, and the agent's cursor shows where it is writing. The view follows it across sheets
  and slides.
- Other people with the document open see the same edits over a live event stream.
- Every run ends with:
  - an audit of the model, shown as a health strip;
  - a refresh of the data tables;
  - a short summary with cell references.
- **Speed:** choose Fast, Balanced or Thorough.
- **Stop:** halts the agent between steps.
- **Undo this run:** reverses everything the run did. Every single change, by the agent or a person, is
  in the History tab with its own undo.

#### The spreadsheet

The grid is built to feel like Excel:
- a formula bar and name box, selection by click, shift-click or drag, and Excel keyboard navigation;
- type-to-edit and F2, clearing with Delete, and undo with Cmd/Ctrl+Z;
- copy and paste as tab-separated text, to and from Excel. Pasting within Studio adjusts relative
  references.
- frozen panes, merged cells, text that spills into empty neighbours, and resizable columns;
- number formats and banker colour shortcuts;
- cell comments, source markers, and a "cell types" legend that tints inputs, formulas, links and
  numbers typed into formulas.

The calculation engine (`src/lib/studio/`) is YouBank's own, and it runs in the browser and on the server:
- **Formula language.** A tokenizer and parser follow Excel's rules: negation binds tighter than `^`, and
  `^` is left-associative. They handle sheet-qualified references, whole columns and rows, defined names,
  error literals and array arithmetic.
- **About 120 functions,** including:
  - NPV, XNPV, IRR, XIRR, MIRR, PMT, IPMT, PPMT, PV, FV, NPER, RATE, RRI and EFFECT;
  - INDEX, MATCH, XLOOKUP, VLOOKUP, OFFSET and INDIRECT;
  - SUMIFS, COUNTIFS, AVERAGEIFS and SUMPRODUCT;
  - EDATE, EOMONTH and YEARFRAC;
  - TEXT, the statistical functions and the logical functions.

  They are tested against the results Excel documents.
- **Recalculation.**
  - Values are computed lazily and cached.
  - A dependency graph means an edit recalculates only the cells that depend on it.
  - Deep chains are evaluated bottom-up, so a 6,000-step chain does not exhaust the stack.
- **Circular references.** They are solved the way Excel's iterative calculation does it. Tarjan's
  algorithm finds each circular group, which is then solved by Gauss–Seidel substitution, ordered so a
  loop that is switched off settles at once. The limit is 100 iterations, stopping when nothing moves
  by more than 0.001. The LBO template charges interest on average debt balances, with a
  circuit-breaker switch.
- **What-if tools.** Two-way data tables (the output recomputed for every pair of inputs) and goal seek.
- **Imported workbooks.** A cell using a function YouBank does not implement shows the value the file
  had saved.

#### Templates

Each template is fully formula-driven and filled from SEC XBRL company facts and market data:
- blue inputs, black formulas, green links;
- USD millions;
- key outputs saved as named ranges.

| Template | What it builds |
|---|---|
| DCF | Unlevered free cash flow over 5 years; a CAPM WACC build; mid-year convention; perpetuity-growth terminal value; implied price and upside; a live WACC × terminal-growth grid written as formulas, with its steps as inputs. For a loss-making company, the margin ramps to its margin before stock-based compensation |
| Trading comps | Peers from the saved peer group or a list you give; EV/revenue and EV/EBITDA with quartiles; the implied value range of the target |
| Valuation pack | DCF, comps and a summary sheet that feeds a football field, plus a linked 6-slide pitch deck |
| LBO | Sources and uses; a debt schedule with a cash sweep and interest on average balances; IRR and MOIC; an entry × exit IRR data table. It uses adjusted EBITDA, with a take-private entry at a 25% premium, for listed companies |
| Merger model | Accretion/dilution, breakeven synergies, and a live premium × stock-mix grid |
| Cap table | A priced round, with the option-pool top-up solved in closed form |

#### The deck

- Slides are 16:9. Their tables, charts, figures and football fields are **links into the model**, so a
  changed assumption flows to every page.
- Charts come in column, bar, stacked, line, pie, waterfall and football-field forms.
- You can edit titles and text, drag elements to move or resize them, reorder slides and comment on
  them.
- **Tie-out** checks the deck against the model. It flags:
  - broken links and error values;
  - tables typed in by hand;
  - any number in slide text that is not in the model at the precision shown.

#### Grunt-work tools

These are available to the agent and one click away in the toolbar:
- **Audit:** errors, numbers typed into formulas, overwritten formulas in projection rows, formulas that
  break their row's pattern, references to empty cells, unused inputs, circular references and failed
  checks. Each finding links to its cell.
- **Banker formatting:** colours, and number formats chosen by what each row is about.
- **Refresh data tables.**
- **Turn the comments:** the agent makes each requested change across the model and the deck, then
  resolves each comment with a note.
- **Intake report** for uploads: sheets, cells and formulas; hidden sheets; links to other workbooks;
  unsupported functions; and what could not be kept (macros, images, conditional formats, charts). A
  "Review this file" button is included, and file contents are treated as data, never as instructions.
- **Uncertainty tools:**
  - `monte_carlo` draws the model's own input cells (optionally correlated through a Gaussian copula),
    recomputes the whole workbook for each draw without changing it, and writes percentiles, a tornado
    and each input's share of the variance to a Monte Carlo sheet slides can link to;
  - `suggest_assumptions` gives data-driven ranges for growth, margin, WACC and terminal growth;
  - `forecast_series` extends history with calibrated intervals;
  - `risk_check` adds the implied rating and earnings-quality flags.
- **Per-career quick tasks:**
  - bankers get valuation packs and football fields;
  - PE gets LBOs, returns attribution and IC decks;
  - VCs get rounds, cap tables and liquidation waterfalls;
  - students get "plant three errors for me to find".

#### Files

| Direction | What happens |
|---|---|
| Export .xlsx | Formulas with their computed results, styles, widths, frozen panes, merges and defined names. Newer functions get Excel's `_xlfn.` prefix, and the file asks Excel to recalculate on open. Data tables are written as values with a note |
| Export .pptx | Native, editable tables and column, bar, line and pie charts. Football fields and waterfalls are drawn as precise shapes, the way think-cell does it. Sources, page numbers and confidentiality lines are included |
| Import | .xlsx and .xlsm, keeping values, formulas (shared formulas expanded), number formats, fonts, fills, borders, widths, frozen panes, merges and defined names. Also .csv |

#### Inside Excel and PowerPoint

The YouBank add-in puts Studio inside Excel and PowerPoint, on the web, Windows and Mac. Install it from
`/app/office` (the manifest is served at `/office/manifest.xml`), click **YouBank** on the Home tab, and
connect with a code.

**Connecting.** Office runs add-ins in a frame where a site's cookies are often blocked, so the add-in signs
in with a device code, not a session:
1. The add-in asks for a code and shows it (`ABCD-2345`, with no look-alike characters).
2. The person approves it at `/office/connect`, signed in to YouBank. That page sits outside the app, so a
   first-time user can sign in and approve before the ten-minute code expires.
3. The add-in holds a poll secret that only it knows, and uses it to collect a device token, once.

Only hashes of the poll secret and the token are stored. Every connected install is listed at
`/app/office`, and disconnecting one stops its token at once. The Studio API accepts either the browser
session or the token, so the add-in uses the same routes as the browser.

**Excel.** A workbook links to a Studio document in one of three ways:
- build a model here: a DCF, comps, an LBO or a valuation pack from SEC data;
- use the workbook as it is: a blank sheet or your own model;
- open an existing YouBank model into it.

Once linked:
- **The agent writes into your workbook live.** Each patch the agent commits streams to the add-in and is
  applied at once through Office.js.
  - Cells are grouped into runs along a row, one range per run.
  - The selection follows the agent unless you turn **Follow** off.
  - Everything that writes to Excel goes through one queue, so edits land in order.
  - A formula Excel rejects fails alone; the rest of the change still lands.
- **Your edits sync back.** A change marks its sheet. A second later that sheet is read and sent, and
  Studio stores the difference as one undoable change ("Synced from Excel: 3 cells").
  - A snapshot is compared by value, so a recalculated result, a formula's letter case or a source tag
    does not count as an edit.
  - Renaming a sheet in Excel renames it in Studio, so the deck's links survive.
  - New, deleted and reordered sheets are picked up on a four-second beat.
- **A sync cannot undo newer work.** The add-in says which change it last applied. If anything newer has
  landed, the server refuses the sync (409); the add-in catches up and tries again.
- **Reopening a workbook days later.** The workbook remembers the last change it saw. When it opens, the
  add-in:
  1. rebuilds that state from the undo patches of everything since;
  2. replays those changes into Excel;
  3. sends anything typed into Excel while it was closed.
- **What makes the round trip:** values, formulas, number formats, fonts, fills, borders, alignment,
  column widths, frozen panes, sheet order and defined names. Text that Excel would turn into a number or
  a date ("2025", "Jun-25") is written with a leading apostrophe, so it stays text.
- **Large workbooks.** Snapshots are gzipped. A sheet is read up to 150,000 cells, and its formats up to
  25,000 cells. A workbook is limited to 400,000 cells.

**PowerPoint.**
- **Insert the deck.** The deck arrives after the selected slide, as native tables and charts. Each slide
  is tagged with its Studio slide and document.
- **Refresh from the model.**
  - Each tagged slide is replaced in place with its current version.
  - Slides new in Studio are added after the last one; slides deleted in Studio are removed.
  - Slides you made yourself are never touched.
  - PptxGenJS numbers exported slides from 256, which is how one slide is picked out of the file.
- **Keep my edits** unlinks the selected slides, so a refresh leaves them alone.
- The brand check, the tie-out and the agent are in the pane. After an agent run, the slides refresh.

**Requirements.** ExcelApi 1.9 and PowerPointApi 1.3: Microsoft 365, Office 2021 or later, or Office on
the web.

#### Checkpoints

- Save the model and deck under a name ("Sent to MD"). You can do it from Studio's History tab, from the
  add-in, or by asking the agent.
- **What changed since** is a semantic diff, not a cell dump. It shows:
  - the key outputs (named outputs, key-output cells and slide metrics), with before, after and the change
    in percent;
  - every input that changed, with its row label;
  - the formulas that changed;
  - sheets and slides added, removed or renamed.
- Two checkpoints can also be compared with each other.
- **Restore** returns to a checkpoint as one change, which can itself be undone.
- Comparisons ignore key order, because Postgres `jsonb` re-sorts object keys.

#### Brand check

Run it from Checks, from PowerPoint, or by asking the agent. It flags what gets a book sent back:
- a cover dated in a past month;
- a page of figures without a source line;
- elements running off the page or into the footer, and elements overlapping;
- text that will not fit its box, text under 9 pt, and colours outside the deck's palette;
- tables with too many rows for their space;
- headline figures without a caption, empty slides and two-line titles.

Most findings come with a fix:
- bring the cover date up to this month;
- add a source line naming the model's sheets;
- move an element inside the page;
- reduce a font size;
- use the theme colour.

**Fix all** applies every fix as one change. Fixes to the same element stack rather than overwrite each
other.

#### Paper in: marked-up printouts and data rooms

- **A marked-up printout becomes comments.**
  - Upload a PDF or a phone photo of the reviewer's pen marks.
  - The model reads the handwriting, circles and arrows against an outline of the live document: slides by
    number, rows by label, periods by column header.
  - Each mark becomes a comment on its slide or cell. Marks it cannot place land on their page's slide,
    and are counted.
  - Then **Turn the comments** has the agent make the changes.
- **A data-room PDF becomes a sheet of sourced inputs.** Upload a CIM, audited accounts or a management
  deck, and its financial tables become a new sheet:
  - each table sits under a banded title with its unit and page;
  - figures are copied exactly as printed, as blue inputs; parentheses become negatives and percentages
    become decimals;
  - each figure is tagged with its file and page;
  - notes on restatements, adjustments and unaudited periods are kept at the foot.
- Files can be up to 4 MB: PDF, PNG, JPEG, WebP or GIF. Printed text is treated as content, never as an
  instruction.

Research behind Studio:
[docs/research/studio-competitive-landscape.md](docs/research/studio-competitive-landscape.md) and
[docs/research/analyst-grunt-work.md](docs/research/analyst-grunt-work.md).

### Relationships: the email agent

`/app/crm` has eight tabs: **Queue**, **Inbox**, **Pipeline**, **Contacts**, **Insights**, **Campaigns**,
**Nurture**, and **Agent & autopilot**.

#### Mailboxes

A mailbox connects in one of two ways:

- **App password (IMAP and SMTP).** Presets cover Gmail and Google Workspace, iCloud, Yahoo, Zoho and
  Fastmail.
  - Mail is read over IMAP (imapflow) and sent over SMTP (nodemailer), from your own address.
  - This is the fastest route and needs no Google review.
- **Gmail API with OAuth.** Available when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
  - It uses the `gmail.readonly` and `gmail.send` scopes only.
  - Sync is incremental through Gmail's history API.

**Threading.**
- Threads are keyed by Gmail's thread id where the server exposes it (`X-GM-THRID`). Otherwise the key is
  the root `Message-ID`, found from `References` and `In-Reply-To`.
- Replies carry `In-Reply-To` and `References`, so they thread in the recipient's mail client.
- A reply is sent from the mailbox that received the thread.

#### Two modes

The mode changes the triage prompts, the pipeline and the writing role.

| Mode | For | Pipeline |
|---|---|---|
| Deal flow | Investing in or advising companies | inbox → screening → diligence → partner review → term sheet → portfolio (or passed) |
| Business development | Selling, partnering, fundraising | lead → contacted → engaged → meeting → proposal → won (or lost) |

#### Triage

Every new thread is classified. Triage records:

- **A category.** One of: prospect, customer, partner, colleague, founder pitch, intro request, portfolio
  update, LP or investor, scheduling, diligence material, vendor, recruiting, newsletter, other.
- **An audience.** A thread is *internal* if the sender is at one of your company's domains, and *external*
  otherwise.
- **Whether it needs a reply,** decided by deterministic rules together with the model.
- **The stage** the email implies for the deal.
- **Whether the sender opted out.** "Please remove me" is an opt-out; "not right now, try us next year" is
  not.

Newsletters, auto-replies, no-reply senders and bulk mail are recognised and never answered.

#### Drafting

Every draft is written as you. The draft prompt includes:
- your "About you" and signature;
- your standing instructions and knowledge (pasted, or uploaded as .txt, .md or .csv);
- a writing voice learned from your sent mail (a description of how you write, with no details about the
  people you wrote to);
- your playbook answers and active lessons;
- the three most similar emails you have sent yourself, as examples of tone.

Each draft carries:
- a rationale;
- a confidence (high, medium or low);
- a `sensitive` flag for money, terms and legal matters. Quoting a price exactly as you authorised it is
  not sensitive.
- the questions it needs you to answer.

#### It asks, and remembers

When a reply needs something only you know, such as a price, a date or a yes, the agent asks one short
question in the queue.

- Your answer completes the draft.
- Tick "remember" and the answer goes into the playbook. The model first rewrites it so that it answers the
  next person who asks, not only this thread.
- Every later draft uses the playbook, so the same question is not asked twice.

#### The review queue

Everything the agent writes appears in one place:
- questions waiting for you;
- offers to put a kind of email on autopilot;
- suggested next steps;
- a composer for new emails;
- scheduled automatic sends, each with a countdown and a Stop button;
- drafts waiting for review;
- recently sent mail.

You can edit a draft before sending it, and it goes out from your mailbox.

#### Suggestions

The agent proposes next steps, each with its reasoning:
- a stage move the latest email implies;
- a follow-up when nobody has answered (after 5 days by default);
- a check-in on a deal that has gone quiet (21 days by default);
- a reconnection when a contact's company files a Form D. Funding signals are matched to your contacts by
  company.

#### Nurture

Nurture rules find relationships that have gone quiet. For each one, the agent decides whether there is an
honest reason to write. When there is not, it logs why. Each rule has a daily draft cap.

#### Campaigns

Cold outreach, from lead list to follow-ups:

- **Leads** come from the startup directory (filtered) or from a pasted list. Pasted leads without an email
  address are counted as skipped, not dropped silently.
- **Qualification** checks each lead against an ideal profile before anything is written.
- **Sequences** are personalised and multi-step. A sequence stops when the lead replies or opts out.
- **Consent guard.** Recipients at EU, EEA and Canadian domains are skipped unless you confirm that you have
  consent or another lawful basis.
- **Cross-account cap.** No recipient gets more than one first cold email through YouBank in 30 days,
  counted across every account.
- **Experiments.** The first email's opening angle and send time are chosen by the adaptive engine's
  outreach experiments.

#### Contacts, pipeline and compose

- **Contacts** are grouped by kind: prospect, customer, partner, colleague, founder, investor, LP, banker or
  operator.
- **Deals** move through the mode's stages.
- **Threads** show their activity, including what autopilot did.
- **Compose** writes a new email from a one-line instruction.

#### Insights

Relationship intelligence from the mail the agent has read, each number with its method:
- **Relationship strength** (0 to 100): recency-weighted emails times how two-way they are, scaled to your
  own volume.
- **Reply odds** for a new email to each contact: a logistic model trained on your own settled emails,
  used only when it beats per-contact reply rates on your most recent quarter (Brier score shown).
- **Waiting on a reply:** Kaplan-Meier over every email says when an unprompted reply becomes unlikely;
  threads past that point are marked "nudge due", with a one-click nudge draft.
- **Going quiet:** people who wrote regularly and are well past their usual gap, with a reconnect draft.
- **Pipeline forecast:** each open deal's win odds (stage priors calibrated to your record, moved by
  engagement), the exact distribution of wins and a simulated P10/P50/P90 value.
- **What each contact knows:** every email is tagged once with its topics by a small model; replaying a
  contact's mail gives, per topic, the chance they know it (knowledge tracing with forgetting) and how
  much they engage with it. Drafts to them are told not to re-explain what they know and what is worth
  raising next.

#### The morning run

`/api/cron/agent` runs daily at 11:00 UTC. It works in this order:

1. The scans, which only read data: funding signals, follow-ups and stale deals.
2. The work that calls the model: nurture rules and due campaign steps. Each has its own cap, and the whole
   run has a time budget.
3. Settling the outreach experiments.

It only drafts. Drafts of a kind that is on autopilot are scheduled, and the send queue sends them within
your sending hours. Each person can turn the morning run off.

### Autopilot

Autopilot is **off by default**. When it is on, each kind of email has its own setting: **Off**, **Ask me** or
**Autopilot**.

| Kind of email | Default |
|---|---|
| Replies to people outside your company | Ask me |
| Replies to your coworkers | Ask me |
| Cold email campaigns | Ask me |
| Follow-ups when nobody answers | Off |
| Reconnecting with quiet contacts | Ask me |

**Other settings:**

| Setting | Default | What it does |
|---|---|---|
| Hold before sending | 5 minutes | A window in which to stop any automatic email |
| Daily cap | 40 | Maximum automatic sends per rolling 24 hours, across everything |
| Sending hours | 08:00–19:00 | In your time zone |
| Weekdays only | On | No automatic sends at weekends |
| Read my mailbox every few minutes | On | Lets the heartbeat sync the mailbox |
| Company email domains | Your mailbox's domain, unless it is a public provider such as gmail.com | Who counts as a coworker |

#### What autopilot will not send

Checks run when a draft is considered, and again just before it is sent. A draft that fails any check comes
to you with the reasons written down.

- The agent's confidence is not high.
- It touches money, terms, legal or anything sensitive.
- It needs an answer or a decision from you.
- It contains a blank to fill in.
- It is empty or has no recipient.
- The recipient is an automated address, or the draft answers an automated message.
- The recipient asked not to be contacted (for anything that is not a reply to them).
- Autopilot has already sent twice in this conversation today.
- **Security veto:** it contains a link, email address or account-like number (8+ digits, or IBAN-shaped)
  that does not appear in your own settings, knowledge, playbook or signature. An inbound email therefore
  cannot steer the agent into sending an attacker's link.
- **Earned autonomy:** that kind of email is on probation, or this draft was picked as a spot check (see
  [the adaptive engine](#the-adaptive-engine)).

#### How a send happens

1. A scheduled draft waits out the hold, and then for your sending hours.
2. Just before sending, the send queue re-reads the live thread. If you already replied (from your phone,
   say), or a newer message changed the question, the draft is withdrawn.
3. The send claims the draft (`pending` → `sending`), so a draft can go only once. A send stuck in
   `sending` is recovered from the time it was claimed.
4. `sendDraft()` in `src/lib/crm/send.ts` is the only code that sends. It adds your signature and threading
   headers, refuses an opted-out recipient, and records who sent it (you or autopilot).

#### The heartbeat

Vercel's Hobby plan runs cron at most once a day, which is too slow for an agent that answers email.
Instead:
- A **Neon Function** (`neon/autopilot.ts`) with a schedule trigger (`*/5 * * * *`) calls
  `/api/cron/autopilot` every five minutes with a bearer secret.
- The function relays only genuine trigger deliveries. Neon strips any `x-neon-*` header a caller sends, so
  an `x-neon-trigger-invocation-id` that matches the body's `invocation_id` can only come from the trigger.

**Each pass, for each person with autopilot on:**
1. Take a per-person lock, so passes never overlap. A manual sync takes the same lock.
2. Sync the mailboxes. Then triage and draft each new thread, and consider each draft for sending.
3. Draft due follow-ups, unless follow-ups are off.
4. Prepare due campaign steps.
5. Send whatever is due.

#### Regulated mode

Regulated mode is for FINRA and SEC registrants.
- Autopilot cannot be switched on.
- Every email is sent by a person, from their own mailbox, so the firm's archive captures it.
- An **audit log (CSV)** lists every email the agent drafted, who sent it, and how much it was edited
  (`/api/crm/audit`).

### The adaptive engine

**The principle.** A language model's confidence in itself is not evidence. It stays a hard gate: nothing
below high confidence is sent automatically. But what to automate is decided from what the person does.

**The code:**
- `src/lib/crm/engine-rules.ts`: the pure rules. The public site's live demo runs the same file in the
  browser.
- `src/lib/crm/engine.ts`: the server side.
- `src/lib/crm/learning-math.ts`: dependency-free maths:
  - the Beta CDF (Lentz's continued fraction) and its quantile (bisection);
  - Lanczos log-gamma;
  - Marsaglia–Tsang gamma sampling, for Beta sampling;
  - a seeded mulberry32 generator.

There are three learning loops per account.

#### Loop 1: earned autonomy

**Labels.** Every draft the person sends is a label.
- The **edit ratio** is the word-level Levenshtein distance between draft and sent text, divided by the
  length of the longer one. The signature is stripped first.
- A draft is **good** if the ratio is at most 0.05 *and* no critical field changed: a number, amount,
  percentage, link, email address, weekday or month.
- Otherwise it is **bad**: edited (ratio ≤ 0.25), rewritten, or a critical change. A light edit still
  counts as bad, because autopilot would have sent it wrong.
- Discarded drafts are not labels, because "no reply needed" and "wrong reply" look the same from outside.
- Stopping an automatic send counts as a bad label and extends the cancel streak.

**Strata.** Trust is kept separately for each kind of email, audience and category. Examples:
`reply:internal:colleague`, `reply:external:prospect`, `campaign:first`, `campaign:follow`, `follow_up`,
`nurture` and `compose`.

**The estimate.** The rate of good drafts is estimated as a Beta posterior:

```
p(good rate) = Beta(1 + good, 1 + bad)
```

The prior is flat, so only the person's own labels count. Counts decay with a 90-day half-life.

**Certification.** A kind is offered autopilot when both conditions hold:

```
labels ≥ 20
10% quantile of Beta(1 + good, 1 + bad) ≥ 0.90
```

In words: the engine is 90% confident that at most 10% of these drafts would need your edits.
- With no bad labels, the condition is met after 21 unchanged sends in a row: 0.1^(1/22) = 0.9006.
  About 22 are needed in practice, because older labels decay.
- The offer is one click in the queue. Nothing graduates by itself.
- Graduating sets that kind to Autopilot, switches autopilot on, and resets the demotion state.
- It is refused in regulated mode.

**Spot checks.** After graduation, some would-be automatic sends go to the person instead, so that labels
keep arriving:
- 1 in 5 before a kind has 60 labels;
- 1 in 20 after that.

**Demotion.** Any one of these puts a kind on probation, and autopilot holds it:

- **An anytime-valid e-process.** It tests "bad rate ≤ 10%" against "bad rate = 20%". The update is:

  ```
  e ← e × 2      on a bad label
  e ← e × 8/9    on a good label
  ```

  A kind is demoted when `e ≥ 20`. By Ville's inequality, a kind whose true bad rate is at most 10% is
  wrongly demoted with probability at most 5%, however long it runs. For example:
  - 10 bad labels in 40 gives e ≈ 29.9, which demotes;
  - 9 in 40 gives e ≈ 13.3, which does not.
- **A cancel streak:** three automatic sends stopped in a row.
- **Mostly rewritten:** after at least 3 labels, the posterior mean of the good rate is below 0.5.

#### Loop 2: lessons from your edits

- When a sent draft was edited by more than 5%, the model compares the draft with what was sent. It states
  the durable preference in plain language, for example "Propose a specific day and time instead of asking
  for availability."
- The model is shown the lessons already known for that kind of email, with their ids. When an edit shows
  a preference a known lesson already states, even in different words, it returns that lesson's id and
  the lesson is reinforced rather than duplicated. Shared wording (Jaccard ≥ 0.5 over content words) is a
  fallback, and one edit can reinforce a given lesson only once.
- A lesson becomes **active** once it has been seen twice, or when you confirm it. You can retire any
  lesson.
- Active lessons go into every draft prompt in their context. The prompt also includes the three sent emails
  most similar to the new one, as examples of tone.
- Lessons shape wording only. They never authorise a fact or relax a rule.

#### Loop 3: outreach experiments

**Arms.** There are two dimensions:

| Dimension | Arms |
|---|---|
| Opening angle | Specific observation · relevant question · outcome first · very short · why now |
| Send time | Morning (7–11) · midday (11–14) · afternoon (14–19), local time, within your sending hours |

"Why now" is a *sleeping* arm. It is offered only for a lead whose Form D was filed in the last 90 days, and
it never overstates the raise: a Form D reports the amount sold to date, not necessarily a new round.

**Outcomes.**

| Outcome | Counts as |
|---|---|
| A human reply within 14 days | A reward |
| An opt-out | A failure, and is also shown as an opt-out |
| An automated reply | Nothing (ignored) |
| No reply after 14 days | A failure |

Each email is settled exactly once.

**Delayed feedback.** A send that is still waiting counts as a fraction of a failure:

```
F(t) = 1 − exp(−t / 36 hours)
```

This assumes half of replies arrive within a day and 86% within three. The engine learns from day one
instead of waiting out the reply window.

**Prior.** Each arm's prior is empirical Bayes, built from other accounts' settled outcomes on that arm
(leaving this account out):
- It is used once those accounts have at least 30 sends on the arm.
- Otherwise the prior is centred on the pooled rate across all arms.
- An arm nobody has tried therefore starts near real reply rates, not at a flat 50%.
- The prior is `Beta(1 + 20r, 1 + 20(1 − r))`.

**Choice.**
- Arms are chosen by **Thompson sampling**, with 10% of decisions made uniformly at random.
- Each send logs its propensity, `0.1 / K + 0.9 × P(best)`, so strategies can be evaluated offline without
  bias.
- Counts decay with a 90-day half-life.

#### What the person sees

**Agent & autopilot → "What the agent has learned"** shows:
- **Trust meters** for each kind of email: the estimate with its 90% interval, and either the certified bound
  or the reason for probation.
- **Lessons**, with Confirm and Retire buttons.
- **Arm tables** with these columns:
  - sends settled, replies and opt-outs;
  - the estimated reply rate with a 90% interval;
  - the chance each arm is best (shown as "–" for a sleeping arm that has never been used).
- An **error budget**: automatic sends in the last 7 days, times the worst certified bad rate.

Graduation offers appear at the top of the queue.

#### Research basis

| Method | Used for | Source |
|---|---|---|
| Thompson sampling | Outreach arms | W. R. Thompson, *Biometrika* (1933); O. Chapelle and L. Li, NeurIPS (2011); D. Russo et al., "A Tutorial on Thompson Sampling" (2018) |
| Delayed feedback | Pending sends as partial failures | C. Vernade, O. Cappé and V. Perchet, UAI (2017), arXiv:1706.09186 |
| Certified error rates | Graduation | A. Angelopoulos et al., "Learn then Test", *Annals of Applied Statistics* (2025), arXiv:2110.01052; Trust-or-Escalate, ICLR (2025) |
| Strong acceptance as the label | Unchanged and no critical field changed | Ansible Lightspeed (2024) |
| E-processes and Ville's inequality | Anytime-valid demotion | Ramdas et al., survey of e-values, arXiv:2210.01948 |
| Discounting | 90-day half-life | V. Raj and S. Kalyani, discounted Thompson sampling (2017) |
| Sleeping arms | "Why now" only with a fresh Form D | Duolingo, KDD (2020) |
| Learning from edits | Lessons and own-writing examples | G. Gao et al., PRELUDE/CIPHER, NeurIPS (2024), arXiv:2404.15269; PROSE, ICML (2025), arXiv:2505.23815 |
| Prompt-injection risk in mail agents | The security veto | The Trojan Hippo and EchoLeak attacks (2025–2026) |

### Teams and live collaboration

- **Teams** (`/app/team`) are shared workspaces.
  - There are four roles: owner, admin, member and viewer.
  - People join by invitation.
  - A team always keeps at least one owner. A sole owner can make someone else an owner and then leave.
- **Live collaboration** (`/app/collab`) lets two people open a tool and work on the same model.
  - Changes appear for the other person. Someone who joins later picks up the model where it stands.
  - It runs on Postgres and Server-Sent Events, because Vercel cannot hold a socket open.
  - An append-only event log's serial id doubles as the sequence number. Streams rotate every 45 seconds
    and resume with `Last-Event-ID`.
  - Patches merge on the server with `state || patch::jsonb`, so the last write wins per field.
    Keystrokes are coalesced into one patch per 250 ms.
  - Presence is a heartbeat with a 25-second window.
  - A session shared with a team is open to that team; an unshared one stays with whoever started it.

### YouBank for desktop

A desktop app for Windows, macOS and Linux (Tauri v2, in `desktop/`; its own README covers building,
releasing and signing). Download it from `/download`, which picks the installer for the visitor's system
from the latest `desktop-v*` GitHub Release and says in plain words what the app may touch.

- **The site in its own window**, with a tray menu, native notifications, `youbank://` links (a ticker, a
  deal, a Studio document, a quick ask question), one instance at a time, a remembered window, an offline
  screen that retries, and updates from GitHub Releases.
- **Quick ask** from any app on a global hotkey (Ctrl+Shift+Space, ⌘⇧Space on a Mac): the terminal's
  assistant in a small floating window, on the same daily AI allowance.
- **A local agent**, each part off until the person agrees to a screen saying what it does:
  - **Local files.** Folders of CIMs, models and memos become Edge documents. Files are fingerprinted on
    the computer and only new or changed ones are uploaded; the server gets a hash of each path, never
    the path. The first 25 files are free; more need Pro (`desktop.folders`).
  - **Excel and PowerPoint.** Pull a Studio model as a real `.xlsx` (or a deck as `.pptx`); a saved
    workbook goes back to Studio as one undoable change ("Synced from desktop: 14 cells"), through the
    same diff as the Excel add-in, and is refused if Studio moved on meanwhile. AI edits to a local file
    (Pro, `desktop.office_agent`) run the Studio agent and write the result back, keeping a backup.
  - **Alerts.** Edge findings and other bell alerts, the email agent's questions and news about pipeline
    deals, polled every few minutes (read only).
  - **Scheduled tasks** from the tray: the morning brief and the email agent's status (free), the Edge
    brief and watch checks (Pro, `desktop.background_ai`). An AI task runs on its schedule only if the
    person switched it on for that computer; the server keeps its own copy of that switch and refuses
    otherwise.
- **Signing in** works like the Office add-in: the app shows a code, the person approves it at
  `/desktop/connect`, and the app keeps a device token (`ybd_…`) in the system keychain. It works only on
  `/api/desktop/**`. Connected computers are listed, and can be disconnected, in Settings → Desktop app.
- **What the site may ask of the app** is fixed at three commands (its version, open quick ask, open the
  agent's settings). The site cannot reach files, programs or the keychain through it.

### Site, onboarding and styles

- **The landing page (`/`)** includes:
  - an auto-playing terminal demo;
  - a mock of the relationships queue;
  - a live adaptive-engine demo running the product's own code: an earned-autonomy simulator, a Thompson
    sampling simulator and lessons;
  - live demos: trading comps, an assistant answer with citations, and the startup directory;
  - segments, the planned plans, a style gallery, data and method, and an FAQ.
- **Per-career pages** at `/for/<role>`.
- **Sign-in** with Google through Neon Auth, then a six-step onboarding survey: role, group, experience,
  focus, style and goals.
- **14 styles:**
  - Dark: Terminal, Midnight, Aurora, Graphite, Phosphor, Evergreen, Nordic.
  - Light: Daylight, Paper, Ivory & Gold, Ocean, Rosé, Solar, Lavender.

  Components use design tokens only. `scripts/gen-themes.ts` regenerates `src/app/themes.css` from
  `src/lib/themes.ts`.
- **The top bar and the sidebar.** Each person pins the features they use to the top bar, in their own
  order, with names or icons only; the page they are on shows as a dashed tab when it is not pinned. The
  sidebar (the button at the left, or ⌘/Ctrl+\\) holds every feature, the workflows inside them
  (terminal functions, Newsroom views, Relationships tabs, settings) and the tools picked for their role,
  with search across all of it. It opens over the page or docks beside it. When a workflow's page is
  already open, it switches view in place, so open panels stay put. Saved in `profiles.extra.nav`
  (`src/lib/nav.ts`).
- **Built-in controls.** Dropdowns (`src/components/ui/Select.tsx`) and confirmation and text-entry
  dialogs (`src/components/ui/Dialog.tsx`) replace the browser's own: themed like everything else,
  animated, with keyboard support, search in long lists, and type-to-confirm for deletions that
  affect a whole team.

---

## Architecture

```
     Browser: Next.js App Router pages, React 19      Excel and PowerPoint: the add-in (Office.js)
                                        │                     │  device token, same /api/studio routes
                                        ▼                     ▼
  Vercel ─── Next.js 16 server: pages and route handlers under /api/*
   │   Cron 06:00 UTC ─► /api/cron/sync     startup directory and Form D refresh
   │   Cron 11:00 UTC ─► /api/cron/agent    morning agent run (drafts only)
   │
   ├──► Neon Postgres (Drizzle ORM)
   ├──► OpenAI Responses API  /  Anthropic Messages API
   ├──► SEC EDGAR (submissions, XBRL company facts, full-text search) · Financial Modeling Prep
   └──► Mailboxes: IMAP + SMTP (app password)  or  Gmail API (OAuth)

  Neon Function "autopilot" ◄── schedule trigger (every 5 min)
        └──► POST /api/cron/autopilot  (Authorization: Bearer AUTOPILOT_SECRET)
  Neon Function "news" ◄── schedule trigger (every 10 min)
        └──► POST /api/cron/news       (the Newsroom: sources, stories, alerts, briefs)
```

**The mail loop:**

```
new mail ─► sync (Gmail history, or IMAP) ─► resolve thread ─► triage ─► draft ─► consider
   ├─ held      ─► review queue, with the reasons
   └─ scheduled ─► hold + sending hours ─► re-read live thread ─► sendDraft ─► learnFromSend (loops 1–2)

reply arrives ─► recordReplies ─► stop the sequence / record an opt-out ─► settleOutreach (loop 3)
```

**`src/lib/crm/`, file by file:**

| File | Role |
|---|---|
| `model.ts` | Vocabulary: modes, stages, categories, contact and draft kinds, consent domains |
| `agent.ts` | Triage and drafting prompts and schemas |
| `sync.ts` · `mailbox.ts` · `imap.ts` · `gmail.ts` | Mailbox access, incremental changes, thread resolution, sending over SMTP or the Gmail API |
| `accounts.ts` · `crypto.ts` | Connected mailboxes; AES-256-GCM encryption of credentials |
| `db.ts` | Thread ingestion, triage processing, draft creation, reply recording, activity |
| `send.ts` | `sendDraft()`, the only code that sends |
| `autopilot-rules.ts` | Pure rules: settings, autonomy levels, sending window, send verdict, automated-mail detection |
| `autopilot.ts` | `considerDraft`, the heartbeat `tick`, the send queue, answering questions |
| `engine-rules.ts` · `engine.ts` · `learning-math.ts` | The adaptive engine |
| `knowledge.ts` · `settings.ts` | Playbook and questions; settings, voice, per-person lock |
| `scan.ts` · `actions.ts` | Pure scan rules (follow-ups, stale deals, nurture, funding signals); suggested actions |
| `nurture.ts` · `campaigns.ts` · `outreach.ts` · `contacts.ts` · `compose.ts` | Nurture rules, campaigns and leads, contacts, new emails |
| `run.ts` | The morning run |

---

## Data model

All tables are in `src/db/schema.ts`.

| Area | Tables |
|---|---|
| Accounts and research | `profiles`, `workflow_runs`, `documents`, `peer_groups`, `peer_group_members`, `comps_sheets`, `manual_inputs`, `footnotes`, `company_cache`, `kv_cache`, `startups` |
| Teams | `teams`, `team_members`, `team_invites` |
| Live collaboration | `collab_sessions`, `collab_events`, `collab_presence` |
| Relationships | `email_accounts`, `crm_contacts`, `crm_deals`, `crm_threads`, `crm_messages`, `crm_drafts`, `crm_questions`, `crm_playbook`, `crm_settings`, `crm_actions`, `crm_signals`, `crm_nurture_rules`, `crm_nurture_log`, `crm_campaigns`, `crm_campaign_leads` |
| Adaptive engine | `crm_trust` (per stratum: good, bad, observations, unchanged, e-process, cancel streak), `crm_arms` (per arm: decayed pulls, rewards, negatives), `crm_lessons`, `crm_learning_events` (every label and outcome, for audit and offline evaluation) |
| Studio | `studio_docs` (workbook, deck and comments as JSON, each edit an atomic `jsonb` update), `studio_events` (every patch with its undo; the serial id is the live-stream cursor and the add-in's sync cursor), `studio_runs` (each agent run: instruction, status, summary, stats), `studio_checkpoints` (named snapshots of the workbook and deck) |
| Excel and PowerPoint | `office_pairings` (a code awaiting approval: the hashed poll secret and the expiry), `office_devices` (connected installs: the hashed token, last use, revocation) |
| Desktop app | `desktop_pairings` (as for Office), `desktop_devices` (connected computers: the hashed token, system, app version, the scheduled-task switches, last use, revocation), `desktop_files` (each indexed local file: a hash of its path, its name, content hash and Edge document) |
| AI and inference | `ai_usage` (every model call: feature, model, tokens including cached and reasoning, list-price cost); `crm_messages.topics` (each email's topics, tagged once, for contact knowledge tracing); terminal mastery lives in `profiles.extra.skills` |

**Migrations.**
- On a fresh database, `drizzle-kit push` creates every table from the schema.
- Changes to an existing database are hand-written, idempotent SQL in `drizzle/`, applied in order with
  `scripts/apply-sql.mts`:
  - `0001_teams`
  - `0002_crm`
  - `0003_collab`
  - `0004_outreach`
  - `0005_autopilot`
  - `0006_adaptive`
  - `0007_studio`
  - `0008_office`
  - `0009_ai_usage`
  - `0010_contact_knowledge`
  - `0016_desktop`
- After applying them, `drizzle-kit push` should report no changes.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.3 (App Router, Turbopack), React 19.2, TypeScript 5 |
| Styling | Tailwind CSS v4 with design tokens, 14 generated themes, motion, lucide-react icons |
| Database | Neon Postgres through `@neondatabase/serverless` |
| ORM | Drizzle ORM 0.45, drizzle-kit |
| Auth | Neon Auth (managed Better Auth) with Google sign-in |
| AI | OpenAI Responses API (`openai` 7), Anthropic Messages API (`@anthropic-ai/sdk`), zod 4 for structured output |
| Mail | imapflow (IMAP), nodemailer (SMTP), mailparser (MIME), Gmail REST API |
| Data | SEC EDGAR (submissions, XBRL company facts, full-text search), Financial Modeling Prep, Y Combinator, a16z, Thiel Fellows, Show HN |
| Hosting | Vercel (functions and Cron) |
| Scheduling | Vercel Cron (daily jobs) and a Neon Functions schedule trigger (the five-minute heartbeat) |
| Statistics | In-house, dependency-free: Beta CDF and quantile, Gamma and Beta sampling, Thompson sampling |
| Tests | `tsx` scripts: unit suites, plus end-to-end runs against a Neon branch and an Ethereal mailbox |

---

## Running locally

```bash
pnpm install
cp .env.example .env.local                 # fill in the keys (see below)
set -a; . ./.env.local; set +a
pnpm exec drizzle-kit push                 # create the tables on a fresh database
pnpm dev                                   # http://localhost:3000
```

**Development tips:**
- Use a Neon branch rather than production for development.
- Outside production, `YOUBANK_DEV_USER=<name>` signs you in as `dev-<name>` without Google. It is useful
  for screenshots and tests against a branch.

**Other commands:**

```bash
pnpm exec tsx scripts/gen-themes.ts                               # after editing themes
pnpm exec tsx --env-file=.env.local scripts/snapshot.ts           # refresh the landing page's demo data
pnpm exec tsx --env-file=.env.local scripts/run-workflow.ts <id>  # one live workflow run
pnpm exec tsx --env-file=.env.local scripts/backfill.ts           # startup directory backfill
bash scripts/preflight.sh                                         # everything that must pass before a deploy
```

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon connection string (pooled) |
| `DATABASE_URL_UNPOOLED` | yes | Direct connection, for migrations |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `NEON_AUTH_JWKS_URL` | yes | Sign-in (from `neon env pull`; cookie secret via `openssl rand -base64 32`) |
| `AI_PROVIDER` | yes | `openai` or `anthropic` |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | yes | The key for the chosen provider |
| `OPENAI_MODEL`, `OPENAI_RESEARCH_MODEL`, `OPENAI_REASONING_EFFORT`, `ANTHROPIC_MODEL` | no | Defaults: `gpt-6-astra`, `gpt-5.4-mini`, `medium`, `claude-opus-5` |
| `FMP_API_KEY` | yes | Prices and market caps |
| `MARKET_BACKUP` | no | `off` turns off the market-data backups (Nasdaq, the ECB rates, CoinGecko, AI research); on by default |
| `MARKET_RESEARCH_MODEL`, `MARKET_RESEARCH_ESCALATION_MODEL` | no | The models AI research uses; defaults `gpt-5.6-luna`, retrying with `gpt-5.4-mini` |
| `EDGAR_USER_AGENT` | yes | The SEC asks for a descriptive User-Agent with a contact email |
| `CRON_SECRET` | yes | Bearer token for Vercel Cron (`/api/cron/sync`, `/api/cron/agent`) |
| `EMAIL_TOKEN_SECRET` | to connect mail | Encrypts mailbox passwords and tokens (`openssl rand -base64 32`) |
| `AUTOPILOT_SECRET` | for autopilot | Bearer token the heartbeat sends to `/api/cron/autopilot` (`CRON_SECRET` is also accepted) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | no | Gmail API connection via OAuth; the redirect defaults to `<origin>/api/crm/gmail/callback` |
| `AUTOPILOT_SPOT_CHECK_RATE` | no | Overrides the spot-check rate (tests only) |
| `NEWS_AI_BUDGET_USD` | no | The Newsroom's monthly AI cap; default `25` |
| `NEWS_RESEARCH_MODEL` | no | The model for research briefs; default `gpt-5.6-luna` |
| `NEWS_VAPID_PUBLIC_KEY`, `NEWS_VAPID_PRIVATE_KEY`, `NEWS_VAPID_SUBJECT` | for browser push | Web Push keys (`npx web-push generate-vapid-keys`) and a `mailto:` contact |
| `GITHUB_TOKEN` | no | Raises GitHub's rate limit for the tech radar and the download page's release lookup |
| `DESKTOP_RELEASE_REPO` | no | Where the desktop installers are released; default `AyanBhardwaj1/YouBank` |
| `YOUBANK_DEV_USER` | no | Development sign-in, ignored in production |

---

## Connecting a mailbox

### With an app password (any of the presets)

1. Create an app password with your provider:
   - **Google:** https://myaccount.google.com/apppasswords. The account needs 2-Step Verification.
   - **iCloud:** an app-specific password under Sign-In and Security.
   - **Yahoo, Zoho and Fastmail:** their equivalents.
2. In YouBank, open **Relationships**, choose the provider, and paste your address and the app password.
3. YouBank verifies the IMAP and SMTP logins before saving anything, then encrypts the password.

### With the Gmail API (OAuth)

1. In Google Cloud, enable the **Gmail API**, then create an **OAuth client ID** of type *Web application*.
2. Add `https://<your-domain>/api/crm/gmail/callback` as an authorised redirect URI. Add the `localhost`
   equivalent too, for local work.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `EMAIL_TOKEN_SECRET`.
4. Open **Relationships** and press *Connect Gmail*.

**How the OAuth connection behaves:**
- The agent asks for `gmail.readonly` and `gmail.send` only. It cannot modify or delete anything in the
  mailbox.
- The consent flow carries a nonce in an httpOnly cookie.
- Refresh tokens are encrypted before storage. A refresh failure marks the mailbox `needs_reauth` and gives
  the reason.
- Google classes both scopes as **restricted**. Your own account and a test list of up to 100 users work
  immediately. Serving anyone else requires Google's verification review.

---

## Deploying

1. **Environment.** Set the variables above in the Vercel project, not in `.env.local`.
2. **Database.** Apply any new migration to production, then check for drift:
   ```bash
   set -a; . ./.env.local; set +a
   DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm exec tsx scripts/apply-sql.mts drizzle/0011_newsroom.sql
   pnpm exec drizzle-kit push        # should report no changes
   ```
3. **Build and ship:**
   ```bash
   bash scripts/preflight.sh         # themes, typecheck, lint, tool packs, production build
   vercel --prod --yes
   ```
4. **Crons.** `vercel.json` schedules `/api/cron/sync` (06:00 UTC) and `/api/cron/agent` (11:00 UTC).
5. **The autopilot heartbeat.** Deploy it on the production branch with the Neon CLI. It is deployed this
   way, not from `neon.ts`, because it carries secrets:
   ```bash
   neon functions deploy autopilot --src neon/autopilot.ts \
     --env YOUBANK_URL=https://<your-domain> --env AUTOPILOT_SECRET=<secret>
   neon triggers create --function-slug autopilot --name autopilot-heartbeat --cron '*/5 * * * *'
   ```
6. **The Newsroom heartbeat**, the same way:
   ```bash
   neon functions deploy news --src neon/news.ts \
     --env YOUBANK_URL=https://<your-domain> --env AUTOPILOT_SECRET=<secret>
   neon triggers create --function-slug news --name news-heartbeat --cron '*/10 * * * *'
   ```
7. **Verify.**
   - `curl -i https://<your-domain>/api/cron/autopilot` should return `401` without the secret.
   - After five minutes, the Vercel logs should show `POST /api/cron/autopilot`.
8. **The desktop app.** Apply `drizzle/0016_desktop.sql`, then push a tag `desktop-v<version>`: the
   `Desktop` workflow builds the installers into a draft GitHub Release; publish it and `/download` offers
   it. Signing and update keys are optional secrets, listed in `desktop/README.md`.

---

## Testing

| Suite | Command | What it covers |
|---|---|---|
| Learning (63 tests) | `pnpm exec tsx scripts/test-learning.ts` | Beta CDF and quantile against exact values; certification boundaries; the e-process; scoring and critical fields; decay; Thompson sampling and propensities; delayed feedback; the security veto |
| Autopilot (62 tests) | `pnpm exec tsx scripts/test-autopilot.ts` | Settings normalisation, autonomy levels, sending windows and time zones, the send verdict, placeholders, automated-mail detection, the daily cap, playbook selection |
| Outreach (53 tests) | `pnpm exec tsx scripts/test-outreach.ts` | Follow-up, stale-deal and nurture candidate rules; funding-signal matching; company normalisation; sequence steps; the consent guard |
| Gmail parsing (12 tests) | `pnpm exec tsx scripts/test-gmail-parse.ts` | Address splitting (including quoted commas), MIME bodies, headers |
| Inference (58 tests) | `pnpm exec tsx scripts/test-inference.ts` | The command parser; Welch beta, Kupiec, Parkinson; forecasts, seasonality and nested intervals; rating tables, the Ohlson units, left-out views; knowledge tracing and its policies; Kaplan-Meier and Poisson-binomial; relationship strength, contact knowledge, deal odds and pipeline simulation; the recession probit and Sahm rule; copula rank correlation; Monte Carlo and forecasting over a live Studio workbook |
| Newsroom (73 tests) | `pnpm exec tsx scripts/test-news.ts` | URL, title and ticker cleaning; RSS, Atom and RDF; EDGAR's latest-filings feed, 8-K items and 13D pairs; Federal Register, GDELT and radar items; sector radars (FERC, DOE and NRC milestones, Fed bank applications, ITC cases, trials, FDA approvals, recalls, places and the map); robots.txt precedence; article extraction and paywall markers; classification and importance; clustering thresholds, figures (rounded or not) and filings; company names against SEC's listings; ranking reasons and mutes; desks; preferences, quiet hours and brief times; budget tiers; premiums, implied multiples and league tables; alert decisions; the calendar across daylight saving; research acceptance; tidying the model's reading; the brief email |
| Tool packs | `pnpm exec tsx scripts/test-pack.ts all` | Schema and example validation, id collisions |
| Autopilot end to end | see the header of `scripts/e2e-autopilot.ts` | A real IMAP/SMTP mailbox (Ethereal), a real database and the live model: coworker replies sent automatically and threaded; a pricing question held and asked; the answer remembered and reused; newsletters ignored; a draft withdrawn when you reply yourself |
| Studio (136 tests) | `pnpm exec tsx scripts/test-studio.ts` | Formula language and precedence; about 120 functions against Excel's documented results; number formats; the dependency graph, deep chains and iterative circularity; data tables and goal seek; every template; audit rules; banker formatting; edit operations with reference shifting; the linked deck and tie-out; .xlsx and .pptx round trips |
| Studio end to end | `DATABASE_URL=<branch> pnpm exec tsx scripts/e2e-studio.ts` | With the live model: a valuation pack with a linked deck, a custom formula-linked sheet with a waterfall slide, a turned comment, undoing a run, and exports from the stored document |
| Excel, PowerPoint and Studio tools (127 tests) | `pnpm exec tsx scripts/test-office.ts` | The workbook diff behind "Synced from Excel"; the Excel adapter against an in-memory Excel (`scripts/mock-office.ts`): every template written in and read back unchanged, and each kind of agent edit applied to Excel and to Studio side by side; a formula Excel rejects; a person's edits coming back; PowerPoint insert and in-place refresh; checkpoints and restore; every brand-check rule and stacked fixes; markup placement and data-room sheets; the manifest; pairing codes |
| Excel and PowerPoint end to end (52 checks) | see the header of `scripts/e2e-office.ts` | Against a running server and a Neon branch, with the live model: pairing and a single-use token; linking a workbook; a template round trip through Postgres; gzipped, partial and refused (409) syncs; an agent run applied to Excel as it streams; rebuilding an old state from undo patches; the deck's slide ids; checkpoints; the brand check; a marked-up photo read into comments; a data-room PDF read into a sheet; revoking the device |
| Engine end to end (20 checks) | `DATABASE_URL=<branch> E2E_STUB_LESSONS=1 pnpm exec tsx scripts/e2e-engine.ts` | Certification, a critical change, probation, spot checks, the security veto, demotion by cancels, lesson merging, settlement exactly once, pooled priors, Thompson sampling |
| Desktop app (15 tests) | `cd desktop && pnpm check:web && pnpm check:rust` | Links, navigation rules, site addresses, settings, the scheduler's timing, which files are indexed, path hashing, the streaming parser; the pages' scripts and that every command they call is registered and allowed |
| Preflight | `bash scripts/preflight.sh` | Themes, the tool catalog, typecheck, lint, inference, Newsroom, tool packs, production build |

The end-to-end scripts write rows under a throwaway user. Point them at a **Neon branch**, never at
production.

---

## Security, privacy and compliance

**Credentials.**
- Mailbox passwords and refresh tokens are encrypted with AES-256-GCM before storage, and decrypted only to
  talk to the mail server.
- Disconnecting a mailbox deletes the row, so no credential survives it.

**Sending.**
- There is one sending function, `sendDraft()`.
- A single-use claim means a draft cannot go twice.
- The live thread is re-read before every automatic send.

**Prompt injection.**
- The security veto holds any automatic email containing a link, address or account number the person did
  not provide.
- Automated messages are never answered.
- Loop guards limit autopilot to two sends per conversation per day.
- Lessons cannot authorise facts.

**Excel and PowerPoint.**
- The add-in signs in with a device code. Only hashes of the poll secret and the device token are stored.
- A token is collected once. A code is approved only from a signed-in browser session, never by another
  add-in, and the approval page warns people to approve only a code they see in their own Office.
- Every install is listed with its last use, and disconnecting one revokes its token at once.
- Uploaded printouts and data-room files are read as content: the reviewer's marks are the only requests,
  and printed text is never followed as an instruction.

**Scheduled endpoints.**
- Cron and heartbeat endpoints require bearer secrets.
- The Neon relay accepts only real trigger deliveries.

**Regulated firms.**
- Regulated mode turns autopilot off and keeps every send human and in the firm's own mailbox.
- The audit CSV records every draft, who sent it and how much it was edited.
- This follows FINRA's 2026 oversight report, which flags AI agents acting "without human validation and
  approval", and the SEC's January 2025 off-channel recordkeeping fines ($63.1M across 12 firms).

**Consent and frequency.**
- Campaigns skip recipients at EU, EEA and Canadian domains unless you confirm consent or another lawful
  basis.
- A recipient gets at most one first cold email through YouBank per 30 days.
- Opt-outs stop the sequence, and nothing but a reply is ever sent automatically to that person again.

**Your data.**
- No model is trained on your data.
- What the engine learns is per-account statistics and plain-language lessons, which you can read and
  retire.

**Known gaps, stated plainly:**
- Campaign emails do not yet add a postal address, an unsubscribe line or a `List-Unsubscribe` header.
  - CAN-SPAM requires a working opt-out mechanism and a physical postal address in commercial email.
  - Google and Yahoo require one-click unsubscribe from bulk senders.
  - Add these before running campaigns at volume.
- Gmail's OAuth scopes are restricted. Beyond 100 test users, the OAuth path needs Google's verification.
  The app-password path works today.
- There is no SOC 2 report yet.
- Market data is used under a developer licence. Redistribution terms need a proper licence before paid
  plans launch.

---

## Research behind the product

**AI inference** (September 2026): LLM inference techniques, financial machine learning and knowledge
tracing, and Bloomberg's functions against the free data that can replace them. What was built from them,
the data licences and what was left for later: [docs/research/ai-inference.md](docs/research/ai-inference.md).

Three earlier research reports are behind the adaptive engine, the website and the plan:
- new AI and machine-learning methods;
- the fintech and dealmaking market;
- startup and venture context.

**Conclusions that shaped the product:**

- **Breadth is not a moat; the loop is.** The defensible wedge is this sequence:
  1. a Form D, 8-K or S-1 event;
  2. the company in the startup directory;
  3. who in *your* inbox knows them;
  4. a drafted outreach email that you approve.

  Incumbents are converging on data access. Affinity shipped an MCP server and agents in 2026. Crunchbase,
  CB Insights, Tracxn, Dealroom, Specter and Harmonic all shipped MCP connectors. Anthropic's Claude for
  Financial Services added low-cost data partners.
- **Trust has to be earned and measured.** Recent work shows a model's self-graded confidence is poorly
  calibrated. That is why autonomy is certified on the person's own decisions, with exact bounds and
  anytime-valid demotion.
- **Pricing belongs in the $30–$300 per seat per month band.** The planned plans are below; nothing is
  billed during the beta.

| Plan | Price | For |
|---|---|---|
| Campus | Free with a .edu address | Students: the full terminal and data, AI workflows with a monthly allowance, a recruiting pack |
| Pro | $39 a month, or $29 billed yearly | Individuals: higher limits, the relationships agent and one mailbox |
| Deal Team | $149 per seat a month, three seats minimum | Teams: autopilot and campaigns, the adaptive engine across the team, shared workspaces |
| Enterprise | From $249 per seat a month, yearly | Firms: regulated mode and audit exports, SSO and admin controls, data residency options, bring-your-own data licences |

---

## Roadmap

- **Compliance for cold email:**
  - a postal address and an unsubscribe line in campaign emails;
  - a `List-Unsubscribe` one-click header;
  - opt-outs honoured within 48 hours.
- **A YouBank connector inside Claude and ChatGPT:** a remote MCP server exposing Form D × directory × XBRL.
  - It would follow the stateless 2026-07-28 MCP specification, with MCP Apps for rendered results.
  - On Vercel it would use `mcp-handler`, which needs its own OAuth 2.1 authorisation server.
- **Mailboxes:** Microsoft 365 and Outlook, and Google verification (CASA) for the Gmail API path.
- **Studio and the add-in:**
  - single sign-on in the add-in through Office's nested app authentication, for Microsoft 365 tenants;
  - an AppSource listing, so the add-in installs from Office's store;
  - pushing changes to the add-in over a stream, instead of a four-second poll;
  - Excel charts, conditional formats and data validation in the round trip;
  - data-room files over 4 MB, uploaded straight to storage.
- **Engine:**
  - fit the reply-delay curve to real data once there are 200 replies;
  - evaluate new angle strategies offline from the logged propensities;
  - suggest new angles from what replies have in common.
- **Company:**
  - SOC 2 Type I;
  - properly licensed market data;
  - billing for the plans above.

---

## Repository layout

```
YouBank/
  .github/workflows/desktop.yml   builds the desktop installers into a draft GitHub Release
  desktop/                 YouBank for desktop (Tauri v2): the Rust app in src-tauri/, its own pages in src/
  docs/                    product thinking, decisions, specs, market research
  drizzle/                 hand-written SQL migrations (0001–0008)
  neon/autopilot.ts        the five-minute heartbeat relay (Neon Function)
  scripts/                 tests, end-to-end runs, migrations, snapshot, themes, backfill, preflight
  src/app/                 routes: marketing, /for/<role>, /download, /onboarding, /app/*, /office/* (the add-in),
                           /desktop/connect, /api/*
  src/components/
    crm/                   workspace, review queue, inbox, pipeline, contacts, campaigns, nurture,
                           agent settings, engine insights, mailbox bar
    studio/                Studio home, workspace, grid, deck view, slide charts, state hook
    office/                the add-in's task pane, and the connect and install pages
    marketing/             landing page, adaptive-engine demo, terminal demo, role pages, live demos
    terminal/              command bar, panels, screens (DES FA COMPS PREC CAP FIL EVT INS XBRL AI PG TOOLS)
    workflows/             tool gallery, runner, form, output blocks
    theme/  charts/  motion/  ui/
  src/db/schema.ts         every table
  src/lib/
    crm/                   the relationships agent, autopilot and the adaptive engine (see Architecture)
    studio/                formula engine, functions, number formats, templates, audit, deck, edit
                           operations, persistence, .xlsx/.pptx, the Studio agent, workbook sync,
                           checkpoints, the brand check, reading printouts and data rooms
    office/                the add-in: pairing and tokens, the Excel and PowerPoint adapters, the
                           manifest, its API client
    desktop/               the desktop app's server side: pairing and tokens, the alerts feed,
                           scheduled tasks, local files, Office sync, the release lookup
    ai/                    models, config, agent (OpenAI Responses and Anthropic), data tools, prompts
    edgar/  fmp/  vc/      SEC EDGAR and XBRL, prices, startup directory and Form D
    workflows/             tool contract, prompt builder, registry, a pack per role
    teams/  collab/  auth/ teams and roles, live collaboration, sign-in
    themes.ts calc.ts roles.ts metrics.ts company.ts
```

## Further docs

| Doc | What |
|---|---|
| [docs/06-product-overview.md](docs/06-product-overview.md) | Routes, terminal functions, the tool system, the AI layer, theming, commands |
| [docs/newsroom.md](docs/newsroom.md) | The Newsroom: sources and why each, the pipeline, clustering calibration, ranking, AI and its budget, delivery, the editions |
| [docs/03-decisions.md](docs/03-decisions.md) | Every decision and its rationale, in order |
| [docs/05-tool-pack-authoring.md](docs/05-tool-pack-authoring.md) | How to add tools for a role |
| [docs/04-comps-engine-spec.md](docs/04-comps-engine-spec.md) | Comps engine spec |
| [docs/01-tech-ma-personas.md](docs/01-tech-ma-personas.md) | The original persona study |
| [docs/research/](docs/research/) | Market research behind the tool packs, plus the Studio competitive landscape and the analyst grunt-work study |
