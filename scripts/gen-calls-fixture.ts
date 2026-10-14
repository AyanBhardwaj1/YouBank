/**
 * Call Desk's (E5) labelled Q&A fixture: scripts/fixtures/calls/qa-labels.jsonl. Until about 300 pairs from
 * transcripts companies filed on EDGAR are labelled (two passes: a model, then a person on disagreements;
 * docs/edge-next.md open question 5), this writes a TEMPLATE set: analyst questions on twelve common topics
 * with direct, intermediate and fully evasive answers composed from phrasings seen on calls, plus 6% label
 * noise between neighbouring classes so the classifier cannot simply memorise the templates. It is a labelled
 * starting point, said so everywhere its numbers appear, and is replaced pair by pair as real labels arrive.
 * No dataset from a licensed transcript vendor is used (EvasionBench's data stays out).
 *
 *   pnpm exec tsx scripts/gen-calls-fixture.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rng } from "@/lib/edge/scen/stats";

const R = rng(20261014);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(R() * xs.length)];

type Topic = { key: string; number: string[]; open: string[]; noun: string; direct: string[]; related: string[] };
const TOPICS: Topic[] = [
  { key: "margins", noun: "margins", number: ["Can you quantify how much gross margin expansion you expect in the second half?", "What's the margin target for next year, in basis points of improvement?", "How much did freight costs weigh on margins, in percentage points?"], open: ["How should we think about margins going forward?", "What are the moving parts on margins into next year?"], direct: ["we expect gross margin to expand about 150 basis points in the second half, to roughly 41%", "freight took about 80 basis points off gross margin, and we expect half of that back by the fourth quarter", "the margin target for next year is 38% to 39%, up from 36.5% this year"], related: ["margins benefited from mix and we continue to work on productivity", "there are puts and takes on margins, including mix, freight and pricing"] },
  { key: "volumes", noun: "volumes", number: ["What growth rate are you assuming for Permian volumes next year?", "How many barrels a day do you expect on the new pipeline by year-end?"], open: ["Can you talk about the volume outlook in the Permian?", "How are producer customers thinking about activity next year?"], direct: ["we're assuming Permian volumes grow 8% to 10% next year, about 250,000 barrels a day at the midpoint", "we expect about 400,000 barrels a day on the new line by December, and full rates by the second quarter"], related: ["producers remain active in the basin and we have good visibility on our dedicated acreage", "activity levels are healthy and the pipeline is filling as customers ramp"] },
  { key: "capex", noun: "capital spending", number: ["What's the capex range for 2027?", "How much growth capital is in the budget for next year?"], open: ["How are you thinking about the capital budget next year?", "Is there any flexibility in the capital program?"], direct: ["capex for 2027 is $1.2 billion to $1.4 billion, of which about $500 million is growth", "growth capital next year is about $650 million, down from $800 million this year"], related: ["we'll stay disciplined on capital and fund projects that meet our return thresholds", "the capital program is flexible and we'll calibrate it to customer demand"] },
  { key: "buyback", noun: "buybacks", number: ["How much of the buyback authorization do you expect to use this year?", "What's the dollar amount of repurchases planned for the fourth quarter?"], open: ["How do you prioritize buybacks against debt paydown?", "What's the philosophy on returning cash?"], direct: ["we expect to use about $2 billion of the $5 billion authorization this year, roughly $600 million in the fourth quarter", "repurchases in the fourth quarter should be about $400 million, similar to the third"], related: ["returning capital remains a priority, balanced with investment and the balance sheet", "we look at buybacks opportunistically alongside our other uses of cash"] },
  { key: "mna", noun: "acquisitions", number: ["How big an acquisition would you consider, in dollar terms?", "What leverage would you be willing to take on for a deal?"], open: ["Are you in discussions on any acquisitions?", "How do you think about M&A in the current environment?"], direct: ["we'd consider deals up to about $3 billion and would keep leverage under 3.5 times", "we would not go above 3.0 times leverage for a deal, and we'd fund the rest with cash on hand"], related: ["we look at a lot of opportunities and we're disciplined on price", "the pipeline of opportunities is active and we'll be selective"] },
  { key: "leverage", noun: "leverage", number: ["When do you expect to hit the 3.5 times leverage target?", "What's net leverage expected to be at year-end?"], open: ["How are you thinking about the balance sheet?", "Any update on deleveraging?"], direct: ["we expect to reach 3.5 times by the end of 2027, and to be at about 3.8 times at year-end", "net leverage should be about 2.9 times at year-end, down from 3.2 times today"], related: ["the balance sheet is in good shape and deleveraging remains a focus", "we're making progress on leverage and free cash flow supports it"] },
  { key: "pricing", noun: "pricing", number: ["How much pricing did you take in the quarter, in percentage terms?", "What price increase is assumed in the guidance?"], open: ["How is the pricing environment?", "Are customers pushing back on price?"], direct: ["pricing added about 4% in the quarter and the guidance assumes 2% to 3% for next year", "we took a 5% list price increase in July, and realized about 3.5% net"], related: ["the pricing environment remains constructive and customers see the value", "we continue to price for value and watch competitive dynamics"] },
  { key: "demand", noun: "order trends", number: ["What were orders up in October, year over year?", "How many weeks of backlog do you have today?"], open: ["Can you talk about what you're seeing in demand?", "How did order trends evolve through the quarter?"], direct: ["October orders were up about 7% year over year, and backlog is about 14 weeks", "backlog stands at roughly 12 weeks, up from 10 weeks a year ago"], related: ["demand is holding up and customers remain engaged", "order trends were steady and the pipeline is healthy"] },
  { key: "guidance", noun: "guidance", number: ["Why didn't you raise full-year revenue guidance given the beat, and what's the new range?", "What revenue range does the guidance imply for the fourth quarter?"], open: ["How conservative is the guidance?", "What would it take to get to the high end?"], direct: ["the full-year range is $4.2 billion to $4.4 billion; the beat was timing, so we kept the range and it implies about $1.1 billion in the fourth quarter", "the guidance implies fourth-quarter revenue of $1.05 billion to $1.10 billion"], related: ["we try to be prudent with guidance given the macro backdrop", "there are a number of factors that could move us within the range"] },
  { key: "tariffs", noun: "tariffs", number: ["What's the dollar impact of tariffs on cost of goods this year?", "How much of the tariff cost can you offset with pricing, as a percentage?"], open: ["How are you managing the tariff situation?", "What's the exposure to tariffs?"], direct: ["tariffs add about $120 million to cost of goods this year and we offset about 70% with pricing and sourcing", "we can offset roughly 60% of the tariff cost through price, and the rest by moving suppliers by mid-2027"], related: ["we're working closely with suppliers and customers on tariffs", "the situation is fluid and we have mitigation plans in place"] },
  { key: "retention", noun: "net revenue retention", number: ["What was net revenue retention in the quarter?", "How much did churn increase, in percentage points?"], open: ["How are customers behaving on renewals?", "Any change in churn?"], direct: ["net revenue retention was 112% in the quarter, down from 115%, and gross churn was about 6%", "churn rose about one point to 7%, concentrated in the smallest customers"], related: ["renewal behavior remains healthy and customers are expanding", "we're seeing some optimization in the smaller customers"] },
  { key: "china", noun: "China", number: ["How much of revenue comes from China?", "What share of the backlog is from Chinese customers?"], open: ["How exposed are you to China?", "What are you seeing in China?"], direct: ["China is about 12% of revenue and about 8% of backlog", "Chinese customers are roughly 10% of the backlog, down from 15% a year ago"], related: ["China remains an important market and we're monitoring it closely", "we have a balanced geographic footprint, including China"] },
];

const DIRECT_START = ["Sure.", "Yes.", "Yeah, so", "So the short answer is", "To answer your question,", "Good question.", "", "", "Thanks, Sam."];
const HEDGES = ["That could move around a bit.", "It may vary quarter to quarter.", "Obviously it depends on the macro.", "We'll see how the year plays out.", ""];
const REFUSE = ["We don't provide guidance on that.", "We're not going to comment on that.", "We don't break that out.", "We're not going to speculate on that.", "I'd prefer not to get into specifics there."];
const DEFER = ["Let's take that offline.", "We'll have more to say at our investor day.", "We'll update you on the next call.", "We'll follow up with you after the call.", "We'll share more details in due course."];
const PIVOT = ["As I mentioned in my prepared remarks, we had a strong quarter.", "As we said earlier on the call, we're pleased with the progress.", "As you saw in our release, the quarter was solid."];
const BOILER = ["What I'd say is we remain focused on our long-term strategy and creating shareholder value.", "We're very confident in the team and our strategy.", "We continue to execute well and we're excited about the opportunity ahead.", "We're disciplined and focused on execution."];
const OTHER_NUMBER = ["Revenue was up 6% in the quarter.", "We generated $300 million of free cash flow.", "Earnings per share were $1.12.", ""];

function directAnswer(t: Topic): string {
  const s = pick(DIRECT_START), body = pick(t.direct), h = R() < 0.3 ? pick(HEDGES) : "";
  return `${s} ${body.charAt(0).toUpperCase() + body.slice(1)}. ${h}`.replace(/\s+/g, " ").trim();
}
function intermediateAnswer(t: Topic): string {
  const parts = [pick(t.related).replace(/^./, (c) => c.toUpperCase()) + ".", R() < 0.5 ? `We're not going to give a precise figure on ${t.noun}, but directionally we expect it to improve over time.` : `Directionally, ${t.noun} should trend better, though it's early.`, R() < 0.5 ? pick(OTHER_NUMBER) : "", R() < 0.4 ? pick(HEDGES) : ""];
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
function evasiveAnswer(): string {
  const lead = pick([pick(REFUSE), pick(DEFER), pick(PIVOT), "It's too early to say.", "It's premature to talk about that."]);
  const rest = [R() < 0.7 ? pick(BOILER) : "", R() < 0.3 ? pick(DEFER) : "", R() < 0.15 ? pick(OTHER_NUMBER) : ""];
  return [lead, ...rest].join(" ").replace(/\s+/g, " ").trim();
}

const out: string[] = [];
const N = 360;
for (let i = 0; i < N; i++) {
  const t = pick(TOPICS);
  const q = R() < 0.65 ? pick(t.number) : pick(t.open);
  const u = R();
  let label = u < 0.45 ? 0 : u < 0.78 ? 1 : 2;
  const answer = label === 0 ? directAnswer(t) : label === 1 ? intermediateAnswer(t) : evasiveAnswer();
  // Label noise between neighbouring classes, as two human labellers disagree on borderline answers.
  if (R() < 0.06) label = label === 1 ? (R() < 0.5 ? 0 : 2) : 1;
  out.push(JSON.stringify({ id: `t${i + 1}`, topic: t.key, question: q, answer, label: ["direct", "intermediate", "evasive"][label], source: "template" }));
}
const dir = path.join(process.cwd(), "scripts/fixtures/calls");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "qa-labels.jsonl"), `${out.join("\n")}\n`);
console.log(`wrote ${out.length} template pairs to scripts/fixtures/calls/qa-labels.jsonl`);
