/**
 * Q5: brokers' own execution disclosures, parsed. Pure.
 *
 * - Rule 606(a)(1): each broker's quarterly order-routing report, published as XML under the SEC's 606
 *   technical specification: per month, for S&P 500 stocks, other stocks and options, the share of non-directed
 *   orders by type and, per venue, the net payment for order flow received (in dollars and in cents per hundred
 *   shares) by order type.
 * - Rule 605: market centers' (and, from 1 August 2026, large brokers') monthly execution quality, as
 *   pipe-delimited rows: order type and size buckets, covered orders and shares, average effective and realized
 *   spreads, and shares price-improved with the average improvement per share. This parser reads the original
 *   (pre-2024 amendment) layout; the amended layout adds columns and a summary report and needs its own mapping
 *   once a real file is saved (the sandbox could not download one).
 * The fixtures (scripts/fixtures/quant/rule606.xml, rule605.txt) are constructed from the specifications, and
 * labelled as such.
 */
import { XMLParser } from "fast-xml-parser";

export type VenueRow = { name: string; mic: string; orderPct: number | null; pfof: Record<"market" | "marketableLimit" | "nonMarketableLimit" | "other", { usd: number | null; centsPer100: number | null }> };
export type CategoryMonth = { category: "sp500" | "otherStocks" | "options"; month: string; marketPct: number | null; venues: VenueRow[] };
export type Report606 = { broker: string; year: number | null; quarter: number | null; months: CategoryMonth[]; totals: { category: CategoryMonth["category"]; pfofUsd: number; marketOrderCentsPer100: number | null }[] };

const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[,$%]/g, "")); return v === undefined || v === null || v === "" || !Number.isFinite(n) ? null : n; };
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function parse606(xml: string): Report606 {
  const p = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true });
  const doc = p.parse(xml) as Record<string, unknown>;
  const root = (doc.heldOrderRoutingPublicReport ?? doc.HeldOrderRoutingPublicReport ?? Object.values(doc).find((v) => v && typeof v === "object")) as Record<string, unknown>;
  if (!root) throw Object.assign(new Error("This is not a Rule 606 XML report."), { status: 400 });
  const months: CategoryMonth[] = [];
  for (const m of arr(root.rMonthly as Record<string, unknown> | Record<string, unknown>[])) {
    const mon = String(m.mon ?? "");
    for (const [key, category] of [["rSP500", "sp500"], ["rOtherStocks", "otherStocks"], ["rOptions", "options"]] as const) {
      const c = m[key] as Record<string, unknown> | undefined;
      if (!c) continue;
      const venues = arr((c.rVenues as Record<string, unknown> | undefined)?.rVenue as Record<string, unknown> | Record<string, unknown>[]).map((v) => ({
        name: String(v.name ?? ""), mic: String(v.mic ?? ""), orderPct: num(v.orderPct),
        pfof: {
          market: { usd: num(v.netPmtPaidRecvMarketOrdersUsd), centsPer100: num(v.netPmtPaidRecvMarketOrdersCph) },
          marketableLimit: { usd: num(v.netPmtPaidRecvMarketableLimitOrdersUsd), centsPer100: num(v.netPmtPaidRecvMarketableLimitOrdersCph) },
          nonMarketableLimit: { usd: num(v.netPmtPaidRecvNonMarketableLimitOrdersUsd), centsPer100: num(v.netPmtPaidRecvNonMarketableLimitOrdersCph) },
          other: { usd: num(v.netPmtPaidRecvOtherOrdersUsd), centsPer100: num(v.netPmtPaidRecvOtherOrdersCph) },
        },
      }));
      months.push({ category, month: mon, marketPct: num(c.ndoMktPct), venues });
    }
  }
  const totals = (["sp500", "otherStocks", "options"] as const).map((category) => {
    const ms = months.filter((m) => m.category === category);
    const pfofUsd = ms.reduce((s, m) => s + m.venues.reduce((t, v) => t + Object.values(v.pfof).reduce((u, x) => u + (x.usd ?? 0), 0), 0), 0);
    // Market-order payment per 100 shares, weighted by each venue's market-order dollars.
    let w = 0, acc = 0;
    for (const m of ms) for (const v of m.venues) { const x = v.pfof.market; if (x.usd && x.centsPer100 !== null) { w += x.usd; acc += x.usd * x.centsPer100; } }
    return { category, pfofUsd, marketOrderCentsPer100: w > 0 ? acc / w : null };
  }).filter((t) => months.some((m) => m.category === t.category));
  return { broker: String(root.bd ?? root.brokerDealer ?? ""), year: num(root.year), quarter: num(root.qtr), months, totals };
}

export type Row605 = { participant: string; marketCenter: string; month: string; symbol: string; orderType: "market" | "marketable_limit" | "inside_limit" | "at_quote_limit" | "near_quote_limit" | "other"; size: "100-499" | "500-1999" | "2000-4999" | "5000-9999" | "other"; coveredOrders: number; coveredShares: number; executedShares: number; effectiveSpread: number | null; realizedSpread: number | null; improvedShares: number; avgImprovement: number | null };
export type Summary605 = { marketCenter: string; month: string; orderType: Row605["orderType"]; size: Row605["size"]; shares: number; effectiveSpread: number | null; improvedShare: number | null; avgImprovement: number | null };

const TYPE: Record<string, Row605["orderType"]> = { "11": "market", "12": "marketable_limit", "13": "inside_limit", "14": "at_quote_limit", "15": "near_quote_limit" };
const SIZE: Record<string, Row605["size"]> = { "21": "100-499", "22": "500-1999", "23": "2000-4999", "24": "5000-9999" };

/** Parse a Rule 605 file in the original pipe-delimited layout (26 fields per row). */
export function parse605(text: string): Row605[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes("|")).map((l) => l.split("|").map((x) => x.trim())).filter((f) => f.length >= 20 && /^\d{6}$/.test(f[2])).map((f) => ({
    participant: f[0], marketCenter: f[1], month: `${f[2].slice(0, 4)}-${f[2].slice(4, 6)}`, symbol: f[3].toUpperCase(),
    orderType: TYPE[f[4]] ?? "other", size: SIZE[f[5]] ?? "other",
    coveredOrders: Number(f[6]) || 0, coveredShares: Number(f[7]) || 0, executedShares: Number(f[9]) || 0,
    realizedSpread: num(f[16]), effectiveSpread: num(f[17]), improvedShares: Number(f[18]) || 0, avgImprovement: num(f[19]),
  }));
}

/** Share-weighted summary by market center, month, order type and size bucket. */
export function summarise605(rows: Row605[]): Summary605[] {
  const by = new Map<string, Row605[]>();
  for (const r of rows) { const k = `${r.marketCenter}|${r.month}|${r.orderType}|${r.size}`; by.set(k, [...(by.get(k) ?? []), r]); }
  return [...by.values()].map((rs) => {
    const sh = rs.reduce((s, r) => s + r.executedShares, 0);
    const wavg = (pick: (r: Row605) => number | null, w: (r: Row605) => number) => { let a = 0, b = 0; for (const r of rs) { const v = pick(r); if (v !== null) { a += v * w(r); b += w(r); } } return b > 0 ? a / b : null; };
    const improved = rs.reduce((s, r) => s + r.improvedShares, 0);
    return { marketCenter: rs[0].marketCenter, month: rs[0].month, orderType: rs[0].orderType, size: rs[0].size, shares: sh, effectiveSpread: wavg((r) => r.effectiveSpread, (r) => r.executedShares), improvedShare: sh > 0 ? improved / sh : null, avgImprovement: wavg((r) => r.avgImprovement, (r) => r.improvedShares) };
  });
}

/**
 * The payment for order flow a broker received on the person's own equity orders, estimated: shares traded by
 * market order times the broker's reported cents per 100 shares (S&P 500 or other stocks), over 100.
 */
export function pfofOnOrders(sharesSp500: number, sharesOther: number, r: Report606): { usd: number | null; basis: string } {
  const c = (cat: "sp500" | "otherStocks") => r.totals.find((t) => t.category === cat)?.marketOrderCentsPer100 ?? null;
  const a = c("sp500"), b = c("otherStocks");
  if (a === null && b === null) return { usd: null, basis: "The report lists no market-order payments." };
  const usd = ((a ?? 0) * sharesSp500 + (b ?? 0) * sharesOther) / 100 / 100;
  return { usd, basis: `${sharesSp500.toLocaleString("en-US")} S&P 500 shares at ${(a ?? 0).toFixed(2)} cents per 100 and ${sharesOther.toLocaleString("en-US")} other shares at ${(b ?? 0).toFixed(2)} cents per 100 (${r.broker || "the broker"}, ${r.year ?? ""} Q${r.quarter ?? ""} Rule 606 report).` };
}
