# Phase 1 personas: Technology M&A group, boutique bank, San Francisco

Context: a boutique advisory bank (Moelis-style) runs sell-side and buy-side M&A, plus some
restructuring and capital advisory. Tech M&A in SF touches software, internet, fintech, and
semis. Deal teams are small: 1 MD, 1 VP/Director, 1 Associate, 1-2 Analysts.

A typical week has three kinds of work:

1. **Pitching** (winning mandates): pitch books, buyer/target ideas, valuation snapshots.
2. **Execution** (live deals): sell-side process management, marketing materials, diligence.
3. **Coverage** (relationships): tracking companies, news, earnings, and investor sentiment.

---

## Analyst (years 1-3)

What they actually do, ranked by hours per week:

| Task | Typical output | Automation potential |
|---|---|---|
| Trading comps | Excel comps sheet, spread from filings/Capital IQ | High: pull data, spread, format, footnote |
| Precedent transactions | Excel deal table with multiples, premiums | High: pull, screen, standardize |
| Pitch book assembly | 40-80 page PowerPoint | High: generate first draft slides from templates |
| DCF / LBO / merger model updates | Excel model | Medium: build from template, update inputs; humans own assumptions |
| Public Information Book (PIB) | PDF binder of filings, research, news | Very high: fully automatable |
| Buyer / target lists | Excel tiered list with rationale | High: screen, tier, draft rationale |
| CIM and teaser drafting | Word/PowerPoint | Medium-high: first draft from data room + management notes |
| Data room management | Folder index, Q&A log | High: index, track, answer repeat questions |
| Process trackers | Excel: NDAs sent, IOIs, bid deadlines | Very high |
| Working group lists (WGL) | Excel contact sheet | Very high |
| Earnings / news summaries | Email blurb, one-pager | Very high |
| Formatting and checking | Consistent fonts, footnotes, tie-outs | High: lint models and decks |

Pain points: 2am turns of comps, re-doing formatting after every MD comment, hunting for the
right version of a model, copying numbers between Excel and PowerPoint by hand.

## Associate (years 3-6, often post-MBA)

| Task | Automation potential |
|---|---|
| Review and check analyst work (models, comps, decks) | High: automated tie-outs, error scans, diff vs prior version |
| Own the model logic and valuation narrative | Low-medium: AI as sparring partner, not owner |
| Draft CIM sections, management presentation | Medium-high |
| Run the process: buyer outreach log, NDA negotiation tracking, bid comparison | High |
| Coordinate diligence: Q&A triage, expert calls, lawyer/accountant handoffs | High for triage and logging |
| Client and buyer communications | Medium: drafts, summaries, follow-up tracking |
| Staffing and analyst training | Low |

Pain points: being the bottleneck between MD comments and analyst execution; keeping a dozen
buyers' statuses straight; knowing whether the numbers changed since the last version.

## Managing Director

| Task | Automation potential |
|---|---|
| Origination: who might sell, who might buy, and why now | Medium-high: idea generation from signals (funding, activist stakes, aging founders, PE hold periods) |
| Client relationships: CEO, CFO, board, sponsors | Low: but call prep and CRM notes are highly automatable |
| Negotiation strategy, deal structuring | Low: AI supports with scenario analysis |
| Fairness opinion and committee prep | Medium: assemble supporting materials |
| Board presentations | Medium: drafts from execution materials |
| Market intelligence: what sponsors are paying, what strategics are hunting | High: continuous digest |
| Internal: staffing, fee estimates, pipeline reviews | High: pipeline dashboards |

Pain points: not enough hours for relationships; pre-meeting prep is thin; insight is scattered
across email, CRM, and analysts' heads.

---

## The automation map, grouped into product modules

1. **Data core**: companies, transactions, financials, filings, people, and events. Every other
   module reads from here. This is the "financial database" half of YouBank.
2. **Comps engine**: trading comps and precedent transactions, with sourcing, spreading,
   calendarization, footnotes, and export to Excel/PowerPoint.
3. **Deck generator**: pitch books, teasers, CIMs, management presentations, board decks, from
   templates plus the data core plus AI-written narrative.
4. **Model workspace**: templated DCF/LBO/merger models, input updating, and a model linter
   (broken links, hardcodes, sign errors, tie-outs).
5. **Process manager**: sell-side process tracker, NDA and buyer log, data room index and Q&A,
   IOI/LOI comparison, working group list.
6. **Coverage and origination**: watchlists, news/earnings digests, deal-idea generation, call
   prep memos, CRM notes.
7. **AI workspace**: chat and agents that can read the data core, run the modules above, and
   produce documents; with citations to sources so bankers can verify.

## Suggested build order

1. Data core + Comps engine (most hours saved per analyst, and every other module needs it).
2. Deck generator for pitch books and PIBs.
3. Process manager.
4. Coverage and origination.
5. Model workspace and linter.
