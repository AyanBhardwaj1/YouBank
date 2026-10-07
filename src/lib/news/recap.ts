/**
 * The 60-second recap: the day for a desk as a short run of animated slides, drawn in the browser
 * (no video is encoded on our side). A title card with the day's count, the top stories one per slide
 * with their best figure, the deals board, the movers, and a close. Each slide has its time on screen;
 * together they run about a minute. The browser draws them on a canvas, so the same frames can be
 * shared as images or recorded to a video file on the person's own machine. Pure, tested.
 */
export type RecapStory = { id: number; headline: string; category: string; categoryLabel: string; tags: string[]; tickers: string[]; sourceCount: number; bullet: string; figure: { label: string; value: string } | null; change: number | null; closes: number[] };
export type RecapDeal = { label: string; valueUsd: number | null; kind: string };
export type RecapMover = { symbol: string; change: number };

export type RecapSlide =
  | { kind: "title"; ms: number; desk: string; date: string; stories: number; sources: number; deals: number }
  | { kind: "story"; ms: number; n: number; of: number; story: RecapStory }
  | { kind: "deals"; ms: number; deals: RecapDeal[]; totalUsd: number }
  | { kind: "movers"; ms: number; movers: RecapMover[] }
  | { kind: "outro"; ms: number; url: string };

export const RECAP_TARGET_MS = 60_000;

/**
 * Slides for the day. Stories are taken in the order given (the person's ranking), at most five; the
 * deals board appears with at least two sized deals; movers with at least three. Story slides share
 * whatever time the other slides leave of the minute, between five and nine seconds each.
 */
export function recapSlides(p: { desk: string; date: string; stories: RecapStory[]; deals: RecapDeal[]; movers: RecapMover[]; storyCount: number; sourceCount: number; url: string }): RecapSlide[] {
  const stories = p.stories.slice(0, 5);
  const deals = p.deals.filter((d) => d.valueUsd && d.valueUsd > 0).sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)).slice(0, 5);
  const movers = [...p.movers].filter((m) => Number.isFinite(m.change)).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 6);
  const fixed: RecapSlide[] = [];
  const title: RecapSlide = { kind: "title", ms: 5_000, desk: p.desk, date: p.date, stories: p.storyCount, sources: p.sourceCount, deals: p.deals.length };
  const dealSlide: RecapSlide | null = deals.length >= 2 ? { kind: "deals", ms: 7_000, deals, totalUsd: deals.reduce((n, d) => n + (d.valueUsd ?? 0), 0) } : null;
  const moverSlide: RecapSlide | null = movers.length >= 3 ? { kind: "movers", ms: 6_000, movers } : null;
  const outro: RecapSlide = { kind: "outro", ms: 4_000, url: p.url };
  fixed.push(title, ...(dealSlide ? [dealSlide] : []), ...(moverSlide ? [moverSlide] : []), outro);
  const left = RECAP_TARGET_MS - fixed.reduce((n, s) => n + s.ms, 0);
  const each = stories.length ? Math.max(5_000, Math.min(9_000, Math.floor(left / stories.length / 500) * 500)) : 0;
  const storySlides: RecapSlide[] = stories.map((story, i) => ({ kind: "story", ms: each, n: i + 1, of: stories.length, story }));
  return [title, ...storySlides, ...(dealSlide ? [dealSlide] : []), ...(moverSlide ? [moverSlide] : []), outro];
}

export const recapMs = (slides: RecapSlide[]) => slides.reduce((n, s) => n + s.ms, 0);

/** Which slide is on screen at `t` ms, and how far through it (0 to 1). Past the end, the last slide at 1. */
export function slideAt(slides: RecapSlide[], t: number): { index: number; progress: number } {
  let start = 0;
  for (let i = 0; i < slides.length; i++) {
    if (t < start + slides[i].ms) return { index: i, progress: Math.max(0, (t - start) / slides[i].ms) };
    start += slides[i].ms;
  }
  return { index: Math.max(0, slides.length - 1), progress: 1 };
}

/** Wrap text to lines of at most `max` characters at word boundaries, at most `lines` lines (the last ends "…" when cut). */
export function wrapText(text: string, max: number, lines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= max) cur += " " + w;
    else { out.push(cur); cur = w; if (out.length === lines) break; }
  }
  if (out.length < lines && cur) out.push(cur);
  const used = out.join(" ").split(/\s+/).length;
  if (used < words.length && out.length) out[out.length - 1] = `${out[out.length - 1].replace(/[,.;:]?$/, "")}…`;
  return out.slice(0, lines);
}
