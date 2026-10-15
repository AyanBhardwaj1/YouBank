/**
 * Q5: fills from brokers' CSV exports. Each template is recognised by its header; rows that are not trades
 * (dividends, transfers, interest) are skipped and counted. Pure.
 *
 * The layouts follow each broker's documented or commonly shared export (Schwab transactions, Fidelity
 * account history, Robinhood account activity, Webull order records, Interactive Brokers' activity statement
 * Trades section, E*TRADE transactions) plus YouBank's own template. The build sandbox could not download real
 * exports, so the fixtures in scripts/fixtures/quant/fills/ are constructed from those layouts and labelled as
 * such; a template that does not match a real file says which columns it expected.
 *
 * Where an export has no time of day (Schwab, Fidelity, Robinhood, E*TRADE), the fill is placed at noon New
 * York time with `timeKnown: false` in its raw row, and time-of-day checks skip it.
 */
import type { Fill } from "../contracts";
import { parseCsv } from "../csv";
import { newYorkTime } from "../pit/calendar";

export type Broker = "schwab" | "fidelity" | "robinhood" | "webull" | "ibkr" | "etrade" | "youbank";
export type ImportResult = { broker: Broker | null; fills: (Fill & { raw: Record<string, string>; timeKnown: boolean })[]; skipped: number; errors: string[]; expected?: string[] };

export const TEMPLATES: Record<Broker, { label: string; columns: string[] }> = {
  schwab: { label: "Charles Schwab (transactions)", columns: ["Date", "Action", "Symbol", "Description", "Quantity", "Price", "Fees & Comm", "Amount"] },
  fidelity: { label: "Fidelity (account history)", columns: ["Run Date", "Action", "Symbol", "Description", "Type", "Quantity", "Price ($)", "Commission ($)", "Fees ($)", "Accrued Interest ($)", "Amount ($)", "Settlement Date"] },
  robinhood: { label: "Robinhood (account activity)", columns: ["Activity Date", "Process Date", "Settle Date", "Instrument", "Description", "Trans Code", "Quantity", "Price", "Amount"] },
  webull: { label: "Webull (order records)", columns: ["Name", "Symbol", "Side", "Status", "Filled", "Total Qty", "Price", "Avg Price", "Time-in-Force", "Placed Time", "Filled Time"] },
  ibkr: { label: "Interactive Brokers (activity statement, Trades)", columns: ["Trades", "Header", "DataDiscriminator", "Asset Category", "Currency", "Symbol", "Date/Time", "Quantity", "T. Price", "C. Price", "Proceeds", "Comm/Fee", "Basis", "Realized P/L", "MTM P/L", "Code"] },
  etrade: { label: "E*TRADE (transactions)", columns: ["TransactionDate", "TransactionType", "SecurityType", "Symbol", "Quantity", "Amount", "Price", "Commission", "Description"] },
  youbank: { label: "YouBank template", columns: ["date", "time", "symbol", "side", "quantity", "price", "fees", "order_type", "limit_price", "placed_time"] },
};

const money = (s: string | undefined) => { const t = (s ?? "").replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"); const v = Number(t); return t && Number.isFinite(v) ? v : null; };
const mdy = (s: string) => { const m = /(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/.exec(s); return m ? `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : /^\d{4}-\d{2}-\d{2}/.test(s.trim()) ? s.trim().slice(0, 10) : null; };
const hms = (s: string) => { const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(s); if (!m) return null; let h = Number(m[1]); if (m[4]) { if (/pm/i.test(m[4]) && h < 12) h += 12; if (/am/i.test(m[4]) && h === 12) h = 0; } return `${String(h).padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`; };
const nyIso = (date: string, time: string | null) => { const t = time ?? "12:00:00"; const base = newYorkTime(date, t.slice(0, 5)); return new Date(Date.parse(base) + Number(t.slice(6, 8) || 0) * 1000).toISOString(); };
const sym = (s: string) => s.trim().toUpperCase().replace(/[./]/g, "-");
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function detect(header: string[]): Broker | null {
  const h = header.map(norm);
  const has = (cols: string[]) => cols.every((c) => h.includes(norm(c)));
  if (has(["Trades", "Header", "Date/Time", "T. Price"])) return "ibkr";
  if (has(["Placed Time", "Filled Time", "Side", "Avg Price"])) return "webull";
  if (has(["Run Date", "Action", "Price ($)"])) return "fidelity";
  if (has(["Activity Date", "Trans Code", "Instrument"])) return "robinhood";
  if (has(["TransactionDate", "TransactionType", "Symbol"])) return "etrade";
  if (has(["Date", "Action", "Symbol", "Fees & Comm"])) return "schwab";
  if (has(["date", "symbol", "side", "quantity", "price"])) return "youbank";
  return null;
}

type Side = Fill["side"];
const sideOf = (s: string): Side | null => {
  const t = s.toLowerCase();
  if (/sell short|short sale|^short$|sell_short/.test(t)) return "short";
  if (/buy to cover|cover/.test(t)) return "cover";
  if (/\bbought\b|^buy|you bought|reinvest/.test(t) && !/reinvest/.test(t)) return "buy";
  if (/\bsold\b|^sell|you sold/.test(t)) return "sell";
  return null;
};

/** Parse an export. `accountRef` names the account the person imports into. */
export function importFills(text: string, accountRef = "csv"): ImportResult {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const errors: string[] = [];
  // Find the header row (Fidelity exports start with blank or title lines; IBKR has many sections).
  const hi = rows.findIndex((r) => detect(r) !== null);
  if (hi < 0) return { broker: null, fills: [], skipped: rows.length, errors: ["The file's columns did not match a known export."], expected: Object.values(TEMPLATES).map((t) => `${t.label}: ${t.columns.join(", ")}`) };
  const header = rows[hi];
  const broker = detect(header)!;
  const col = (r: string[], name: string) => { const i = header.findIndex((c) => norm(c) === norm(name)); return i >= 0 ? (r[i] ?? "").trim() : ""; };
  const fills: ImportResult["fills"] = [];
  let skipped = 0;
  const seen = new Map<string, number>();
  const body = rows.slice(hi + 1);
  body.forEach((r, k) => {
    try {
      const raw = Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]));
      let f: (Omit<Fill, "source" | "accountRef" | "extId"> & { timeKnown: boolean }) | null = null;
      switch (broker) {
        case "schwab": {
          const side = sideOf(col(r, "Action")), d = mdy(col(r, "Date").split(" as of ")[0]), q = money(col(r, "Quantity")), p = money(col(r, "Price"));
          if (side && d && q && p) f = { symbol: sym(col(r, "Symbol")), side, qty: Math.abs(q), price: p, executedAt: nyIso(d, null), fees: Math.abs(money(col(r, "Fees & Comm")) ?? 0), timeKnown: false };
          break;
        }
        case "fidelity": {
          const side = sideOf(col(r, "Action")), d = mdy(col(r, "Run Date")), q = money(col(r, "Quantity")), p = money(col(r, "Price ($)"));
          if (side && d && q && p) f = { symbol: sym(col(r, "Symbol")), side, qty: Math.abs(q), price: p, executedAt: nyIso(d, null), fees: Math.abs(money(col(r, "Commission ($)")) ?? 0) + Math.abs(money(col(r, "Fees ($)")) ?? 0), timeKnown: false };
          break;
        }
        case "robinhood": {
          const code = col(r, "Trans Code").toLowerCase(), side: Side | null = code === "buy" ? "buy" : code === "sell" ? "sell" : null;
          const d = mdy(col(r, "Activity Date")), q = money(col(r, "Quantity")), p = money(col(r, "Price"));
          if (side && d && q && p) f = { symbol: sym(col(r, "Instrument")), side, qty: Math.abs(q), price: p, executedAt: nyIso(d, null), fees: 0, timeKnown: false };
          break;
        }
        case "webull": {
          if (!/filled/i.test(col(r, "Status"))) break;
          const side = sideOf(col(r, "Side")), ft = col(r, "Filled Time"), pt = col(r, "Placed Time"), d = mdy(ft), q = money(col(r, "Filled")), p = money(col(r, "Avg Price"));
          const lp = money(col(r, "Price"));
          if (side && d && q && p) f = { symbol: sym(col(r, "Symbol")), side, qty: Math.abs(q), price: p, executedAt: nyIso(d, hms(ft)), ...(mdy(pt) ? { placedAt: nyIso(mdy(pt)!, hms(pt)) } : {}), ...(lp && /^\d/.test(col(r, "Price")) ? { orderType: "limit" as const, limitPrice: lp } : { orderType: "market" as const }), fees: 0, timeKnown: !!hms(ft) };
          break;
        }
        case "ibkr": {
          if (r[0] !== "Trades" || r[1] !== "Data" || !/order/i.test(col(r, "DataDiscriminator")) || !/stock/i.test(col(r, "Asset Category"))) break;
          const dt = col(r, "Date/Time"), d = mdy(dt), q = money(col(r, "Quantity")), p = money(col(r, "T. Price"));
          if (d && q && p) f = { symbol: sym(col(r, "Symbol")), side: q > 0 ? "buy" : "sell", qty: Math.abs(q), price: p, executedAt: nyIso(d, hms(dt.split(",")[1] ?? "")), fees: Math.abs(money(col(r, "Comm/Fee")) ?? 0), timeKnown: !!hms(dt.split(",")[1] ?? "") };
          break;
        }
        case "etrade": {
          const side = sideOf(col(r, "TransactionType")), d = mdy(col(r, "TransactionDate")), q = money(col(r, "Quantity")), p = money(col(r, "Price"));
          if (side && d && q && p) f = { symbol: sym(col(r, "Symbol")), side, qty: Math.abs(q), price: p, executedAt: nyIso(d, null), fees: Math.abs(money(col(r, "Commission")) ?? 0), timeKnown: false };
          break;
        }
        case "youbank": {
          const side = sideOf(col(r, "side")), d = mdy(col(r, "date")), q = money(col(r, "quantity")), p = money(col(r, "price"));
          const t = hms(col(r, "time")), pt = hms(col(r, "placed_time")), ot = col(r, "order_type").toLowerCase(), lp = money(col(r, "limit_price"));
          if (side && d && q && p) f = { symbol: sym(col(r, "symbol")), side, qty: Math.abs(q), price: p, executedAt: nyIso(d, t), ...(pt ? { placedAt: nyIso(d, pt) } : {}), orderType: ot === "market" || ot === "limit" || ot === "stop" ? ot : "other", ...(lp ? { limitPrice: lp } : {}), fees: Math.abs(money(col(r, "fees")) ?? 0), timeKnown: !!t };
          break;
        }
      }
      if (!f || !f.symbol) { skipped++; return; }
      // Stable across re-exports: identical rows are numbered in order, so importing the same file twice adds nothing.
      const base = `${broker}:${f.executedAt}:${f.symbol}:${f.side}:${f.qty}:${f.price}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const extId = `${base}#${n}`;
      fills.push({ ...f, source: "csv", accountRef, broker, extId, raw });
    } catch { errors.push(`Row ${hi + k + 2} could not be read.`); }
  });
  return { broker, fills, skipped, errors };
}
