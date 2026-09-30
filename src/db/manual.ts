import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "./index";
import type { CompanyData } from "@/lib/types";

/**
 * Manual NTM estimates are private to the person who entered them: one analyst's number never
 * replaces another customer's, and their notes never reach anyone else's AI context.
 */
export type ManualInput = { ticker: string; field: string; value: number | null; note: string; enteredBy: string; enteredAt: string };

/** The note is shown beside the figure and read by the person's AI; a sentence or two is plenty. */
export const MAX_NOTE_CHARS = 500;

/** A person's latest manual input per (ticker, field). No person, no inputs. */
export async function latestManualInputs(tickers: string[], userId: string | null): Promise<ManualInput[]> {
  if (!db || tickers.length === 0 || !userId) return [];
  const rows = await db.select().from(schema.manualInputs)
    .where(and(eq(schema.manualInputs.userId, userId), inArray(schema.manualInputs.ticker, [...new Set(tickers.map((t) => t.toUpperCase()))])))
    .orderBy(desc(schema.manualInputs.enteredAt));
  const seen = new Set<string>();
  const out: ManualInput[] = [];
  for (const r of rows) {
    const k = `${r.ticker}|${r.field}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ticker: r.ticker, field: r.field, value: r.value, note: r.note, enteredBy: r.enteredBy, enteredAt: r.enteredAt.toISOString() });
  }
  return out;
}

/** Merge a person's manual NTM estimates into company records (mutates and returns the same objects), in one query. */
export async function applyManualInputs(companies: CompanyData[], userId: string | null): Promise<CompanyData[]> {
  if (!db || companies.length === 0 || !userId) return companies;
  let inputs: ManualInput[] = [];
  try { inputs = await latestManualInputs(companies.map((c) => c.ticker), userId); } catch { return companies; }
  for (const c of companies) {
    const mine = inputs.filter((i) => i.ticker === c.ticker && i.value !== null);
    const rev = mine.find((i) => i.field === "ntm_revenue");
    const ebitda = mine.find((i) => i.field === "ntm_ebitda");
    if (rev || ebitda) {
      c.estimates = { ntmRevenue: rev?.value ?? null, ntmEbitda: ebitda?.value ?? null, source: "manual", enteredBy: (rev ?? ebitda)!.enteredBy, enteredAt: (rev ?? ebitda)!.enteredAt };
      c.sources.notes.push(`NTM estimates entered manually by ${c.estimates.enteredBy} on ${c.estimates.enteredAt?.slice(0, 10)}${rev?.note ? ` (${rev.note})` : ""}.`);
    }
  }
  return companies;
}
