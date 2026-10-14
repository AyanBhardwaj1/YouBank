/**
 * Call Desk's peer comparison (E5, premium edge.calls-peers): up to six companies' latest read calls side by
 * side (evasion rate with its interval, what each avoided) and their promises' hit rates, then one short
 * comparison written by the small model from those numbers only. The model call is recorded in the AI usage
 * ledger, so it counts against the person's AI allowance. Companies without a read call say so.
 */
import { desc, sql, and } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { logError } from "@/lib/errors";
import { canRead } from "../docs/store";
import { small } from "../models";
import { commitmentsFor, type CallSummary } from "./store";

export type PeerRow = { ticker: string; name: string; docId: number | null; said: string; rate: { mean: number; low: number; high: number } | null; avoided: string[]; hitRate: string; hits: number; settled: number };

export async function comparePeers(userId: string, tickers: string[]): Promise<{ rows: PeerRow[]; comparison: string; model: string }> {
  const db = requireDb();
  const rows: PeerRow[] = [];
  for (const t of tickers.slice(0, 6)) {
    const docs = await db.select({ id: schema.edgeDocs.id, ownerId: schema.edgeDocs.ownerId, teamId: schema.edgeDocs.teamId, desk: sql<{ summary?: CallSummary; said?: string; name?: string; avoided?: { topic: string }[] } | null>`${schema.edgeDocs.meta}->'callDesk'` })
      .from(schema.edgeDocs).where(and(sql`${schema.edgeDocs.meta}->>'ticker' = ${t}`, sql`${schema.edgeDocs.meta}->'callDesk'->'summary' is not null`)).orderBy(desc(sql`${schema.edgeDocs.meta}->'callDesk'->>'said'`)).limit(5);
    let pick: (typeof docs)[number] | null = null;
    for (const d of docs) if (await canRead(userId, d)) { pick = d; break; }
    const promises = await commitmentsFor(userId, t).catch(() => null);
    rows.push({
      ticker: t, name: promises?.name ?? pick?.desk?.name ?? t, docId: pick?.id ?? null, said: pick?.desk?.said ?? "",
      rate: pick?.desk?.summary ? { mean: pick.desk.summary.mean, low: pick.desk.summary.low, high: pick.desk.summary.high } : null,
      avoided: (pick?.desk?.avoided ?? []).slice(0, 3).map((a) => a.topic), hitRate: promises?.hitRate.text ?? "No promises read.", hits: promises?.hitRate.hits ?? 0, settled: promises?.hitRate.n ?? 0,
    });
  }
  const facts = rows.map((r) => `${r.ticker} (${r.name}): ${r.rate ? `evasive share ${Math.round(r.rate.mean * 100)}% (80% interval ${Math.round(r.rate.low * 100)}-${Math.round(r.rate.high * 100)}%) on the call of ${r.said}; most avoided: ${r.avoided.join(", ") || "none"}` : "no call read yet"}; promises: ${r.hitRate}`).join("\n");
  try {
    const out = await structured(z.object({ comparison: z.string().describe("three to five sentences") }), "edge-calls-peers",
      "You compare companies' earnings-call candour from the numbers given, and nothing else. Say which companies answered analysts most and least directly, whether the intervals overlap (if they do, say the difference is not clear), and how their promises have turned out. Never say anyone lied or was dishonest; say an answer did not address the question asked. No advice.",
      facts, { override: small(), maxTokens: 800, timeoutMs: 60_000 });
    return { rows, comparison: out.data.comparison, model: out.model };
  } catch (e) {
    logError(e, { where: "edge-calls-peers" });
    return { rows, comparison: "The written comparison could not be made just now; the table above is complete.", model: "" };
  }
}
