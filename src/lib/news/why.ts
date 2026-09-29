/**
 * "Why it matters to you": a two-sentence note on a story written for one person, from their role,
 * group and sectors, the watchlist companies and contacts it touches, and the story's own summary.
 * Written on request, kept per person and story, inside the personal tier of the news budget (the
 * first to pause when money is tight).
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { ROLES } from "@/lib/roles";
import { allow } from "./budget";
import { score } from "./rank";
import type { ReaderContext } from "./reader";

const Out = z.object({ text: z.string().describe("two sentences, specific to this person's work; no preamble") });

export async function whyForMe(ctx: ReaderContext, clusterId: number): Promise<{ text: string | null; reason?: string }> {
  const db = requireDb();
  const [st] = await db.select().from(schema.newsUserItems).where(and(eq(schema.newsUserItems.userId, ctx.userId), eq(schema.newsUserItems.clusterId, clusterId)));
  if (st?.why?.text) return { text: st.why.text };
  const [c] = await db.select().from(schema.newsClusters).where(eq(schema.newsClusters.id, clusterId));
  if (!c) return { text: null, reason: "Story not found" };
  if (!(await allow("personal"))) return { text: null, reason: "This month's AI budget for personal notes is used up; the story's summary still applies." };
  const { reasons } = score(ctx.reader, c);
  const p = ctx.profile;
  const who = `${p.seniority ? `${p.seniority}, ` : ""}${ROLES[p.role].label}${p.specialty ? ` (${p.specialty})` : ""}${p.firmType ? ` at a ${p.firmType.toLowerCase()}` : ""}${p.sectors.length ? `, covering ${p.sectors.join(", ")}` : ""}`;
  const r = await structured(Out, "news-why",
    "You tell a finance professional, in two sentences, why a news story matters to their work: what it changes for their clients, deals, portfolio or coverage, and one thing to do or watch. Use only the story's facts; do not invent numbers. Direct and specific; no hedging boilerplate.",
    `Reader: ${who}.\nTheir desk: ${ctx.desk.label}. Watchlist: ${ctx.watchlist.slice(0, 12).join(", ") || "none"}.\nWhy it was shown to them: ${reasons.join("; ") || "their desk"}.\n\nStory: ${c.headline}\n${(c.summary?.bullets ?? []).join("\n")}\n${c.summary?.why ? `General significance: ${c.summary.why}` : ""}`,
    { task: "summarize", maxTokens: 400, timeoutMs: 45_000 }).catch(() => null);
  if (!r) return { text: null, reason: "The model did not answer; try again shortly." };
  const why = { text: r.data.text.trim(), model: r.model, at: new Date().toISOString() };
  await db.insert(schema.newsUserItems).values({ userId: ctx.userId, clusterId, why }).onConflictDoUpdate({ target: [schema.newsUserItems.userId, schema.newsUserItems.clusterId], set: { why, updatedAt: new Date() } });
  return { text: why.text };
}
