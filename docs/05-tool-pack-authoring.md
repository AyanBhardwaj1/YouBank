# Authoring a role tool pack

A tool pack is one TypeScript file, `src/lib/workflows/packs/<role>.ts`, exporting `<ROLE>_PACK: ToolDef[]`.
It is the product for that role: every AI workflow and calculator the user sees in the Tools gallery, the home
dashboard, and inside terminal panels. Packs are authored from the market research in `docs/research/`.

## Read first
1. `src/lib/workflows/types.ts`: the contract (`Field`, `OutputBlock`, `WorkflowOutput`, `WorkflowDef`, `CalculatorDef`, helpers `num/str/list/bool/parseCsv/fmt`).
2. `src/lib/workflows/packs/core.ts`: the reference implementation. Match its density and quality.
3. `src/lib/workflows/prompt.ts`: how `description`, `instructions`, and `prompt` are assembled into the model's system and user messages, and the output contract the model is told to follow.
4. `src/lib/ai/tools.ts`: the data tools the model can call. Names: `get_company_financials`, `get_trading_comps`, `search_companies`, `search_filing`, `read_filing`, `read_document`, `edgar_fulltext_search`, `get_recent_filings`, `get_xbrl_series`, `get_insider_transactions`, `calc`, `web_research` (native web search on OpenAI), `form_d_search`, `search_startups`.
5. `src/lib/roles.ts`: `RoleId` and the exact `specialties` strings for your role (use them verbatim in `specialties`).
6. Your research document(s) in `docs/research/`: the feature proposals, methodologies, glossaries, and prompt libraries are the source of truth for what to build.

## What to deliver
- At least **20 AI workflows** (`kind: "ai"`) and at least **8 calculators** (`kind: "calc"`) for the role (banker: 30 and 12, covering M&A, coverage sectors, restructuring, leveraged finance, ECM, DCM).
- Cover the research's top-priority features first, then breadth across every specialty of the role. Each specialty must have at least three tools that name it in `specialties`.
- Ids: kebab-case, globally unique, descriptive (`rx-recovery-waterfall`, `fpa-variance-bridge`). Do not reuse core ids: `company-one-pager`, `filing-teardown`, `peer-benchmark`, `precedent-transactions`, `research-brief`, `dcf`, `wacc`, `npv-irr`.

## AI workflow quality bar
- `description`: 2-3 sentences a practitioner would recognize (what it produces, from which data, by which method).
- `instructions`: a numbered method. Name the exact tools to call, in order, with the search phrases to use (e.g. `search_filing` on the 10-K for "indebtedness", `edgar_fulltext_search` with forms ["8-K"] and the phrase "Item 1.03"), the formulas and standards (ASC references, IRR definitions, premium conventions), and the block types to produce and in what order. Say what to do when data is missing. This is where the research goes.
- `prompt(inputs)`: a short, specific user message built from the inputs.
- `fields`: only what is needed. Use `ticker`/`tickers` for public companies, `csv` for pasted exports (state expected `columns`), `select` for modes, `textarea` for pasted text (CIM excerpts, term sheets). Provide `example` inputs that work with real US-listed companies.
- `deliverable`, `category`, `icon` (lucide-react name), `tags`, `savesMinutes`, `effort` ("low" for lookups, "medium" default, "high" for multi-document extraction).
- Do not write workflows that only restate what a chat prompt would do; each must encode a method and produce structured blocks.

## Calculator quality bar
- Pure, synchronous `compute(inputs)`; validate and `throw new Error("...")` with a readable message.
- Implement the standard formula exactly (mid-year convention, treasury stock method, SAFE post-money conversion, liquidation preference stacking, Hamada, Gordon growth, XIRR-style IRR via bisection, price/volume/mix decomposition, NWC peg as trailing average, ASC 842 present value with monthly discounting, etc.) and document assumptions in `caveats`.
- Output: `kpis` first, then a `table` of the schedule, then at least one chart (`bar`, `columns`, `waterfall`, `line`, `scatter`) or `sensitivity` grid. Format with `fmt`. Percent inputs are whole numbers (25 means 25%) and must be divided by 100 inside compute.
- Add `prefill(company)` where a ticker makes sense. `CompanyData` fields: `ltm.revenue, priorRevenue, grossProfit, operatingIncome, da, sbc, ebitda, adjEbitda, operatingCashFlow, capex, netIncome`, `balance.cash, debt, sharesOut`, `price.last, marketCap`, `quarters[]`.

## Constraints
- TypeScript strict, no `any`, no unused imports. Import only from `"../types"` (and `"@/lib/types"` for `CompanyData` types if needed).
- Must pass `pnpm exec tsc --noEmit -p tsconfig.json` (ignore errors in other packs being written concurrently and in `.next/types`) and `pnpm exec eslint src/lib/workflows/packs/<role>.ts`.
- Keep the file under ~1,800 lines: compact definitions, no repeated boilerplate. Extract small shared helpers at the top of the file when useful.

## Testing
- `pnpm exec tsx scripts/test-pack.ts <role>`: loads the pack, checks id uniqueness against every pack, runs every calculator with its `example` (and with empty inputs, which must throw or return sensibly), and validates outputs against the `WorkflowOutput` schema.
- `pnpm exec tsx --env-file=.env.local scripts/run-workflow.ts <tool-id>`: runs one AI workflow end to end with its example inputs against the live model and prints the parsed output. Run it for two or three of your most important workflows and fix instructions that produce weak or malformed results. Each run costs money; do not loop it.
