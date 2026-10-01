/**
 * Retrieval eval for Documents: questions over the test branch's documents (Energy Transfer's 10-K and
 * two 10-Qs, and eight fictional company write-ups and calls), each with the passages that should be
 * found, written as phrases from those passages so the check survives re-chunking. Reports recall@5 and
 * recall@12 of the fused candidates and of the final selection the answer model reads, so changes to
 * embeddings, keyword search or reranking can be compared. Retrieval only: no answers are written.
 *
 * Read-only: every insert, update or delete the run would send to the database is refused at the driver
 * (the AI usage rows it would normally record are skipped).
 *
 *   node --env-file=.env.local --env-file=<test branch env> node_modules/tsx/dist/cli.mjs scripts/eval-docs.ts \
 *     [--plans plans.json] [--only 3,7] [--cross off] [--json out.json] [--module path/to/retrieve.ts] [--headers]
 *
 * --plans reuses the search phrasings saved by an earlier run (and saves new ones), so two runs differ
 * only in the code under test; --cross off skips the cross-encoder step; --module runs another copy of
 * the retrieval module (an older version, say) against the same questions; --headers re-embeds the
 * passages in scope with their headers in memory (documents indexed before headers were embedded keep
 * their old vectors in the database) and uses those for the meaning search, to measure what re-indexing
 * would bring without writing anything.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { neonConfig } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { docLabel, passageHeader } from "@/lib/edge/docs/chunk";
import { embedTexts } from "@/lib/edge/docs/embed";

type Needle = string | string[];
type Case = { q: string; scope: "ET" | "all"; needles: Needle[] };

const K10 = "Energy Transfer LP 10-K (2026-02-19)", Q2 = "Energy Transfer LP 10-Q (2026-08-06)", Q1 = "Energy Transfer LP 10-Q (2026-05-07)";

/** The questions. A needle is a phrase (or alternatives) that a relevant passage contains. */
export const CASES: Case[] = [
  // The 10-K (fiscal 2025)
  { q: "How many people did Energy Transfer employ at the end of 2025, and how many were represented by labor unions?", scope: "ET", needles: ["employed an aggregate of 22,311 employees"] },
  { q: "Why did Energy Transfer suspend the Lake Charles LNG export project, and when?", scope: "ET", needles: ["announced the suspension of development of the Lake Charles LNG project"] },
  { q: "How large was the impairment Energy Transfer recorded for the Lake Charles LNG export project?", scope: "ET", needles: [["256 million fixed asset impairment related to the suspension", "impairment of the assets associated with the Lake Charles LNG export project"]] },
  { q: "How many miles of intrastate natural gas pipelines does Energy Transfer operate, and with what capacity?", scope: "ET", needles: ["approximately 12,200 miles of intrastate natural gas transportation pipelines"] },
  { q: "What is the send-out capacity of the Lake Charles LNG regasification facility?", scope: "ET", needles: ["send out capacity of 1.8 Bcf/d"] },
  { q: "What was Energy Transfer's consolidated Adjusted EBITDA for 2025 compared with 2024?", scope: "ET", needles: ["Adjusted EBITDA (consolidated) $ 15,984 $ 15,483"] },
  { q: "What was the Midstream segment's Adjusted EBITDA in 2025 versus 2024?", scope: "ET", needles: ["Midstream 3,164 2,910"] },
  { q: "What share of Energy Transfer's workforce is covered by collective bargaining agreements?", scope: "ET", needles: ["6% of our workforce is covered by a number of collective bargaining agreements"] },
  { q: "How much fuel does Sunoco LP distribute each year, and to how many locations?", scope: "ET", needles: ["distribute over 15 billion gallons annually"] },
  { q: "What is the capacity of the Bayou Bridge Pipeline?", scope: "ET", needles: ["Bayou Bridge Pipeline has a capacity of approximately 480 MBbls/d"] },
  { q: "Who are Energy Transfer's co-chief executive officers?", scope: "ET", needles: [["Marshall S. McCrea, III and Thomas E. Long, Co-Chief Executive Officers", "Thomas E. Long 69 Co-Chief Executive Officer", "Marshall S. (Mackie) McCrea, III, Co-Chief Executive Officer; • Thomas E. Long, Co-Chief Executive Officer"]] },
  { q: "How does Energy Transfer test its cybersecurity program, and who does the testing?", scope: "ET", needles: ["engage third-party service providers to perform audits, assessments and penetration tests"] },
  { q: "What annual retainer did Energy Transfer pay its outside directors in 2025?", scope: "ET", needles: ["$100,000 annual retainer"] },
  { q: "What could a credit rating downgrade do to Energy Transfer?", scope: "ET", needles: ["downgrade of our credit ratings could impact our and our subsidiaries' liquidity"] },
  // The 10-Q for the quarter ended June 30, 2026
  { q: "How did early volumes from the Hugh Brinson Pipeline affect results in the second quarter of 2026?", scope: "ET", needles: ["$21 million increase from early volumes during the commissioning of the Hugh Brinson Pipeline"] },
  { q: "Which senior notes did Energy Transfer issue in January 2026?", scope: "ET", needles: ["issued $ 1.00 billion aggregate principal amount of 4.55 % senior notes due 2031"] },
  { q: "What was Energy Transfer's net income per common unit for the three months ended June 30, 2026?", scope: "ET", needles: [["Basic income per common unit $ 0.59", "NET INCOME PER COMMON UNIT: Basic $ 0.59"]] },
  { q: "When did Sunoco LP complete the TanQuid acquisition, and what did it pay?", scope: "ET", needles: ["On January 16, 2026, Sunoco LP completed the acquisition of TanQuid"] },
  { q: "How much horsepower did the J-W Power acquisition add to USAC's fleet?", scope: "ET", needles: ["added approximately 0.8 million active horsepower"] },
  { q: "How much did Energy Transfer's Adjusted EBITDA grow in the second quarter of 2026 compared with a year earlier?", scope: "ET", needles: ["Adjusted EBITDA increased by $1.20 billion and $2.04 billion"] },
  // The 10-Q for the quarter ended March 31, 2026
  { q: "By how much did Adjusted EBITDA increase in the first quarter of 2026, and why?", scope: "ET", needles: ["Adjusted EBITDA increased by $839 million, or approximately 20%"] },
  { q: "What lawsuit did Oklahoma's Attorney General bring against Energy Transfer entities over Winter Storm Uri?", scope: "ET", needles: ["filed a petition on behalf of Grand River Dam Authority"] },
  { q: "How much growth and maintenance capital does Energy Transfer expect to spend in 2026 in the intrastate segment?", scope: "ET", needles: ["Intrastate transportation and storage $ 1,300 $ 80"] },
  { q: "Why is Energy Transfer now in scope for the OECD Pillar Two global minimum tax?", scope: "ET", needles: ["acquisition of Parkland brings the Partnership into scope for Pillar Two"] },
  // The fictional uploads, searched together with the filings
  { q: "What segments does Cinderlake Midstream report?", scope: "all", needles: ["three segments: Natural Gas Gathering, Gas Processing, and Compression"] },
  { q: "Who is Redwillow Pipeline Group's chief financial officer?", scope: "all", needles: ["Victor Han, Chief Financial Officer"] },
  { q: "Which of the midstream companies in my uploads reported an operating loss, and how large was it?", scope: "all", needles: [["operating loss of $34 million", "an operating loss of $34 million"]] },
  { q: "What is Granite Bend's plan to get back to profitability?", scope: "all", needles: ["The path has three parts"] },
  { q: "Compare last year's revenue at Cinderlake, Blue Mesa, Redwillow and Granite Bend.", scope: "all", needles: [["Cinderlake reported revenue of $276 million", "revenue of $276 million"], ["$716 million in revenue", "Revenue was $716 million"], ["RWPG reported revenue of $310 million", "Revenue was $310 million"], ["$347 million in revenue", "$347 million of revenue"]] },
  { q: "Who asked Cinderlake about margin improvement in processing, and what did management answer?", scope: "all", needles: ["Should investors expect margin improvement from the processing segment", "There is opportunity, particularly as utilization rises"] },
];

/** Letters and digits only, so "4.55 %" and "4.55%" or "$ 1.00" and "$1.00" compare equal. Pure. */
export const squash = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}]+/gu, "");

/** Recall at k: the share of needles some passage among the first k contains. Pure. */
export function recallAt(texts: string[], needles: Needle[], k: number): number {
  if (!needles.length) return 1;
  const top = texts.slice(0, k).map(squash);
  return needles.filter((n) => (Array.isArray(n) ? n : [n]).some((alt) => top.some((t) => t.includes(squash(alt))))).length / needles.length;
}

/** 1 / the rank of the first passage holding any needle (0 when none does). Pure. */
export function reciprocalRank(texts: string[], needles: Needle[]): number {
  const alts = needles.flatMap((n) => (Array.isArray(n) ? n : [n])).map(squash);
  const i = texts.findIndex((t) => { const s = squash(t); return alts.some((a) => s.includes(a)); });
  return i < 0 ? 0 : 1 / (i + 1);
}

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };

/** Refuse writes at the driver: the eval must leave the database as it found it. */
function readOnly() {
  const inner = neonConfig.fetchFunction as ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | undefined;
  neonConfig.fetchFunction = async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    let queries: string[] = [];
    try { const j = JSON.parse(body) as { query?: string; queries?: { query: string }[] }; queries = j.queries ? j.queries.map((x) => x.query) : [j.query ?? ""]; } catch { /* not a query */ }
    if (queries.some((q) => /^\s*(with\b[\s\S]*?\b)?(insert|update|delete|create|drop|alter|truncate|grant|vacuum)\b/i.test(q))) throw new Error("eval-docs is read-only");
    return (inner ?? fetch)(input, init);
  };
}

type Plan = { queries: string[]; keywords: string };

async function main() {
  readOnly();
  const db = requireDb();
  console.log(`database ${new URL(process.env.DATABASE_URL!).hostname.split(".")[0]} (read-only)`);
  const docs = (await db.execute(sql`select id, title, source, meta->>'ticker' as ticker from edge_docs where status = 'ready' order by id`)).rows as { id: number; title: string; source: string; ticker: string | null }[];
  const scopes = { ET: docs.filter((d) => d.ticker === "ET" && d.source === "sec").map((d) => d.id), all: docs.map((d) => d.id) };
  for (const t of [K10, Q1, Q2]) if (!docs.some((d) => d.title === t)) console.warn(`  missing on this database: ${t}`);
  if (process.argv.includes("--check")) {
    // Every needle must be in some passage of its scope, or the question cannot score.
    const texts = ((await db.execute(sql`select doc_id, text from edge_chunks`)).rows as { doc_id: number; text: string }[]);
    for (const [i, c] of CASES.entries()) {
      const pool = texts.filter((t) => scopes[c.scope].includes(t.doc_id)).map((t) => squash(t.text));
      for (const n of c.needles) {
        const alts = (Array.isArray(n) ? n : [n]).map(squash);
        const holders = pool.filter((t) => alts.some((a) => t.includes(a))).length;
        if (!holders) console.log(`  ${i + 1}: no passage holds "${Array.isArray(n) ? n[0] : n}"`);
        else if (holders > 3) console.log(`  ${i + 1}: ${holders} passages hold "${Array.isArray(n) ? n[0] : n}"`);
      }
    }
    return;
  }
  const alt = arg("module");
  const r = (alt ? await import(alt) : await import("@/lib/edge/docs/retrieve")) as typeof import("@/lib/edge/docs/retrieve");
  const mod = r as typeof r & { retrieve?: (question: string, docIds: number[], plan: Plan, opts?: { cross?: boolean }) => Promise<{ hits: { text: string }[]; fused: { text: string }[]; method: string }> };
  const plansFile = arg("plans");
  const plans: Record<string, Plan> = plansFile && existsSync(plansFile) ? JSON.parse(readFileSync(plansFile, "utf8")) as Record<string, Plan> : {};
  const only = arg("only")?.split(",").map(Number);
  const cross = arg("cross") !== "off";
  // --headers: the passages in scope embedded with their headers, held in memory.
  type Mem = { id: number; doc_id: number; text: string; title: string; section: string; v: number[] };
  let mem: Mem[] | null = null;
  if (process.argv.includes("--headers")) {
    const info = new Map(((await db.execute(sql`select id, title, source, meta->>'ticker' as ticker, meta->>'form' as form, meta->>'period' as period, meta->>'filed' as filed, meta->>'company' as company from edge_docs where status = 'ready'`)).rows as { id: number; title: string; source: string; ticker: string | null; form: string | null; period: string | null; filed: string | null; company: string | null }[]).map((d) => [d.id, d]));
    const chunks = (await db.execute(sql`select id, doc_id, section, speaker, text from edge_chunks where embedding is not null order by id`)).rows as { id: number; doc_id: number; section: string; speaker: string; text: string }[];
    // --header-kind doc: the document's label only, without the section and speaker.
    const docOnly = arg("header-kind") === "doc";
    const inputs = chunks.map((c) => { const d = info.get(c.doc_id); const di = d ? { title: d.title, source: d.source, meta: d } : null; return `${di ? (docOnly ? docLabel(di) : passageHeader(di, c)) : ""}\n${c.text}`; });
    const vectors = await embedTexts(inputs, "edge-eval");
    mem = chunks.map((c, i) => ({ id: Number(c.id), doc_id: c.doc_id, text: c.text, title: info.get(c.doc_id)?.title ?? "", section: c.section, v: vectors[i] }));
    console.log(`re-embedded ${mem.length} passages with their headers, e.g. "${inputs[0].split("\n")[0]}"`);
  }
  const cosine = (a: number[], b: number[]) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / Math.sqrt(na * nb || 1); };
  const rows: { n: number; q: string; fused5: number; fused12: number; fused30: number; final5: number; final12: number; rr: number; finalCount: number; ms: number; method: string }[] = [];
  const t0 = Date.now();
  for (const [i, c] of CASES.entries()) {
    if (only && !only.includes(i + 1)) continue;
    const started = Date.now();
    const plan = plans[c.q] ?? (plans[c.q] = await mod.planQueries(c.q));
    const ids = scopes[c.scope];
    let fused: { text: string }[], hits: { text: string }[], method = "search + model selection";
    if (mem) {
      // The keyword lists from the database, the meaning lists from the re-embedded passages, fused as search() fuses them.
      const words: number[][] = [];
      const found = await mod.search(ids, plan.queries, plan.keywords, 50, { onList: (kind, list) => { if (kind === "words") words.push(list); } });
      const pool = mem.filter((m) => ids.includes(m.doc_id));
      const meaning = (await embedTexts(plan.queries, "edge-eval")).map((q) => pool.map((m) => ({ id: m.id, s: cosine(q, m.v) })).sort((a, b) => b.s - a.s).slice(0, 50).map((x) => x.id));
      const byId = new Map<number, { text: string }>([...pool.map((m) => [m.id, m] as const), ...found.map((h) => [h.chunkId, h] as const)]);
      fused = mod.fuse([...meaning, ...words]).slice(0, 100).map((x) => byId.get(x.id)!).filter(Boolean);
      hits = await mod.rerank(c.q, fused as Parameters<typeof mod.rerank>[1], 12);
      method = "meaning search over passages embedded with headers (in memory), keyword search, model selection";
    } else if (mod.retrieve) ({ fused, hits, method } = await mod.retrieve(c.q, ids, plan, { cross }));
    else { fused = await mod.search(ids, plan.queries, plan.keywords); hits = await mod.rerank(c.q, fused as Parameters<typeof mod.rerank>[1], 12); }
    const f = fused.map((h) => h.text), h = hits.map((x) => x.text);
    const row = { n: i + 1, q: c.q, fused5: recallAt(f, c.needles, 5), fused12: recallAt(f, c.needles, 12), fused30: recallAt(f, c.needles, 30), final5: recallAt(h, c.needles, 5), final12: recallAt(h, c.needles, 12), rr: reciprocalRank(f, c.needles), finalCount: h.length, ms: Date.now() - started, method };
    rows.push(row);
    console.log(`${String(row.n).padStart(2)}  fused ${row.fused5.toFixed(2)}/${row.fused12.toFixed(2)}  final ${row.final5.toFixed(2)}/${row.final12.toFixed(2)}  rr ${row.rr.toFixed(2)}  (${row.finalCount} kept, ${(row.ms / 1000).toFixed(1)}s)  ${c.q.slice(0, 70)}`);
  }
  if (plansFile) writeFileSync(plansFile, JSON.stringify(plans, null, 1));
  const avg = (k: "fused5" | "fused12" | "fused30" | "final5" | "final12" | "rr") => rows.reduce((s, x) => s + x[k], 0) / Math.max(1, rows.length);
  console.log(`\n${rows.length} questions in ${Math.round((Date.now() - t0) / 1000)}s · method: ${rows[0]?.method ?? ""}`);
  console.log(`fused candidates   recall@5 ${avg("fused5").toFixed(3)}   recall@12 ${avg("fused12").toFixed(3)}   recall@30 ${avg("fused30").toFixed(3)}   MRR ${avg("rr").toFixed(3)}`);
  console.log(`final selection    recall@5 ${avg("final5").toFixed(3)}   recall@12 ${avg("final12").toFixed(3)}`);
  const out = arg("json");
  if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
}

if (process.argv[1]?.endsWith("eval-docs.ts")) main().catch((e) => { console.error("failed:", e); process.exit(1); });
