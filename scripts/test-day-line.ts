/** Home's day line (src/lib/desk/day-line.ts): pnpm exec tsx scripts/test-day-line.ts */
import { biggestMover, dayParts } from "@/lib/desk/day-line";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const now = Date.parse("2026-11-04T15:00:00Z");
const t = () => "2:00 PM";
ok("everything", dayParts({ waiting: 3, next: { title: "Acme diligence call", start: "2026-11-04T19:00:00Z" }, mover: { ticker: "NVDA", changePct: 0.041 } }, now, t), ["3 decisions waiting", "next: Acme diligence call at 2:00 PM", "NVDA up 4.1%"]);
ok("one decision, singular", dayParts({ waiting: 1, next: null, mover: null }, now, t), ["1 decision waiting"]);
ok("soon: minutes", dayParts({ waiting: 0, next: { title: "Standup", start: "2026-11-04T15:12:00Z" }, mover: null }, now, t), ["Standup in 12 min"]);
ok("under way: now", dayParts({ waiting: null, next: { title: "Board call", start: "2026-11-04T14:50:00Z" }, mover: null }, now, t), ["now: Board call"]);
ok("an untitled meeting", dayParts({ waiting: null, next: { title: "  ", start: "2026-11-04T19:00:00Z" }, mover: null }, now, t), ["next: a meeting at 2:00 PM"]);
ok("small moves are not news", dayParts({ waiting: null, next: null, mover: { ticker: "KO", changePct: -0.004 } }, now, t), []);
ok("a fall reads down", dayParts({ waiting: null, next: null, mover: { ticker: "XOM", changePct: -0.032 } }, now, t), ["XOM down 3.2%"]);
ok("nothing to say", dayParts({ waiting: 0, next: null, mover: null }, now, t), []);
ok("the biggest move either way", biggestMover([{ ticker: "A", changePct: 0.01 }, { ticker: "B", changePct: -0.05 }, { ticker: "C", changePct: null }, { ticker: "D", changePct: NaN }]), { ticker: "B", changePct: -0.05 });
ok("no prices, no mover", biggestMover([{ ticker: "A", changePct: undefined }]), null);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
