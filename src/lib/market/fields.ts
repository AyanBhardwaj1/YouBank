/**
 * Field-level fallthrough (docs/data-layer.md): when the source that answered a dataset leaves a field
 * empty (SEC has no price, no estimates), the person's next eligible source that can fill that field is
 * asked for it, and the field says where it came from. When no source has it, the field stays empty
 * (null, shown as "—") with the reason, never a silent zero. Pure, except for nothing: the registry asks
 * the sources and calls `mergeFields` with their answers.
 */
import type { DatasetName, Licence } from "./sources-meta";

/** Where one field came from, or why it is empty. */
export type FieldSource = { id: string; label: string; licence?: Licence; yourKey?: boolean };
export type FieldProvenance = FieldSource | { reason: string };

/** The fields a dataset's answer may be filled field by field, and why each would be empty. */
export type FieldSpec = { fields: readonly string[]; reasons: Readonly<Record<string, string>> };

const PRICE_REASON = "Needs a price source: no licensed free source has live prices. Add a data key in Settings → Data sources.";
const ESTIMATE_REASON = "Estimates need a licensed source: YouBank's FMP plan or your own FMP, Finnhub or Alpha Vantage key.";

export const FIELD_SPECS: Partial<Record<DatasetName, FieldSpec>> = {
  profile: {
    fields: ["name", "price", "changePct", "marketCap", "low52", "high52", "exchange", "sector", "industry", "description", "website"],
    reasons: {
      price: PRICE_REASON, changePct: PRICE_REASON, marketCap: "Needs a price (market cap is price × shares).", low52: PRICE_REASON, high52: PRICE_REASON,
      description: "Not in the answering source's data.", website: "Not in the answering source's data.", sector: "Not in the answering source's data.", industry: "Not in the answering source's data.",
    },
  },
  earnings: {
    fields: ["quarters", "next", "annual"],
    reasons: { next: `The next report date and its estimates: ${ESTIMATE_REASON}`, annual: ESTIMATE_REASON, quarters: "No reported quarters in the answering sources." },
  },
  analysts: {
    fields: ["target", "counts", "firms"],
    reasons: { target: "No licensed free source has price targets.", counts: "No licensed free source has rating counts.", firms: "No rating changes in the answering sources." },
  },
};

/** Empty: missing, null, blank text or an empty list. Zero is a value, not empty. Pure. */
export const isEmptyValue = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);

/** The spec's fields that `data` leaves empty. Pure. */
export function missingFields(data: unknown, spec: FieldSpec): string[] {
  if (!data || typeof data !== "object") return [...spec.fields];
  const d = data as Record<string, unknown>;
  return spec.fields.filter((f) => isEmptyValue(d[f]));
}

export type Filler<R> = { data: R; source: FieldSource; reasons?: Record<string, string> };

/**
 * The first answer with its empty fields filled from the later answers, in order (each field from the
 * first later answer that has it), and the provenance of every field that was filled or is still empty.
 * Fields the first answer had are its own and are not listed. Pure.
 */
export function mergeFields<R>(first: Filler<R>, later: Filler<R>[], spec: FieldSpec): { data: R; fields: Record<string, FieldProvenance> } {
  const data = { ...(first.data as Record<string, unknown>) };
  const fields: Record<string, FieldProvenance> = {};
  for (const f of missingFields(first.data, spec)) {
    const from = later.find((l) => !isEmptyValue((l.data as Record<string, unknown> | null)?.[f]));
    if (from) {
      data[f] = (from.data as Record<string, unknown>)[f];
      fields[f] = from.source;
    } else {
      // Explicitly null, never left as an empty string or 0 that would read as a value.
      if (!Array.isArray(data[f])) data[f] = null;
      fields[f] = { reason: first.reasons?.[f] ?? spec.reasons[f] ?? "No source had this." };
    }
  }
  for (const [f, reason] of Object.entries(first.reasons ?? {})) if (!fields[f] && !spec.fields.includes(f)) fields[f] = { reason };
  return { data: data as R, fields };
}

/** Whether a field's provenance is a reason (empty), not a source. Pure. */
export const isReason = (p: FieldProvenance): p is { reason: string } => "reason" in p;
