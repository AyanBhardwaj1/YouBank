/**
 * The Precedent Engine's evaluation (E1, docs/edge-next.md):
 *   1. field accuracy by family on the labelled set: the hand-checked fixture fields (offline, always) and,
 *      with a database, fields a person has confirmed or corrected (verified_by set);
 *   2. recall@10 of the precedents bankers chose: for deals whose fairness opinion lists its selected
 *      transactions, how many of those (when they are in the database) "deals like this one" retrieves in its
 *      top ten (target 0.5 to start; the number is reported as it is);
 *   3. coverage of the 80% multiple interval on the latest year's deals, each predicted without itself.
 * With --fit it writes src/lib/edge/deals/confidence.json from the labelled fields.
 *
 *   pnpm exec tsx scripts/eval-precedents.ts            (offline part only without DATABASE_URL)
 *   DATABASE_URL=<test branch> pnpm exec tsx scripts/eval-precedents.ts [--fit]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checkField } from "@/lib/edge/deals/checks";
import { fitConfidence, MIN_LABELLED, rawScore, type LabelledField } from "@/lib/edge/deals/confidence";
import { FAMILIES, FIELD } from "@/lib/edge/deals/fields";
import { locateSections, SECTIONS_BY_KIND } from "@/lib/edge/deals/sections";
import { partsFromHtml } from "@/lib/edge/docs/html";

const dir = path.join(__dirname, "fixtures", "deals");
const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "n/a" : `${(v * 100).toFixed(1)}%`);

function offline(): LabelledField[] {
  const docs: Record<string, ReturnType<typeof locateSections>> = {};
  const labels = readFileSync(path.join(dir, "labels.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { deal: string; section: string; field: string; value: string; quote: string; truth: unknown });
  const out: LabelledField[] = [];
  for (const l of labels) {
    docs[l.deal] ??= locateSections(partsFromHtml(readFileSync(path.join(dir, `${l.deal}.html`), "utf8")), [...SECTIONS_BY_KIND.proxy, "reasons"]);
    const sec = docs[l.deal].find((x) => x.key === l.section) ?? docs[l.deal].find((x) => x.text.includes(l.quote.slice(0, 30)));
    const c = checkField({ field: l.field, value: l.value, quote: l.quote }, sec?.text ?? "");
    if (c.value === null) continue;
    out.push({ deal: l.deal, field: l.field, raw: rawScore(c.checks, sec?.via ?? "keywords"), correct: JSON.stringify(c.value) === JSON.stringify(l.truth) });
  }
  return out;
}

function report(rows: LabelledField[], label: string) {
  console.log(`\nField accuracy by family (${label}): ${rows.length} fields from ${new Set(rows.map((r) => r.deal)).size} deals`);
  for (const fam of FAMILIES) {
    const mine = rows.filter((r) => FIELD[r.field]?.family === fam);
    if (!mine.length) continue;
    console.log(`  ${fam.padEnd(12)} ${String(mine.length).padStart(4)} fields  right ${pct(mine.filter((r) => r.correct).length / mine.length)}${mine.length < MIN_LABELLED ? `  (below the ${MIN_LABELLED} a family needs before its confidence is called calibrated)` : ""}`);
  }
}

async function main() {
  const fit = process.argv.includes("--fit");
  const labelled = offline();
  report(labelled, "hand-checked fixture fields");
  if (!process.env.DATABASE_URL) {
    console.log("\nNo DATABASE_URL: recall@10 and interval coverage need the deal database (run against the test branch).");
    if (fit) { writeFileSync(path.join(__dirname, "..", "src/lib/edge/deals/confidence.json"), `${JSON.stringify(fitConfidence(labelled, `fixture-${new Date().toISOString().slice(0, 10)}`), null, 2)}\n`); console.log("Wrote confidence.json from the fixture labels."); }
    return;
  }
  const { requireDb, schema } = await import("@/db");
  const { and, eq, ne, sql } = await import("drizzle-orm");
  const { nameScore } = await import("@/lib/edge/entities/crosswalk");
  const { dealQuery, similarDeals } = await import("@/lib/edge/deals/store");
  const { recallAtK } = await import("@/lib/edge/deals/similar");
  const db = requireDb();

  // 1. Fields a person confirmed or corrected.
  const verified = await db.select().from(schema.edgeDealFields).where(and(ne(schema.edgeDealFields.verifiedBy, ""))).limit(20_000);
  const dbRows: LabelledField[] = verified.map((f) => ({ deal: String(f.dealId), field: f.field, raw: Number((f.checks as { raw?: number }).raw ?? 0.5), correct: f.active }));
  if (dbRows.length) report(dbRows, "fields people confirmed or corrected");
  const all = [...labelled, ...dbRows];
  if (fit) { writeFileSync(path.join(__dirname, "..", "src/lib/edge/deals/confidence.json"), `${JSON.stringify(fitConfidence(all, `labels-${new Date().toISOString().slice(0, 10)}`), null, 2)}\n`); console.log(`Wrote confidence.json from ${all.length} labelled fields.`); }

  // 2. Recall@10 of the bankers' chosen precedents.
  const chosen = await db.select({ dealId: schema.edgeDealFields.dealId, value: schema.edgeDealFields.value }).from(schema.edgeDealFields).where(and(eq(schema.edgeDealFields.field, "selected_precedents"), eq(schema.edgeDealFields.active, true))).limit(2000);
  const targets = (await db.execute(sql`select id, target_name from edge_deals where owner_id is null and target_name <> ''`)).rows as { id: number; target_name: string }[];
  const find = (name: string) => { let best = 0, id = 0; for (const t of targets) { const s = nameScore(name, t.target_name).score; if (s > best) { best = s; id = t.id; } } return best >= 0.9 ? id : 0; };
  const recalls: number[] = [];
  for (const c of chosen) {
    const ids = (Array.isArray(c.value) ? c.value : []).map((v) => String(v).split("/").pop()!.trim()).map(find).filter((id) => id && id !== c.dealId);
    if (!ids.length) continue;
    const q = await dealQuery(c.dealId);
    if (!q) continue;
    const r = await similarDeals(q, {}, 10);
    const rec = recallAtK(r.results.map((x) => x.id), ids, 10);
    if (rec !== null) recalls.push(rec);
  }
  const mean = recalls.length ? recalls.reduce((a, b) => a + b, 0) / recalls.length : null;
  console.log(`\nRecall@10 of banker-chosen precedents: ${pct(mean)} on ${recalls.length} deals whose chosen precedents are in the database (target 50% to start).`);

  // 3. Coverage of the 80% interval on the latest year.
  const year = new Date().getUTCFullYear() - 1;
  const recent = (await db.execute(sql`select id, ev_ebitda from edge_deals where owner_id is null and ev_ebitda is not null and extract(year from announced_at) >= ${year} limit 300`)).rows as { id: number; ev_ebitda: number }[];
  let covered = 0, n = 0;
  for (const d of recent) {
    const q = await dealQuery(d.id);
    if (!q) continue;
    const band = (await similarDeals(q, {}, 20)).range.band;
    if (!band) continue;
    n++; if (d.ev_ebitda >= band.low && d.ev_ebitda <= band.high) covered++;
  }
  console.log(`Coverage of the 80% EV/EBITDA interval on ${year}+ deals: ${n ? pct(covered / n) : "n/a"} of ${n} with a band.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
