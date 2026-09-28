/**
 * Knowledge tracing for the terminal. Each function is a skill; opening it and working in it is
 * evidence of use, a failed command is evidence against. Bayesian Knowledge Tracing with forgetting
 * turns that into a mastery estimate per function, which fades hints and suggests the next function
 * worth learning (one whose prerequisites the person already has).
 */
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { ASSISTED_BKT, bktUpdate, decayed, DEFAULT_BKT, hintLevel, masteryLabel, nextSkills, type SkillState } from "@/lib/inference/tracing";

export type SkillDef = { key: string; label: string; weight: number; requires?: string[]; why: string };

/** The curriculum: functions, what learning them unlocks, and what they build on. */
export const SKILLS: SkillDef[] = [
  { key: "DES", label: "Description", weight: 1, why: "The starting point for any company." },
  { key: "FA", label: "Financials", weight: 1, requires: ["DES"], why: "Read the statements before any valuation." },
  { key: "GP", label: "Price chart", weight: 0.9, requires: ["DES"], why: "Trend, volatility regime and the price cone." },
  { key: "COMPS", label: "Trading comps", weight: 0.9, requires: ["FA"], why: "Where the company trades against peers." },
  { key: "CAP", label: "Capital structure", weight: 0.8, requires: ["FA"], why: "Debt, leverage and liquidity." },
  { key: "EE", label: "Earnings", weight: 0.8, requires: ["FA"], why: "Surprises, beat odds and the typical move." },
  { key: "FCST", label: "Revenue forecast", weight: 0.8, requires: ["FA"], why: "A model forecast with honest intervals, against the Street." },
  { key: "BETA", label: "Beta", weight: 0.7, requires: ["GP"], why: "Market sensitivity, the input to cost of capital." },
  { key: "RISK", label: "Risk", weight: 0.7, requires: ["GP"], why: "Volatility forecast, value at risk and drawdowns." },
  { key: "WACC", label: "Cost of capital", weight: 0.7, requires: ["BETA", "CAP"], why: "Discount rate for a DCF." },
  { key: "IRAT", label: "Implied rating", weight: 0.7, requires: ["CAP"], why: "Credit risk without a ratings licence." },
  { key: "QUAL", label: "Earnings quality", weight: 0.7, requires: ["FA"], why: "Forensic checks on the numbers." },
  { key: "DDIS", label: "Debt maturities", weight: 0.6, requires: ["CAP"], why: "The refinancing wall." },
  { key: "DVD", label: "Dividends", weight: 0.5, requires: ["FA"], why: "Yield, growth and dividend safety." },
  { key: "ANR", label: "Analysts", weight: 0.5, requires: ["EE"], why: "Ratings, targets and drift." },
  { key: "INS", label: "Insiders", weight: 0.5, requires: ["DES"], why: "What management is doing with its own shares." },
  { key: "FIL", label: "Filings", weight: 0.6, requires: ["DES"], why: "The primary source for everything else." },
  { key: "EQS", label: "Screener", weight: 0.8, requires: ["FA"], why: "Find companies across the whole market." },
  { key: "WEI", label: "World indices", weight: 0.6, why: "The market backdrop." },
  { key: "GC", label: "Treasury curve", weight: 0.6, why: "Rates, curve shape and recession odds." },
  { key: "ECO", label: "Economy", weight: 0.6, requires: ["GC"], why: "Inflation, jobs and growth, with outlooks." },
  { key: "PORT", label: "Portfolio risk", weight: 0.6, requires: ["RISK"], why: "Risk of a whole book, not one stock." },
  { key: "HP", label: "Price history", weight: 0.4, requires: ["GP"], why: "The daily record behind the chart." },
  { key: "MOST", label: "Movers", weight: 0.4, requires: ["WEI"], why: "What is moving the market today." },
  { key: "SECT", label: "Sectors", weight: 0.5, requires: ["WEI"], why: "Which parts of the market lead and lag." },
  { key: "FXC", label: "Currencies", weight: 0.4, requires: ["WEI"], why: "The dollar against the majors." },
  { key: "CMDTY", label: "Commodities", weight: 0.4, requires: ["WEI"], why: "Energy, metals and grains." },
  { key: "MA", label: "M&A", weight: 0.5, requires: ["DES"], why: "Who is buying whom." },
  { key: "PREC", label: "Precedents", weight: 0.6, requires: ["COMPS"], why: "What buyers have paid for similar companies." },
  { key: "EVT", label: "Events", weight: 0.5, requires: ["FIL"], why: "Material events from 8-K filings." },
  { key: "XBRL", label: "XBRL explorer", weight: 0.4, requires: ["FA"], why: "Any figure a company reports, as a series." },
  { key: "AI", label: "AI assistant", weight: 0.9, requires: ["DES"], why: "Ask anything over the open screens, with sources." },
];

export type SkillsView = { skills: (SkillDef & { p: number; n: number; mastery: ReturnType<typeof masteryLabel>; hint: ReturnType<typeof hintLevel> })[]; next: { key: string; label: string; why: string }[] };

async function load(userId: string): Promise<Record<string, SkillState>> {
  const [row] = await requireDb().select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  const skills = (row?.extra as Record<string, unknown> | null)?.skills;
  return skills && typeof skills === "object" ? (skills as Record<string, SkillState>) : {};
}

export function describe(states: Record<string, SkillState>, now = new Date()): SkillsView {
  return {
    skills: SKILLS.map((s) => { const st = states[s.key]; const p = st ? decayed(st, now) : DEFAULT_BKT.pInit; return { ...s, p, n: st?.n ?? 0, mastery: masteryLabel(p, st?.n ?? 0), hint: st ? hintLevel(p) : "full" }; }),
    next: nextSkills(SKILLS, states, now, 3).map((k) => { const s = SKILLS.find((x) => x.key === k)!; return { key: s.key, label: s.label, why: s.why }; }),
  };
}

export async function skillsView(userId: string): Promise<SkillsView> {
  return describe(await load(userId));
}

export type Evidence = "typed" | "click" | "quiz";
const PARAMS: Record<Evidence, typeof DEFAULT_BKT> = { typed: DEFAULT_BKT, click: ASSISTED_BKT, quiz: { ...DEFAULT_BKT, pGuess: 0.25 } };

/**
 * Record evidence for one function; returns the updated view. A command typed unaided is strong
 * evidence (guess 0.1); one reached by clicking is weaker (guess 0.3); a four-option quiz answer has a
 * guess of 0.25; closing a panel straight after opening it counts against.
 */
export async function recordSkill(userId: string, key: string, correct: boolean, evidence: Evidence = "typed"): Promise<SkillsView> {
  if (!SKILLS.some((s) => s.key === key)) return skillsView(userId);
  const db = requireDb();
  const [row] = await db.select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  const extra = { ...((row?.extra as Record<string, unknown>) ?? {}) };
  const states = { ...((extra.skills as Record<string, SkillState>) ?? {}) };
  states[key] = bktUpdate(states[key] ?? null, correct, new Date(), PARAMS[evidence]);
  extra.skills = states;
  if (row) await db.update(schema.profiles).set({ extra }).where(eq(schema.profiles.userId, userId));
  return describe(states);
}
