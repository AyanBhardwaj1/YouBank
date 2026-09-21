# Open questions (to be answered before scaffolding code)

## Product scope
- Which module first: comps engine, deck generator, process manager, or coverage digest?
- Single-user tool for now, or multi-user with deal teams and permissions from day one?
- Export targets: native Excel/PowerPoint files, or in-app tables and slides first?

## UI
- Feel: Bloomberg-style dense terminal, Notion-style docs workspace, or Linear-style clean app?
- Primary surfaces: dashboard, company page, deal page, chat sidebar? Which is the home screen?
- Desktop web only, or also mobile for MDs on the go?

## AI
- Provider: Claude (Anthropic API) vs OpenAI vs multiple. Default assumption: Claude.
- Interaction model: chat with tools, autonomous agents per task, or both?
- Citations and audit trail required on every generated number? (Recommended: yes.)

## Data
- Licensed sources (Capital IQ, FactSet, PitchBook) require enterprise contracts. Start with
  free/cheap sources: SEC EDGAR (filings, XBRL financials), Financial Modeling Prep or Polygon
  (prices, fundamentals), Crunchbase (private companies, paid), news via RSS/NewsAPI.
- Database: Postgres (relational core) plus pgvector for document search is the default.

## Stack
- Web: Next.js + TypeScript + Tailwind + shadcn/ui is the default assumption.
- API: Next.js route handlers or a separate Python FastAPI service for financial computation
  and document generation (python-pptx, openpyxl)?
- Auth: Clerk/Auth.js or skip for now?
