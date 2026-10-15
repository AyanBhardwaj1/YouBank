/**
 * The quant terminal functions' arguments, parsed. Pure, safe on the client; tested in scripts/test-quant.ts.
 *   KELLY 0.55 1 | KELLY 0.52-0.58 1 | KELLY 55% 2   a bet: win chance (or range) and the payoff odds
 *   KELLY sharpe 0.3-0.8 18%                       an asset: Sharpe range and annual volatility
 *   BTX 2.1 18 30                                  a claim: Sharpe, months, variants tried
 *   TCA AAPL 25000                                 a pre-trade estimate: symbol and dollar size
 */
export type KellyArg = { kind: "bet"; pLow: string; pHigh: string; odds: string } | { kind: "asset"; sharpeLow: string; sharpeHigh: string; vol: string };

const frac = (s: string) => { const pct = s.endsWith("%"); const n = Number(s.replace(/%$/, "")); return Number.isFinite(n) ? (pct || n > 1 ? n / 100 : n) : NaN; };
const range = (s: string, f: (x: string) => number): [number, number] | null => {
  const m = s.match(/^(-?[\d.]+%?)(?:\s*(?:-|to|–)\s*(-?[\d.]+%?))?$/);
  if (!m) return null;
  const a = f(m[1]), b = m[2] ? f(m[2]) : a;
  return Number.isFinite(a) && Number.isFinite(b) ? [Math.min(a, b), Math.max(a, b)] : null;
};

export function parseKellyArg(arg: string | undefined): KellyArg | null {
  const t = (arg ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!t.length) return null;
  if (t[0] === "sharpe" || t[0] === "asset") {
    const r = range(t[1] ?? "", Number), vol = frac(t[2] ?? "");
    return r && Number.isFinite(vol) && vol > 0 ? { kind: "asset", sharpeLow: String(r[0]), sharpeHigh: String(r[1]), vol: String(vol) } : null;
  }
  const r = range(t[0], frac), odds = t[1] === undefined ? 1 : Number(t[1]);
  if (!r || !(r[0] > 0 && r[1] < 1) || !(odds > 0)) return null;
  return { kind: "bet", pLow: String(r[0]), pHigh: String(r[1]), odds: String(odds) };
}

export function parseBtxArg(arg: string | undefined): { sharpe?: number; months?: number; trials?: number } | undefined {
  const n = (arg ?? "").trim().split(/\s+/).filter(Boolean).map(Number);
  if (!n.length || !Number.isFinite(n[0])) return undefined;
  return { sharpe: n[0], ...(Number.isFinite(n[1]) && n[1] > 0 ? { months: n[1] } : {}), ...(Number.isFinite(n[2]) && n[2] >= 1 ? { trials: Math.round(n[2]) } : {}) };
}

export function parseTcaArg(arg: string | undefined): { symbol?: string; notional?: number } {
  const t = (arg ?? "").trim().toUpperCase().split(/\s+/).filter(Boolean);
  const symbol = t.find((x) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(x));
  const num = t.map((x) => Number(x.replace(/[$,]/g, "").replace(/K$/, "e3").replace(/M$/, "e6"))).find((x) => Number.isFinite(x) && x > 0);
  return { ...(symbol ? { symbol } : {}), ...(num ? { notional: num } : {}) };
}
