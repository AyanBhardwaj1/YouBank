/** Eval scoring (src/lib/ai/evals/score.ts): pnpm exec tsx scripts/test-evals.ts */
import { passes, stable, states, summarize, wilson } from "@/lib/ai/evals/score";
import { annualQuestions } from "@/lib/ai/evals/golden";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};

console.log("stating a figure");
const rev = { label: "FY2025 revenue", value: 391_035_000_000, unit: "usd" as const };
ok("$391.0 billion states it", states("Revenue was $391.0 billion in fiscal 2025.", rev), true);
ok("$391,035 million states it", states("Revenue: $391,035 million.", rev), true);
ok("$391 billion states it at its written precision", states("about $391 billion", rev), true);
ok("$390.0 billion does not", states("Revenue was $390.0 billion.", rev), false);
ok("$391.0 million (a scale slip) does not", states("Revenue was $391.0 million.", rev), false);
ok("a year is not a figure", states("In 2025 revenue grew.", { label: "y", value: 2025, unit: "count" }), false);
const margin = { label: "gross margin", value: 46.21, unit: "pct" as const };
ok("46.2% states 46.21%", states("Gross margin was 46.2%.", margin), true);
ok("a tolerance widens the match", states("Gross margin was 46%.", { ...margin, value: 46.4, tol: 0.01 }), true);

console.log("passing a question");
ok("every expected figure present: pass", passes("Revenue $391.0 billion; gross margin 46.2%.", { expected: [rev, margin] }), { pass: true, missing: [] });
ok("one missing: fail, and it is named", passes("Revenue $391.0 billion.", { expected: [rev, margin] }), { pass: false, missing: ["gross margin"] });
ok("no expected figures never passes", passes("anything", { expected: [] }).pass, false);

console.log("reliability");
const s = summarize([{ id: "a", runs: [true, true, true] }, { id: "b", runs: [true, false, true] }, { id: "c", runs: [false, false, false] }, { id: "d", runs: [true, true, true] }]);
ok("pass@1 counts first runs", s.pass1, 0.75);
ok("pass^3 needs every run", s.passK, 0.5);
ok("mean over runs", Math.round(s.mean * 1000) / 1000, 0.667);
const w = wilson(15, 20);
ok("Wilson interval", [Math.round(w.lo * 1000) / 1000, Math.round(w.hi * 1000) / 1000], [0.531, 0.888]);
ok("two runs 0.70 vs 0.66 on 200 are within noise", stable({ pass: 0.7, n: 200 }, { pass: 0.66, n: 200 }).ok, true);
ok("0.70 vs 0.55 on 200 are not", stable({ pass: 0.7, n: 200 }, { pass: 0.55, n: 200 }).ok, false);

console.log("machine slice from XBRL company facts");
const fy = (end: string, val: number, accn: string, start?: string, form = "10-K") => ({ end, start, val, accn, fy: Number(end.slice(0, 4)), fp: "FY", form, filed: `${end.slice(0, 4)}-11-01` });
const cf = { entityName: "Acme Corp", facts: { "us-gaap": {
  RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [
    fy("2025-09-27", 416_161_000_000, "A-25", "2024-09-29"), fy("2024-09-28", 391_035_000_000, "A-24", "2023-10-01"),
    fy("2024-09-28", 391_035_000_000, "A-25", "2023-10-01"), // last year's figure, repeated in this year's 10-K
    fy("2025-06-28", 94_036_000_000, "Q-25", "2025-03-30", "10-Q"),
  ] } },
  NetIncomeLoss: { units: { USD: [fy("2025-09-27", 112_010_000_000, "A-25", "2024-09-29")] } },
  Assets: { units: { USD: [fy("2025-09-27", 359_241_000_000, "A-25"), fy("2025-09-27", 1, "A-25", "2024-09-29")] } },
} } };
const qs = annualQuestions(cf, "ACME");
ok("one question per item found", qs.map((q) => q.id), ["xbrl:ACME:revenue:2025-09-27", "xbrl:ACME:net_income:2025-09-27", "xbrl:ACME:assets:2025-09-27"]);
ok("pinned to the latest 10-K by accession", qs.every((q) => q.provenance.startsWith("xbrl:A-25:")), true);
ok("the latest year's revenue, not a quarter", qs[0].expected[0].value, 416_161_000_000);
ok("a balance is an instant, not a duration", qs[2].expected[0].value, 359_241_000_000);
ok("the question names the period and accession", /fiscal year ended 2025-09-27 \(Form 10-K, accession A-25\)/.test(qs[0].question), true);
ok("no facts, no questions", annualQuestions({}, "X").length, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
