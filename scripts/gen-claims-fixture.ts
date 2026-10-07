/**
 * Builds Calibrated Claims' calibration fixture (scripts/fixtures/claims.jsonl): 468 labelled claims, each
 * with the passages it cites as Edge's answers present them (header line, text, whether the quote was
 * found, the passage's rank). Deterministic: `pnpm exec tsx scripts/gen-claims-fixture.ts` rewrites the
 * same file.
 *
 * This is the template set (v1), not the set the spec asks for in the end. The spec's set is 300-400
 * claims from real Edge answers over the evaluation filings, labelled by a second model and spot-checked by
 * a person (docs/edge-next.md, E2, and open question 5 on who labels). That needs the live answerer and a
 * person's time, neither available when this was built. It is larger than the spec's 300-400 so that
 * Strict's 5% line can be set with 95% confidence on half of it. So v1 is generated from templates that reproduce
 * the failure modes the verifier exists for, in proportions chosen to resemble answers after the quote
 * check: right numbers, numbers changed in the retelling, wrong period, wrong company, arithmetic done
 * right and wrong, unrelated passages, quotes found only on a second reading, and overreach no feature can
 * see (labelled unsupported though every check passes) so the measured rates are not flattered. Every
 * company and figure is invented. Replace it with the real set when it exists; the verifier prints which
 * set it was calibrated on.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { rng } from "../src/lib/edge/scen/stats";

type Cite = { text: string; header: string; quote: "exact" | "near" | "failed"; rank: number };
type Row = { id: string; claim: string; analysis: boolean; scope: { name: string; ticker: string }[]; cites: Cite[]; supported: 0 | 1; reason: string };

const COMPANIES = [
  { name: "Halcyon Midstream LP", ticker: "HLMS" }, { name: "Pecos Gathering Inc.", ticker: "PCGI" }, { name: "Blue Mesa Energy Corp", ticker: "BMEC" },
  { name: "Northgate Software Inc.", ticker: "NGSW" }, { name: "Corvid Therapeutics Inc.", ticker: "CRVD" }, { name: "Lantern Utilities Co", ticker: "LNTU" },
  { name: "Ridgeback Resources Inc.", ticker: "RDGB" }, { name: "Tamarack Pipeline Partners", ticker: "TMPP" },
];
const METRICS = [
  { what: "revenue", unit: "$", base: [400, 4000] }, { what: "adjusted EBITDA", unit: "$", base: [80, 900] }, { what: "capital expenditures", unit: "$", base: [50, 600] },
  { what: "net income", unit: "$", base: [20, 400] }, { what: "free cash flow", unit: "$", base: [30, 500] },
];
const VOLS = [{ what: "gathered volumes", unit: "MMcf/d", base: [500, 3000] }, { what: "processed volumes", unit: "MMcf/d", base: [300, 2500] }, { what: "employees", unit: "", base: [800, 9000] }];
const QUAL = [
  ["expects to complete the Orla expansion in the second half of the year", "Management expects to complete the Orla expansion in the second half of the year."],
  ["named a new chief financial officer", "The Board appointed a new Chief Financial Officer effective upon the filing of this report."],
  ["entered into an amended credit agreement", "We entered into an amended and restated credit agreement with a syndicate of lenders."],
  ["faces litigation over a pipeline right of way", "We are a defendant in litigation concerning a pipeline right of way in Reeves County."],
  ["has its largest customer under a contract that expires next year", "Our largest customer's gathering agreement expires at the end of next year."],
  ["began a strategic review of its water business", "The Board has initiated a review of strategic alternatives for our water business."],
];
const QUARTER = ["first", "second", "third", "fourth"];
const MONTH_END = ["March 31", "June 30", "September 30", "December 31"];

const u = rng(20261005);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(u() * xs.length)];
const between = (a: number, b: number) => a + u() * (b - a);
const money = (mm: number) => (mm >= 1000 ? `$${(mm / 1000).toFixed(1)} billion` : `$${Math.round(mm)} million`);
const moneyExact = (mm: number) => `$${Math.round(mm).toLocaleString("en-US")} million`;

function context() {
  const co = pick(COMPANIES), other = pick(COMPANIES.filter((c) => c !== co));
  const year = 2022 + Math.floor(u() * 4), q = Math.floor(u() * 4);
  const quarterly = u() < 0.6;
  const header = `${co.name} (${co.ticker}) · ${quarterly ? "10-Q" : "10-K"} · ${quarterly ? `quarter ended ${MONTH_END[q]}, ${year}` : `year ended December 31, ${year}`} · Management's discussion`;
  const period = quarterly ? `the ${QUARTER[q]} quarter of ${year}` : year.toString();
  return { co, other, year, q, quarterly, header, period, scope: [co, other] };
}

let n = 0;
const rows: Row[] = [];
const add = (r: Omit<Row, "id">) => rows.push({ id: `v1-${String(++n).padStart(3, "0")}`, ...r });
const rank = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));

// Overreach (unsupported, invisible to every check) is set at about 2.5% of claims: an assumption, close to
// the 3% the spec expects Strict to measure, until the real labelled set shows the true share.
const kinds: [string, number][] = [
  ["number", 120], ["qualitative", 60], ["growth", 40], ["near", 36], ["agree", 28], ["analysis", 16],
  ["wrong-number", 40], ["wrong-period", 30], ["wrong-company", 24], ["wrong-growth", 20], ["unrelated", 30], ["overreach", 12], ["mangled-but-true", 12],
];
for (const [kind, count] of kinds) {
  for (let i = 0; i < count; i++) {
    const c = context();
    const m = pick([...METRICS, ...VOLS]);
    const cur = between(m.base[0], m.base[1]), prev = cur / between(0.82, 1.25);
    const fmt = (v: number) => (m.unit === "$" ? money(v) : `${Math.round(v).toLocaleString("en-US")}${m.unit ? ` ${m.unit}` : ""}`);
    const fmtExact = (v: number) => (m.unit === "$" ? moneyExact(v) : `${Math.round(v).toLocaleString("en-US")}${m.unit ? ` ${m.unit}` : ""}`);
    const passage = `${m.what[0].toUpperCase()}${m.what.slice(1)} for ${c.period} was ${fmtExact(cur)}, compared with ${fmtExact(prev)} in the prior-year period.`;
    const cite = (quote: Cite["quote"], r = rank(1, 4), text = passage, header = c.header): Cite => ({ text, header, quote, rank: r });
    const growth = ((cur - prev) / prev) * 100;
    const dir = growth >= 0 ? "rose" : "fell";
    switch (kind) {
      case "number": add({ claim: `${c.co.name}'s ${m.what} was ${fmt(cur)} in ${c.period}.`, analysis: false, scope: c.scope, cites: [cite("exact")], supported: 1, reason: "states the passage's figure" }); break;
      case "qualitative": { const [claim, text] = pick(QUAL); add({ claim: `${c.co.name} ${claim}.`, analysis: false, scope: c.scope, cites: [cite("exact", rank(1, 5), text)], supported: 1, reason: "restates the passage" }); break; }
      case "growth": add({ claim: `${c.co.name}'s ${m.what} ${dir} ${Math.abs(growth).toFixed(0)}% from the prior-year period.`, analysis: false, scope: c.scope, cites: [cite("exact")], supported: 1, reason: "growth worked out correctly from the passage" }); break;
      case "near": add({ claim: `${m.what[0].toUpperCase()}${m.what.slice(1)} at ${c.co.name} reached ${fmt(cur)} in ${c.period}.`, analysis: false, scope: c.scope, cites: [cite("near", rank(2, 8))], supported: 1, reason: "supported; quote found on the second reading" }); break;
      case "agree": add({ claim: `${c.co.name} reported ${m.what} of ${fmt(cur)} for ${c.period}.`, analysis: false, scope: c.scope, cites: [cite("exact"), cite("exact", rank(2, 6), `As reported, ${m.what} totalled ${fmtExact(cur)} for ${c.period}.`)], supported: 1, reason: "two passages agree" }); break;
      case "analysis": { const ok = u() < 0.6; add({ claim: ok ? `The rise in ${m.what} suggests demand held up through ${c.period}.` : `${c.co.name} will keep growing ${m.what} at this pace next year.`, analysis: true, scope: c.scope, cites: [cite(u() < 0.5 ? "exact" : "failed")], supported: ok ? 1 : 0, reason: ok ? "a fair inference from the passage" : "a forecast the passage does not make" }); break; }
      case "wrong-number": { const bad = cur * pick([0.8, 0.85, 1.15, 1.25, 1.4]); add({ claim: `${c.co.name}'s ${m.what} was ${fmt(bad)} in ${c.period}.`, analysis: false, scope: c.scope, cites: [cite("exact")], supported: 0, reason: "the figure was changed in the retelling" }); break; }
      case "wrong-period": { const wrong = c.quarterly ? `the ${QUARTER[(c.q + 1) % 4]} quarter of ${c.year + 1}` : String(c.year + 1); add({ claim: `${c.co.name}'s ${m.what} was ${fmt(cur)} in ${wrong}.`, analysis: false, scope: c.scope, cites: [cite("exact")], supported: 0, reason: "the passage is about a different period" }); break; }
      case "wrong-company": add({ claim: `${c.other.name}'s ${m.what} was ${fmt(cur)} in ${c.period}.`, analysis: false, scope: c.scope, cites: [cite("exact")], supported: 0, reason: "the passage is about a different company" }); break;
      case "wrong-growth": { const g = Math.abs(growth) + pick([4, 6, 9, -5]) ; add({ claim: `${c.co.name}'s ${m.what} ${dir} ${Math.max(1, g).toFixed(0)}% from the prior-year period.`, analysis: false, scope: c.scope, cites: [cite("exact")], supported: 0, reason: "the growth rate is miscomputed" }); break; }
      case "unrelated": { const [, text] = pick(QUAL); add({ claim: `${c.co.name}'s ${m.what} was ${fmt(cur * between(0.7, 1.3))} in ${c.period}.`, analysis: false, scope: c.scope, cites: [cite("failed", rank(3, 12), text)], supported: 0, reason: "the cited passage does not discuss this" }); break; }
      case "overreach": { const [claim, text] = pick(QUAL); add({ claim: `${c.co.name} ${claim}, its most important decision in a decade.`, analysis: false, scope: c.scope, cites: [cite("exact", rank(1, 4), text)], supported: 0, reason: "adds a judgement the passage does not make (no check can see it)" }); break; }
      case "mangled-but-true": add({ claim: `${c.co.name} reported ${m.what} of ${fmt(cur)} for ${c.period}.`, analysis: false, scope: c.scope, cites: [cite("failed", rank(1, 5))], supported: 1, reason: "true, though the writer's quote did not match the passage word for word" }); break;
    }
  }
}
// Shuffle, then mark the held-out half (every other row after the shuffle).
for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(u() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
const out = rows.map((r, i) => JSON.stringify({ ...r, split: i % 2 === 0 ? "fit" : "held", set: "template", version: "v1" })).join("\n") + "\n";
writeFileSync(path.join(__dirname, "fixtures", "claims.jsonl"), out);
console.log(`${rows.length} claims written (${rows.filter((r) => r.supported).length} supported)`);
