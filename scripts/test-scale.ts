/**
 * Checks for the work that keeps YouBank fast and correct under many people at once (docs/scale.md):
 * single-flight caches, process-wide singletons, keyset cursors, the per-owner algo batches and the AI
 * spend totals. Pure checks always run. With DATABASE_URL pointing at a LOCAL database that has the
 * schema (never a remote one), the concurrency checks run against Postgres too: atomic AI spend under 100
 * parallel calls, seats given at once never exceeding the subscription, rate counters and leases.
 *   pnpm exec tsx scripts/test-scale.ts
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/yb_scale pnpm exec tsx scripts/test-scale.ts
 */
import { randomUUID } from "node:crypto";
import { shared, sharedMap } from "@/lib/shared";
import { forgetMemo, memo } from "@/lib/memo";
import { cacheJson, cacheSet } from "@/lib/cache";
import { decodeCursor, encodeCursor, pageOf } from "@/lib/cursor";
import { EVERYONE, totalsOf, utcDay } from "@/lib/ai/spend";
import { byOwner } from "@/lib/algo/functions";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function testShared() {
  console.log("process-wide singletons");
  let made = 0;
  const a = shared("test:one", () => ({ n: ++made }));
  const b = shared("test:one", () => ({ n: ++made }));
  check("a key is made once and shared", a === b && made === 1);
  const m1 = sharedMap<string, number>("test:map"), m2 = sharedMap<string, number>("test:map");
  m1.set("x", 1);
  check("a shared map is one map", m2.get("x") === 1);
  // A second copy of the module (another build layer) finds the same store on globalThis.
  const store = (globalThis as Record<symbol, Map<string, unknown>>)[Symbol.for("youbank.shared")];
  check("the store lives on globalThis under a registered symbol", store?.get("test:one") === a);
}

async function testMemo() {
  console.log("memo: single flight");
  let loads = 0;
  const load = async () => { loads++; await sleep(30); return { v: loads }; };
  const got = await Promise.all(Array.from({ length: 50 }, () => memo("test:memo", 60_000, load)));
  check("50 concurrent misses share one load", loads === 1 && got.every((g) => g === got[0]), { loads });
  await memo("test:memo", 60_000, load);
  check("a hit does not load again", loads === 1);
  forgetMemo("test:memo");
  await memo("test:memo", 60_000, load);
  check("forgetMemo makes the next read load afresh", loads === 2);
  let tries = 0;
  const failing = async () => { tries++; throw new Error("upstream down"); };
  await Promise.all([memo("test:fail", 60_000, failing).catch(() => null), memo("test:fail", 60_000, failing).catch(() => null)]);
  await memo("test:fail", 60_000, failing).catch(() => null);
  check("a failure is shared by concurrent callers and not kept", tries === 2, { tries });
}

async function testCacheJson() {
  console.log("cacheJson: single flight and failure memory");
  const key = `test:cj:${randomUUID()}`;
  let loads = 0;
  const load = async () => { loads++; await sleep(30); return { ok: true }; };
  await Promise.all(Array.from({ length: 40 }, () => cacheJson(key, 60_000, load)));
  check("40 concurrent misses on one instance cost one upstream call", loads === 1, { loads });
  const bad = `test:cj-bad:${randomUUID()}`;
  let calls = 0;
  const down = async () => { calls++; throw new Error("upstream down"); };
  await cacheJson(bad, 60_000, down).catch(() => null);
  await cacheJson(bad, 60_000, down).catch(() => null);
  check("a failed upstream is not asked again for half a minute", calls === 1, { calls });
}

function testCursor() {
  console.log("keyset cursors");
  const at = "2026-10-20T01:02:03.123456Z";
  const c = decodeCursor(encodeCursor(at, 42));
  check("a cursor round-trips at microsecond precision", c?.at === at && c?.id === 42, c);
  check("a cursor for an untimed row round-trips", JSON.stringify(decodeCursor(encodeCursor(null, 7))) === JSON.stringify({ at: null, id: 7 }));
  check("garbage is the first page", decodeCursor("not a cursor") === null && decodeCursor(Buffer.from("x|y").toString("base64url")) === null && decodeCursor(null) === null);
  check("a millisecond time is refused (it would skip rows)", decodeCursor(encodeCursor("2026-10-20T01:02:03.123Z", 1)) === null);
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: 10 - i, cursorAt: `2026-10-20T00:00:0${i}.000000Z`, name: `r${i}` }));
  const p = pageOf(rows, 5);
  check("a page of five from six rows has a next cursor at the fifth", p.rows.length === 5 && decodeCursor(p.next)?.id === 6, p.next);
  check("rows leave without their cursor time", !("cursorAt" in p.rows[0]));
  check("the last page has no next cursor", pageOf(rows.slice(0, 3), 5).next === null);
}

function testPure() {
  console.log("spend totals and algo batches");
  check("utcDay keys by the UTC date", utcDay(new Date("2026-10-20T23:59:59-05:00")) === "2026-10-21");
  const t = totalsOf([{ scope: "u1", usd: "0.5" }, { scope: `${EVERYONE}:3`, usd: 2 }, { scope: `${EVERYONE}:9`, usd: "1" }], "u1");
  check("totals pick the person's row and sum everyone's shards", t.mine === 0.5 && t.everyone === 3, t);
  check("background work has no personal total", totalsOf([{ scope: EVERYONE, usd: 1 }], null).mine === null);
  const groups = byOwner([{ id: 1, userId: "a" }, { id: 2, userId: "b" }, { id: 3, userId: "a" }, { id: 4, userId: "c" }]);
  check("due strategies group by owner, oldest first", JSON.stringify(groups) === JSON.stringify([[1, 3], [2], [4]]), groups);
}

/* ---------------- against a local Postgres ---------------- */

function localDb(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  const host = new URL(url.replace(/^postgres(ql)?:/, "http:")).hostname;
  return ["localhost", "127.0.0.1", "::1"].includes(host);
}

async function testDb() {
  const { requireDb, schema } = await import("@/db");
  const { sql, eq, and, inArray } = await import("drizzle-orm");
  const db = requireDb();
  const has = await db.execute<{ ok: boolean }>(sql`select to_regclass('public.ai_spend') is not null as ok`);
  if (!has.rows[0]?.ok) { console.log("database: ai_spend missing (apply drizzle/0027_scale.sql); skipping database checks"); return; }

  console.log("database: atomic AI spend");
  const { addSpend, readSpend } = await import("@/lib/ai/spend");
  // A day long past, so the test's spend never counts against today's caps; its rows are removed after.
  const day = new Date("2000-01-01T12:00:00Z");
  await db.delete(schema.aiSpend).where(eq(schema.aiSpend.day, utcDay(day)));
  const user = `test-spend-${randomUUID()}`;
  const before = await readSpend(user, day);
  const results = await Promise.all(Array.from({ length: 100 }, () => addSpend(user, 0.01, day)));
  const after = await readSpend(user, day);
  check("100 parallel calls of $0.01 add up to exactly $1.00", Math.abs((after.mine ?? 0) - 1) < 1e-9, after);
  check("everyone's total (summed over its shards) grew by the same $1.00", Math.abs(after.everyone - before.everyone - 1) < 1e-9, { before: before.everyone, after: after.everyone });
  const seen = new Set(results.map((r) => Math.round((r.mine ?? 0) * 100)));
  check("each call got back a distinct running total (no lost update)", seen.size === 100 && Math.max(...seen) === 100, { distinct: seen.size });
  const [row] = await db.select({ calls: schema.aiSpend.calls }).from(schema.aiSpend).where(and(eq(schema.aiSpend.scope, user), eq(schema.aiSpend.day, utcDay(day))));
  check("the call count is exact too", row?.calls === 100, row);
  const shardRows = await db.select({ scope: schema.aiSpend.scope }).from(schema.aiSpend).where(and(sql`${schema.aiSpend.scope} like '*:%'`, eq(schema.aiSpend.day, utcDay(day))));
  check("everyone's total is spread over several shards (no single hot row)", shardRows.length > 1, { shards: shardRows.length });
  await db.delete(schema.aiSpend).where(eq(schema.aiSpend.day, utcDay(day)));

  console.log("database: rate counters and leases");
  const { lease, withinRate } = await import("@/lib/locks");
  const rk = `test-rate-${randomUUID()}`;
  const allowed = (await Promise.all(Array.from({ length: 50 }, () => withinRate(rk, 10, 60_000)))).filter(Boolean).length;
  check("50 requests at once against a limit of 10 let exactly 10 through", allowed === 10, { allowed });
  const lk = `test-lease-${randomUUID()}`;
  const held = await Promise.all(Array.from({ length: 20 }, () => lease(lk, 30_000)));
  check("20 instances asking for one lease: exactly one gets it", held.filter(Boolean).length === 1);
  await Promise.all(held.map((r) => r?.()));
  check("a released lease can be taken again", !!(await lease(lk, 30_000)));
  await db.delete(schema.kvCache).where(inArray(schema.kvCache.key, [`lease:${lk}`]));

  console.log("database: shared cache refill across instances");
  const fk = `test:fill:${randomUUID()}`;
  const other = await lease(`fill:${fk}`, 20_000); // another instance is loading this key
  let loaded = 0;
  setTimeout(() => void cacheSet(fk, JSON.stringify({ from: "other" }), 60_000), 300);
  const v = await cacheJson<{ from: string }>(fk, 60_000, async () => { loaded++; return { from: "me" }; }, { shared: true });
  check("an instance waits for the one already loading instead of calling upstream again", v.from === "other" && loaded === 0, { v, loaded });
  await other?.();
  await db.delete(schema.kvCache).where(inArray(schema.kvCache.key, [fk]));

  console.log("database: seats given at once");
  const { assignSeat } = await import("@/lib/billing/seats");
  const owner = `test-owner-${randomUUID()}`;
  const members = Array.from({ length: 5 }, (_, i) => `test-member-${i}-${randomUUID()}`);
  const [team] = await db.insert(schema.teams).values({ name: "Seat race", slug: `seat-race-${randomUUID()}`, createdBy: owner }).returning({ id: schema.teams.id });
  try {
    await db.insert(schema.subscriptions).values({ userId: owner, plan: "team", status: "active", seats: 3 });
    await db.insert(schema.teamMembers).values([{ teamId: team.id, userId: owner, role: "owner" }, ...members.map((m) => ({ teamId: team.id, userId: m, role: "member" }))]);
    const outcomes = await Promise.allSettled(members.map((m) => assignSeat(owner, m, team.id, { exempt: true })));
    const given = await db.select({ userId: schema.seatAssignments.userId }).from(schema.seatAssignments).where(eq(schema.seatAssignments.ownerUserId, owner));
    check("five seats given at once on a 3-seat plan: exactly two (the owner holds the third)", given.length === 2 && outcomes.filter((o) => o.status === "fulfilled").length === 2, { given: given.length });
    check("the others are refused with a reason", outcomes.filter((o) => o.status === "rejected").every((o) => /seats are in use/.test(String((o as PromiseRejectedResult).reason?.message))));
  } finally {
    await db.delete(schema.seatHistory).where(eq(schema.seatHistory.ownerUserId, owner));
    await db.delete(schema.seatAssignments).where(eq(schema.seatAssignments.ownerUserId, owner));
    await db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, owner));
    await db.delete(schema.teams).where(eq(schema.teams.id, team.id));
  }
}

async function main() {
  testShared();
  await testMemo();
  await testCacheJson();
  testCursor();
  testPure();
  if (localDb()) await testDb();
  else console.log("database checks skipped (set DATABASE_URL to a local database to run them)");
  console.log(`\n${pass} passed, ${fail} failed`);
  const { pgClient } = await import("@/db");
  await pgClient?.end({ timeout: 1 }).catch(() => undefined);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
