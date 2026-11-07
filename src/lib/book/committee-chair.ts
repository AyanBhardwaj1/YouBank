/**
 * The chair's structured answer and system prompt, for the server only (zod stays out of the browser bundle,
 * which imports ./committee.ts for its types and labels). The run is src/app/api/book/committee.
 */
import { z } from "zod";
import type { ChairAnswer } from "./committee";

export const ChairSchema: z.ZodType<ChairAnswer> = z.object({
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
