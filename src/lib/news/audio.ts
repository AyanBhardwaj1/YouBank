/**
 * The personal audio briefing, on the server.
 *
 * Free, always: the chapters built from the person's stories (briefing.ts), which the browser reads
 * aloud with its own voice. Nothing is spent.
 *
 * Premium (news.audio), on a click: a small model rewrites those chapters as a spoken script, and
 * OpenAI's gpt-4o-mini-tts reads each chapter (one request per chapter keeps every request under the
 * 4,096-character limit and makes chapters exact). The audio goes to object storage (R2) when it is
 * set up, and the browser plays it through signed links; without storage it is sent back once with the
 * response and not kept. Without OPENAI_API_KEY the AI script is still written and the browser voice
 * reads it (the free fallback). One per person per day and kind; asking again returns it unless they
 * ask to remake it (three remakes a day).
 *
 * Premium (news.audio-daily), switched on by the person: the same, made each morning at their brief
 * time by the Newsroom pass and announced in the bell. The plan is checked when the switch is turned on
 * and again before every run, so a lapsed plan stops the spending.
 *
 * Spend goes to the person's own AI ledger (features "audio-briefing-script" and "audio-briefing-voice"),
 * under their daily AI cap, not the Newsroom's shared pipeline budget.
 */
import { createHash } from "node:crypto";
import OpenAI from "openai";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import type { BriefingAudio, BriefingChapter } from "@/db/schema";
import { structured } from "@/lib/ai/agent";
import { guardAi } from "@/lib/ai/limits";
import { aiUser, recordUsage } from "@/lib/ai/usage";
import { putObject, r2Ready, signedUrl } from "@/lib/edge/infra/r2";
import { briefingChapters, mergeScript, ttsCostUsd, type BriefingStory } from "./briefing";
import { deskBrief, forYou } from "./brief";
import { localParts, type VoiceId } from "./prefs";
import type { ReaderContext } from "./reader";
import { sharedRecentClusters, type ClusterRow } from "./store";

export const TTS_MODEL = "gpt-4o-mini-tts";
const TTS_INSTRUCTIONS = "Read as a calm, clear financial news anchor: measured pace, neutral and confident, light emphasis on numbers and company names. Short pauses between sentences. Never rush.";

export const ttsReady = () => !!process.env.OPENAI_API_KEY?.trim();

/** Today's date in the person's own zone: the slot their briefing belongs to. */
export const audioSlot = (ctx: Pick<ReaderContext, "prefs">, at = new Date()) => localParts(at, ctx.prefs.brief.timezone).date;

/** The stories a person's briefing covers, in order: their "for you" stories, then their desk's brief. */
export async function briefingStories(ctx: ReaderContext): Promise<{ stories: BriefingStory[]; watch: { label: string; last: number | null; change: number | null }[] }> {
  const [brief, recent] = await Promise.all([deskBrief(ctx.desk).catch(() => null), sharedRecentClusters(30, 600, 0.2).catch(() => [] as ClusterRow[])]);
  const mine = forYou(ctx.reader, recent, 4);
  const byId = new Map(recent.map((c) => [c.id, c]));
  const out: BriefingStory[] = [];
  const add = (s: BriefingStory) => { if (!out.some((x) => x.id === s.id)) out.push(s); };
  for (const c of mine) add({ id: c.id, headline: c.headline, bullets: (c.summary?.bullets ?? []).slice(0, 2), why: c.summary?.why ?? "", tickers: c.tickers, category: c.category, reasons: c.reasons });
  for (const i of brief?.items ?? []) {
    const c = byId.get(i.clusterId);
    add({ id: i.clusterId, headline: i.headline, bullets: i.lines.length ? i.lines : (c?.summary?.bullets ?? []).slice(0, 2), why: i.why || c?.summary?.why || "", tickers: i.tickers, category: i.category });
  }
  return { stories: out.slice(0, 7), watch: (brief?.watch ?? []).map((w) => ({ label: w.label, last: w.last, change: w.change })) };
}

/** The free chapters for now. */
export async function freeBriefing(ctx: ReaderContext, at = new Date()): Promise<BriefingChapter[]> {
  const { stories, watch } = await briefingStories(ctx);
  return briefingChapters({ name: ctx.name || ctx.profile.name || "", deskLabel: ctx.desk.label, date: at, timeZone: ctx.prefs.brief.timezone, stories, watch });
}

const Script = z.object({
  chapters: z.array(z.object({ id: z.string(), text: z.string().describe("what the voice says for this chapter: spoken English, 25 to 110 words") })).describe("one per chapter given, same ids, same order"),
});

const SCRIPT_SYSTEM = `You write the script for a short personal audio news briefing for a finance professional, read aloud by a voice. You are given chapters (an opening, one per story, maybe the markets, a close) with their facts. Rewrite each as natural spoken English: short sentences, figures said the way a person says them ("four point one billion dollars"), no lists, no headings, no URLs, no emojis. Use only the facts given; never add numbers, names or claims. Link stories with light transitions. Keep each story chapter to 40 to 90 words; the opening and close to one or two sentences. Keep every chapter id.`;

/** A model's spoken rewrite of the free chapters; the free text stands for anything it drops. */
async function writeScript(ctx: ReaderContext, base: BriefingChapter[]): Promise<{ chapters: BriefingChapter[]; model: string }> {
  const prompt = `Listener: ${ctx.name || "the listener"}, ${ctx.desk.label} desk.\n\n${base.map((c) => `[${c.id}] ${c.title}\n${c.text}`).join("\n\n")}`;
  const r = await structured(Script, "audio-briefing-script", SCRIPT_SYSTEM, prompt, { task: "summarize", maxTokens: 3000, timeoutMs: 60_000 });
  return { chapters: mergeScript(base, r.data.chapters), model: r.model };
}

/** One chapter read by the neural voice: mp3 bytes. */
async function speak(client: OpenAI, text: string, voice: VoiceId, speed: number): Promise<Uint8Array> {
  const res = await client.audio.speech.create({ model: TTS_MODEL, voice, input: text, instructions: TTS_INSTRUCTIONS, response_format: "mp3", speed });
  return new Uint8Array(await res.arrayBuffer());
}

const userDir = (userId: string) => createHash("sha256").update(userId).digest("hex").slice(0, 20);

export type BriefingOut = {
  id: number | null; kind: "ai" | "daily"; slot: string; createdAt: string; model: string; voice: string;
  chapters: (BriefingChapter & { audioUrl?: string })[];
  /** Why there is no neural audio, when there is none (the browser voice reads the script instead). */
  note?: string;
};

/** Signed links for stored audio (an hour each), or nothing when storage is not set up. */
export async function withAudioUrls(row: typeof schema.newsBriefings.$inferSelect): Promise<BriefingOut> {
  const audio = row.audio ?? null;
  const urls = audio && r2Ready() ? await Promise.all(audio.map((a) => signedUrl(a.key, 3600, { contentType: "audio/mpeg" }).catch(() => ""))) : [];
  return {
    id: row.id, kind: row.kind as "ai" | "daily", slot: row.slot, createdAt: row.createdAt.toISOString(), model: row.model, voice: row.voice,
    chapters: row.chapters.map((c, i) => ({ ...c, ...(urls[i] ? { audioUrl: urls[i] } : {}) })),
    ...(audio ? {} : { note: ttsReady() ? "The neural voice is not stored on this server, so your browser's voice reads the AI script." : "The neural voice is not set up on this server, so your browser's voice reads the AI script." }),
  };
}

/** The stored briefing for today, if any (either kind, the most recent). */
export async function todaysBriefing(ctx: ReaderContext): Promise<typeof schema.newsBriefings.$inferSelect | null> {
  const rows = await requireDb().select().from(schema.newsBriefings).where(and(eq(schema.newsBriefings.userId, ctx.userId), eq(schema.newsBriefings.slot, audioSlot(ctx)))).catch(() => []);
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}

/**
 * Write and voice a briefing. The caller has already checked the plan (news.audio on a click, or
 * news.audio-daily in the morning pass). Spend is checked against the person's daily AI cap first.
 */
export async function makeBriefing(ctx: ReaderContext, kind: "ai" | "daily", at = new Date()): Promise<BriefingOut> {
  const base = await freeBriefing(ctx, at);
  if (base.length <= 2) throw Object.assign(new Error("There are no stories for your briefing yet. Try again once the morning's news is in."), { status: 409 });
  const ttsUsd = ttsReady() ? ttsCostUsd(base) : 0;
  await guardAi(aiUser(), ttsUsd);
  const { chapters, model } = await writeScript(ctx, base).catch(() => ({ chapters: base, model: "" }));
  // Without a script and without a voice there is nothing to add to the free briefing: say so, store nothing.
  if (!model && !ttsReady()) throw Object.assign(new Error("The AI briefing could not be written just now. The free briefing still plays with your browser's voice."), { status: 503 });
  const slot = audioSlot(ctx, at);
  let audio: BriefingAudio | null = null;
  const inline: string[] = [];
  let costUsd = 0;
  if (ttsReady()) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 90_000, maxRetries: 1 });
    const voice = ctx.prefs.audio.voice, speed = ctx.prefs.audio.speed;
    // Three chapters at a time: a briefing is about ten chapters, and each takes a few seconds.
    const clips: Uint8Array[] = new Array(chapters.length);
    for (let i = 0; i < chapters.length; i += 3) {
      const batch = await Promise.all(chapters.slice(i, i + 3).map((c) => speak(client, c.text, voice, speed)));
      batch.forEach((b, k) => { clips[i + k] = b; });
    }
    costUsd = ttsCostUsd(chapters);
    recordUsage({ feature: "audio-briefing-voice", provider: "openai", model: TTS_MODEL, usage: { input: Math.round(chapters.reduce((n, c) => n + c.text.length, 0) / 4), cached: 0, cacheWrite: 0, output: 0, reasoning: 0 }, extraCostUsd: costUsd });
    if (r2Ready()) {
      const dir = `news/audio/${userDir(ctx.userId)}/${slot}-${kind}`;
      audio = await Promise.all(clips.map(async (b, i) => {
        const key = `${dir}/${String(i).padStart(2, "0")}.mp3`;
        await putObject(key, b, "audio/mpeg", "private, max-age=86400");
        return { key, bytes: b.byteLength, seconds: chapters[i].seconds };
      }));
    } else {
      for (const b of clips) inline.push(`data:audio/mpeg;base64,${Buffer.from(b).toString("base64")}`);
    }
  }
  const values = { userId: ctx.userId, slot, kind, desk: ctx.desk.id, chapters, audio, voice: ttsReady() ? ctx.prefs.audio.voice : "", model, costUsd };
  const [row] = await requireDb().insert(schema.newsBriefings).values(values)
    .onConflictDoUpdate({ target: [schema.newsBriefings.userId, schema.newsBriefings.slot, schema.newsBriefings.kind], set: { ...values, createdAt: new Date() } }).returning();
  const out = await withAudioUrls(row);
  if (inline.length) return { ...out, chapters: out.chapters.map((c, i) => ({ ...c, audioUrl: inline[i] })), note: undefined };
  return out;
}
