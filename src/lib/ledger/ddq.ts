/**
 * The AI section of a due-diligence questionnaire, answered from the record rather than from memory. LPs and
 * their consultants now ask managers how AI is used, which models and vendors, who reviews the output, how
 * accuracy is checked, what is recorded and how outside AI apps are controlled (AIMA is adding AI to its
 * illustrative DDQ, and the SEC's exam staff look for AI claims a firm cannot back). Every answer here is
 * built from the research ledger, the AI-app keys and the track record; what only the firm can say (its
 * written policy, who is accountable, its data terms) is left as a bracketed prompt to fill in.
 *
 * The wording avoids the phrases the letter's compliance pass flags as AI marketing, so the same pass can
 * read the edited answers. Pure; tested in scripts/test-ledger.ts. The page is src/app/report/ddq.
 */
import type { Calibration } from "../book/forecast";
import type { Governance } from "./governance";

export type DdqApp = { name: string; paused: boolean; book: boolean; propose: boolean; lastUsedAt: string | null };
export type DdqInput = {
  firm: string; period: string; now: Date;
  g: Governance | null;
  ledger: { on: boolean; since: string | null; chainOk: boolean | null; checked: number | null; anchors: number; anchorsMatch: number };
  apps: DdqApp[];
  calibration: Calibration | null;
  /** Positions whose last AI committee sitting is on record. */
  committees: number;
  /** The decision journal: positions held, how many carry the PM's own notes, and how many notes in all. */
  journal?: { positions: number; withNotes: number; notes: number };
  /** Closed positions' returns by the committee's last call before the close (scorecard byCommittee). */
  committeeCalls?: { decision: "add" | "hold" | "trim" | "exit"; n: number; avgReturn: number | null }[];
};
export type DdqItem = { id: string; topic: string; q: string; a: string };

const pct = (x: number | null) => (x === null ? null : `${x % 1 ? x.toFixed(1) : x}%`);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const day = (iso: string) => iso.slice(0, 10);
/** Names once each, with a count where several keys share one ("Claude (2 keys)"). */
const names = (apps: DdqApp[]) => { const m = new Map<string, number>(); for (const a of apps) m.set(a.name, (m.get(a.name) ?? 0) + 1); return [...m].map(([n, k]) => (k > 1 ? `${n} (${k} keys)` : n)); };

export function draftDdq(i: DdqInput): DdqItem[] {
  const g = i.g, on = i.ledger.on;
  const live = i.apps.filter((a) => !a.paused);
  const proposing = live.filter((a) => a.book && a.propose);
  const noRecord = "[The research ledger is off, so YouBank has no record to answer from: describe this yourself, or turn the ledger on and answer from next period.]";
  const items: DdqItem[] = [];

  items.push({
    id: "use", topic: "Use of AI", q: "Where does the firm use AI in its investment process, and who makes investment decisions?",
    a: [
      "AI tools support research: they read SEC filings, XBRL financial data, news and comparable companies, draft and check written theses, argue the case against a position (a red team) and, on request, convene an AI investment committee whose recommendation is advice only.",
      g && on && g.ai ? `In ${i.period.toLowerCase()} they produced ${g.ai} recorded outputs, by use: ${list((g.inventory ?? []).map((u) => `${u.use.charAt(0).toLowerCase()}${u.use.slice(1)} (${u.n})`))}.` : "",
      "Investment decisions are made by [names and roles]. No AI tool can place a trade or change the book of positions.",
      proposing.length ? `${list(names(proposing))} may propose a position; a person reviews each proposal and adds or dismisses it.` : "No connected AI app may propose positions.",
    ].filter(Boolean).join(" "),
  });

  items.push({
    id: "models", topic: "Models and vendors", q: "Which AI models and third-party AI applications does the firm use?",
    a: [
      g && on && g.byModel.length ? `Models named in the record this period: ${list(g.byModel.map((m) => `${m.model} (${m.n})`))}.` : on ? "No model was named in the record this period." : noRecord,
      i.apps.length ? `AI applications connected to YouBank over MCP, each with its own key: ${list(names(i.apps))}.` : "No outside AI application is connected.",
      "[Name the vendors' data-use terms: whether prompts are retained or used for training, and where data is processed.]",
    ].join(" "),
  });

  items.push({
    id: "review", topic: "Human oversight", q: "How is AI output reviewed by a person before it is relied on?",
    a: !on || !g ? noRecord : [
      `Reviews are recorded in the research ledger, entry by entry. In ${i.period.toLowerCase()}: ${g.reviews.approved} approved, ${g.reviews.rejected} rejected and ${g.reviews.noted} noted${g.reviewedShare !== null ? `, covering ${pct(g.reviewedShare)} of AI outputs` : ""}.`,
      g.rejected.length ? `Each rejection keeps the reviewer's reason; the latest: "${g.rejected[0].note || "no reason given"}".` : "",
      "[Say which outputs must be reviewed before use (for example anything sent to investors), and by whom.]",
    ].filter(Boolean).join(" "),
  });

  items.push({
    id: "accuracy", topic: "Accuracy", q: "How does the firm check the accuracy of AI output and guard against fabricated figures?",
    a: [
      "YouBank's AI answers cite their sources, and each figure in an answer is checked automatically against the source it cites; figures that do not match or have no source are marked in the answer.",
      on ? "" : "The results of those checks are kept only while the research ledger is on, and it is off.",
      g && on && g.figures.answers ? `In ${i.period.toLowerCase()}, ${g.figures.verified} of ${g.figures.checkable} checkable figures across ${g.figures.answers} answers matched their source or were computed from cited figures (${pct(g.figures.verifiedShare)}); ${g.figures.noMatch} did not match and ${g.figures.uncited} had no source.` : "",
      g && on && g.ai ? `${pct(g.sourcedShare) ?? "n/a"} of AI outputs cited at least one source.` : "",
      "Position theses are checked against reported XBRL figures each day, not against AI summaries.",
    ].filter(Boolean).join(" "),
  });

  const c = i.calibration;
  const ai = c?.bySource.find((s) => s.source === "AI committee"), pm = c?.bySource.find((s) => s.source === "You");
  items.push({
    id: "measure", topic: "Measuring AI's contribution", q: "How does the firm measure whether AI improves its decisions?",
    a: [
      "Forecasts are recorded before the outcome is known and scored when they resolve: the probability that a position's kill criteria hold to a date, scored with the Brier score.",
      ai && pm ? `To date the AI committee's Brier score is ${ai.brier.toFixed(3)} on ${ai.n} resolved forecast${ai.n === 1 ? "" : "s"} and the portfolio managers' is ${pm.brier.toFixed(3)} on ${pm.n} (lower is better).` : c && c.n ? `${c.n} forecast${c.n === 1 ? " has" : "s have"} resolved so far${c.brier !== null ? `, with a Brier score of ${c.brier.toFixed(3)}` : ""}.` : "No forecast has resolved yet; the record starts with the first one.",
      i.committees ? `${i.committees} position${i.committees === 1 ? " has" : "s have"} an AI committee recommendation on record.` : "",
      i.committeeCalls?.length ? `Closed positions by the committee's last call before the close: ${list(i.committeeCalls.map((c) => `${c.decision} ${c.n}${c.avgReturn !== null ? ` (average ${c.avgReturn >= 0 ? "+" : "−"}${Math.abs(c.avgReturn * 100).toFixed(1)}%)` : ""}`))}. These are position price moves before costs, not fund performance.` : "",
    ].filter(Boolean).join(" "),
  });

  items.push({
    id: "records", topic: "Recordkeeping", q: "What records does the firm keep of AI use, and can they be altered?",
    a: !on ? noRecord : [
      `Every AI output is recorded in the research ledger with its prompt, model, sources and figure check${i.ledger.since ? `, continuously since ${day(i.ledger.since)}` : ""}.`,
      "Each entry's SHA-256 hash covers its content and the hash before it, so any edit, deletion or reordering breaks the chain.",
      i.ledger.chainOk === null ? "" : i.ledger.chainOk ? `The chain was recomputed on ${day(i.now.toISOString())} and all ${i.ledger.checked ?? 0} entries check.` : "[The chain did not check when this was drafted: resolve this before sending.]",
      !i.ledger.anchors ? "No copy of the chain's head is kept outside YouBank yet."
        : i.ledger.anchorsMatch === i.ledger.anchors ? `Its head is also kept outside YouBank, and ${i.ledger.anchors === 1 ? "that copy matches" : `all ${i.ledger.anchors} copies match`}, which catches a rewrite of the whole chain.`
        : `[${i.ledger.anchors - i.ledger.anchorsMatch} of the ${i.ledger.anchors} copies of the chain's head kept outside YouBank did not match when this was drafted: find out why before sending.]`,
      g && g.pauses.length ? `Recording was switched off or on ${g.pauses.length} time${g.pauses.length === 1 ? "" : "s"} this period, and each switch is itself recorded.` : "",
      "The ledger is tamper-evident; it is not WORM storage. [Say where the firm's books-and-records copies are kept.]",
    ].filter(Boolean).join(" "),
  });

  items.push({
    id: "access", topic: "Controls on AI applications", q: "What can outside AI applications access, and how is that controlled?",
    a: !i.apps.length ? "No outside AI application is connected." : [
      `Each application has its own revocable key with its own permissions${on ? ", and every call it makes is recorded in the research ledger" : "; calls are recorded only while the research ledger is on, and it is off"}.`,
      ...i.apps.map((a) => `${a.name}: ${a.paused ? "paused" : "active"}; ${a.book ? `may read the book${a.propose ? " and propose positions for review" : ", may not propose"}` : "public research tools only, no access to the book"}${a.lastUsedAt ? `; last used ${day(a.lastUsedAt)}` : "; not used yet"}.`),
      g && on && g.byApp.length ? `This period: ${g.byApp.reduce((s, a) => s + a.n, 0)} calls${g.errors ? `, ${g.errors} ending in an error` : ""}${g.proposals ? `, ${g.proposals} proposal${g.proposals === 1 ? "" : "s"}` : ""}.` : "",
    ].filter(Boolean).join(" "),
  });

  const jr = i.journal;
  items.push({
    id: "decisions", topic: "Documenting decisions", q: "How are investment decisions, and the reasons for them, documented?",
    a: [
      "Every position carries written kill criteria and a dated decision journal. YouBank writes an entry itself whenever the weight, the forecast, the kill criteria, the thesis or the side changes, and the portfolio manager adds the reason. The journal is written by the server, so it cannot be backfilled, and it is kept through the close.",
      jr && jr.positions ? `Today ${jr.withNotes} of ${jr.positions} positions carry the manager's own notes (${jr.notes} in all).` : "",
      "[Say who reviews the journal, and how often.]",
    ].filter(Boolean).join(" "),
  });

  items.push({
    id: "data", topic: "Confidential information", q: "How does the firm prevent confidential or material non-public information from reaching AI tools?",
    a: "YouBank's research tools read public sources: SEC filings, XBRL data, market prices and news. [State the firm's policy on entering investor data, confidential or material non-public information into AI tools, and how staff are trained on it.]",
  });

  items.push({
    id: "policy", topic: "Governance", q: "Does the firm have a written AI policy, and who is accountable for it?",
    a: `[Name the policy, when it was adopted and last reviewed, and the person accountable.] ${on ? "An AI governance report for any month can be produced from the research ledger: output by model and app, review rates, rejections, the figure check and the chain's integrity. [Say who reviews it, and how often.]" : "Turning on the research ledger would give the policy a record to be tested against."}`,
  });
  return items;
}


export function ddqMarkdown(items: DdqItem[], firm: string, period: string, now: Date): string {
  return [
    `# ${firm || "[Firm]"}: AI due-diligence answers`,
    `Prepared ${day(now.toISOString())} from the research ledger (${period.toLowerCase()}). Bracketed text is for the firm to complete.`,
    ...items.flatMap((x, n) => ["", `## ${n + 1}. ${x.topic}`, `**Q.** ${x.q}`, "", x.a]),
  ].join("\n");
}
