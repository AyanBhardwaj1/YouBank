/**
 * What changed, for the "New in YouBank" card (src/components/workspace/WhatsNew.tsx). Newest first.
 * Bump RELEASE when adding entries: the card shows once per release per browser.
 */
export const RELEASE = "2026-11-04";

export type NewThing = { title: string; body: string; href?: string; action?: "palette" | "arrange" | "shortcuts"; cta: string };

export const WHATS_NEW: NewThing[] = [
  { title: "⌘K goes anywhere", body: "Any page or tool, a ticker, your look, or a question for the AI, from one box.", action: "palette", cta: "Try it" },
  { title: "Home, your way", body: "Focus, Home or Desk. Arrange widgets right on the page: drag, resize, add.", action: "arrange", cta: "Arrange" },
  { title: "Looks and wallpapers", body: "Six looks to start from, any accent colour, Home wallpapers, and match your system's light and dark.", href: "/app/settings?tab=style", cta: "Open Style" },
  { title: "Waiting for you", body: "The agent's drafts, questions and follow-ups, decided right on Home.", href: "/app", cta: "See Home" },
  { title: "Your own watchlist", body: "Edit it on Home; the terminal, comps and your news follow it.", href: "/app", cta: "Edit it" },
  { title: "Answers you can use", body: "Copy with sources, paste tables into Excel, save to notes, and follow-up questions.", href: "/app/terminal?fn=AI", cta: "Ask something" },
  { title: "Checked figures in tools", body: "Every number in an AI workflow's result is checked against the source it cites, as in chat.", href: "/app/tools", cta: "Run a tool" },
  { title: "Star tools, jump back in", body: "Star the tools you use; they come first. Home remembers the pages and tickers you opened last.", href: "/app/tools", cta: "Open Tools" },
  { title: "Share your setup", body: "Give a teammate your whole desk and look as a code, or use theirs.", href: "/app/settings?tab=desk", cta: "Open My desk" },
  { title: "Keyboard", body: "G then a letter to go anywhere. ? lists them.", action: "shortcuts", cta: "Show keys" },
];
