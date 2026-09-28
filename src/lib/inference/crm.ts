/**
 * Inference for relationships and pipelines, as pure functions over email and deal histories.
 *
 * - Relationship strength: recency-weighted interactions times reciprocity. Gilbert and Karahalios
 *   (2009) found days since last contact the strongest single predictor of tie strength; products
 *   such as Affinity and Dynamics 365 score recency, frequency and two-way reciprocity the same way.
 * - Contact knowledge: what a person has been told, and whether it stuck, as Bayesian knowledge
 *   tracing with forgetting (each of our mentions is a learning event, their own words are evidence),
 *   and what they care about as a discounted Beta over how they engage with each topic.
 * - Deal odds: a stage prior moved by engagement evidence on the logit scale, and a Monte Carlo of the
 *   whole pipeline for a range instead of a single weighted total.
 */
import { rng as seeded, normalSampler, quantile } from "./stats";
import { poissonBinomial } from "./survival";

const DAY = 86_400_000;
const days = (a: Date | number, b: Date | number) => (Number(a) - Number(b)) / DAY;

/* ---------------- Relationship strength ---------------- */

export type Interaction = { at: Date; kind: "two-way" | "inbound" | "unanswered" };
export const INTERACTION_WEIGHT: Record<Interaction["kind"], number> = { "two-way": 1.5, inbound: 1, unanswered: 0.25 };
export const STRENGTH_HALF_LIFE = 60;

/** Recency-weighted engagement: sum of w x 2^(-age / 60 days). */
export function engagement(events: Interaction[], now = new Date()): number {
  return events.reduce((a, e) => a + INTERACTION_WEIGHT[e.kind] * Math.pow(2, -Math.max(0, days(now, e.at)) / STRENGTH_HALF_LIFE), 0);
}

/**
 * Strength on 0-100: 100 (1 - e^(-E / E0)) (0.5 + 0.5 r), where E0 is the median engagement across the
 * person's active contacts (so the scale adapts to how much they email) and r = min(in, out) / max(in,
 * out) over 180 days is reciprocity. Bands follow Dynamics 365: good 60+, fair 40-59, poor below 40.
 */
export function relationshipStrength(E: number, E0: number, inbound180: number, outbound180: number): { score: number; band: "good" | "fair" | "poor"; reciprocity: number } {
  const r = Math.max(inbound180, outbound180) ? Math.min(inbound180, outbound180) / Math.max(inbound180, outbound180) : 0;
  const score = 100 * (1 - Math.exp(-E / Math.max(E0, 1e-6))) * (0.5 + 0.5 * r);
  return { score, band: score >= 60 ? "good" : score >= 40 ? "fair" : "poor", reciprocity: r };
}

/* ---------------- Contact knowledge tracing ---------------- */

/** One tagged email: what we mentioned, or what they showed they know or asked about. */
export type TopicEvent = { at: Date; direction: "inbound" | "outbound"; topics: string[]; knows?: string[]; asks?: string[]; /** For outbound: did they reply within a week, and about what. */ reply?: { topics: string[] } | null; subject?: string };

export type TopicState = {
  topic: string; awareness: number; halfLife: number; a: number; b: number; told: number; engaged: number;
  lastTold: Date | null; lastSeen: Date | null; evidence: string;
};

const G = 0.05, S = 0.05;

/**
 * Replay a contact's emails into per-topic awareness and interest.
 *
 * Awareness A = P(they know topic k), a hidden Markov model in the style of BKT. Between events it
 * fades, A <- A 2^(-dt / h), with h starting at 60 days and doubling after each mention they engaged
 * with. Our mention is a learning event, A <- A + (1 - A) T, with T = 0.9 when they replied about it,
 * 0.5 when they replied at all, 0.3 when they did not (we cannot tell if it was read). Their own
 * words are observations with guess and slip of 0.05: showing they know it raises A, asking about
 * it lowers it.
 *
 * Interest I = P(they engage when k comes up), a Beta whose counts decay with a 120-day half-life:
 * a <- l a + engaged, b <- l b + (1 - engaged). Raising a topic unprompted counts as engagement.
 */
export function traceTopics(events: TopicEvent[], now = new Date()): Map<string, TopicState> {
  const lambdaPerDay = Math.pow(2, -1 / 120);
  type Live = TopicState & { at: Date | null; notes: string[] };
  const states = new Map<string, Live>();
  const get = (k: string) => {
    let s = states.get(k);
    if (!s) { s = { topic: k, awareness: 0.1, halfLife: 60, a: 0, b: 0, told: 0, engaged: 0, lastTold: null, lastSeen: null, evidence: "", at: null, notes: [] }; states.set(k, s); }
    return s;
  };
  /** Fade awareness (half-life h) and interest counts (120-day half-life) up to `at`. */
  const age = (s: Live, at: Date) => {
    if (s.at) {
      const dt = Math.max(0, days(at, s.at));
      s.awareness *= Math.pow(2, -dt / s.halfLife);
      s.a *= Math.pow(lambdaPerDay, dt);
      s.b *= Math.pow(lambdaPerDay, dt);
    }
    s.at = at;
  };
  const sorted = [...events].sort((x, y) => Number(x.at) - Number(y.at));
  for (const e of sorted) {
    const date = e.at.toISOString().slice(0, 10);
    if (e.direction === "outbound") {
      for (const k of e.topics) {
        const s = get(k); age(s, e.at);
        const aboutIt = !!e.reply && e.reply.topics.includes(k);
        const T = aboutIt ? 0.9 : e.reply ? 0.5 : 0.3;
        s.awareness = s.awareness + (1 - s.awareness) * T;
        const engaged = aboutIt ? 1 : e.reply ? 0.5 : 0;
        s.a += engaged; s.b += 1 - engaged; s.told++;
        if (engaged === 1) { s.engaged++; s.halfLife = Math.min(365, s.halfLife * 2); }
        s.lastTold = e.at;
        s.notes = [...s.notes, `told ${date}${e.subject ? ` in "${e.subject.slice(0, 60)}"` : ""}${aboutIt ? ", and they replied about it" : ""}`].slice(-2);
      }
    } else {
      const knows = new Set(e.knows ?? []), asks = new Set(e.asks ?? []);
      for (const k of new Set([...e.topics, ...knows, ...asks])) {
        const s = get(k); age(s, e.at);
        const p = s.awareness;
        if (asks.has(k)) s.awareness = (p * S) / (p * S + (1 - p) * (1 - G));
        else if (knows.has(k)) s.awareness = (p * (1 - S)) / (p * (1 - S) + (1 - p) * G);
        else s.awareness = (p * (1 - S)) / (p * (1 - S) + (1 - p) * 0.2);
        s.a += 1; s.engaged++;
        s.lastSeen = e.at;
        s.notes = [...s.notes, `${asks.has(k) ? "asked about it" : knows.has(k) ? "showed they know it" : "raised it"} ${date}${e.subject ? ` in "${e.subject.slice(0, 60)}"` : ""}`].slice(-2);
      }
    }
  }
  for (const s of states.values()) age(s, now);
  return new Map([...states].map(([k, s]) => [k, { topic: s.topic, awareness: Math.min(0.999, Math.max(0.001, s.awareness)), halfLife: s.halfLife, a: s.a, b: s.b, told: s.told, engaged: s.engaged, lastTold: s.lastTold, lastSeen: s.lastSeen, evidence: s.notes.join("; ") }]));
}

/** Interest with a prior of kappa pseudo-emails at the person's base engagement rate. */
export const interestMean = (s: Pick<TopicState, "a" | "b">, baseRate: number, kappa = 5) => (s.a + kappa * baseRate) / (s.a + s.b + kappa);

/**
 * What to raise next: U = I~ + (1 - A) x importance - [told in the last 14 days] + 0.3 [important and
 * A < 0.5], with I~ a Thompson draw from the interest Beta (so less-tried topics still get a turn).
 */
export function talkingPoints(states: TopicState[], importance: Map<string, number>, baseRate: number, now = new Date(), seed = 1, k = 2): { topic: string; score: number; why: string }[] {
  const u = seeded(seed), z = normalSampler(u);
  const beta = (a: number, b: number) => { const x = gamma(a, u, z), y = gamma(b, u, z); return x / (x + y); };
  const known = new Map(states.map((s) => [s.topic, s]));
  const topics = new Set([...states.map((s) => s.topic), ...importance.keys()]);
  const kappa = 5;
  return [...topics].map((t) => {
    const s = known.get(t) ?? { topic: t, awareness: 0.1, halfLife: 60, a: 0, b: 0, told: 0, engaged: 0, lastTold: null, lastSeen: null, evidence: "" };
    const imp = importance.get(t) ?? 0.2;
    const draw = beta(s.a + kappa * baseRate, s.b + kappa * (1 - baseRate));
    const recent = s.lastTold && days(now, s.lastTold) < 14 ? 1 : 0;
    const score = draw + (1 - s.awareness) * imp - recent + (imp >= 0.5 && s.awareness < 0.5 ? 0.3 : 0);
    const why = recent ? "mentioned in the last two weeks" : s.told === 0 && !s.lastSeen ? "not raised with them yet" : s.awareness < 0.5 ? `told before but likely faded (${Math.round(s.awareness * 100)}% chance they recall it)` : `they engage with it (${Math.round(interestMean(s, baseRate) * 100)}%)`;
    return { topic: t, score, why };
  }).sort((a, b) => b.score - a.score).slice(0, k);
}

function gamma(k: number, u: () => number, z: () => number): number {
  if (k <= 0) return 1e-9;
  if (k < 1) return gamma(k + 1, u, z) * Math.pow(u(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) { let x = z(), v = 1 + c * x; if (v <= 0) continue; v = v * v * v; const uu = u(); x = x * x; if (uu < 1 - 0.0331 * x * x || Math.log(uu) < 0.5 * x + d * (1 - v + Math.log(v))) return d * v; }
}

/* ---------------- Deals ---------------- */

const logit = (p: number) => Math.log(Math.min(0.999, Math.max(0.001, p)) / (1 - Math.min(0.999, Math.max(0.001, p))));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export type DealEvidence = { daysIdle: number; overdue: boolean; strength: number | null; recentInbound: boolean };

/**
 * Win probability: logit p = logit(stage prior) + evidence. Until there are enough closed deals to
 * fit the weights, they are set by hand and shown: idle time costs 0.5 per 30 days (up to 1.5), an
 * overdue next step 0.4, a strong relationship with the contact adds up to 0.8, a reply in the last
 * two weeks 0.3.
 */
export function dealWinProbability(prior: number, e: DealEvidence): { p: number; drivers: { factor: string; effect: number }[] } {
  const drivers: { factor: string; effect: number }[] = [];
  const idle = -Math.min(1.5, (0.5 * Math.max(0, e.daysIdle - 14)) / 30);
  if (idle < -0.01) drivers.push({ factor: `idle ${Math.round(e.daysIdle)} days`, effect: idle });
  if (e.overdue) drivers.push({ factor: "next step overdue", effect: -0.4 });
  if (e.strength !== null) drivers.push({ factor: `relationship ${Math.round(e.strength)}/100`, effect: (0.8 * (e.strength - 50)) / 50 });
  if (e.recentInbound) drivers.push({ factor: "replied in the last 14 days", effect: 0.3 });
  const p = sigmoid(logit(prior) + drivers.reduce((a, d) => a + d.effect, 0));
  return { p, drivers };
}

/**
 * The stage prior moved toward the desk's own record: (wins + kappa x configured) / (closed + kappa),
 * applied as a ratio to every open stage, with kappa = 20 so a handful of outcomes cannot swing it.
 */
export function calibratedPriors(configured: Record<string, number>, won: number, lost: number, kappa = 20): { priors: Record<string, number>; winRate: number | null } {
  const closed = won + lost;
  if (!closed) return { priors: configured, winRate: null };
  const open = Object.entries(configured).filter(([, p]) => p > 0 && p < 1);
  const avg = open.reduce((a, [, p]) => a + p, 0) / Math.max(1, open.length);
  const shrunk = (won + kappa * avg) / (closed + kappa);
  const ratio = avg > 0 ? shrunk / avg : 1;
  return { priors: Object.fromEntries(Object.entries(configured).map(([k, p]) => [k, p > 0 && p < 1 ? Math.min(0.97, p * ratio) : p])), winRate: won / closed };
}

export type PipelineDeal = { id: number; p: number; amount: number | null };

/**
 * The pipeline as a distribution: each deal closes with its own probability, amounts drawn lognormal
 * around the entered figure (sigma 0.35 until there is history of quoted against closed amounts).
 * The count of wins is exact (Poisson-binomial); the value is 10,000 seeded draws.
 */
export function simulatePipeline(deals: PipelineDeal[], n = 10_000, seed = 17, sigma = 0.35, target?: number) {
  const u = seeded(seed), z = normalSampler(u);
  const totals: number[] = [];
  const priced = deals.filter((d) => d.amount && d.amount > 0);
  for (let i = 0; i < n; i++) {
    let t = 0;
    for (const d of priced) if (u() < d.p) t += (d.amount as number) * Math.exp(-0.5 * sigma * sigma + sigma * z());
    totals.push(t);
  }
  totals.sort((a, b) => a - b);
  const count = poissonBinomial(deals.map((d) => d.p));
  const cum = (k: number) => count.slice(0, k + 1).reduce((a, b) => a + b, 0);
  const countQ = (q: number) => { for (let k = 0; k < count.length; k++) if (cum(k) >= q) return k; return count.length - 1; };
  return {
    value: priced.length ? { p10: quantile(totals, 0.1), p50: quantile(totals, 0.5), p90: quantile(totals, 0.9), mean: totals.reduce((a, b) => a + b, 0) / n, weighted: priced.reduce((a, d) => a + d.p * (d.amount as number), 0), deals: priced.length, pAtLeastTarget: target !== undefined ? totals.filter((t) => t >= target).length / n : null } : null,
    wins: { expected: deals.reduce((a, d) => a + d.p, 0), p10: countQ(0.1), p50: countQ(0.5), p90: countQ(0.9), none: count[0] ?? 1, distribution: count.slice(0, Math.min(count.length, 21)) },
  };
}

/** Stage win probabilities before any evidence, by desk. Deals pipelines move slowly and pass on most; sales stages follow CRM defaults. */
export const STAGE_PRIORS: Record<string, number> = {
  inbox: 0.03, screening: 0.08, diligence: 0.2, partner: 0.4, term_sheet: 0.7, portfolio: 1, passed: 0,
  lead: 0.05, contacted: 0.1, engaged: 0.2, meeting: 0.35, proposal: 0.6, won: 1, lost: 0,
};
