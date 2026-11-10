/**
 * What changed, for the "New in YouBank" card (src/components/workspace/WhatsNew.tsx). Newest first.
 * Bump RELEASE when adding entries: the card shows once per release per browser.
 */
export const RELEASE = "2026-11-07a";

export type NewThing = { title: string; body: string; href?: string; action?: "palette" | "arrange" | "shortcuts"; cta: string };

export const WHATS_NEW: NewThing[] = [
  { title: "Process health", body: "Goalposts moved, losers held longer than winners, theses nobody has reviewed in 90 days, whether your catalysts played out, and more, read from your own records, graded on one panel, and tracked week by week.", href: "/report/book", cta: "See yours" },
  { title: "A decision journal", body: "Every change to a position is dated as it happens; add a line on why. The week shows changes still without a reason, and broken theses with nothing done since.", href: "/app/book", cta: "Open the Book" },
  { title: "The week in your book", body: "What changed, which forecasts resolved, what the committee said and what is coming, on one page, and in the bell after Friday's close.", href: "/report/week", cta: "Open it" },
  { title: "A base rate for your forecasts", body: "Beside a forecast on a position with a price line, the chance the price holds from volatility alone. Start there, then adjust.", href: "/app/book", cta: "Open the Book" },
  { title: "Compliance checks in your AI app", body: "Ask Claude or ChatGPT to draft LP commentary: it checks its own draft with YouBank for promises, AI claims and figures that don't match the filings.", href: "/app/settings?tab=connect", cta: "Connect" },
  { title: "An AI investment committee", body: "On any position: a bull and a bear write sourced briefs alone, then a chair recommends add, hold, trim or exit, with the dissent and a forecast scored beside yours.", href: "/app/book", cta: "Open the Book" },
  { title: "Track record and calibration", body: "Close a position with a reason and it joins your track record. Give a thesis a forecast and YouBank scores how well calibrated you are.", href: "/app/book", cta: "Open the Book" },
  { title: "LP letter and DDQ answers", body: "A draft LP letter from your book, and the AI questions LPs ask answered from your record, each with a compliance check as you edit.", href: "/report/letter", cta: "Draft the letter" },
  { title: "Risk and stress tests", body: "Your book's beta, one-day VaR, the names that are really one bet, and what today's book would have lost in COVID, 2022 and April 2025. Check a trade before you make it.", href: "/app/book?view=risk", cta: "See the risk" },
  { title: "Your AI apps can propose", body: "Claude or ChatGPT can propose a position with its thesis and kill criteria. It waits in your Book until you review it; nothing is added without you.", href: "/app/book", cta: "Open the Book" },
  { title: "AI governance report", body: "A month of the research ledger on one page for compliance or a DDQ: what the AI produced, what was reviewed and rejected, and whether the chain still checks.", href: "/report/ledger", cta: "Open it" },
  { title: "The Book", body: "Your positions, each thesis with the numbers that would prove it wrong, checked against filings and the price on every load. Exposure, P&L and a red team that argues the other side.", href: "/app/book", cta: "Open the Book" },
  { title: "YouBank in your AI apps", body: "Claude, ChatGPT, Cursor and your own agents can use YouBank's research tools over MCP, with sources on every figure.", href: "/app/settings?tab=connect", cta: "Connect" },
  { title: "A research ledger", body: "A tamper-evident record of what the AI was asked and answered, with sources and sign-offs, ready for compliance.", href: "/app/settings?tab=ledger", cta: "Turn it on" },
  { title: "⌘K goes anywhere", body: "Any page or tool, a ticker, a setting, or a question for the AI, from one box.", action: "palette", cta: "Try it" },
  { title: "Your day in one line", body: "Under the greeting: what waits for you, your next meeting, and your biggest mover.", href: "/app", cta: "See Home" },
  { title: "Home, your way", body: "Focus, Home or Desk. Arrange widgets right on the page: drag, resize, add.", action: "arrange", cta: "Arrange" },
  { title: "Waiting for you", body: "The agent's drafts, questions and follow-ups, decided right on Home.", href: "/app", cta: "See Home" },
  { title: "Your own watchlist", body: "Edit it on Home; the terminal, comps and your news follow it.", href: "/app", cta: "Edit it" },
  { title: "Conversations are kept", body: "The terminal AI keeps your last conversation per ticker in this browser. New chat starts over; signing out clears it.", href: "/app/terminal?fn=AI", cta: "Open the AI" },
  { title: "Find people and deals", body: "Type a name in ⌘K to find your contacts and deals.", action: "palette", cta: "Try it" },
  { title: "Answers you can use", body: "Copy with sources, paste tables into Excel, save to notes, and follow-up questions.", href: "/app/terminal?fn=AI", cta: "Ask something" },
  { title: "Checked figures in tools", body: "Every number in an AI workflow's result is checked against the source it cites, as in chat.", href: "/app/tools", cta: "Run a tool" },
  { title: "Star tools, jump back in", body: "Star the tools you use; they come first. Home remembers the pages and tickers you opened last.", href: "/app/tools", cta: "Open Tools" },
  { title: "Share your setup", body: "Give a teammate your whole desk as a code, or use theirs.", href: "/app/settings?tab=desk", cta: "Open My desk" },
  { title: "What changed in the 10-K", body: "Ask the AI what a company changed since its last 10-K or 10-Q: new, dropped and reworded passages, quoted.", href: "/app/terminal?fn=AI", cta: "Ask" },
  { title: "Know the cost first", body: "Before a deep research run or a workflow, see what it usually uses of your monthly AI allowance.", href: "/app/tools", cta: "Open Tools" },
  { title: "Keyboard", body: "G then a letter to go anywhere. ? lists them.", action: "shortcuts", cta: "Show keys" },
];
