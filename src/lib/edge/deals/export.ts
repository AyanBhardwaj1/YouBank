/**
 * Precedents as rows (E1): the request's filters, and deals as CSV with each headline term's quote and
 * source document, so an export carries its own audit trail.
 */
import { and, eq, inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { DealFilters, DealView, FieldRow } from "./store";
import { EXPORT_COLUMNS } from "./view";

const num = (v: string | null) => (v !== null && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** The filters a request asks for (the store validates each). Pure. */
export function filtersOf(q: URLSearchParams): DealFilters {
  return {
    q: q.get("q")?.slice(0, 80) || undefined, sic: q.get("sic") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined,
    buyer: q.get("buyer") ?? undefined, consideration: q.get("consideration") ?? undefined, min: num(q.get("min")), max: num(q.get("max")), read: q.get("read") === "1",
  };
}

/** Active fields for many deals, by deal. */
export async function activeFieldsMany(ids: number[]): Promise<Map<number, FieldRow[]>> {
  const out = new Map<number, FieldRow[]>();
  if (!ids.length) return out;
  const rows = await requireDb().select().from(schema.edgeDealFields).where(and(inArray(schema.edgeDealFields.dealId, ids), eq(schema.edgeDealFields.active, true)));
  for (const r of rows) out.set(r.dealId, [...(out.get(r.dealId) ?? []), r]);
  return out;
}

const cell = (v: unknown) => { const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join("; ") : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Deals as CSV, quotes included. Pure. */
export function dealCsv(deals: DealView[], fields: Map<number, Pick<FieldRow, "field" | "value" | "quote">[]>): string {
  const lines = deals.map((d) => {
    const f = (name: string) => fields.get(d.id)?.find((x) => x.field === name);
    const src = d.sources.find((s) => s.role === "proxy" || s.role === "tender") ?? d.sources[0];
    return [d.id, d.announcedAt ?? "", d.targetName, d.targetTicker, d.acquirerName, d.buyerType, d.sic, d.consideration, d.equityUsdMm, d.evUsdMm, d.evEbitda, d.evRevenue, d.premiumUnaffected,
      f("termination_fee")?.value ?? "", f("termination_fee")?.quote ?? "", f("go_shop_days")?.value ?? "", f("parties_contacted")?.value ?? "", f("final_bids")?.value ?? "", src?.url ?? ""].map(cell).join(",");
  });
  return [EXPORT_COLUMNS.join(","), ...lines].join("\n");
}
