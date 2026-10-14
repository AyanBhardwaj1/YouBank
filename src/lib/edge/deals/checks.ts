/**
 * The deterministic checks every extracted deal term passes before it is stored (E1, steps 3 and 4):
 * - the quote must appear in the section it came from (docs/text quoteFound);
 * - a numeric value is read again from the quote by a number parser (deals/parse.ts), and that reading is
 *   what is stored; a model value the quote does not bear out is dropped, and one that disagrees with the
 *   quote is noted;
 * - units are USD millions (USD per share for prices);
 * - across fields: enterprise value against equity value plus net debt from XBRL (within 5%), the stated
 *   premium against the premium computed from prices (within 2 points), the termination fee as a share of
 *   equity value (a usual 1% to 6%), the price per share times shares outstanding against equity value
 *   (within 10%).
 * A failed check lowers the field's confidence and names the conflict. Pure.
 */
import { normText, quoteFound } from "../docs/text";
import { FIELD, isNumeric, type ValueKind } from "./fields";
import { considerationOf, moneyAll, parseCount, parseDate, parseDays, parseMoney, parsePercent, parseRange, parseRatio, perShareOf } from "./parse";

export type FieldValue = number | string | string[] | { low: number; high: number; unit: string } | null;
export type CheckResult = { name: string; ok: boolean | null; detail: string };
export type Raw = { field: string; value: string; quote: string };
export type Checked = { field: string; value: FieldValue; quote: string; checks: CheckResult[]; dropped?: string };

/** A value read from a quote by the field's kind; null when the quote does not state one. Pure. */
export function readValue(kind: ValueKind, text: string, options?: string[]): FieldValue {
  switch (kind) {
    case "money_mm": { const m = moneyAll(text).find((x) => x.unit === "usd_mm"); return m ? Math.round(m.value * 1000) / 1000 : null; }
    case "per_share": return perShareOf(text);
    case "percent": return parsePercent(text);
    case "days": return parseDays(text);
    case "count": return parseCount(text);
    case "ratio": return parseRatio(text);
    case "date": return parseDate(text);
    case "range": { const r = parseRange(text); return r ? { low: r.low, high: r.high, unit: r.unit } : null; }
    case "enum": {
      if (options?.includes("cash")) return considerationOf(text);
      return null;
    }
    default: return null;
  }
}

const close = (a: number, b: number, rel: number) => Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1e-9);

/** The list items a quote and its section bear out (each item's words must appear in the section). Pure. */
export function listItems(value: string, section: string): string[] {
  const items = value.split(/;|\n|,(?![^()]*\))| and (?=[A-Z])/).map((s) => s.trim().replace(/^and\s+/i, "")).filter((s) => s.length >= 3 && s.length <= 120);
  const hay = normText(section);
  return [...new Set(items)].filter((s) => { const n = normText(s); return n.length >= 3 && hay.includes(n); }).slice(0, 25);
}

/**
 * One field's own checks: the quote is in the section; a numeric value is re-read from the quote (and the
 * model's reading compared); text, enum and list values are kept only when the section bears them out.
 * Returns the value to store, or a dropped reason. Pure.
 */
export function checkField(raw: Raw, section: string): Checked {
  const def = FIELD[raw.field];
  const checks: CheckResult[] = [];
  if (!def) return { field: raw.field, value: null, quote: raw.quote, checks, dropped: "unknown field" };
  const quote = raw.quote.trim();
  const found = quote.length >= 8 && quoteFound(quote, section);
  checks.push({ name: "quote", ok: found, detail: found ? "found in the section" : "not found in the section" });
  if (!found) return { field: raw.field, value: null, quote, checks, dropped: "the quote is not in the document" };
  if (isNumeric(def.kind)) {
    const fromQuote = readValue(def.kind, quote, def.options);
    if (fromQuote === null) return { field: raw.field, value: null, quote, checks, dropped: "no number in the quote" };
    const fromModel = readValue(def.kind, raw.value, def.options) ?? (def.kind === "money_mm" ? (parseMoney(`$${raw.value}`)?.value ?? null) : null);
    const agree = fromModel === null ? null : typeof fromQuote === "number" && typeof fromModel === "number" ? close(fromQuote, fromModel, 0.01) : JSON.stringify(fromQuote) === JSON.stringify(fromModel);
    checks.push({ name: "reparse", ok: true, detail: "value re-read from the quote" });
    checks.push({ name: "model", ok: agree, detail: agree === null ? "the model gave no comparable value" : agree ? "the model's value matches the quote" : `the model said ${raw.value}; the quote says otherwise, and the quote's value is kept` });
    return { field: raw.field, value: fromQuote, quote, checks };
  }
  if (def.kind === "enum") {
    const v = raw.value.trim().toLowerCase();
    if (!def.options?.includes(v)) return { field: raw.field, value: null, quote, checks, dropped: "not one of the allowed values" };
    const fromQuote = readValue("enum", quote, def.options);
    if (fromQuote !== null) checks.push({ name: "reparse", ok: fromQuote === v, detail: fromQuote === v ? "the quote's words agree" : `the quote reads as ${fromQuote}` });
    return { field: raw.field, value: fromQuote ?? v, quote, checks };
  }
  if (def.kind === "list") {
    const items = listItems(raw.value, section);
    if (!items.length) return { field: raw.field, value: null, quote, checks, dropped: "no item appears in the document" };
    checks.push({ name: "items", ok: true, detail: `${items.length} item${items.length === 1 ? "" : "s"} found in the document` });
    return { field: raw.field, value: items, quote, checks };
  }
  const v = raw.value.trim().slice(0, 300);
  if (!v) return { field: raw.field, value: null, quote, checks, dropped: "empty" };
  return { field: raw.field, value: v, quote, checks };
}

export type Facts = { netDebtMm?: number | null; sharesMm?: number | null; computedPremium?: number | null };

/**
 * The checks across fields, added to each field they touch: enterprise value against equity plus net debt
 * (5%), stated against computed premium (2 points), termination fee against equity value (1% to 6%), price
 * per share times shares against equity value (10%). Pure.
 */
export function crossChecks(fields: Checked[], facts: Facts): Checked[] {
  const val = (f: string) => { const x = fields.find((c) => c.field === f && typeof c.value === "number"); return x ? (x.value as number) : null; };
  const add = (f: string, r: CheckResult) => { const x = fields.find((c) => c.field === f); if (x) x.checks.push(r); };
  const eq = val("equity_value"), ev = val("enterprise_value"), prem = val("premium_unaffected"), fee = val("termination_fee"), rfee = val("reverse_termination_fee"), ps = val("per_share");
  if (ev !== null && eq !== null && facts.netDebtMm !== null && facts.netDebtMm !== undefined) {
    const implied = eq + facts.netDebtMm, ok = close(ev, implied, 0.05);
    add("enterprise_value", { name: "ev_bridge", ok, detail: ok ? `matches equity value plus net debt from XBRL (${Math.round(implied)}m) within 5%` : `equity value plus net debt from XBRL is ${Math.round(implied)}m, ${Math.round(Math.abs(ev / implied - 1) * 100)}% away` });
  }
  if (prem !== null && facts.computedPremium !== null && facts.computedPremium !== undefined) {
    const ok = Math.abs(prem - facts.computedPremium) <= 0.02;
    add("premium_unaffected", { name: "premium_prices", ok, detail: ok ? `matches the premium computed from prices (${(facts.computedPremium * 100).toFixed(1)}%) within 2 points` : `prices give ${(facts.computedPremium * 100).toFixed(1)}%` });
  }
  for (const [f, v] of [["termination_fee", fee], ["reverse_termination_fee", rfee]] as const) {
    if (v === null || eq === null || eq <= 0) continue;
    const share = v / eq, ok = share >= 0.01 && share <= (f === "termination_fee" ? 0.06 : 0.1);
    add(f, { name: "fee_share", ok, detail: `${(share * 100).toFixed(1)}% of equity value${ok ? "" : f === "termination_fee" ? ", outside the usual 1% to 6%" : ", outside the usual 1% to 10%"}` });
  }
  if (ps !== null && eq !== null && facts.sharesMm) {
    const implied = ps * facts.sharesMm, ok = close(eq, implied, 0.1);
    add("equity_value", { name: "per_share_x_shares", ok, detail: ok ? `matches price per share times shares outstanding (${Math.round(implied)}m) within 10%` : `price per share times shares outstanding is ${Math.round(implied)}m` });
  }
  return fields;
}

/** A field's fee as a share of equity value, for the deal page ("3.1% of equity value"). Pure. */
export function feeShare(fee: number | null, equity: number | null): number | null {
  return fee !== null && equity !== null && equity > 0 ? fee / equity : null;
}
