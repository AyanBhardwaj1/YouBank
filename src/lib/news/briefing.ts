/**
 * The personal audio briefing's script, as chapters: a short opening, one chapter per story (its
 * headline, what happened in a sentence or two, and why it matters), the market watch when there is
 * one, and a close. This version is built from the stories' own summaries with no model, and is what
 * the free briefing reads aloud with the browser's own voice (the Web Speech API). The AI version
 * (audio.ts) rewrites the same chapters as a spoken script and reads them with a neural voice; it
 * keeps these chapter ids and story links, so the player and its chapters work the same either way.
 * Pure, safe on the client, tested.
 */
import type { BriefingChapter } from "@/db/schema";

/** Spoken English runs about 155 words a minute. */
export const WORDS_PER_MINUTE = 155;
export const secondsFor = (text: string) => Math.max(2, Math.round((text.trim().split(/\s+/).filter(Boolean).length / WORDS_PER_MINUTE) * 60));
/** Text to speech takes at most 4,096 characters a request; each chapter is read in one. */
export const MAX_CHAPTER_CHARS = 3_800;

export type BriefingStory = { id: number; headline: string; bullets: string[]; why: string; tickers: string[]; category: string; reasons?: string[] };
export type BriefingWatch = { label: string; last: number | null; change: number | null };

/** Tickers and symbols read badly aloud ("NVDA"); spell them with spaces so voices say the letters. */
export const sayTicker = (t: string) => (/^[A-Z]{1,5}$/.test(t) ? t.split("").join(" ") : t);

/** Make written finance text speakable: currency figures, percentages, "bn", "x" multiples, en dashes. */
export function speakable(text: string): string {
  return text
    .replace(/\$(\d+(?:\.\d+)?)\s?(?:bn|b)\b/gi, "$1 billion dollars").replace(/\$(\d+(?:\.\d+)?)\s?(?:mn|m)\b/gi, "$1 million dollars")
    .replace(/\$(\d+(?:\.\d+)?)\s?(trillion|billion|million)/gi, "$1 $2 dollars").replace(/\$(\d[\d,]*(?:\.\d+)?)/g, "$1 dollars")
    .replace(/(\d)\s?bps\b/gi, "$1 basis points").replace(/(\d(?:\.\d+)?)x\b/g, "$1 times").replace(/(\d)%/g, "$1 percent")
    .replace(/\bQ([1-4])\b/g, (_, q: string) => `the ${["first", "second", "third", "fourth"][Number(q) - 1]} quarter`).replace(/\s*[–—]\s*/g, ", ").replace(/\s+/g, " ").trim();
}

const ordinal = ["First", "Next", "Also today", "Elsewhere", "Meanwhile", "In other news", "One more", "Finally"];

/** "Thursday, October 2" in the person's zone. */
export const spokenDate = (at: Date, timeZone = "America/New_York") => at.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone });

/**
 * The free script: chapters straight from the summaries. `stories` are already in the person's order
 * (their "for you" stories first, then their desk's brief). At most eight story chapters.
 */
export function briefingChapters(p: { name: string; deskLabel: string; date: Date; timeZone?: string; stories: BriefingStory[]; watch?: BriefingWatch[] }): BriefingChapter[] {
  const stories = p.stories.slice(0, 8);
  const first = p.name.trim().split(/\s+/)[0] ?? "";
  const minutes = Math.max(1, Math.round(stories.reduce((n, s) => n + secondsFor([s.headline, ...s.bullets.slice(0, 2), s.why].join(" ")), 0) / 60 + 0.5));
  const intro = `Good morning${first ? `, ${first}` : ""}. This is your ${p.deskLabel} briefing for ${spokenDate(p.date, p.timeZone)}: ${stories.length} ${stories.length === 1 ? "story" : "stories"}, about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  const chapters: BriefingChapter[] = [{ id: "intro", title: "Opening", text: intro, seconds: secondsFor(intro) }];
  stories.forEach((s, i) => {
    const word = i > 0 && i === stories.length - 1 ? "Finally" : ordinal[Math.min(i, ordinal.length - 2)];
    const lead = `${word}: ${s.headline.replace(/[.!?]?$/, ".")}`;
    const why = s.why ? ` Why it matters: ${s.why}` : "";
    const mine = s.reasons?.find((r) => !r.startsWith("For your desk"));
    const because = mine ? mine.replace(/^On your watchlist:/, "it is on your watchlist,").replace(/^In your network:/, "someone in your network is involved,") : "";
    const text = speakable(`${lead} ${s.bullets.slice(0, 2).join(" ")}${why}${because ? ` You are hearing this because ${because.charAt(0).toLowerCase()}${because.slice(1)}.` : ""}`).slice(0, MAX_CHAPTER_CHARS);
    chapters.push({ id: `s${s.id}`, title: s.headline, text, clusterId: s.id, tickers: s.tickers.slice(0, 3), seconds: secondsFor(text) });
  });
  const moves = (p.watch ?? []).filter((w) => w.last !== null && w.change !== null).slice(0, 4);
  if (moves.length) {
    const text = speakable(`The markets. ${moves.map((w) => `${w.label} ${w.change! >= 0 ? "up" : "down"} ${Math.abs(w.change! * 100).toFixed(1)}%`).join(", ")}.`);
    chapters.push({ id: "markets", title: "Market watch", text, seconds: secondsFor(text) });
  }
  const outro = "That's your briefing. Open any story in the Newsroom for the sources, the numbers and the full timeline.";
  chapters.push({ id: "outro", title: "Close", text: outro, seconds: secondsFor(outro) });
  return chapters;
}

/**
 * Fit a model's rewrite onto the free chapters: same ids, order and story links; a chapter the model
 * dropped or left empty keeps its free text, and anything over the speech limit is cut at a sentence.
 */
export function mergeScript(base: BriefingChapter[], written: { id: string; text: string }[]): BriefingChapter[] {
  const byId = new Map(written.map((w) => [w.id.trim(), w.text.trim()]));
  return base.map((c) => {
    const t = byId.get(c.id);
    if (!t || t.length < 12) return c;
    let text = speakable(t);
    if (text.length > MAX_CHAPTER_CHARS) { const cut = text.slice(0, MAX_CHAPTER_CHARS); text = cut.slice(0, Math.max(cut.lastIndexOf(". ") + 1, 200)); }
    return { ...c, text, seconds: secondsFor(text) };
  });
}

/** Total length of a briefing in seconds. */
export const briefingSeconds = (chapters: BriefingChapter[]) => chapters.reduce((n, c) => n + c.seconds, 0);

/** Estimated cost of voicing chapters with gpt-4o-mini-tts: about $0.015 a minute of audio. */
export const ttsCostUsd = (chapters: BriefingChapter[]) => Math.round((briefingSeconds(chapters) / 60) * 0.015 * 10_000) / 10_000;
