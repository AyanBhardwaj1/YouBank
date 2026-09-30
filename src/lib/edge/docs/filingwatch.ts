/**
 * Documents in the feed. When a company someone watches files a new 10-K or 10-Q, Edge compares its
 * risk factors with the previous one of the kind and posts what was added, dropped and reworded, with
 * the filing's own words. Each filing is looked at once for everyone watching the company.
 */
import { and, eq, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getSubmissions, listFilings } from "@/lib/edgar/submissions";
import { resolveTicker } from "@/lib/edgar/tickers";
import { logError } from "@/lib/errors";
import { record } from "../provenance";
import { BETA_ON } from "../watches";
import { changeRadar, type Radar } from "./changes";

const DAY = 86_400_000;
/** Filings newer than this are news to look at; older ones are history the radar can show on request. */
const FRESH_DAYS = 14;

/** How much a filing's section moved, 0 to 1: twenty added or dropped paragraphs is a lot. Pure. */
export function filingMagnitude(c: Radar["counts"]): number {
  return Math.min(1, (c.added + c.removed + 0.5 * c.changed) / 20);
}

/** The card's headline for a filing's changes. Pure. */
export function filingTitle(name: string, form: string, c: Radar["counts"]): string {
  const bits = [c.added && `${c.added} risk factor${c.added === 1 ? "" : "s"} added`, c.removed && `${c.removed} dropped`, c.changed && `${c.changed} reworded`].filter(Boolean);
  return `${name}'s new ${form}: ${bits.join(", ") || "risk factors unchanged"}`;
}

/** Look for new 10-Ks and 10-Qs of watched companies; returns the new cards' ids. */
export async function scanFilings(deadline: number): Promise<number[]> {
  const db = requireDb();
  const rows = await db.selectDistinct({ ticker: sql<string>`${schema.edgeWatches.target}->>'ticker'` }).from(schema.edgeWatches)
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.edgeWatches.userId))
    .where(and(BETA_ON, eq(schema.edgeWatches.kind, "company"))).limit(300);
  const found: number[] = [];
  for (const { ticker } of rows) {
    if (!ticker || Date.now() > deadline - 30_000) break;
    try {
      const t = await resolveTicker(ticker);
      if (!t) continue;
      const latest = listFilings(await getSubmissions(String(t.cik)), ["10-K", "10-Q"], 6).find((f) => f.form === "10-K" || f.form === "10-Q");
      if (!latest || Date.now() - Date.parse(latest.filed) > FRESH_DAYS * DAY) continue;
      const key = `filing:${latest.accession}:risk`;
      if (await cacheGet(`edge:quiet:${key}`)) continue;
      const [seen] = await db.select({ id: schema.edgeDetections.id }).from(schema.edgeDetections).where(eq(schema.edgeDetections.key, key));
      if (seen) continue;
      const form = latest.form as "10-K" | "10-Q";
      const r = await changeRadar(ticker, form, "risk");
      const moved = r.counts.added + r.counts.removed + r.counts.changed;
      if (!r.current || !r.prior || !moved) { await cacheSet(`edge:quiet:${key}`, "1", 60 * DAY); continue; }
      const samples = r.rows.filter((x) => x.status !== "changed" || x.similarity < 0.7).slice(0, 4).map((x) => ({ status: x.status, text: x.text.slice(0, 700), ...(x.before ? { before: x.before.slice(0, 500) } : {}) }));
      const [row] = await db.insert(schema.edgeDetections).values({
        key, kind: "filing_change", module: "documents", title: filingTitle(r.name, form, r.counts).slice(0, 200),
        summary: (r.summary.join(" ") || `${r.counts.added} paragraphs are new and ${r.counts.removed} were removed from the risk factors since the ${form} filed ${r.prior.filed}.`).slice(0, 1200),
        why: `Edge compared Item 1A (Risk factors) of the ${form} filed ${r.current.filed} with the one filed ${r.prior.filed}, paragraph by paragraph: a paragraph with no close match (three-word sequences, under 30% shared) is new or dropped, a partial match is reworded. The summary quotes the filing and adds nothing beyond it.`,
        confidence: 0.9, magnitude: filingMagnitude(r.counts), tickers: [ticker], bbox: null,
        visual: { type: "filing_change", ticker, name: r.name, form, section: "risk", current: r.current, prior: r.prior, counts: r.counts, summary: r.summary.slice(0, 4), samples },
        observedAt: new Date(r.current.filed),
      }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
      if (!row) continue;
      const now = new Date();
      await record(`detection:${row.id}`, [
        { sourceName: `SEC EDGAR: ${r.name} ${form} filed ${r.current.filed}`, sourceUrl: r.current.url, license: "Public filing (SEC EDGAR)", method: "Item 1A paragraphs compared with the previous filing", modelVersion: "", retrievedAt: now },
        { sourceName: `SEC EDGAR: ${r.name} ${form} filed ${r.prior.filed}`, sourceUrl: r.prior.url, license: "Public filing (SEC EDGAR)", method: "the earlier version", modelVersion: "", retrievedAt: now },
        ...(r.summary.length ? [{ sourceName: "Summary of the changes", sourceUrl: "", license: "YouBank", method: "a small language model, quoting the filing", modelVersion: "gpt-5.6-luna", retrievedAt: now }] : []),
      ]);
      found.push(row.id);
    } catch (e) {
      logError(e, { where: "edge-scan-filings" });
    }
  }
  return found;
}
