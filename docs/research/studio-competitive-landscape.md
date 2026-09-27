# AI agents for finance spreadsheets and decks: the competitive landscape

Prepared 2026-09-27 for Studio, YouBank's live model-and-deck workspace. Accuracy figures are the vendors' own unless marked independent. "Unverified" marks third-party estimates or claims that could not be confirmed at the source. Some primary pages (openai.com, gamma.app, Wall Street Oasis, CNBC) blocked direct fetches; for those, secondary coverage is cited.

## Three facts that frame the market

- **Live editing in the user's own file is table stakes.** Microsoft, Anthropic, OpenAI and Google all ship agents that edit an open workbook or deck. "You can watch it edit" is not a differentiator on its own.
- **Quality is well short of a good analyst.** In the one independent head-to-head found, Wall Street Prep (29 June 2026) had tools build a three-statement model of Apple ([WSP](https://www.wallstreetprep.com/knowledge/ranking-the-best-ai-tools-for-financial-modeling-2026/)):
  - the best tool, Shortcut, scored 5.9/10, against 9.4 for a top analyst;
  - Shortcut and Claude "hallucinated significant portions of historical data";
  - every tool relied on plugs, and every tool failed on circularity.
- **Pricing is split.**
  - General add-ins cost about $18–25 per user per month.
  - Finance specialists mostly quote on request, often thousands of dollars per seat per year, sometimes with seat minimums.
  - Boutiques fall in between.

## 1. Products

### Platform assistants

| Product | What it does | Where it runs | Live in your file | Price | Limits and complaints |
|---|---|---|---|---|---|
| Microsoft Copilot (Agent Mode, Office Agent) | Multi-step building and editing; Office Agent drafts decks from chat. Excel now offers GPT or Claude. Daloopa, FactSet, PitchBook and S&P connectors added June 2026 ([MS](https://www.microsoft.com/en-us/microsoft-365/blog/2026/06/25/copilot-in-excel-built-for-the-era-of-frontier-finance/)) | Excel, Word, PowerPoint on web, Windows and Mac | Yes, generally available since 22 April 2026 ([MS](https://www.microsoft.com/en-us/copilot/blog/2026/04/22/copilots-agentic-capabilities-in-word-excel-and-powerpoint-are-generally-available/)) | Copilot Business $21/user/month on top of a base M365 plan ([MS](https://www.microsoft.com/en-us/microsoft-365-copilot/pricing)) | Edits only with calculation set to Automatic ([FAQ](https://support.microsoft.com/en-us/office/frequently-asked-questions-about-agent-mode-in-excel-1cfd906d-40b4-46be-8e2d-65b893e28a02)). Microsoft says correctness on finance spreadsheets is still improving. WSP: 4.4/10, with the weakest formatting and the most accurate historicals |
| Anthropic: Claude for Excel and PowerPoint, and Claude for Financial Services | Reads, edits, builds and debugs workbooks, with cell-level citations. PowerPoint reads the slide master and makes native charts ([Excel](https://claude.com/docs/office-agents/excel), [PPT](https://claude.com/docs/office-agents/powerpoint)). Open-source skills for comps, DCF, LBO, merger models, `audit-xls` and `ib-check-deck` ([GitHub](https://github.com/anthropics/financial-services)) | Office add-ins | Yes; it tracks and explains its changes | Included in Pro ($20/month), Team and Max ([pricing](https://claude.com/pricing)) | No data tables, macros or VBA. Change history is local only and not in Enterprise audit logs. Warns about prompt injection from outside files. WSP: 5.5/10, with hallucinated historicals and hardcodes |
| OpenAI: ChatGPT for Excel, Sheets and PowerPoint; ChatGPT for Financial Services | Excel add-in in beta from March 2026 and open to all in May; PowerPoint add-in in beta. The Financial Services edition (10 September 2026) bundles Daloopa, PitchBook and LSEG data and builds models and pitch books; Morgan Stanley and Evercore were design partners ([Unite.AI](https://www.unite.ai/openai-launches-chatgpt-for-financial-services-with-built-in-data/)) | Add-ins; ChatGPT | Add-ins yes; the Financial Services edition generates files | Add-ins on all plans; Financial Services price undisclosed | The PowerPoint beta cannot yet handle templates or fonts ([Thurrott](https://www.thurrott.com/a-i/336411/openai-launches-chatgpt-for-powerpoint-add-in-in-beta)). OpenAI concedes connector error rates |
| Google Gemini in Sheets and Slides | Builds and edits whole sheets from Gmail and Drive context. 70.48% on SpreadsheetBench, as reported by Google ([Workspace](https://workspaceupdates.googleblog.com/2026/04/build-and-edit-complex-spreadsheets-with-Gemini-in-Google-Sheets.html)); native editable decks in Slides | Side panel | Yes | Workspace Business Standard and up | US English at launch; no finance-specific tests found |

### Finance-native agents and modeling engines

| Product | What it does | Live | Price | Notes |
|---|---|---|---|---|
| Shortcut | Autonomous modeling agent in its own workbook, a Windows app and Excel and Sheets add-ins ([site](https://shortcut.ai/)) | Yes | Free tier; Pro $100/month; Teams $320/month plus $100/seat ([pricing](https://www.shortcut.ai/pricing)) | Ranked first by WSP, at only 5.9/10 |
| Endex | Agents build models, memos and decks inside Office. $14M round led by OpenAI's fund ([TechStartups](https://techstartups.com/2025/08/06/endex-ai-raises-14m-in-funding-led-by-openai-startup-fund-to-bring-ai-agents-directly-into-excel/)) | Yes | Not public | No independent test found |
| Tracelight | Builds and reviews models, cites numbers, turns models into decks ([site](https://tracelight.ai/)) | Yes | $40–200/month ([pricing](https://tracelight.ai/pricing)) | Accuracy figures self-reported |
| Crunched (YC F25) | Error-checks and builds models; links information-memorandum data into templates ([YC](https://ycombinator.com/companies/crunched)) | Yes | Not found | Early stage |
| F2 | Private-credit underwriting on a native Excel engine, with an audit mode ([site](https://f2.ai/)) | Exports .xlsx | Not public | Narrow vertical |
| Mosaic | Deterministic LBO/DCF engine; its Autopilot emails back a model in about five minutes ([site](https://www.mosaic.pe/)) | Exports | Not public | Reportedly exports sensitivities as hardcoded values (unverified) |

### Finance AI platforms that output Office files

- **Rogo:** comps, models and pitch books; an Excel plug-in links and audits tabs ([Rogo](https://rogo.com/news/may-product-update)). About $3,300 per seat per year (Sacra estimate, [Sacra](https://sacra.com/c/rogo/)).
- **Hebbia (with FlashDocs):** its Max agent returns slides, reports and models; the Excel plug-in adds source notes ([Hebbia](https://www.hebbia.com/blog/introducing-max)). Around $10k per seat (unverified).
- **Model ML:** decks and memos in the firm's own formats, with "AutoCheck" for number-tying and formatting ([Model ML](https://llms.modelml.com/pitch-book-automation)). It does not say whether outputs stay linked to the model.
- **AlphaSense (with Carousel and Canalyst):** an Excel add-in with refreshable models ([help](https://help.alpha-sense.com/hc/en-us/articles/42497864864787-AlphaSense-Data-Models-Excel-Add-In)).
- **Daloopa:** source-hyperlinked fundamentals; supplies data but does not build models.
- **FactSet Pitch Creator:** a slide assistant within FactSet, at about $12k per user per year.

### Office add-ins and slide tools

- **Macabacus:** formula auditing and Excel-to-PowerPoint linking, $200–360 per year; its AI Deck Check is on Enterprise only ([pricing](https://macabacus.com/pricing)).
- **UpSlide:** Excel-to-PowerPoint links and an AI consistency check; minimum of 5 licenses plus a setup fee ([pricing](https://upslide.com/pricing/)).
- **think-cell:** 40+ chart types including football fields; charts only, no models.
- **Pitchly:** tombstones and bios.
- **Gamma and Beautiful.ai:** general AI slides. Gamma's own help center says exports can differ from its editor ([help](https://help.gamma.app/en/articles/15939201-why-doesn-t-my-exported-pdf-or-powerpoint-match-what-i-see-in-gamma)).

## 2. Gaps no product covers well for boutiques

1. **Model-to-deck links with a provable tie-out, at small-team prices.**
   - Linking exists but isn't agentic: Macabacus, UpSlide, think-cell.
   - AI tools regenerate exhibits instead, or run probabilistic checks.
   - Model ML says that after a model change "every downstream figure, chart title, and footnote has to be re-verified".
2. **Sourced historicals without a data-terminal budget.**
   - Hallucinated historicals were the most dangerous failure in the WSP test.
   - Cell-level sourcing exists, but behind paid data.
   - The SEC's XBRL APIs are free.
3. **Integrity checks that run on every edit,** not an audit afterwards. Every tool in the WSP test used plugs and missed circularity.
4. **Sensitivity tables and football fields.**
   - Claude does not support Excel data tables.
   - Training The Street tells bankers to use "Automatic except for data tables" because data tables slow large models to a crawl.
   - No agent was found that builds a football field from the model's own ranges and keeps it linked (unverified).
5. **Banker conventions enforced as rules:** colours, units, signs and consistent row formulas.
6. **Turning MD comments** across the deck and the model.
7. **A shareable audit trail of agent edits.**
8. **Untrusted inbound files:** seller models and prompt injection.
9. **Price.**
10. **Round-trip fidelity to Excel and PowerPoint.**

## 3. What this meant for Studio

| Gap | What Studio does |
|---|---|
| Model-to-deck links and tie-out | Slides hold links to ranges and cells, never pasted values; `tieOut()` flags broken links, error values, typed-in tables and any number in slide text that is not in the model |
| Integrity on every edit | Every agent run ends with a model audit and a health strip; the audit catches numbers typed into formulas, overwritten formulas, broken row patterns, errors, references to empty cells and circularity |
| Circularity | Iterative calculation (Tarjan's algorithm to find circular groups, then Gauss–Seidel) with a circuit-breaker switch; the LBO template charges interest on average debt balances |
| Sourced historicals | Templates fill inputs from SEC XBRL company facts and show the source; the agent passes a source with typed-in figures |
| Sensitivity tables and football fields | Engine-computed data tables, plus live-formula sensitivity grids where a closed form exists; the football field is a chart linked to the summary sheet |
| Banker conventions | One-click banker formatting, a cell-type legend, and colours applied automatically to agent writes |
| Page turns | Comments on cells and slides; "Turn the comments" makes each change and resolves each comment with a note |
| Audit trail | Every change is an event with its undo; any change or any whole agent run can be undone |
| Inbound files | An intake report on upload: hidden sheets, external links, unsupported functions, dropped features; file contents are treated as data, not instructions |
| Round trip | .xlsx export with formulas and computed results; newer functions get Excel's `_xlfn.` prefix; .pptx with native tables and charts |
