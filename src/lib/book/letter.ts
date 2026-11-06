/**
 * The LP letter, drafted from what YouBank already knows: the book's theses and how they stand, what closed
 * and why, the track record, how well calibrated the conviction was, the book's risk, and how AI was used
 * and supervised. It is a draft for the PM to rewrite in their own voice, never a finished letter.
 *
 * A compliance pass then reads whatever the PM writes. It is rule-based, so it gives the same answer every
 * time. It flags what the SEC's Marketing Rule and its exam staff look for:
 * - promissory or guaranteeing language and unsupported superlatives;
 * - performance without a time period, and gross without net;
 * - hypothetical or back-tested results;
 * - "AI-washing": claims about AI the firm cannot back with a record (the research ledger).
 * It is a first read, not legal advice. Pure; tested in scripts/test-book.ts.
 */
import type { BookSummary, Evaluation } from "./position";
import { closedReturn, CLOSE_REASONS, scorecardLine, type ClosedPosition, type Scorecard } from "./journal";
import { calibrationLine, type Calibration } from "./forecast";

export type LetterInput = {
  firm: string; period: string; now: Date;
  evals: Evaluation[]; summary: BookSummary;
  closed: ClosedPosition[]; record: Scorecard; calibration: Calibration | null;
  risk: { betaNet: number | null; var95: number | null; worst: { label: string; pnl: number } | null } | null;
  ai: { outputs: number; reviewedShare: number | null; verifiedShare: number | null; ledgerOn: boolean } | null;
  /** The PM's own decision-journal notes from the period (not YouBank's automatic entries), newest first. */
  notes?: { ticker: string; at: string; text: string; /** The changes saved with the note. */ with?: string }[];
};

const pct = (x: number, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}%`;

export function draftLetter(i: LetterInput): string {
  const s = i.summary;
  const broken = i.evals.filter((e) => e.verdict === "broken"), watch = i.evals.filter((e) => e.verdict === "watch");
  const recent = i.closed.filter((c) => Date.parse(c.closedAt) >= i.now.getTime() - 92 * 86_400_000);
  const lines: string[] = [
    `Dear partners,`,
    ``,
    `[Open in your own words: the quarter in two sentences, and what you are proud of or not.]`,
    ``,
    `## The book (${i.period})`,
    `We hold ${s.positions} position${s.positions === 1 ? "" : "s"}: ${s.long}% of NAV long and ${s.short}% short, ${s.net}% net. Every position carries a written thesis and the numbers that would prove it wrong, which we check against each company's filings after every close.`,
  ];
  if (broken.length || watch.length) {
    lines.push(``, `## Where our theses are under pressure`);
    for (const e of [...broken, ...watch].slice(0, 6)) lines.push(`- **${e.ticker}** (${e.direction}${e.weight !== null ? `, ${e.weight}% of NAV` : ""}): ${e.verdict === "broken" ? "a kill criterion has failed" : "close to a kill criterion"}. ${e.summary} [What we are doing about it.]`);
  } else lines.push(``, `Every thesis in the book holds against its kill criteria as of this letter.`);
  if (recent.length) {
    lines.push(``, `## What we closed, and why`);
    for (const c of recent.slice(0, 8)) {
      const r = closedReturn(c);
      lines.push(`- **${c.ticker}** (${c.direction}, held ${c.openedAt.slice(0, 10)} to ${c.closedAt.slice(0, 10)}): ${CLOSE_REASONS[c.reason].toLowerCase()}${c.note ? `: ${c.note}` : ""}${r !== null ? ` (${pct(r * 100)} on the position, before costs)` : ""}.`);
    }
  }
  const notes = (i.notes ?? []).filter((n) => Date.parse(n.at) >= i.now.getTime() - 92 * 86_400_000).slice(0, 6);
  if (notes.length) {
    lines.push(``, `## Decisions, in our words at the time`);
    for (const n of notes) lines.push(`- **${n.ticker}**, ${n.at.slice(0, 10)}${n.with ? ` (${n.with})` : ""}: "${n.text}"`);
    lines.push(`[Pick the ones that show how we think; each is from the position's dated decision journal.]`);
  }
  lines.push(``, `## Our process, measured`);
  lines.push(i.record.closed ? `Track record since we began keeping it: ${scorecardLine(i.record)} These are unweighted price moves on individual positions, before fees and costs, not fund performance.` : `We began keeping a track record of every closed position this quarter; it will appear here as positions close.`);
  const pr = i.record.process;
  if (pr) {
    const sound = pr.earned.length + pr.unlucky.length, all = sound + pr.lucky.length + pr.deserved.length;
    if (all) lines.push(`We judge decisions as well as results: ${sound} of the ${all} closed positions with a measurable return followed our process (none was still held more than five days after its thesis broke)${pr.lucky.length ? `, and ${pr.lucky.length} gain${pr.lucky.length === 1 ? "" : "s"} came after holding past a break, which we count as luck rather than skill` : ""}.`);
  }
  if (i.calibration && (i.calibration.n || i.calibration.open)) lines.push(`Calibration of our conviction: ${calibrationLine(i.calibration)}`);
  const aiCal = i.calibration?.bySource.find((x) => x.source === "AI committee"), pmCal = i.calibration?.bySource.find((x) => x.source === "You");
  if (aiCal && pmCal) lines.push(`We also score the AI committee that reviews our positions, the same way: its Brier score is ${aiCal.brier.toFixed(3)} on ${aiCal.n} resolved forecast${aiCal.n === 1 ? "" : "s"}, against ${pmCal.brier.toFixed(3)} on ${pmCal.n} for our own (lower is better). [What we take from the comparison.]`);
  if (i.risk && i.risk.betaNet !== null) lines.push(``, `## Risk`, `Beta-adjusted net exposure is ${i.risk.betaNet.toFixed(1)}% of NAV; the historical one-day 95% value at risk is ${i.risk.var95?.toFixed(2)}% of NAV.${i.risk.worst ? ` Replayed through the ${i.risk.worst.label}, today's book would have moved ${pct(i.risk.worst.pnl, 2)} of NAV.` : ""} These are estimates from past prices, not forecasts.`);
  if (i.ai && i.ai.ledgerOn && i.ai.outputs) {
    lines.push(``, `## How we use AI`, `AI helps us research; people decide. In the last 30 days our research tools produced ${i.ai.outputs} AI outputs, every one kept in a tamper-evident record${i.ai.verifiedShare !== null ? `; ${i.ai.verifiedShare}% of the figures they cited matched their sources` : ""}${i.ai.reviewedShare !== null ? `, and ${i.ai.reviewedShare}% were reviewed by a person` : ""}. No AI tool can trade or change our positions.`);
  }
  lines.push(``, `[Close: what you are watching next quarter.]`, ``, `${i.firm || "[Firm]"}`, ``, `---`, `*Past performance is not indicative of future results. Position-level figures are illustrative of our process and are not fund performance; fund returns, net of fees and expenses, are reported separately by our administrator.*`);
  return lines.join("\n");
}

/* ---------------- The compliance pass ---------------- */

export type LetterFinding = { rule: string; severity: "high" | "medium" | "info"; excerpt: string; why: string };

const sentences = (t: string) => t.replace(/\r/g, "").split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const PERIOD = /\b(since|year|years|quarter|quarterly|month|ytd|annuali[sz]ed|q[1-4]|20\d\d|19\d\d|inception|1-year|5-year|10-year|trailing)\b/i;

/** A company figure YouBank holds (from a kill-criterion check), for checking a figure written about it. */
/** The facts to check from the Book's evaluations: each percent kill-criterion figure YouBank holds. */
export function factsFrom(evals: Evaluation[]): FilingFact[] {
  const M: Partial<Record<string, FilingFact["metric"]>> = { revenue_growth: "revenue growth", gross_margin: "gross margin", operating_margin: "operating margin", fcf_margin: "free cash flow margin" };
  return evals.flatMap((e) => e.checks.flatMap((c) => {
    const metric = M[c.criterion.metric];
    const v = Number(/(-?\d+(?:\.\d+)?)/.exec(c.shown.replace("−", "-"))?.[1]);
    return metric && c.evidence && Number.isFinite(v) ? [{ ticker: e.ticker, name: e.name, metric, value: v, shown: c.shown, source: `${c.evidence.source}, ${c.evidence.period}` }] : [];
  }));
}

export type FilingFact = { ticker: string; name: string; metric: "revenue growth" | "gross margin" | "operating margin" | "free cash flow margin"; value: number; shown: string; source: string };

const METRIC_WORDS: Record<FilingFact["metric"], string> = {
  "revenue growth": "(?:revenue|sales|top[- ]line)\\s+(?:growth|grew|growing|rose|increased)|grew\\s+(?:revenue|sales)",
  "gross margin": "gross\\s+margins?",
  "operating margin": "operating\\s+margins?|operating\\s+profit\\s+margin",
  "free cash flow margin": "(?:free\\s+cash\\s+flow|fcf)\\s+margins?",
};
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Figures written about a held company, checked against the filing. In each clause: the companies named (a
 * ticker as written, case-sensitive, or the company's distinctive first word as a capitalised name), and each
 * metric phrase with the percent that belongs to it (the one after it, up to the next metric or company, the
 * "to" figure in "from X to Y", signed by "down" or "negative"). The percent is checked against the company
 * named nearest the metric, within half a point. A clause about a quarter or another period is skipped: the
 * filing figures are LTM. Ranges ("66-68%") are skipped.
 */
export function checkFigures(text: string, facts: FilingFact[]): { excerpt: string; fact: FilingFact; said: number }[] {
  const out: { excerpt: string; fact: FilingFact; said: number }[] = [];
  const firms = [...new Map(facts.map((f) => [f.ticker, f])).values()].map((f) => {
    const first = (f.name.split(/\s+/)[0] ?? "").replace(/[^\p{L}\p{N}&'-]/gu, "");
    const named = first.length >= 4 && /^\p{Lu}/u.test(first) && !/^(the|first|general|american|united|international|national|global|western|eastern|southern|northern|target|advanced|applied|digital|first|best)$/i.test(first);
    return { ticker: f.ticker, re: new RegExp(`(?<![A-Za-z$])\\$?${esc(f.ticker)}(?![A-Za-z])${named ? `|\\b${esc(first)}\\b` : ""}`, "g") };
  });
  const METRICS = Object.entries(METRIC_WORDS).map(([metric, kw]) => ({ metric: metric as FilingFact["metric"], re: new RegExp(kw, "gi") }));
  const OTHER_PERIOD = /\b(q[1-4]|quarter(?:ly)?|month(?:ly)?|half[- ]year|h[12]|first half|second half|week(?:ly)?|year[- ]to[- ]date|ytd)\b/i;
  for (const s of sentences(text)) {
    for (const cl of s.split(/;\s*|,\s+(?=(?:and|while|but|whereas)\b)/)) {
      if (OTHER_PERIOD.test(cl)) continue;
      const mentions = firms.flatMap((f) => [...cl.matchAll(f.re)].map((m) => ({ ticker: f.ticker, at: m.index ?? 0 })));
      if (!mentions.length) continue;
      const hits = METRICS.flatMap((x) => [...cl.matchAll(x.re)].map((m) => ({ metric: x.metric, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))).sort((a, b) => a.start - b.start);
      for (const [k, h] of hits.entries()) {
        const nextMention = mentions.filter((m) => m.at > h.end).map((m) => m.at);
        const stop = Math.min(hits[k + 1]?.start ?? cl.length, ...nextMention, h.end + 60);
        const win = cl.slice(h.end, stop).replace(/−/g, "-");
        // A range is not one figure; "from X to Y" means Y.
        if (/\d\s?[-–]\s?\d+(?:\.\d+)?\s?%/.test(win)) continue;
        const m = /\bto\s+(-?\d+(?:\.\d+)?)\s?%/.exec(win) ?? /(-?\d+(?:\.\d+)?)\s?%/.exec(win);
        let said: number;
        if (m) {
          said = Number(m[1]);
          if (said > 0 && /\b(down|negative|minus|declin\w*|fell|fall\w*|shrank|shrink\w*|contract\w*)\b/i.test(win.slice(0, m.index))) said = -said;
        } else {
          // "30% revenue growth": the percent just before the phrase.
          const before = /(-?\d+(?:\.\d+)?)\s?%\s+(?:\w+\s+){0,2}$/.exec(cl.slice(Math.max(0, h.start - 30), h.start).replace(/−/g, "-"));
          if (!before) continue;
          said = Number(before[1]);
        }
        // The company named nearest the metric (one named before it wins a tie).
        const who = [...mentions].sort((a, b) => Math.abs(a.at - h.start) - Math.abs(b.at - h.start) || a.at - b.at)[0];
        const f = facts.find((x) => x.ticker === who.ticker && x.metric === h.metric);
        if (f && Number.isFinite(said) && Math.abs(said - f.value) > 0.5 && !out.some((o) => o.excerpt === s && o.fact === f)) out.push({ excerpt: s, fact: f, said });
      }
    }
  }
  return out;
}

/** What the record says, for checking a claim about AI against it: shares in percent, over the period. */
export type AiRecord = { reviewedShare: number | null; verifiedShare: number | null; outputs: number };

export function lintLetter(text: string, ctx: { ledgerOn: boolean; record?: AiRecord | null; facts?: FilingFact[] }): LetterFinding[] {
  const out: LetterFinding[] = [];
  const add = (rule: string, severity: LetterFinding["severity"], excerpt: string, why: string) => {
    if (!out.some((f) => f.rule === rule && f.excerpt === excerpt.slice(0, 200) && f.why === why)) out.push({ rule, severity, excerpt: excerpt.slice(0, 200), why });
  };
  // The draft's own bracketed prompts and disclaimer are not claims.
  const body = text.replace(/\n---\n\*Past performance is not indicative[\s\S]*?\*\s*$/, "");
  for (const s of sentences(body)) {
    if (/^\[.*\]$/.test(s)) continue;
    if (/\b(guarantee[ds]?|risk[- ]free|can(?:no|')t lose|no downside|sure thing|certain to|will (?:double|triple|outperform))\b/i.test(s)) add("Promissory or guaranteeing language", "high", s, "The Marketing Rule bars statements implying a guaranteed or riskless result.");
    if (/\b(best|top[- ]performing|number one|#1|unmatched|unrivall?ed|world[- ]class)\b/i.test(s)) add("Unsupported superlative", "medium", s, "A superlative needs evidence you can produce on request; otherwise it may be misleading.");
    const perf = /(\b(return(?:ed|s)?|performance|gain(?:ed|s)?|up|outperform(?:ed)?|beat)\b[^.]*[-+]?\d+(\.\d+)?\s?%)|([-+]?\d+(\.\d+)?\s?%[^.]*\b(return(?:ed|s)?|performance|gain(?:ed|s)?)\b)/i.test(s);
    if (perf && !PERIOD.test(s)) add("Performance without a time period", "medium", s, "Performance should state the period it covers (and fund performance the 1, 5 and 10-year periods).");
    if (/\bgross\b/i.test(s) && /\b(return|performance)\b/i.test(s) && !/\bnet\b/i.test(body)) add("Gross performance without net", "high", s, "Gross performance must be shown with net performance, with equal prominence.");
    if (/\b(hypothetical|back-?test(?:ed|ing)?|would have (?:returned|made|gained|earned)|simulated|model portfolio)\b/i.test(s)) add("Hypothetical performance", "medium", s, "Hypothetical or back-tested results need policies, the right audience and full disclosure of their assumptions.");
    // A claim about how AI is supervised, checked against the record (the SEC's exam staff compare the two).
    const rec = ctx.record;
    // Clause by clause, so "91% of figures matched, and 12% were reviewed" pairs each figure with its claim.
    if (rec && ctx.ledgerOn && /\b(ai|models?|machine|automated|algorithms?)\b/i.test(s)) for (const cl of s.split(/[,;:(]\s*|\s+and\s+(?=\d)/)) {
      // A claim about AI's output: the clause names the AI or its output, and the number is not a change ("40% more").
      if (!/\b(ai|models?|automated|algorithms?|outputs?|answers?|figures?)\b/i.test(cl) || /\d\s?%\s+(more|less|fewer|higher|lower|faster|slower)\b/i.test(cl)) continue;
      // "Our AI tool reviewed…" has AI doing the reviewing, not being reviewed.
      if (/\b(ai|models?|tools?|algorithms?)\b[^,;]*\b(reviewed|checked|verified)\s+(?!by)\w/i.test(cl) && !/\b(?:outputs?|answers?|figures?)\b[^,;]*\b(?:were|was|are|is)\b/i.test(cl)) continue;
      const all = /\b(?:all|every|each)\s+(?:(?:of\s+)?(?:our|the|its|their)\s+)?(?:ai|model|machine|automated|output|answer|figure|number|research)/i.test(cl) || /\b100\s?%/.test(cl);
      const said = Number(/(\d{1,3}(?:\.\d+)?)\s?%/.exec(cl)?.[1] ?? NaN);
      const check = (word: RegExp, share: number | null, what: string) => {
        // Only a claim of "all" or of a number is checkable; a passing mention is not a claim.
        if (!word.test(cl) || (!all && !Number.isFinite(said))) return;
        if (share === null) { add("AI claim the record cannot show", "high", s, `The research ledger has no record of ${what} for this period, so this cannot be backed.`); return; }
        if (all && share < 100) add("AI claim contradicts the record", "high", s, `The ledger shows ${share}% of ${what}, not all. Say what the record shows.`);
        else if (Number.isFinite(said) && Math.abs(said - share) > 2) add("AI claim contradicts the record", "high", s, `The ledger shows ${share}% of ${what} for this period, not ${said}%.`);
      };
      check(/\b(reviewed|review|approved|signed off|human[- ]in[- ]the[- ]loop|overseen)\b/i, rec.reviewedShare, "AI outputs reviewed by a person");
      check(/\b(verified|checked against|matched (?:their|its) sources?|accurate)\b/i, rec.verifiedShare, "AI figures verified against their source");
    }
    if (/\b(ai[- ](?:driven|powered|based|first)|artificial intelligence|machine learning|our (?:proprietary )?algorithm|deep learning|neural)\b/i.test(s)) {
      if (!ctx.ledgerOn) add("AI claim without a record", "high", s, "\"AI-washing\" is an SEC enforcement priority: claims about AI must be true and supportable. Turn on the research ledger to keep a record of how AI is used.");
      else add("AI claim: keep the record on file", "info", s, "The research ledger supports this: keep this period's governance report with the letter's file.");
    }
  }
  for (const x of checkFigures(body, ctx.facts ?? [])) add("Figure does not match the filing", "high", x.excerpt, `${x.fact.ticker}'s ${x.fact.metric} is ${x.fact.shown} (${x.fact.source}), not ${x.said}%. A wrong figure in investor communications is a Marketing Rule problem.`);
  return out;
}
