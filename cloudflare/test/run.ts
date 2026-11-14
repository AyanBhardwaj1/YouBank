/**
 * The Worker's pure logic: when a thesis agent wakes, how the ledger sequencer lines up with YouBank's copy,
 * which MCP calls wait for the person, and the shared-secret check. `npm test` (tsx).
 */
import { nextEntry, verifyChain, type LedgerContent, type LedgerEntry } from "../../src/lib/ledger/chain";
import { reconcile } from "../src/ledger-logic";
import { afterFailure, BUSY_SEC, CONTINUE_SEC, IDLE_SEC, MIN_GAP_SEC, nextAfter } from "../src/thesis-logic";
import { bearer, gateFor } from "../src/mcp-logic";
import { authorized } from "../src/app";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}`, detail ?? ""); } };
const now = new Date("2026-11-14T22:00:00Z");

console.log("thesis agent: when to wake");
const run = { done: true, reason: null, status: "running", nextTickAt: "2026-11-15T13:00:00Z" };
ok("a finished tick sleeps until the thesis's next check-in", (() => { const n = nextAfter(run, now); return n.kind === "at" && n.when.toISOString() === "2026-11-15T13:00:00.000Z"; })());
ok("an unfinished tick continues almost at once", (() => { const n = nextAfter({ ...run, done: false }, now); return n.kind === "continue" && n.delaySec === CONTINUE_SEC; })());
ok("a next tick already due waits the minimum gap, never a hot loop", (() => { const n = nextAfter({ ...run, nextTickAt: "2026-11-14T21:00:00Z" }, now); return n.kind === "at" && n.when.getTime() === now.getTime() + MIN_GAP_SEC * 1000; })());
ok("paused, stopped, done or deleted: stop scheduling", ["paused", "stopped", "done", "gone"].every((status) => nextAfter({ ...run, status }, now).kind === "stop"));
ok("another runner holds it: look again in two minutes", (() => { const n = nextAfter({ ...run, reason: "running elsewhere" }, now); return n.kind === "retry" && n.delaySec === BUSY_SEC; })());
ok("no next tick named: look again in six hours, not never", (() => { const n = nextAfter({ ...run, nextTickAt: null }, now); return n.kind === "retry" && n.delaySec === IDLE_SEC; })());
ok("failures back off 2, 4, 8 minutes … capped at an hour", [1, 2, 3, 10].map((f) => (afterFailure(f, false) as { delaySec: number }).delaySec).join() === "120,240,480,3600");
ok("a permanent refusal stops", afterFailure(1, true).kind === "stop");

console.log("ledger sequencer: lining up with YouBank's copy");
const c = (s: string): LedgerContent => ({ kind: "chat", subject: s, model: "m", prompt: "p", output: "o", sources: [], meta: {} });
const chain: LedgerEntry[] = [];
for (let i = 0; i < 5; i++) chain.push(nextEntry(chain[i - 1] ?? null, c(`e${i + 1}`), new Date(now.getTime() + i * 1000)));
const head = (e: LedgerEntry | undefined) => (e ? { seq: e.seq, hash: e.hash } : null);
ok("first ever entry: nothing on either side", JSON.stringify(reconcile(null, null, [])) === JSON.stringify({ after: null, missing: [], dropAbove: null }));
ok("in step: append after the shared head", (() => { const p = reconcile(head(chain[2]), head(chain[2]), []); return p.after?.seq === 3 && !p.missing.length && p.dropAbove === null; })());
ok("Durable Object behind (it was off): follow YouBank's head", (() => { const p = reconcile(head(chain[4]), head(chain[1]), []); return p.after?.seq === 5 && p.dropAbove === null; })());
ok("Durable Object new, YouBank has entries: start from YouBank's head", reconcile(head(chain[3]), null, []).after?.seq === 4);
ok("YouBank holds nothing (new, or deleted with the account): start afresh, never bring entries back", (() => { const p = reconcile(null, head(chain[4]), chain); return p.after === null && !p.missing.length && p.dropAbove === 0; })());
ok("Durable Object ahead with entries YouBank never stored: hand them back, append after them", (() => { const p = reconcile(head(chain[2]), head(chain[4]), chain.slice(3)); return p.after?.seq === 5 && p.missing.map((e) => e.seq).join() === "4,5"; })());
ok("…and what it hands back verifies onto YouBank's head", (() => { const p = reconcile(head(chain[2]), head(chain[4]), chain.slice(3)); return verifyChain([...p.missing, nextEntry(p.after, c("new"), now)], head(chain[2])).ok; })());
const forked = nextEntry(chain[2], c("someone else's e4"), now);
ok("same height, different entry (YouBank wrote its own while this was unreachable): YouBank wins", (() => { const p = reconcile(head(forked), head(chain[3]), []); return p.after?.hash === forked.hash && p.dropAbove === 3; })());
ok("ahead but not chaining onto YouBank's head: drop the stray entries, follow YouBank", (() => { const p = reconcile(head(forked), head(chain[4]), [chain[4]]); return p.after?.hash === forked.hash && p.dropAbove === 4 && !p.missing.length; })());
ok("ahead with a gap: drop, never hand back a broken chain", (() => { const p = reconcile(head(chain[1]), head(chain[4]), [chain[3], chain[4]]); return p.after?.seq === 2 && p.dropAbove === 2 && !p.missing.length; })());

console.log("hosted MCP: the approval gate");
const write = { name: "propose_position", title: "Propose a position for my review", annotations: { readOnlyHint: false } };
const read = { name: "book_status", annotations: { readOnlyHint: true } };
ok("a writing tool waits for the person when the app can ask", !!gateFor(write, true)?.message.includes("Propose a position"));
ok("without elicitation it goes through (YouBank's Needs you queue is the gate)", gateFor(write, false) === null);
ok("reading tools never wait", gateFor(read, true) === null && gateFor({ name: "x" }, true) === null);
const req = (h?: string) => new Request("https://w.example/mcp", { headers: h ? { authorization: h } : {} });
ok("a bearer key is read; junk is not", bearer(req("Bearer yb_live_0123456789abcdef")) === "yb_live_0123456789abcdef" && bearer(req("Bearer short")) === null && bearer(req("Basic abcdefabcdefabcdef")) === null && bearer(req()) === null);

console.log("shared secret");
const env = { APP_SECRET: "s".repeat(40) } as never;
ok("the right secret passes", authorized(new Request("https://w.example/x", { headers: { authorization: `Bearer ${"s".repeat(40)}` } }), env));
ok("a wrong or missing one does not", !authorized(new Request("https://w.example/x", { headers: { authorization: `Bearer ${"t".repeat(40)}` } }), env) && !authorized(new Request("https://w.example/x"), env));
ok("a short secret is refused outright", !authorized(new Request("https://w.example/x", { headers: { authorization: "Bearer short" } }), { APP_SECRET: "short" } as never));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
