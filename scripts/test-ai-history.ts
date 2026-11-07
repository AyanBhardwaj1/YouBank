/** Kept AI conversations (src/lib/client/ai-history.ts): pnpm exec tsx scripts/test-ai-history.ts */
import { keepable, parseStored } from "@/lib/client/ai-history";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const q = (c: string) => ({ role: "user", content: c }), a = (c: string, x: object = {}) => ({ role: "assistant", content: c, ...x });
ok("finished messages only", keepable([q("one"), a("ans"), q("two"), a("", { streaming: true })]).map((m) => m.content), ["one", "ans", "two"]);
ok("failed answers are not kept", keepable([q("one"), a("partial", { error: "cut off" })]).map((m) => m.content), ["one"]);
const long = Array.from({ length: 20 }, (_, i) => (i % 2 ? a(`a${i}`) : q(`q${i}`)));
ok("the last 12, starting with a question", [keepable(long).length, keepable(long)[0].role], [12, "user"]);
ok("sources ride along", keepable([q("x"), a("y", { sources: [{ id: "S1", label: "10-K", url: "https://sec.gov" }] })])[1].sources?.[0].id, "S1");
const now = Date.parse("2026-11-04T12:00:00Z");
ok("a week-old conversation is gone", parseStored(JSON.stringify({ at: now - 8 * 86400_000, messages: [q("x")] }), now), []);
ok("a recent one comes back", parseStored(JSON.stringify({ at: now - 3600_000, messages: [q("x"), a("y")] }), now).length, 2);
ok("junk is nothing", [parseStored("{", now), parseStored("null", now), parseStored(JSON.stringify({ at: now, messages: [{ role: "system", content: "x" }] }), now)], [[], [], []]);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
