/**
 * Home's "Getting started": the few steps that make YouBank useful to a new person, each ticked from
 * what they have actually done (GET /api/desk/checklist), never from a click on the list. Pure.
 */
export type ChecklistFacts = { asked: boolean; ranTool: boolean; mail: boolean; calendar: boolean; twoFactor: boolean; styled: boolean; installed: boolean; book?: boolean; forecast?: boolean; reason?: boolean; aiApp?: boolean };

export type ChecklistStep = { id: keyof ChecklistFacts; label: string; hint: string; href: string; cta: string };

/** For a fund (public markets, private equity): the Book and their own AI app come first, since they are the product. */
export const FUND_STEPS: ChecklistStep[] = [
  { id: "book", label: "Put your book in", hint: "Paste it from a spreadsheet or try the sample: every thesis checked against filings after each close.", href: "/app/book", cta: "Open the Book" },
  { id: "forecast", label: "Give a thesis a forecast", hint: "How sure are you its kill criteria hold, and until when? YouBank scores it, so you learn how calibrated you are.", href: "/app/book", cta: "Add one" },
  { id: "reason", label: "Write down why", hint: "A line in a position's decision journal on why you sized it or changed it, dated by the server. It is what your LP letter and DDQ quote.", href: "/app/book", cta: "Add a note" },
  { id: "aiApp", label: "Connect an AI app", hint: "Claude, ChatGPT or Cursor gets your Book and YouBank's research, with sources, under your control.", href: "/app/settings?tab=connect", cta: "Connect" },
];
export const FUND_ROLES: ReadonlySet<string> = new Set(["markets", "pe"]);

export const STEPS: ChecklistStep[] = [
  { id: "asked", label: "Ask your first question", hint: "Any company, filing or number. Answers come with their sources.", href: "/app/terminal?fn=AI", cta: "Ask" },
  { id: "ranTool", label: "Run a tool", hint: "A model, memo or checklist built for your role, filled from filings.", href: "/app/tools", cta: "Pick one" },
  { id: "mail", label: "Connect your mail", hint: "The agent reads threads, drafts replies and asks before it sends.", href: "/app/crm", cta: "Connect" },
  { id: "calendar", label: "Connect your calendar", hint: "Prep briefs before each meeting, on Home under Coming up.", href: "/app/settings?tab=calendar", cta: "Connect" },
  { id: "twoFactor", label: "Turn on two-factor sign-in", hint: "Needed before YouBank can touch a brokerage or your mailbox.", href: "/app/settings?tab=security", cta: "Turn on" },
  { id: "styled", label: "Make it yours", hint: "A style, a layout, a look. Or press ⌘K and type “look”.", href: "/app/settings?tab=style", cta: "Choose" },
  { id: "installed", label: "Install the app", hint: "Its own window and icon, on your phone or desktop.", href: "/download", cta: "Install" },
];

export function checklist(f: ChecklistFacts, role?: string | null): { steps: (ChecklistStep & { done: boolean })[]; done: number; total: number; next: ChecklistStep | null } {
  const steps = [...(role && FUND_ROLES.has(role) ? FUND_STEPS : []), ...STEPS].map((s) => ({ ...s, done: !!f[s.id] }));
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, next: steps.find((s) => !s.done) ?? null };
}

/** Whether the stored preferences show the person changed how YouBank looks or is arranged. */
export function hasStyled(extra: Record<string, unknown>): boolean {
  const look = extra.look && typeof extra.look === "object" ? Object.keys(extra.look as object).length > 0 : false;
  const desk = (extra.desk as { source?: string } | undefined)?.source === "you";
  const looks = Array.isArray(extra.looks) && extra.looks.length > 0;
  return typeof extra.theme === "string" || look || desk || looks;
}
