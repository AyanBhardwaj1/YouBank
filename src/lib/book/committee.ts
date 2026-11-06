/**
 * The investment committee: the red team grown into a decision. A bull and a bear each write their brief
 * alone (in parallel, neither seeing the other), because agents that debate drift toward a shared, often
 * wrong consensus. Then a chair reads both briefs and the kill-criteria evidence and decides: add, hold,
 * trim or exit. The chair also gives a probability that no kill criterion fails within 90 days, and names
 * the dissent and the signals to watch.
 *
 * The chair's probability becomes a forecast from "AI committee". It is scored like the PM's own, so the
 * track record sets the person's calibration beside the AI's. Pure: prompts, the chair's schema, and the
 * cleaning of a stored committee. The run is in src/app/api/book/committee; tested in scripts/test-book.ts.
 */
import { z } from "zod";
import { AI_COMMITTEE, normalizeConviction, type Conviction } from "./forecast";
import { METRICS, type Evaluation, type Position, type RedTeam } from "./position";

export const DECISIONS = { add: "Add", hold: "Hold", trim: "Trim", exit: "Exit" } as const;
export type Decision = keyof typeof DECISIONS;
export type Committee = {
  at: string; bull: RedTeam; bear: RedTeam;
  decision: Decision; rationale: string; dissent: string; watch: string[];
  /** The chair's forecast, as source "AI committee". */
  forecast: Conviction | null;
};

const evidenceLines = (p: Position, ev: Evaluation | null) => [
  `The thesis: "${p.thesis}"`,
  p.pillars.length ? `Its pillars:\n${p.pillars.map((x, i) => `${i + 1}. ${x}`).join("\n")}` : "",
  p.criteria.length ? `Its kill criteria:\n${p.criteria.map((c) => `- ${METRICS[c.metric].label} ${c.op === ">=" ? "at least" : "at most"} ${c.value}`).join("\n")}` : "",
  ev ? `Where the criteria stand now: ${ev.checks.map((c) => `${c.label} ${c.shown} (${c.state}${c.headroom ? `, room ${c.headroom.shown}` : ""})`).join("; ")}.` : "",
];

/** The bull: the strongest case FOR the position, written alone. */
export function bullPrompt(p: Position, ev: Evaluation | null): string {
  return [
    `Act as the analyst who pitched this ${p.direction} position in ${p.ticker} to the investment committee.`,
    ...evidenceLines(p, ev),
    "Using the tools (filings, XBRL series, comps, filing changes, news), make the strongest evidence-based case FOR keeping or adding to this position.",
    "Rules: cite every figure and claim with its source id; do not invent numbers; say plainly where the evidence is thin.",
    "Structure: 1) The three strongest arguments, each with evidence. 2) The pillar you are most confident in and why. 3) What the next two quarters should show if you are right, as checkable signals.",
    "Keep it under 400 words.",
  ].filter(Boolean).join("\n\n");
}

export const ChairSchema = z.object({
  decision: z.enum(["add", "hold", "trim", "exit"]),
  probability: z.number().describe("1-99: the chance that no kill criterion fails in the next 90 days"),
  rationale: z.string().describe("Why, in at most 4 sentences, citing which brief's evidence carried it"),
  dissent: z.string().describe("The strongest point from the side that lost, in one or two sentences"),
  watch: z.array(z.string()).describe("Up to 3 checkable signals to watch, most important first"),
});

export const CHAIR_SYSTEM = [
  "You chair a small hedge fund's investment committee. You get the position's thesis, its kill criteria with where each stands, and two briefs written independently: one for the position, one against.",
  "Decide add, hold, trim or exit on the evidence in front of you, not on which brief is longer or more confident. A failed kill criterion weighs heavily toward trim or exit unless the bull shows it is temporary with evidence.",
  "Give your probability (1-99) that no kill criterion fails in the next 90 days. Be calibrated: 50 means a coin flip; do not cluster at 70-80 by habit.",
  "Record the strongest point of the side that lost as the dissent. Never invent facts beyond the briefs and the criteria.",
].join("\n");

/** The chair's prompt: the evidence and both briefs, labelled. */
export function chairPrompt(p: Position, ev: Evaluation | null, bull: string, bear: string): string {
  return [`Position: ${p.direction} ${p.ticker}${p.weight !== null ? `, ${p.weight}% of NAV` : ""}.`, ...evidenceLines(p, ev), `--- Brief FOR (written alone) ---\n${bull.slice(0, 6000)}`, `--- Brief AGAINST (written alone) ---\n${bear.slice(0, 6000)}`].filter(Boolean).join("\n\n");
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const brief = (v: unknown): RedTeam | null => {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (typeof r.text !== "string" || typeof r.at !== "string") return null;
  const sources = (Array.isArray(r.sources) ? r.sources : []).flatMap((s) => {
    const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    return typeof o.id === "string" && typeof o.label === "string" && typeof o.url === "string" && /^https:\/\//.test(o.url) ? [{ id: o.id.slice(0, 8), label: o.label.slice(0, 200), url: o.url.slice(0, 500) }] : [];
  }).slice(0, 30);
  return { at: r.at, text: r.text.slice(0, 8000), sources };
};

/** A committee from the chair's answer and the two briefs, as of `now`: its forecast runs 90 days. */
export function committeeFrom(chair: z.infer<typeof ChairSchema>, bull: RedTeam, bear: RedTeam, now = new Date()): Committee {
  const today = now.toISOString().slice(0, 10);
  const by = new Date(now.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);
  return {
    at: now.toISOString(), bull, bear, decision: chair.decision,
    rationale: clip(chair.rationale, 800), dissent: clip(chair.dissent, 400), watch: chair.watch.map((w) => clip(w, 200)).filter(Boolean).slice(0, 3),
    // A chance given as a fraction (0.72) is 72%, not 1%.
    forecast: normalizeConviction({ p: Math.min(99, Math.max(1, Math.round(chair.probability > 0 && chair.probability < 1 ? chair.probability * 100 : chair.probability))), by, at: today, source: AI_COMMITTEE }),
  };
}

/** A stored committee, cleaned, or null. */
export function normalizeCommittee(raw: unknown): Committee | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bull = brief(r.bull), bear = brief(r.bear);
  if (!bull || !bear || typeof r.at !== "string" || typeof r.decision !== "string" || !(r.decision in DECISIONS)) return null;
  return {
    at: r.at, bull, bear, decision: r.decision as Decision,
    rationale: clip(r.rationale, 800), dissent: clip(r.dissent, 400),
    watch: (Array.isArray(r.watch) ? r.watch : []).map((w) => clip(w, 200)).filter(Boolean).slice(0, 3),
    forecast: r.forecast ? normalizeConviction({ ...(r.forecast as object), source: AI_COMMITTEE }) : null,
  };
}
