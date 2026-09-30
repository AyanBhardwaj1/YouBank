/**
 * Checks for the launch-readiness limits: AI spend gating and cost estimates. No network, no database.
 *   pnpm exec tsx scripts/test-launch.ts
 */
import { modelAllowed } from "@/lib/ai/config";
import { blockedAt, fitMessages } from "@/lib/ai/limits";
import { costOf } from "@/lib/ai/pricing";
import { follow, followedCount, pollDelay, touch } from "@/lib/realtime/feed";
import { memo } from "@/lib/memo";
import { describeFailure, looksInternal, OUR_SIDE, publicMessage, TOO_SLOW } from "@/lib/errors";
import { pool, poolSize } from "@/lib/pool";
import { checkEnv } from "@/lib/env";
import { pollBackoff } from "@/components/news/client";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};

async function main() {
  console.log("AI spend limits");
  const base = { disabled: false, everyone: 10, mine: 1, pending: 0, globalCap: 200, userCap: 5 };
  check("under both caps runs", blockedAt(base) === null);
  check("the off switch stops everything", /paused/.test(blockedAt({ ...base, disabled: true }) ?? ""));
  check("a person at their cap stops", /today's AI limit/.test(blockedAt({ ...base, mine: 5 }) ?? ""));
  check("a run's pending cost counts toward the person's cap", /today's AI limit/.test(blockedAt({ ...base, mine: 4, pending: 1.2 }) ?? ""));
  check("everyone at the global cap stops", /come back at midnight/.test(blockedAt({ ...base, everyone: 200 }) ?? ""));
  check("background work (no person) ignores personal caps", blockedAt({ ...base, mine: null, everyone: 50 }) === null);
  check("background work still stops at the global cap", blockedAt({ ...base, mine: null, everyone: 199.5, pending: 1 }) !== null);
  check("a zero cap blocks", blockedAt({ ...base, userCap: 0, mine: 0 }) !== null);

  console.log("cost estimates");
  const u = { input: 1_000_000, cached: 0, cacheWrite: 0, output: 1_000_000, reasoning: 0 };
  check("a listed model uses its list price", costOf("gpt-6-astra", u) === 60, costOf("gpt-6-astra", u));
  check("an unlisted catalogue model is estimated, not free", (costOf("gpt-5.5-pro", u) ?? 0) >= 60, costOf("gpt-5.5-pro", u));
  check("an unlisted cheap model gets a cheap estimate", (costOf("gpt-4.1-mini", u) ?? 0) > 0 && (costOf("gpt-4.1-mini", u) ?? 99) <= 10, costOf("gpt-4.1-mini", u));
  check("a model outside the catalogue stays uncosted", costOf("text-embedding-3-small", u) === null);

  console.log("chat input");
  type M = { role: "user" | "assistant"; content: string };
  const msg = (role: M["role"], n: number, c = "x"): M => ({ role, content: c.repeat(n) });
  const small: M[] = [msg("user", 10), msg("assistant", 10), msg("user", 10)];
  check("a short conversation is unchanged", JSON.stringify(fitMessages(small)) === JSON.stringify(small));
  const long = fitMessages([msg("user", 50), msg("assistant", 30_000), msg("user", 10)], 20_000, 100_000);
  check("an old long message is capped", long[1].content.length < 20_100 && long[1].content.endsWith("[…cut for length]"), long[1].content.length);
  const many = fitMessages(Array.from({ length: 12 }, (_, i) => msg(i % 2 ? "assistant" : "user", 15_000, String(i % 10))).concat([msg("user", 5)]), 20_000, 100_000);
  const total = many.reduce((n, m) => n + m.content.length, 0);
  check("the history fits the total", total <= 100_000, total);
  check("the newest message is kept", many[many.length - 1].content === "xxxxx");
  check("the history starts with a person's message", many[0].role === "user", many.map((m) => m.role));
  check("an empty history stays empty", fitMessages([]).length === 0);

  console.log("allowed models");
  const was = process.env.AI_ALLOWED_MODELS;
  delete process.env.AI_ALLOWED_MODELS;
  check("no list allows every model", modelAllowed("gpt-5.5-pro"));
  process.env.AI_ALLOWED_MODELS = "gpt-5.6-terra, gpt-5.6-luna";
  check("a listed model is allowed", modelAllowed("gpt-5.6-luna"));
  check("an unlisted model is not", !modelAllowed("gpt-5.5-pro"));
  if (was === undefined) delete process.env.AI_ALLOWED_MODELS; else process.env.AI_ALLOWED_MODELS = was;

  console.log("live-update streams");
  check("fast right after activity", pollDelay(0, false) === 1_000 && pollDelay(14_000, false) === 1_000);
  check("easing off while quiet", pollDelay(30_000, false) === 2_500);
  check("slowest after a quiet minute", pollDelay(120_000, false) === 5_000 && pollDelay(3_600_000, false) === 5_000);
  check("STREAM_MODE=slow stretches the pace five times", pollDelay(0, true) === 5_000 && pollDelay(120_000, true) === 25_000);

  const log: { id: number }[] = [{ id: 1 }, { id: 2 }, { id: 3 }];
  let polls = 0;
  const load = async (since: number) => { polls++; return { events: log.filter((e) => e.id > since) }; };
  const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const got: Record<string, number[]> = { a: [], b: [] };
  const stopA = follow("test:1", 0, load, ({ events }) => { got.a.push(...events.map((e) => e.id)); });
  await nap(30);
  check("a follower receives the log from its cursor", got.a.join() === "1,2,3", got.a);
  const stopB = follow("test:1", 2, load, ({ events }) => { got.b.push(...events.map((e) => e.id)); });
  await nap(30);
  check("a newcomer is served at once from its own cursor", got.b.join() === "3", got.b);
  check("two followers of one log share a poll", followedCount() === 1 && polls === 2, { polls, followed: followedCount() });
  log.push({ id: 4 });
  touch("test:1");
  await nap(30);
  check("a write wakes the followers, each sees it once", got.a.join() === "1,2,3,4" && got.b.join() === "3,4", got);
  stopA(); stopB();
  await nap(30);
  check("the poll stops when nobody follows", followedCount() === 0);

  console.log("shared reads and polling");
  let loads = 0;
  const slow = () => new Promise<number>((r) => setTimeout(() => r(++loads), 20));
  const [x, y] = await Promise.all([memo("t:1", 50, slow), memo("t:1", 50, slow)]);
  check("callers asking at once share one load", loads === 1 && x === 1 && y === 1, { loads, x, y });
  check("a fresh value is reused", (await memo("t:1", 50, slow)) === 1 && loads === 1);
  await nap(60);
  check("an expired value is loaded again", (await memo("t:1", 50, slow)) === 2);
  let failures = 0;
  await memo("t:2", 1_000, async () => { failures++; throw new Error("down"); }).catch(() => undefined);
  await memo("t:2", 1_000, async () => { failures++; return 1; });
  check("a failure is not kept", failures === 2);
  check("polling keeps its pace while healthy", pollBackoff(60_000, 0) === 60_000);
  check("failures double the wait", pollBackoff(60_000, 1) === 120_000 && pollBackoff(60_000, 2) === 240_000);
  check("the wait tops out at ten minutes", pollBackoff(60_000, 20) === 600_000);
  check("a slow poll never waits less than its own pace", pollBackoff(900_000, 3) === 900_000);

  console.log("error messages");
  const quiet = console.error;
  console.error = () => undefined;
  const drizzle = Object.assign(new Error('Failed query: select "id" from "profiles" where "email" = $1\nparams: someone@example.com'), { name: "DrizzleQueryError" });
  check("a database error is withheld", looksInternal(drizzle.message, drizzle.name) && publicMessage(drizzle).startsWith(OUR_SIDE));
  const f = describeFailure(drizzle, 400);
  check("…as a 500 with a reference in the message", f.status === 500 && !!f.ref && f.message.includes(f.ref!) && !f.message.includes("someone@"), f);
  check("a URL is withheld", looksInternal("EDGAR 403 for https://data.sec.gov/submissions/CIK0000320193.json"));
  check("a secret's name is withheld", looksInternal("set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env.local"));
  check("a network failure is withheld", looksInternal("fetch failed") && looksInternal("connect ECONNREFUSED 10.0.0.1:5432"));
  check("a plain message for people passes", publicMessage(new Error("This draft was already sent")) === "This draft was already sent");
  check("a mail sign-in hint passes", !looksInternal("IMAP sign-in was refused. Use an app password, not your normal password, and check the address. For Gmail: 2-Step Verification must be on, then create one at myaccount.google.com/apppasswords."));
  const forbidden = Object.assign(new Error("That model is private to the person who made it"), { status: 403 });
  const g = describeFailure(forbidden);
  check("a 4xx keeps its status and message, unlogged", g.status === 403 && g.message === forbidden.message && !g.ref, g);
  const h = describeFailure(new Error("No mailbox is connected"), 400);
  check("a message for people takes the route's usual status", h.status === 400 && h.message === "No mailbox is connected", h);
  const late = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  check("a timeout reads as one", describeFailure(late).status === 504 && publicMessage(late) === TOO_SLOW);
  console.error = quiet;

  console.log("cache");
  process.env.YOUBANK_NO_DISK_CACHE = "1";
  const { cacheJson } = await import("@/lib/cache");
  let upstream = 0;
  const fetchQuote = () => new Promise<number>((r) => setTimeout(() => r(++upstream), 20));
  const [q1, q2, q3] = await Promise.all([cacheJson("t:quote", 60_000, fetchQuote), cacheJson("t:quote", 60_000, fetchQuote), cacheJson("t:quote", 60_000, fetchQuote)]);
  check("concurrent misses share one upstream call", upstream === 1 && q1 === 1 && q2 === 1 && q3 === 1, { upstream });
  let tries = 0;
  const down = async () => { tries++; throw new Error("upstream down"); };
  await cacheJson("t:down", 60_000, down).catch(() => undefined);
  await cacheJson("t:down", 60_000, down).catch(() => undefined);
  check("a failure is remembered briefly instead of retried per request", tries === 1, { tries });

  console.log("background passes");
  let running = 0, peak = 0;
  const done = await pool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => { running++; peak = Math.max(peak, running); await nap(10); running--; return n * 2; });
  check("a pool keeps at most its size in flight", peak === 3, { peak });
  check("results keep their order", done.join() === "2,4,6,8,10,12,14,16,18,20", done);
  const cut = await pool([1, 2, 3, 4, 5, 6], 2, async (n) => { await nap(25); return n; }, Date.now() + 40);
  check("no new work starts after the deadline", cut.length > 0 && cut.length < 6, cut);
  check("pool sizes from the environment are bounded", poolSize("50", 6) === 20 && poolSize("abc", 6) === 6 && poolSize("0", 6) === 6 && poolSize("3", 6) === 3);

  console.log("environment check");
  const good = { DATABASE_URL: "postgres://x", NEON_AUTH_BASE_URL: "https://auth", NEON_AUTH_COOKIE_SECRET: "x".repeat(32), CRON_SECRET: "c", AUTOPILOT_SECRET: "a", EDGAR_USER_AGENT: "YouBank ops@example.com", EMAIL_TOKEN_SECRET: "e".repeat(16), OPENAI_API_KEY: "k" };
  const ok = checkEnv(good, true);
  check("a complete production environment passes", ok.missing.length === 0 && ok.invalid.length === 0, ok);
  const bad = checkEnv({ ...good, NEON_AUTH_COOKIE_SECRET: "short", CRON_SECRET: "", OPENAI_API_KEY: "", CHAT_BUDGET_MS: "fast", YOUBANK_DEV_USER: "me" }, true);
  check("missing and malformed values are named", bad.missing.includes("CRON_SECRET") && bad.missing.some((m) => m.includes("OPENAI_API_KEY")) && bad.invalid.some((i) => i.startsWith("NEON_AUTH_COOKIE_SECRET")) && bad.invalid.some((i) => i.startsWith("CHAT_BUDGET_MS")) && bad.invalid.some((i) => i.startsWith("YOUBANK_DEV_USER")), bad);
  check("production-only values are not required in development", checkEnv({ ...good, CRON_SECRET: "" }, false).missing.length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
