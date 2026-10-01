/**
 * The week across a person's watches, in a few lines: what the newest findings in their feed add up to,
 * each line pointing at the cards it rests on, and one thing to watch next. Written by a small model
 * from the cards alone (nothing else is known to it), once a day per person and only when there is
 * enough new to say something.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { structured } from "@/lib/ai/agent";
import { cacheJson } from "@/lib/cache";
import type { Blend } from "./access";
import { edgeFeed, type EdgeCard } from "./feed";
import { small } from "./models";
import type { Watch } from "./watches";

const Written = z.object({
  headline: z.string().describe("6 to 12 words: the one thing that matters most this week"),
  points: z.array(z.object({
    text: z.string().describe("one sentence a portfolio manager would want; plain, specific, no hype"),
    cards: z.array(z.number().int()).describe("numbers of the cards this sentence rests on"),
  })).min(1).max(4),
  watch: z.string().describe("one sentence: what to look for next, or an empty string"),
});
export type EdgeBrief = { headline: string; points: { text: string; cards: number[] }[]; watch: string; cards: number; days: number; model: string };

const DAY = 86_400_000;

/** The cards a brief is written from: the feed's best, from the last fortnight. Pure. */
export function briefCards(cards: EdgeCard[], now: number, max = 10): EdgeCard[] {
  return cards.filter((c) => now - Date.parse(c.observedAt ?? c.detectedAt) < 14 * DAY).slice(0, max);
}

export async function edgeBrief(userId: string, watches: Watch[], blend: Blend): Promise<EdgeBrief | null> {
  const feed = await edgeFeed(userId, watches, blend, { scope: "all", limit: 20 });
  const cards = briefCards(feed.cards, Date.now());
  if (cards.length < 2) return null;
  const ids = cards.map((c) => c.id);
  const hash = createHash("sha1").update(ids.join(",")).digest("hex").slice(0, 10);
  return cacheJson(`edge:brief:v1:${userId}:${new Date().toISOString().slice(0, 10)}:${hash}`, DAY, async () => {
    const list = cards.map((c, i) => `[${i + 1}] ${c.kind.replace(/_/g, " ")} · ${c.title} · ${(c.observedAt ?? c.detectedAt).slice(0, 10)} · confidence ${Math.round(c.confidence * 100)}\n${c.summary.slice(0, 420)}`).join("\n\n");
    const r = await structured(Written, "edge-brief",
      "You brief an investment professional on what changed at the companies and places they watch. Use only the numbered cards. Every sentence must cite the card numbers it rests on. Never invent numbers, names or causes; say plainly when a finding is uncertain.",
      `The newest findings in their Edge feed:\n\n${list}`,
      { override: small(), maxTokens: 700, timeoutMs: 45_000 });
    const known = (n: number) => n >= 1 && n <= cards.length;
    return {
      headline: r.data.headline.slice(0, 140),
      points: r.data.points.map((p) => ({ text: p.text.slice(0, 400), cards: [...new Set(p.cards.filter(known))].map((n) => ids[n - 1]) })).filter((p) => p.text),
      watch: r.data.watch.slice(0, 300), cards: cards.length, days: 14, model: r.model,
    };
  });
}
