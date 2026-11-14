/**
 * The optional AI layer on the stock mapping (predict.ai-map). The rules (./mapping.ts) always answer first;
 * a model may add up to eight tickers through the app's AI layer (src/lib/ai/agent.ts structured(), which
 * checks the person's AI budget and records the spend in the usage ledger as them). Its answer is checked
 * (real-looking tickers, not already linked by a rule) and merged with mergeAi, which never removes or
 * overrides a rule's link. Any failure falls back to the rules alone. Cached per market for a week, so a
 * market is read once however many people ask. Server only.
 */
import { z } from "zod";
import { structured } from "@/lib/ai/agent";
import { cacheJson } from "@/lib/cache";
import { logError } from "@/lib/errors";
import { mapMarket, mergeAi, type Mapping } from "./mapping";
import { marketLabel } from "./normalize";
import type { Market } from "./types";

const Suggestion = z.object({
  tickers: z.array(z.object({
    ticker: z.string().describe("A US-listed ticker, e.g. DHI"),
    direction: z.enum(["up", "down", "mixed"]).describe("How the stock tends to move as YES becomes more likely"),
    why: z.string().describe("One factual sentence: the business link, not a prediction"),
  })).max(8),
});

const SYSTEM = [
  "You map a prediction-market question to the US-listed stocks whose businesses it most directly affects.",
  "Name only companies with a direct, explainable link (revenue, costs, regulation, a named party). Prefer fewer, clearer names.",
  "Give each a direction for YES becoming more likely (up, down, mixed) and one factual sentence on the link.",
  "Do not repeat tickers already listed. Do not predict prices, give advice, or use the words buy or sell. Return at most eight.",
].join(" ");

/** The mapping with the AI's additions; the rules' mapping, marked as such, when the model is unavailable or fails. */
export async function aiMapping(m: Market): Promise<{ mapping: Mapping; ai: boolean }> {
  const rules = mapMarket(m);
  try {
    const extra = await cacheJson(`predict:v1:aimap:${m.key}`, 7 * 86_400_000, async () => {
      const prompt = [
        `Question: ${marketLabel(m)}`,
        m.question && m.question !== marketLabel(m) ? `Venue wording: ${m.question}` : "",
        m.rules ? `Resolution rules: ${m.rules.slice(0, 1_200)}` : "",
        `Already linked by rules: ${[...rules.tickers.map((t) => t.ticker), ...rules.sectors.flatMap((s) => [s.etf, ...s.members])].filter(Boolean).join(", ") || "none"}`,
      ].filter(Boolean).join("\n");
      const out = await structured(Suggestion, "predict-ai-map", SYSTEM, prompt, { task: "extract", maxTokens: 600, timeoutMs: 45_000 });
      return out.data.tickers;
    });
    const mapping = mergeAi(rules, extra);
    return { mapping, ai: mapping.source === "rules+ai" };
  } catch (e) {
    logError(e, { where: "predict-ai-map" });
    return { mapping: rules, ai: false };
  }
}
