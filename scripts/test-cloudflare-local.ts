/**
 * The Cloudflare pieces end to end, against a local Worker and a local YouBank (not run in CI: it needs both):
 *   cd cloudflare && npx wrangler dev --port 8787            (with .dev.vars: APP_SECRET, APP_URL=http://localhost:3000)
 *   CF_WORKER_URL=http://localhost:8787 CF_WORKER_SECRET=… pnpm dev
 *   CF_WORKER_URL=… CF_WORKER_SECRET=… DATABASE_URL=… pnpm exec tsx scripts/test-cloudflare-local.ts <userId>
 * Checks: twenty ledger entries appended at once through the Durable Object land as one gap-free chain that
 * verifies; an entry whose insert was lost is handed back and written on the next append; a thesis agent wakes,
 * calls YouBank, logs the tick and schedules itself; the nightly Workflow runs to completion over a real book.
 */
import { sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { append, purgeLedgerCopy, verifyAll } from "@/lib/ledger/store";
import { cleanContent } from "@/lib/ledger/chain";
import { callWorker, cfOn, workerConfig } from "@/lib/cloudflare/worker";
import { signalAgent } from "@/lib/edge/agent/store";

const userId = process.argv[2];
let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}`, detail ?? ""); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!userId || !workerConfig()) throw new Error("usage: CF_WORKER_URL=… CF_WORKER_SECRET=… tsx scripts/test-cloudflare-local.ts <userId>");
  const db = requireDb();
  ok("the Worker answers", !!(await callWorker<{ ok: boolean }>("/health"))?.ok);
  ok("the ledger and the Thesis Agent run on Cloudflare", cfOn("ledger") && cfOn("thesis") && cfOn("workflow"));

  console.log("ledger through the Durable Object");
  await db.delete(schema.researchLedger).where(sql`${schema.researchLedger.userId} = ${userId}`);
  ok("the person's copy in the Durable Object can be forgotten (account deletion)", await purgeLedgerCopy(userId));
  const entries = await Promise.all(Array.from({ length: 20 }, (_, i) => append(userId, cleanContent({ kind: "note", subject: `concurrent ${i}`, output: `entry ${i}` }))));
  const seqs = entries.map((e) => e.seq).sort((a, b) => a - b);
  const viaDo = await callWorker<{ head: { seq: number } | null }>(`/ledger/${userId}`);
  ok("twenty appends at once get twenty different places, 1 to 20", seqs.join() === Array.from({ length: 20 }, (_, i) => i + 1).join(), seqs);
  ok("…placed by the Durable Object, not by the fallback lock", (await callWorker<{ head: { seq: number } | null }>(`/ledger/${userId}`))?.head?.seq === 20 && viaDo !== null);
  const v = await verifyAll(userId);
  ok("the stored chain verifies end to end", v.ok && v.checked === 20, v);
  const lost = await callWorker<{ entry: { seq: number } }>(`/ledger/${userId}/append`, { content: cleanContent({ kind: "note", subject: "insert lost", output: "x" }), base: { seq: 20, hash: entries.find((e) => e.seq === 20)!.hash } });
  ok("an entry appended in the Durable Object but never stored here (a lost insert)", lost?.entry.seq === 21);
  const next = await append(userId, cleanContent({ kind: "note", subject: "after the lost one", output: "y" }));
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.researchLedger).where(sql`${schema.researchLedger.userId} = ${userId}`);
  ok("…is handed back and written before the next one", next.seq === 22 && Number(n.n) === 22, { seq: next.seq, rows: n.n });
  ok("…and the chain still verifies", (await verifyAll(userId)).ok);
  const head = await callWorker<{ head: { seq: number; hash: string } }>(`/ledger/${userId}`);
  ok("the Durable Object's head is YouBank's head", head?.head.seq === 22 && head.head.hash === next.hash);
  await db.delete(schema.researchLedger).where(sql`${schema.researchLedger.userId} = ${userId}`);

  console.log("Thesis Agent on the Agents SDK");
  const [row] = await db.insert(schema.edgeAgents).values({ ownerId: userId, title: "cf local check", thesis: "local wiring check", status: "running", budgetUsd: 5, cadence: "daily", horizonEnd: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), memo: { nextTickAt: new Date().toISOString() } }).returning({ id: schema.edgeAgents.id });
  await signalAgent(row.id, "wake");
  let st: { ticks: number; status: string; nextAt: string | null; recent: { outcome: string }[] } | null = null;
  for (let i = 0; i < 20 && !(st?.ticks); i++) { await sleep(1500); st = await callWorker(`/thesis/${row.id}`); }
  console.log(`       agent: ${st?.status}, next ${st?.nextAt ?? "none"}, ${(st as { why?: string } | null)?.why ?? ""}; last tick: ${st?.recent[0]?.outcome ?? "none"}`);
  ok("the agent woke, called YouBank and logged the tick", !!st && st.ticks >= 1 && st.recent.length >= 1, st);
  // Whatever the tick concluded, the agent acted on YouBank's answer: scheduled its next wake, or stopped because
  // YouBank said the thesis is no longer running.
  ok("…and acted on the answer (scheduled its next wake, or stopped with YouBank's reason)", (st?.status === "scheduled" && !!st.nextAt) || (st?.status === "stopped" && !!st && /the thesis is/.test(String((st as { why?: string }).why))), st);
  await db.update(schema.edgeAgents).set({ status: "paused" }).where(sql`${schema.edgeAgents.id} = ${row.id}`);
  await signalAgent(row.id, "stop");
  st = await callWorker(`/thesis/${row.id}`);
  ok("paused: the agent stops scheduling", st?.status === "stopped" && !st.nextAt, st);
  await db.delete(schema.edgeAgents).where(sql`${schema.edgeAgents.id} = ${row.id}`);

  console.log("nightly kill-criteria Workflow");
  const started = await callWorker<{ id: string }>("/workflows/book", { at: new Date().toISOString() });
  ok("an instance starts", !!started?.id);
  let ws: { status: string; output?: { people: number; checked: number; failed: number } } | null = null;
  for (let i = 0; i < 300 && started && !["complete", "errored", "terminated"].includes(ws?.status ?? ""); i++) { await sleep(2000); ws = await callWorker(`/workflows/book/${started.id}`); }
  ok("it runs to completion", ws?.status === "complete", ws);
  ok("every book in tonight's plan was checked", !!ws?.output && ws.output.people >= 1 && ws.output.checked === ws.output.people && ws.output.failed === 0, ws?.output);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
