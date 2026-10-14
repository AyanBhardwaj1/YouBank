/**
 * Call Desk's (E5) evasion classifier. Three classes as EvasionBench defines them: direct (answers the core
 * question with specific information), intermediate (related information that sidesteps the core) and fully
 * evasive. Edge never calls an answer a lie: it says the answer "did not answer the question asked", with the
 * question, the answer and the reason side by side.
 *
 * The default path is free and runs in-process: observable features of the pair (was a number asked for and
 * given, refusal and deferral phrases, a pivot to prepared remarks, hedging density, how much of the question
 * the answer even touches), a three-class softmax regression fitted on Edge's own labelled pairs
 * (scripts/fixtures/calls/qa-labels.jsonl, fitted by scripts/fit-calls.ts into model.json), temperature
 * scaling and per-class isotonic calibration. Rules add the sub-tags and pick the dodging phrase as a
 * verbatim quote from the answer.
 *
 * The Eva-4B path is optional and off: its training data came from licensed transcripts whose commercial use
 * the owner has not confirmed, so it runs only when EDGE_CALLS_EVA=1 is set, the ML service is configured
 * and the person's plan includes edge.calls-eva (see store.ts); its calibrated probabilities are averaged
 * with these. Pure apart from reading the shipped model.
 */
import shipped from "./model.json";
import { argmax, calibrated, CLASSES, softmaxLogits, type Calibrator, type EvasionClass, type Softmax } from "./calibrate";

export type EvasionModel = Softmax & Calibrator & {
  version: string;
  set: { name: string; version: string; n: number; note: string };
  metrics: { macroF1: number; ece: number; n: number; accuracy: number; heldOut: string };
};

export const evasionModel = (): EvasionModel => shipped as unknown as EvasionModel;

export type Tag = "refused" | "deferred" | "different_question" | "no_number" | "prepared_remarks";
export const TAG_LABEL: Record<Tag, string> = {
  refused: "declined to answer",
  deferred: "deferred it (offline, a later date)",
  different_question: "answered a different question",
  no_number: "no number given when one was asked",
  prepared_remarks: "pointed back to prepared remarks",
};

const ASKS_NUMBER = /\b(how much|how many|what (?:is|was|are|were) (?:the|your)|what kind of|by how much|quantify|range|guidance|percent|percentage|basis points|bps|dollars?|number|figure|size|magnitude|run[- ]rate|margin|growth rate|what level|how big|ballpark|timeline|when (?:do|will|can|should) you)\b/i;
const NUMBER = /(?:\$\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:%|percent|bps|basis points|million|billion|thousand|x\b|times|mbo?e|bcf|barrels|units|days|weeks|months|quarters|years)|\b(?:19|20)\d{2}\b|\b\d+(?:\.\d+)?\b)/gi;
const REFUSAL = /\b(?:we (?:don['’]?t|do not|won['’]?t|will not|aren['’]?t going to|are not going to|can['’]?t|cannot) (?:provide|give|disclose|comment|guide|break (?:that|it) out|get into|share|speculate|talk about)|not (?:going|able) to (?:comment|get into|provide|share|speculate|disclose)|(?:decline|prefer not) to (?:comment|answer|speculate)|no comment|don['’]?t (?:guide|break out)|not something we (?:disclose|provide|comment on))\b/gi;
const DEFER = /\b(?:offline|follow up (?:with you )?(?:later|after the call|separately)|get back to you|take that (?:one )?offline|at (?:a later|the appropriate) (?:date|time)|(?:on|at) (?:the|our) next (?:call|quarter)|at (?:our|the) investor day|more (?:to say|details?|color) (?:later|in the coming|at)|stay tuned|in due course|when (?:we|the time) (?:are|is) (?:ready|right))\b/gi;
const PIVOT = /\b(?:as (?:i|we|[a-z]+) (?:said|mentioned|noted|discussed|outlined|highlighted)(?: earlier| before| in (?:my|our) (?:prepared )?remarks)?|in (?:my|our) prepared remarks|earlier (?:on )?(?:in )?the call|as (?:you|we) (?:saw|can see) in (?:the|our) (?:release|slides|deck))\b/gi;
const HEDGE = /\b(?:may|might|could|potentially|possibly|we['’]?ll see|too early|premature|it depends|hard to (?:say|predict|tell)|difficult to (?:say|predict)|uncertain|fluid|evolving|over time|at some point|we['’]?re evaluating|we continue to (?:evaluate|monitor|assess|look)|lots of moving parts)\b/gi;
const BOILER = /\b(?:(?:very )?(?:pleased|excited|confident|proud) (?:with|about|in)|long[- ]term (?:value|strategy|growth)|value creation|shareholder value|focused on (?:execution|our strategy|the long term)|disciplined|our strategy|world[- ]class|best[- ]in[- ]class|great team|strong position)\b/gi;
const DIRECT_START = /^(?:yes|no|yeah|sure|correct|exactly|that['’]?s right|so the (?:answer|number) is|to answer your question|the short answer|specifically|it['’]?s about|it was|we expect|we['’]?re (?:looking at|guiding to|seeing))\b/i;
const STOP = new Set("the a an and or of to in on for with at by from that this these those is are was were be been it its we our you your i they them their what how when where why which who do does did can could would should will just so as about into than then there here have has had not no yes if but also any some more most very really kind sort lot bit think know see look question thanks thank".split(" "));

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9$%. ]+/g, " ").split(/\s+/).filter(Boolean);
const stem = (w: string) => w.replace(/(?:ing|ed|es|s|ly)$/, "");
const contentSet = (s: string) => new Set(words(s).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d/.test(w)).map(stem));
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

export const FEATURES = ["asksNumber", "answerNumbers", "numberGiven", "refusal", "deferral", "pivot", "hedgeRate", "overlap", "logWords", "directStart", "boilerRate", "shortAnswer"] as const;

/** The pair's features, in FEATURES order. Pure. */
export function pairFeatures(question: string, answer: string): number[] {
  const qw = words(question), aw = words(answer);
  const n = Math.max(1, aw.length);
  const asks = ASKS_NUMBER.test(question) ? 1 : 0;
  const nums = count(NUMBER, answer);
  const q = contentSet(question), a = contentSet(answer);
  const inter = [...q].filter((w) => a.has(w)).length;
  const overlap = q.size ? inter / q.size : 0;
  return [
    asks, Math.log1p(nums), asks && nums > 0 ? 1 : 0, Math.min(2, count(REFUSAL, answer)), Math.min(2, count(DEFER, answer)), Math.min(2, count(PIVOT, answer)),
    (100 * count(HEDGE, answer)) / n, overlap, Math.log1p(aw.length), DIRECT_START.test(answer.trim()) ? 1 : 0, (100 * count(BOILER, answer)) / n, aw.length < 25 && qw.length > 15 ? 1 : 0,
  ];
}

/** The sub-tags rules see in a pair. Pure. */
export function tagsOf(question: string, answer: string): Tag[] {
  const f = pairFeatures(question, answer);
  const tags: Tag[] = [];
  if (f[3] > 0) tags.push("refused");
  if (f[4] > 0) tags.push("deferred");
  if (f[5] > 0) tags.push("prepared_remarks");
  if (f[0] && !f[2]) tags.push("no_number");
  if (f[7] < 0.12 && words(answer).length > 40 && words(question).length > 8) tags.push("different_question");
  return tags;
}

const sentences = (s: string) => s.replace(/\s+/g, " ").split(/(?<=[.!?]["')\]]?)\s+(?=[A-Z0-9"“(])/).map((x) => x.trim()).filter(Boolean);

/** The dodging phrase: the answer's sentence that refused, deferred or pivoted, else its most hedged sentence; verbatim. Pure. */
export function dodgeQuote(answer: string): string {
  const ss = sentences(answer);
  for (const re of [REFUSAL, DEFER, PIVOT]) { const hit = ss.find((s) => count(re, s) > 0); if (hit) return hit.slice(0, 300); }
  const hedged = ss.map((s) => ({ s, h: count(HEDGE, s) + count(BOILER, s) })).sort((a, b) => b.h - a.h)[0];
  return hedged && hedged.h > 0 ? hedged.s.slice(0, 300) : "";
}

export type Scored = { p: Record<EvasionClass, number>; cls: EvasionClass; tags: Tag[]; quote: string; reasons: string[]; engine: string };

/** Score one pair on the free path. Pure. */
export function classifyPair(question: string, answer: string, m: EvasionModel = evasionModel()): Scored {
  const x = pairFeatures(question, answer);
  const probs = calibrated(m, softmaxLogits(m, x));
  return finish(question, answer, probs, `classifier ${m.version}`);
}

/** Average calibrated probabilities of the free classifier and Eva-4B (the optional ensemble). Pure. */
export function ensemble(free: Scored, eva: number[] | null, question: string, answer: string): Scored {
  if (!eva || eva.length !== 3 || !eva.every(Number.isFinite)) return free;
  const avg = CLASSES.map((c, k) => (free.p[c] + eva[k]) / 2);
  return finish(question, answer, avg, `${free.engine} + Eva-4B (averaged)`);
}

function finish(question: string, answer: string, probs: number[], engine: string): Scored {
  const p = { direct: probs[0], intermediate: probs[1], evasive: probs[2] };
  const cls = CLASSES[argmax(probs)];
  const tags = tagsOf(question, answer);
  const quote = cls === "direct" ? "" : dodgeQuote(answer);
  const reasons = tags.map((t) => TAG_LABEL[t]);
  if (!reasons.length && cls === "direct") reasons.push(count(NUMBER, answer) ? "answered with specifics" : "addressed the question");
  if (!reasons.length) reasons.push("related information that sidesteps the core of the question");
  return { p, cls, tags, quote: quote && answer.includes(quote) ? quote : "", reasons, engine };
}

/** How the classifier's own record reads, honestly, for every call page. Pure. */
export function scorecardLine(m: EvasionModel = evasionModel()): string {
  return `Classifier ${m.version}: macro-F1 ${m.metrics.macroF1.toFixed(2)} and calibration error ${m.metrics.ece.toFixed(3)} on ${m.metrics.n} held-out pairs (${m.metrics.heldOut}). Labelled set: ${m.set.name} ${m.set.version}, ${m.set.n} pairs. ${m.set.note}`;
}

const TOPICS: [string, RegExp][] = [
  ["margins", /\bmargins?\b|\bgross profit\b/i], ["volumes and demand", /\bvolumes?\b|\bdemand\b|\borders?\b|\bbacklog\b|\bthroughput\b/i],
  ["capital spending", /\bcapex\b|\bcapital (?:spending|expenditures?|budget|program)\b/i], ["buybacks and dividends", /\bbuy ?backs?\b|\brepurchases?\b|\bdividends?\b|\breturn(?:ing)? (?:of )?capital\b/i],
  ["acquisitions", /\bm&a\b|\bacquisitions?\b|\bdeals?\b|\bmerger\b|\bdivest/i], ["leverage and the balance sheet", /\bleverage\b|\bbalance sheet\b|\bdebt\b|\brefinanc/i],
  ["pricing", /\bpric(?:e|es|ing)\b/i], ["guidance", /\bguidance\b|\boutlook\b|\bhigh end\b|\blow end\b/i], ["costs and tariffs", /\bcosts?\b|\btariffs?\b|\binflation\b|\bfreight\b/i],
  ["customers and churn", /\bchurn\b|\bretention\b|\brenewals?\b|\bcustomers?\b/i], ["regions", /\bchina\b|\beurope\b|\basia\b|\binternational\b/i], ["regulation and legal", /\bregulat|\blitigation\b|\bFERC\b|\bpermits?\b|\bantitrust\b/i],
];

/** The topic a question is about, for "What they avoided"; "other" when none of the common ones. Pure. */
export function topicOf(question: string): string {
  return TOPICS.find(([, re]) => re.test(question))?.[0] ?? "other";
}
