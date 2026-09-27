# Analyst grunt work in Excel and PowerPoint: what to automate first

Prepared 2026-09-27 for Studio. "(est.)" marks an estimate. Vendor figures are marketing claims, not independent studies. Reddit could not be fetched, so Wall Street Oasis (WSO) is the forum source.

## The evidence

- **Manual Office work takes a third to half of a junior's week.**
  - A 2022 Censuswide survey for UpSlide polled 202 IB, PE and investment-management staff from analyst to VP ([UpSlide](https://upslide.com/wp-content/uploads/2024/12/Investment-Banking-Burnout.pdf)). 40% spend 10–20 hours a week on manual Microsoft tasks, 30% spend 21–30 and 30% spend 31–40.
  - A 2020 CSA/UpSlide survey found ([CSA/UpSlide](https://upslide.net/productivity-in-finance-study-csa/)):
    - 69% format Excel tables and charts every day;
    - over 80% proofread every day;
    - 70% check formulas every day;
    - copying from Excel into PowerPoint was the third most frequent task.
- **Slides dominate while pitching.** One analyst put it at about 50% of their time on slides, 90% during pitches ([WSO](https://www.wallstreetoasis.com/forum/investment-banking/percentage-of-time-spent-making-trivial-powerpoint-slides)).
- **Banks and AI labs are now targeting exactly these tasks.**
  - JPMorgan's in-house platform built a five-page banking deck in about 30 seconds ([CNBC](https://www.cnbc.com/2025/09/30/jpmorgan-chase-fully-ai-connected-megabank.html)).
  - Anthropic shipped finance agent templates for pitch building, model building and statement auditing in May 2026 ([Anthropic](https://www.anthropic.com/news/finance-agents)).
  - OpenAI launched ChatGPT for Financial Services on 10 September 2026 ([PYMNTS](https://www.pymnts.com/news/artificial-intelligence/2026/openai-targets-work-junior-bankers-do)).
- **Accuracy is the limit.**
  - On Vals AI's Excel Modeling Benchmark (22 September 2026), the best model passes 89% of formula checks and 81% of presentation checks, but only 64% of numerical checks; LBO and DCF models score worst ([Vals](https://www.vals.ai/benchmarks/emb)).
  - Mergers & Inquisitions: "A model that is '90% correct' is 100% useless", and junior work is shifting to debugging generated models ([M&I](https://mergersandinquisitions.com/ai-for-financial-modeling/)).
  - **Design implication:** the agent wins by making its work fast to check, not only fast to produce.

## Task by task

| Task | How often and how long | Partly automated today by | Still needs a human |
|---|---|---|---|
| Spreading comps and precedents | 15–30 min per company with Capital IQ; 3–6 hours per 10–15 company set (est.) ([WSO](https://www.wallstreetoasis.com/forum/investment-banking/how-long-does-spreading-comps-take)) | Capital IQ and FactSet plug-ins, Claude's comps skill, Rogo | Choosing peers, non-recurring items, outliers |
| DCF, LBO, 3-statement, merger models | 50–90 min per model for first-years in Shortcut's study ([Shortcut](https://shortcut.ai/blog/posts/analyst-benchmark)); days on live deals (est.) | Templates, Copilot, Claude, Shortcut | Assumptions, structure, terms |
| Sensitivity tables | On most valuation pages (est.); Excel data tables slow models ([TTS](https://trainingthestreet.com/resources/data-tables-in-excel/)) | Excel data tables, Macabacus templates | Choosing variables and ranges |
| Banker formatting | Constant; blue inputs, black formulas, green links ([BIWS](https://breakingintowallstreet.com/kb/excel/how-to-color-code-in-excel/)) | Macabacus AutoColor | House-style exceptions |
| Model auditing | 94% of operational spreadsheets had errors, at a 5.2% average cell error rate ([EuSpRIG](https://arxiv.org/pdf/0908.1190)) | Macabacus Model Check, PerfectXL | Intent, materiality, the fix |
| Football fields and waterfalls | 30–90 min per chart (est.) ([BIWS](https://breakingintowallstreet.com/kb/excel/football-field-valuation/)) | think-cell | Which methods and ranges to show |
| Excel to PowerPoint, kept updated | The third most frequent task; native links break ([Macabacus](https://macabacus.com/blog/linking-from-excel-to-powerpoint-and-word)) | Macabacus, UpSlide, think-cell | Layout |
| Page turns (MD comments) | Books reach "v44" ([M&I](https://mergersandinquisitions.com/investment-banking-pitch-books/)); 1–4 hours per round (est.) | Little: UpSlide track changes, single-slide edits | Ambiguous or conflicting comments |
| Tie-outs | Before every send; a football-field number that doesn't match the DCF page is the classic failure ([Autopresent](https://www.autopresent.ing/blog/investment-banking-pitch-deck-anatomy/)) | UpSlide consistency check, Macabacus Deck Check, Model ML | Which number is right |
| Footnotes and sourcing | Every exhibit needs a source and an as-of date | Macabacus components, ChatGPT citations | Disclaimer wording |
| Data-room extraction | Every buy-side deal; Bain expects a week to become a day ([Bain](https://www.bain.com/insights/generative-ai-m-and-a-report-2025/)) | Claude, Hebbia, Rogo, Keye | QoE adjustments, definitions |
| Version control | "FINAL_final_v7" | UpSlide track changes, xltrail | Which version is approved |

## Ranked for a first release

Score = time saved × frequency × feasibility, each scored 1–5 (est.).

| # | Automation | Score | Time for the user to check |
|---|---|---|---|
| 1 | Live grid-to-slide links | 100 | Seconds |
| 2 | Tie-out engine | 80 | Seconds (it is itself a check) |
| 3 | Page-turn executor | 75 | Minutes (a checklist) |
| 4 | Formatting conventions | 75 | Seconds |
| 5 | Deck brand lint | 75 | Seconds |
| 6 | Comps spreading with sources | 64 | Minutes |
| 7 | Model audit panel | 64 | Minutes |
| 8 | Sensitivity tables | 60 | Seconds |
| 9 | Football field and waterfall charts | 60 | Seconds |
| 10 | Data-room extraction | 45 | Minutes |
| 11 | Footnotes and sourcing | 40 | Seconds |
| 12 | Checkpoints and diffs | 40 | Seconds |

- **Start with the checkers.** Trust comes fastest from features the user can check in seconds and that catch human mistakes: the tie-out, the audit, the formatting legend, charts bound to cells.
- **Then the generators,** with sources on every cell.
- **Keep narratives and full builds behind approval,** because they are slow to verify.
- **Build three shared foundations:** where every number came from, live links between cells and slides, and a change log where every edit can be undone.

## What Studio shipped from this list

| Ranked item | Status in Studio |
|---|---|
| 1 Live links | Shipped |
| 2 Tie-out | Shipped |
| 3 Page turns | Shipped (typed comments; marked-up PDFs are next) |
| 4 Formatting | Shipped, plus a cell-type legend |
| 6 Comps with sources | Shipped |
| 7 Audit | Shipped, and run after every agent edit |
| 8 Sensitivities | Shipped |
| 9 Football field and waterfall | Shipped |
| 11 Sources | Partly: templates and agent writes carry sources |
| 12 Checkpoints and diffs | Partly: every change is logged with its undo, and whole runs can be undone |
| 5 Deck brand lint | Next |
| 10 Data-room extraction | Next |
