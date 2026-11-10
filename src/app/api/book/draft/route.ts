import { NextResponse } from "next/server";
import { z } from "zod";
import { structured } from "@/lib/ai/agent";
import { loadUserContext } from "@/lib/ai/persona";
import { guarded } from "@/lib/auth/user";
import { record } from "@/lib/ledger/store";
import { rateLimit } from "@/lib/locks";
import { DRAFT_SYSTEM, draftToPosition, METRIC_KEYS } from "@/lib/book/position";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Draft = z.object({
  ticker: z.string(),
  direction: z.enum(["long", "short"]),
  thesis: z.string(),
  pillars: z.array(z.string()).max(6),
  criteria: z.array(z.object({ metric: z.enum(METRIC_KEYS as [string, ...string[]]), op: z.enum([">=", "<="]), value: z.number(), note: z.string() })).max(8),
  catalysts: z.array(z.object({ label: z.string(), date: z.string() })).max(8),
  /** The price they say they paid (or shorted at), for a stop-loss; null when they give none. */
  entry: z.number().nullable(),
});

/**
 * POST { text }: a position drafted from the person's own words, with kill criteria they can check and
 * change before saving (nothing is saved here). The model's output is cleaned like any saved position
 * (src/lib/book/position.ts draftToPosition); thresholds it chose are marked "suggested". Kept in the
 * research ledger when it is on.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const { text } = ((await req.json().catch(() => ({}))) ?? {}) as { text?: unknown };
    if (typeof text !== "string" || text.trim().length < 12) return NextResponse.json({ error: "Describe the position in a sentence or two: the company, long or short, and why." }, { status: 400 });
    await rateLimit(`book-draft:${user.id}`, 30, 3_600_000, "Many drafts this hour. Try again later.");
    const { prefs } = await loadUserContext(user.id);
    const { data, provider, model } = await structured(Draft, "book_draft", DRAFT_SYSTEM, text.slice(0, 2000), { prefs, task: "draft", timeoutMs: 45_000 });
    const draft = draftToPosition(data);
    if (!draft) return NextResponse.json({ error: "No position could be drafted from that: name the company and say what you expect." }, { status: 422 });
    await record(user.id, { kind: "chat", subject: `Book draft: ${draft.ticker}`, model: `${provider}/${model}`, prompt: text.slice(0, 2000), output: JSON.stringify({ ticker: draft.ticker, direction: draft.direction, thesis: draft.thesis, criteria: draft.criteria }), meta: { feature: "book.draft" } });
    return NextResponse.json({ draft });
  });
}
