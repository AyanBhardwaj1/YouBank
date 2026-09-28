/**
 * Knowledge tracing: Bayesian Knowledge Tracing (Corbett and Anderson 1994) with forgetting as an
 * exponential decay toward the prior, in the spirit of half-life regression (Settles and Meeder 2016).
 *
 * YouBank uses it twice. In the terminal, a "skill" is a function or a finance concept and evidence is
 * how the person uses it, so hints fade as mastery grows and the next function worth learning is
 * suggested. In the email agent, a "skill" is a topic a contact has been told about or asked about,
 * so drafts do not repeat what they already know and follow up on what is still open.
 */

export type BktParams = {
  /** Prior probability the skill is known before any evidence. */
  pInit: number;
  /** Probability of learning at each opportunity. */
  pLearn: number;
  /** Probability of a correct response without knowing (guess). */
  pGuess: number;
  /** Probability of an incorrect response despite knowing (slip). */
  pSlip: number;
  /** Days for the gap above the prior to halve without practice. */
  halfLifeDays: number;
};

/**
 * Defaults from the literature (Corbett and Anderson's bounds, G < 0.3 and S < 0.1): a learning rate
 * of 0.15, a slip of 0.1, and a guess of 0.1 because typing a command unaided is hard to get right by
 * chance. A command reached by clicking a suggestion is weaker evidence, so it carries a guess of 0.3.
 */
export const DEFAULT_BKT: BktParams = { pInit: 0.2, pLearn: 0.15, pGuess: 0.1, pSlip: 0.1, halfLifeDays: 30 };
export const ASSISTED_BKT: BktParams = { ...DEFAULT_BKT, pGuess: 0.3 };

export type SkillState = { p: number; n: number; last: string };

/** Mastery after time away: the part above the prior decays with the half-life. */
export function decayed(state: SkillState, now: Date, params: BktParams = DEFAULT_BKT): number {
  const days = Math.max(0, (now.getTime() - new Date(state.last).getTime()) / 86_400_000);
  return params.pInit + (state.p - params.pInit) * Math.pow(2, -days / params.halfLifeDays);
}

/**
 * One BKT update. Posterior given the observation, then the learning transition:
 *   P(L | correct)   = P(L)(1 - S) / [P(L)(1 - S) + (1 - P(L)) G]
 *   P(L | incorrect) = P(L) S / [P(L) S + (1 - P(L))(1 - G)]
 *   P(L') = P(L | obs) + (1 - P(L | obs)) T
 */
export function bktUpdate(state: SkillState | null, correct: boolean, now: Date, params: BktParams = DEFAULT_BKT): SkillState {
  const prior = state ? decayed(state, now, params) : params.pInit;
  const { pGuess: G, pSlip: S, pLearn: T } = params;
  const post = correct ? (prior * (1 - S)) / (prior * (1 - S) + (1 - prior) * G) : (prior * S) / (prior * S + (1 - prior) * (1 - G));
  const p = post + (1 - post) * T;
  return { p: Math.min(0.999, Math.max(0.001, p)), n: (state?.n ?? 0) + 1, last: now.toISOString() };
}

/** Probability the next response is correct, given the current mastery. */
export const pCorrect = (p: number, params: BktParams = DEFAULT_BKT) => p * (1 - params.pSlip) + (1 - p) * params.pGuess;

export type Mastery = "new" | "learning" | "practised" | "mastered";

/**
 * How much help to show (the expertise-reversal effect: scaffolding that helps a novice slows an
 * expert). Full hints while the next attempt is more likely wrong than right, lighter ones until
 * mastery is likely, none once it is.
 */
export function hintLevel(p: number, params: BktParams = DEFAULT_BKT): "full" | "light" | "none" {
  if (pCorrect(p, params) < 0.6) return "full";
  return p < 0.95 ? "light" : "none";
}

export function masteryLabel(p: number, n: number): Mastery {
  if (n === 0) return "new";
  if (p >= 0.95) return "mastered";
  if (p >= 0.6) return "practised";
  return "learning";
}

/**
 * The next skills worth learning: not yet mastered, whose prerequisites are known (P >= 0.8), ranked by
 * value x (1 - P) with a lift for skills related to what is on screen. When nothing clears the gate
 * (a new user), skills are ranked with the prerequisites' strength as a soft weight instead.
 */
export function nextSkills<K extends string>(skills: { key: K; weight: number; requires?: K[] }[], states: Partial<Record<K, SkillState>>, now: Date, limit = 3, params: BktParams = DEFAULT_BKT, related: K[] = []): K[] {
  const p = (k: K) => { const s = states[k]; return s ? decayed(s, now, params) : params.pInit; };
  const open = skills.filter((s) => p(s.key) < 0.95);
  const prereq = (s: { requires?: K[] }) => (s.requires?.length ? Math.min(...s.requires.map(p)) : 1);
  const score = (s: { key: K; weight: number }) => s.weight * (1 - p(s.key)) * (related.includes(s.key) ? 1.5 : 1);
  const gated = open.filter((s) => prereq(s) >= 0.8);
  const ranked = (gated.length ? gated.map((s) => ({ key: s.key, score: score(s) })) : open.map((s) => ({ key: s.key, score: score(s) * prereq(s) })));
  return ranked.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.key);
}
