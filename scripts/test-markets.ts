/** Exchange hours (src/lib/desk/markets.ts) and Quick calc's engine: pnpm exec tsx scripts/test-markets.ts */
import { EXCHANGES, localMinuteOfWeek, marketStatus, until } from "@/lib/desk/markets";
import { evaluateScript } from "@/lib/calc";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const ex = (id: string) => EXCHANGES.find((e) => e.id === id)!;
const at = (iso: string) => new Date(iso);
const st = (id: string, iso: string) => { const s = marketStatus(ex(id), at(iso)); return [s.state, s.nextIs, s.next?.toISOString() ?? null]; };

console.log("local time");
ok("Wednesday 10:00 in New York (EST, after the clocks changed)", localMinuteOfWeek("America/New_York", at("2026-11-04T15:00:00Z")), 2 * 1440 + 600);
ok("Thursday 00:00 in Tokyo at the same instant", localMinuteOfWeek("Asia/Tokyo", at("2026-11-04T15:00:00Z")), 3 * 1440);

console.log("sessions");
ok("New York mid-morning: open, closes 16:00 ET", st("nyse", "2026-11-04T15:00:00Z"), ["open", "closes", "2026-11-04T21:00:00.000Z"]);
ok("London mid-afternoon: open, closes 16:30", st("lse", "2026-11-04T15:00:00Z"), ["open", "closes", "2026-11-04T16:30:00.000Z"]);
ok("Tokyo at midnight: closed, opens 9:00 JST", st("tse", "2026-11-04T15:00:00Z"), ["closed", "opens", "2026-11-05T00:00:00.000Z"]);
ok("Hong Kong at 12:30: lunch, back at 13:00", st("hkex", "2026-11-04T04:30:00Z"), ["lunch", "opens", "2026-11-04T05:00:00.000Z"]);
ok("Saturday: closed until Monday's open", st("nyse", "2026-11-07T12:00:00Z"), ["closed", "opens", "2026-11-09T14:30:00.000Z"]);
ok("Friday after the close: Monday's open", st("nyse", "2026-11-06T22:00:00Z"), ["closed", "opens", "2026-11-09T14:30:00.000Z"]);
ok("the opening minute counts as open", st("nyse", "2026-11-04T14:30:00Z")[0], "open");
ok("the closing minute counts as closed", st("nyse", "2026-11-04T21:00:00Z")[0], "closed");
ok("Mumbai opens at 9:15 IST", st("nse", "2026-11-04T03:00:00Z"), ["closed", "opens", "2026-11-04T03:45:00.000Z"]);
ok("crypto never closes", marketStatus(ex("crypto"), at("2026-11-07T12:00:00Z")), { state: "open", next: null, nextIs: null });
ok("seconds do not push the next change off the minute", marketStatus(ex("nyse"), at("2026-11-04T15:00:42Z")).next?.toISOString(), "2026-11-04T21:00:00.000Z");
ok("every exchange answers at any instant", EXCHANGES.every((e) => ["open", "lunch", "closed"].includes(marketStatus(e, new Date()).state)), true);

console.log("countdowns");
ok("minutes", until(at("2026-11-04T15:12:00Z"), at("2026-11-04T15:00:00Z")), "12m");
ok("hours", until(at("2026-11-04T17:05:00Z"), at("2026-11-04T15:00:00Z")), "2h 05m");
ok("days", until(at("2026-11-09T14:30:00Z"), at("2026-11-06T22:00:00Z")), "2d 16h");

console.log("quick calc");
ok("suffixes and variables", evaluateScript("ev = 5.4b + 1.2b - 0.8b\nev / 380m").results.map((r) => Math.round(r.value * 100) / 100), [5.8e9, 15.26]);
ok("percent", evaluateScript("200 * 15%").results[0].value, 30);
const bad = (src: string) => { try { evaluateScript(src); return "ran"; } catch (e) { return (e as Error).message; } };
ok("object built-ins are not variables", [bad("constructor"), bad("__proto__ + 1"), bad("toString")], ["Unknown variable constructor", "Unknown variable __proto__", "Unknown variable toString"]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
