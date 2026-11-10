/** B3-0 label-volume rules: pnpm exec tsx scripts/test-label-volume.ts */
import { labelOf, labelsNeeded, strata, verdict, type LabelEvent } from "@/lib/crm/label-volume";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};

console.log("labels");
ok("unchanged is good", labelOf({ outcome: "unchanged", editRatio: null }), "good");
ok("a light edit (5%) is good", labelOf({ outcome: "edited", editRatio: 0.05 }), "good");
ok("a heavier edit is bad", labelOf({ outcome: "edited", editRatio: 0.06 }), "bad");
ok("rewritten is bad", labelOf({ outcome: "rewritten", editRatio: 0.9 }), "bad");
ok("a discard is not a label", labelOf({ outcome: "discarded", editRatio: null }), null);

console.log("labels needed (exact binomial; matches sleep-research/runs/certification-n.txt)");
ok("alpha 10%, delta 5%: 29 / 61 / 116", [labelsNeeded(0), labelsNeeded(0.03), labelsNeeded(0.05)], [29, 61, 116]);
ok("alpha = delta = 5%: 59 / 361 / never", [labelsNeeded(0, 0.05, 0.05), labelsNeeded(0.03, 0.05, 0.05), labelsNeeded(0.05, 0.05, 0.05)], [59, 361, null]);
ok("at or above alpha never certifies", labelsNeeded(0.1), null);

console.log("strata and verdict");
const now = new Date("2026-11-02T00:00:00Z");
const day = (d: number) => new Date(now.getTime() - d * 86_400_000);
const events: LabelEvent[] = [];
// Five people sending 10 clean "external reply" drafts a week for 8 weeks: 80 labels, 0 bad: certified already.
for (let u = 0; u < 5; u++) for (let i = 0; i < 80; i++) events.push({ userId: `p${u}`, bucket: "external:reply", outcome: "unchanged", editRatio: null, at: day(i * 0.7) });
// One person with 4 labels in 8 weeks, a quarter bad: never (bad rate above alpha).
for (let i = 0; i < 4; i++) events.push({ userId: "slow", bucket: "campaign", outcome: i === 0 ? "rewritten" : "unchanged", editRatio: null, at: day(i * 10) });
// Discards and old events do not count.
events.push({ userId: "p0", bucket: "external:reply", outcome: "discarded", editRatio: null, at: day(1) });
events.push({ userId: "old", bucket: "x", outcome: "unchanged", editRatio: null, at: day(200) });
const s = strata(events, now, 8);
ok("old events are outside the window", s.some((r) => r.userId === "old"), false);
const p0 = s.find((r) => r.userId === "p0")!;
ok("discards counted apart, not as labels", [p0.good, p0.bad, p0.discarded], [80, 0, 1]);
ok("enough labels already: 0 days", p0.daysToCertify, 0);
ok("a bad rate above alpha never certifies", s.find((r) => r.userId === "slow")!.needed, null);
const v = verdict(s);
ok("five people reachable, median reachable: go", [v.go, v.peopleReachable, v.medianReachable], [true, 5, true]);
ok("four people is not enough", verdict(s.filter((r) => r.userId !== "p4")).go, false);
ok("nothing reviewed is a no-go", verdict([]).go, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
