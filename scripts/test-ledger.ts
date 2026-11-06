/** The research ledger's chain (src/lib/ledger/chain.ts): pnpm exec tsx scripts/test-ledger.ts */
import { createHash } from "node:crypto";
import { governance, periodOf, type GovRow } from "@/lib/ledger/governance";
import { anchorMail, storable, canonical, cleanContent, entryHash, exportJsonl, headLine, LIMITS, nextEntry, parseAnchors, signoffContent, verifyChain, type LedgerEntry } from "@/lib/ledger/chain";

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

console.log("anchors");
const line = headLine("ana@fund.com", chain[4]);
ok("the head line names the entry and its hash", [line.includes("entry 5"), line.includes(chain[4].hash)], [true, true]);
ok("pasted lines come back as anchors, any wording, deduped", parseAnchors(`${line}\n${line}\nentry #2: ${chain[1].hash.toUpperCase()}\nno hash here entry 3`), [{ seq: 5, hash: chain[4].hash }, { seq: 2, hash: chain[1].hash }]);
const mail = anchorMail(line, 5, "https://youbank.example");
ok("the anchor email carries the line, and pasting the email back finds it", [mail.subject, parseAnchors(mail.text)], ["YouBank research ledger anchor: entry 5", [{ seq: 5, hash: chain[4].hash }]]);
ok("the email's HTML is escaped", anchorMail("<b>x</b> entry 1 " + "a".repeat(64), 1, "https://y").html.includes("<b>x</b>"), false);

console.log("storable text");
const emoji = "😀";
ok("a cut never splits an emoji", [storable(`ab${emoji}`, 3), storable(`ab${emoji}`, 4)], ["ab", `ab${emoji}`]);
ok("lone surrogates and NUL are made storable", [storable("a\uD83Db"), storable("a\u0000b"), storable("x\uDE00")], ["a\uFFFDb", "ab", "x\uFFFD"]);
const long = cleanContent({ kind: "chat", output: "x".repeat(LIMITS.output - 1) + emoji, meta: { "k\u0000": ["v\uD83D"] }, sources: [{ id: "S1", label: "head\u0000line", url: "https://a" }] });
ok("an answer cut at the limit survives a UTF-8 round trip unchanged", Buffer.from(long.output, "utf8").toString("utf8") === long.output && long.output.length === LIMITS.output - 1, true);
ok("meta and sources are cleaned too", [JSON.stringify(long.meta), long.sources[0].label], [JSON.stringify({ k: ["v\uFFFD"] }), "headline"]);

console.log("governance report");
const gr = (seq: number, at: string, kind: GovRow["kind"], extra: Partial<GovRow> = {}): GovRow => ({ seq, at, kind, subject: "", model: "", meta: {}, sources: 0, ...extra });
const rowsG: GovRow[] = [
  gr(1, "2026-10-31T10:00:00.000Z", "chat", { model: "m1", sources: 2 }), // before the period
  gr(2, "2026-11-01T09:00:00.000Z", "note", { meta: { recording: true } }),
  gr(3, "2026-11-02T10:00:00.000Z", "chat", { model: "m1", sources: 3 }),
  gr(4, "2026-11-02T11:00:00.000Z", "mcp", { subject: "book_status via Claude (connected)", meta: { tool: "book_status" }, sources: 4 }),
  gr(5, "2026-11-03T11:00:00.000Z", "mcp", { subject: "propose_position via Claude (connected)", meta: { tool: "propose_position" }, sources: 1 }),
  gr(6, "2026-11-03T12:00:00.000Z", "mcp", { subject: "calc via Cursor", meta: { tool: "calc", isError: true } }),
  gr(7, "2026-11-04T08:00:00.000Z", "red_team", { model: "m2", sources: 5 }),
  gr(8, "2026-11-04T09:00:00.000Z", "signoff", { subject: "Review of entry 3: a question", meta: { ref: 3, decision: "approved", reviewer: "cco@fund" } }),
  gr(9, "2026-11-04T09:05:00.000Z", "signoff", { subject: "Review of entry 7: red team SNOW", meta: { ref: 7, decision: "rejected", reviewer: "cco@fund" }, note: "Cites a stale 10-Q." }),
  gr(10, "2026-11-05T09:00:00.000Z", "signoff", { subject: "Review of entry 1: last month", meta: { ref: 1, decision: "noted", reviewer: "cco@fund" } }),
  gr(11, "2026-11-05T10:00:00.000Z", "note", { meta: { recording: false } }),
];
const later = [gr(20, "2026-12-02T09:00:00.000Z", "signoff", { meta: { ref: 4, decision: "approved", reviewer: "pm" } }), gr(21, "2026-12-03T09:00:00.000Z", "signoff", { meta: { ref: 1, decision: "approved", reviewer: "pm" } })];
const G = governance(rowsG, "2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z", later);
ok("counts the period's AI output by kind, model, app and tool", [G.entries, G.ai, G.byModel, G.byApp, G.byTool.map((t) => t.tool)], [10, 5, [{ model: "m1", n: 1 }, { model: "m2", n: 1 }], [{ app: "Claude (connected)", n: 2 }, { app: "Cursor", n: 1 }], ["book_status", "calc", "propose_position"]]);
ok("sources, proposals, errors, active days", [G.unsourced, G.sourcedShare, G.proposals, G.errors, G.activeDays], [1, 80, 1, 1, 5]);
ok("reviews: in-period sign-offs count, and a later one for an entry in the period; a later one for an older entry does not", [G.reviews, G.reviewedShare], [{ approved: 2, rejected: 1, noted: 1 }, 60]);
ok("rejections are listed with the reviewer and the reason", G.rejected, [{ seq: 9, ref: 7, subject: "red team SNOW", reviewer: "cco@fund", note: "Cites a stale 10-Q.", at: "2026-11-04T09:05:00.000Z" }]);
ok("recording turned on and off in the period is shown", G.pauses, [{ at: "2026-11-01T09:00:00.000Z", on: true }, { at: "2026-11-05T10:00:00.000Z", on: false }]);
ok("an empty period has no shares, not zero", [governance([], "a", "b").sourcedShare, governance([], "a", "b").reviewedShare], [null, null]);
const pm = periodOf("2026-02", new Date("2026-11-06T12:00:00Z")), p30 = periodOf(undefined, new Date("2026-11-06T12:00:00Z")), bad = periodOf("2026-13", new Date("2026-11-06T12:00:00Z"));
ok("a month runs to the first of the next; anything else is the last 30 days", [pm.from, pm.to, pm.label, p30.from, p30.label, bad.label], ["2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z", "February 2026", "2026-10-07T12:00:00.000Z", "The last 30 days", "The last 30 days"]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
