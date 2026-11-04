/** Cost preview before a run (src/lib/ai/cost-preview.ts): pnpm exec tsx scripts/test-cost-preview.ts */
import { costLine, typicalCost } from "@/lib/ai/cost-preview";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
ok("median of positive costs", typicalCost([0.4, 0.2, 0, 0.3, 9, 0.5, 0.1]), 0.35);
ok("too little history: nothing", typicalCost([0.4, 0.2]), null);
ok("NaN and negatives ignored", typicalCost([NaN, -1, 0.2, 0.2, 0.2, 0.2, 0.2]), 0.2);
const e = { typicalUsd: 0.4, runs: 50, monthlyUsd: 10, monthUsd: 2, leftUsd: 0 };
ok("share of the allowance, plenty left", costLine(e, "A deep run"), "A deep run usually uses about 4% of your monthly AI allowance.");
ok("few left: says how many", costLine({ ...e, monthUsd: 8 }, "A deep run"), "A deep run usually uses about 4% of your monthly AI allowance; about 5 more fit in what is left.");
ok("credits count toward what is left", costLine({ ...e, monthUsd: 10, leftUsd: 1 }, "A deep run"), "A deep run usually uses about 4% of your monthly AI allowance; about 2 more fit in what is left.");
ok("nothing left", costLine({ ...e, monthUsd: 10 }, "A deep run"), "A deep run usually uses about 4% of your monthly AI allowance, and less than that is left.");
ok("tiny runs", costLine({ ...e, typicalUsd: 0.02 }), "A run like this usually uses under 1% of your monthly AI allowance.");
ok("no allowance: dollars", costLine({ ...e, monthlyUsd: null }), "A run like this usually costs about $0.40 in AI.");
ok("no history: nothing", costLine({ ...e, typicalUsd: null }), null);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
