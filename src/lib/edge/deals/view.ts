/**
 * How a deal is shown (E1): its fields grouped by family with their values in words, the sale process as a
 * timeline (first contact, NDAs, indications of interest, final bids, signing, closing), and the fairness
 * opinion's ranges for the football field. Shared by the deal page, the Terminal, exports and the canvas.
 * Pure, safe on the client.
 */
import { FAMILY_LABEL, FIELD, type Family } from "./fields";
import { fmtMoney } from "./parse";

export type ShownField = { id?: number; field: string; label: string; family: Family; value: unknown; text: string; quote: string; docUrl: string; section: string; confidence: number; calibrated: boolean; note: string; checks: { name: string; ok: boolean | null; detail: string }[]; method: string; modelVersion: string; createdAt?: string };
export type FieldLike = { id?: number; field: string; value: unknown; quote: string; docUrl: string; section: string; confidence: number; checks: Record<string, unknown>; method: string; modelVersion: string; createdAt?: Date | string };

/** A field's value in words: "$1.2bn", "$56.50/share", "31.4%", "45 days", "2024-03-03", "Goldman Sachs; Lazard". Pure. */
export function valueText(field: string, v: unknown): string {
  const kind = FIELD[field]?.kind;
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.join("; ");
  if (typeof v === "object") { const r = v as { low?: number; high?: number; unit?: string }; return r.low !== undefined && r.high !== undefined ? `${r.unit === "usd_mm" ? fmtMoney({ value: r.low, unit: "usd_mm" }) : `$${r.low.toFixed(2)}`} to ${r.unit === "usd_mm" ? fmtMoney({ value: r.high, unit: "usd_mm" }) : `$${r.high.toFixed(2)}`}` : JSON.stringify(v); }
  if (typeof v === "number") {
    if (kind === "money_mm") return fmtMoney({ value: v, unit: "usd_mm" });
    if (kind === "per_share") return fmtMoney({ value: v, unit: "usd_per_share" });
    if (kind === "percent") return `${(v * 100).toFixed(1)}%`;
    if (kind === "days") return `${v} days`;
    if (kind === "ratio") return `${v} shares`;
    return v.toLocaleString("en-US");
  }
  return String(v);
}

/** Stored field rows as shown. Pure. */
export function shownFields(rows: FieldLike[]): ShownField[] {
  return rows.filter((r) => FIELD[r.field]).map((r) => {
    const c = r.checks as { list?: ShownField["checks"]; calibrated?: boolean; note?: string };
    return {
      id: r.id, field: r.field, label: FIELD[r.field].label, family: FIELD[r.field].family, value: r.value, text: valueText(r.field, r.value), quote: r.quote, docUrl: r.docUrl, section: r.section,
      confidence: r.confidence, calibrated: !!c.calibrated, note: c.note ?? "", checks: c.list ?? [], method: r.method, modelVersion: r.modelVersion,
      createdAt: r.createdAt ? (typeof r.createdAt === "string" ? r.createdAt : r.createdAt.toISOString()) : undefined,
    };
  });
}

/** Fields grouped by family, in the registry's order. Pure. */
export function byFamily(fields: ShownField[]): { family: Family; label: string; fields: ShownField[] }[] {
  const order = Object.keys(FAMILY_LABEL) as Family[];
  return order.map((family) => ({ family, label: FAMILY_LABEL[family], fields: fields.filter((f) => f.family === family) })).filter((g) => g.fields.length);
}

export type TimelineStep = { key: string; label: string; date?: string; count?: number };

/** The sale process in order, with the dates and counts the document states. Pure. */
export function timeline(fields: ShownField[], deal: { announcedAt?: string | null; signedAt?: string | null; closedAt?: string | null }): TimelineStep[] {
  const v = (f: string) => fields.find((x) => x.field === f)?.value;
  const steps: TimelineStep[] = [
    { key: "first_contact", label: "First contact", date: typeof v("first_contact") === "string" ? (v("first_contact") as string) : undefined },
    { key: "parties_contacted", label: "Parties contacted", count: typeof v("parties_contacted") === "number" ? (v("parties_contacted") as number) : undefined },
    { key: "ndas", label: "NDAs", count: typeof v("ndas") === "number" ? (v("ndas") as number) : undefined },
    { key: "iois", label: "Indications of interest", count: typeof v("iois") === "number" ? (v("iois") as number) : undefined },
    { key: "final_bids", label: "Final bids", count: typeof v("final_bids") === "number" ? (v("final_bids") as number) : undefined },
    { key: "sign", label: "Signed", date: (typeof v("sign_date") === "string" ? (v("sign_date") as string) : undefined) ?? deal.signedAt ?? undefined },
    { key: "close", label: "Closed", date: deal.closedAt ?? undefined },
  ];
  return steps.filter((s) => s.date || s.count !== undefined);
}

export type Bar = { label: string; low: number; high: number };

/** The fairness opinion's per-share ranges for the football field, with the offer price beside them. Pure. */
export function footballField(fields: ShownField[]): { bars: Bar[]; offer: number | null } {
  const bars: Bar[] = [];
  for (const [f, label] of [["fairness_dcf", "Discounted cash flow"], ["fairness_comps", "Selected companies"], ["fairness_precedents", "Selected transactions"]] as const) {
    const r = fields.find((x) => x.field === f)?.value as { low?: number; high?: number; unit?: string } | undefined;
    if (r && typeof r.low === "number" && typeof r.high === "number" && r.unit === "usd_per_share") bars.push({ label, low: r.low, high: r.high });
  }
  const offer = fields.find((x) => x.field === "per_share")?.value;
  return { bars, offer: typeof offer === "number" ? offer : null };
}

/** A deal's export columns, quotes included, for CSV and the canvas table. Pure. */
export const EXPORT_COLUMNS = ["deal_id", "announced", "target", "target_ticker", "buyer", "buyer_type", "sic", "consideration", "equity_usd_mm", "ev_usd_mm", "ev_ebitda", "ev_revenue", "premium_unaffected", "termination_fee_usd_mm", "termination_fee_quote", "go_shop_days", "parties_contacted", "final_bids", "source"] as const;

/** The plain-language confidence line beside a field: "checked · 97% · calibrated on 150 deals" or the prior. Pure. */
export function confidenceLine(f: Pick<ShownField, "confidence" | "calibrated" | "note" | "checks">): string {
  const failed = f.checks.filter((c) => c.ok === false);
  const head = failed.length ? `conflict: ${failed.map((c) => c.detail).join("; ")}` : f.checks.some((c) => c.ok === true && !["quote", "reparse", "items"].includes(c.name)) ? "cross-checked" : "quoted and re-read";
  return `${head} · ${Math.round(f.confidence * 100)}% · ${f.note}`;
}
