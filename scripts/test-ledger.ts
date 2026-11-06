/** The research ledger's chain (src/lib/ledger/chain.ts): pnpm exec tsx scripts/test-ledger.ts */
import { createHash } from "node:crypto";
import { canonical, cleanContent, entryHash, exportJsonl, LIMITS, nextEntry, signoffContent, verifyChain, type LedgerEntry } from "@/lib/ledger/chain";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};

console.log("canonical form");
ok("keys sorted at every level, no whitespace", canonical({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } }), '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
ok("undefined fields are left out, null kept", canonical({ a: undefined, b: null }), '{"b":null}');

console.log("the chain");
const t0 = new Date("2026-11-06T12:00:00.000Z");
const ask = (i: number) => cleanContent({ kind: "chat", subject: "SNOW", model: "anthropic/claude", prompt: `What is SNOW's growth? (${i})`, output: `Revenue grew 24.7% [S1]. (${i})`, sources: [{ id: "S1", label: "SNOW XBRL", url: "https://data.sec.gov/x" }], meta: { feature: "terminal-ai" } });
const chain: LedgerEntry[] = [];
for (let i = 0; i < 5; i++) chain.push(nextEntry(chain[i - 1] ?? null, ask(i), new Date(t0.getTime() + i * 1000)));
ok("numbered from 1, each following the last", chain.map((e) => [e.seq, e.prev === (chain[e.seq - 2]?.hash ?? "")]), [[1, true], [2, true], [3, true], [4, true], [5, true]]);
ok("the first follows nothing", chain[0].prev, "");
ok("an intact chain verifies", verifyChain(chain), { ok: true, checked: 5, firstBad: null, problem: "" });
ok("a slice verifies from the entry before it", verifyChain(chain.slice(2), chain[1]).ok, true);
ok("an edited answer is caught at that entry", verifyChain(chain.map((e) => (e.seq === 3 ? { ...e, output: "Revenue grew 40%." } : e))), { ok: false, checked: 2, firstBad: 3, problem: "Entry 3 was changed after it was written." });
const rehashed = chain.map((e) => (e.seq === 3 ? (() => { const x = { ...e, output: "Revenue grew 40%." }; return { ...x, hash: entryHash(x) }; })() : e));
ok("re-hashing the edit breaks the next link", verifyChain(rehashed).problem, "Entry 4 does not follow from entry 3: the chain was changed before it.");
ok("a removed entry is caught", verifyChain(chain.filter((e) => e.seq !== 2)).problem, "Entry 2 is missing: the next one is 3.");
ok("reordering is caught", verifyChain([chain[0], chain[2], chain[1]]).ok, false);
ok("a changed timestamp is caught", verifyChain(chain.map((e) => (e.seq === 5 ? { ...e, at: "2026-11-07T00:00:00.000Z" } : e))).firstBad, 5);
ok("changed sources are caught", verifyChain(chain.map((e) => (e.seq === 1 ? { ...e, sources: [{ id: "S1", label: "SNOW XBRL", url: "https://evil.example" }] } : e))).firstBad, 1);
ok("key order in meta does not matter", entryHash({ ...chain[0], meta: { b: 2, a: 1 } }) === entryHash({ ...chain[0], meta: { a: 1, b: 2 } }), true);

console.log("what is kept");
const big = cleanContent({ kind: "chat", prompt: "x".repeat(LIMITS.prompt + 50), output: "y".repeat(LIMITS.output + 50), sources: Array.from({ length: 80 }, (_, i) => ({ id: `S${i}`, label: "l", url: "https://a" })) });
ok("cut to the limits", [big.prompt.length, big.output.length, big.sources.length], [LIMITS.prompt, LIMITS.output, LIMITS.sources]);
ok("missing fields are empty, not undefined", [big.subject, big.model, big.meta], ["", "", {}]);

console.log("sign-offs and export");
const so = signoffContent(chain[2], "Ana Analyst <ana@fund.com>", "approved", "Checked against the 10-Q.");
ok("a sign-off points at the entry and its hash", [so.kind, so.meta.ref, so.meta.refHash === chain[2].hash, so.meta.decision, so.output], ["signoff", 3, true, "approved", "Checked against the 10-Q."]);
const withSign = [...chain, nextEntry(chain[4], so, new Date(t0.getTime() + 9000))];
ok("a sign-off is a link in the same chain", verifyChain(withSign).ok, true);
const out = exportJsonl(withSign, "ana@fund.com", t0).trim().split("\n");
ok("export: a header, then one line per entry", [out.length, JSON.parse(out[0]).youbank_research_ledger, JSON.parse(out[0]).owner], [7, 1, "ana@fund.com"]);
// The recipe in the header, followed by hand without the library: what a compliance team would run.
const lines = out.slice(1).map((l) => JSON.parse(l) as Record<string, unknown>);
const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v);
let prev = "", good = true;
for (const l of lines) {
  const body = { seq: l.seq, at: l.at, kind: l.kind, subject: l.subject, model: l.model, prompt: l.prompt, output: l.output, sources: l.sources, meta: l.meta, prev };
  const h = createHash("sha256").update(JSON.stringify(sorted(body))).digest("hex");
  if (h !== l.hash || l.prev !== prev) good = false;
  prev = l.hash as string;
}
ok("the export checks out by its own recipe, without YouBank's code", good, true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
