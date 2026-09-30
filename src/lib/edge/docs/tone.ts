/**
 * Hedging and tone in recordings. When a recording is read, a model splits it into speaker turns and
 * scores each for hedging (0 to 1) and tone (-1 to 1); these helpers summarise them by speaker, find the
 * turn at a moment, and compare two recordings (say, one quarter's call with the last). Pure.
 */
export type Turn = { from: number; t?: number; speaker: string; hedging: number; tone: number; note: string };
export type SpeakerTone = { speaker: string; turns: number; hedging: number; tone: number };

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Each speaker's average hedging and tone, the most frequent first. */
export function bySpeaker(turns: Turn[]): SpeakerTone[] {
  const groups = new Map<string, Turn[]>();
  for (const t of turns) groups.set(t.speaker || "Unknown", [...(groups.get(t.speaker || "Unknown") ?? []), t]);
  return [...groups.entries()].map(([speaker, ts]) => ({ speaker, turns: ts.length, hedging: r2(mean(ts.map((t) => t.hedging))), tone: r2(mean(ts.map((t) => t.tone))) }))
    .sort((a, b) => b.turns - a.turns);
}

/** The turn under a moment of the recording (the last one starting at or before it). */
export function turnAt(turns: Turn[], at: number | null | undefined): Turn | null {
  if (at === null || at === undefined) return null;
  let hit: Turn | null = null;
  for (const t of turns) if ((t.t ?? 0) <= at + 0.5) hit = t; else break;
  return hit;
}

/** What the viewer shows for a moment: that turn's scores, and every speaker's averages. */
export function toneOf(turns: Turn[], at: number | null | undefined) {
  const sorted = [...turns].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  return { turn: turnAt(sorted, at), speakers: bySpeaker(sorted).slice(0, 8), overall: { hedging: r2(mean(sorted.map((t) => t.hedging))), tone: r2(mean(sorted.map((t) => t.tone))) } };
}

/** How the speakers two recordings share moved between them (later minus earlier). */
export function toneShift(before: Turn[], after: Turn[]): { speaker: string; hedging: number; tone: number; before: SpeakerTone; after: SpeakerTone }[] {
  const a = new Map(bySpeaker(before).map((s) => [s.speaker.toLowerCase(), s]));
  return bySpeaker(after).filter((s) => a.has(s.speaker.toLowerCase())).map((s) => {
    const p = a.get(s.speaker.toLowerCase())!;
    return { speaker: s.speaker, hedging: r2(s.hedging - p.hedging), tone: r2(s.tone - p.tone), before: p, after: s };
  });
}
