/**
 * Model templates: complete, formula-driven workbooks a banker would recognise, filled from SEC data
 * where a ticker is given. Conventions: blue inputs, black formulas, green links to other sheets;
 * USD millions except per-share figures; every projection assumption is an input the person can change.
 */
import { colName } from "./address";
import type { CellData, CellStyle, Scalar, Sensitivity, SheetData, Workbook } from "./types";
import { newId } from "./types";

/* ---------------- Company data, normalised ---------------- */

export type Fin = {
  ticker: string; name: string; periodEnd: string; revenue: number; priorRevenue: number | null; ebitda: number; da: number; capex: number;
  /** Stock-based compensation, which loss-making growth companies add back to reach "adjusted" EBITDA. */
  sbc: number;
  netIncome: number; cash: number; debt: number; shares: number; price: number; low52: number | null; high52: number | null;
  description: string; source: string; priceAsOf: string | null; illustrative: boolean;
};

type CompanyLike = {
  ticker: string; name: string; description: string;
  price: { last: number; marketCap: number; low52: number | null; high52: number | null; asOf: string } | null;
  ltm: { periodEnd: string; revenue: number | null; priorRevenue: number | null; ebitda: number | null; operatingIncome: number | null; da: number | null; capex: number | null; netIncome: number | null; sbc?: number | null };
  balance: { cash: number | null; debt: number | null; sharesOut: number | null };
  sources: { factsUrl: string };
};

export const ILLUSTRATIVE: Fin = {
  ticker: "TGT", name: "Target Co.", periodEnd: "LTM", revenue: 1000, priorRevenue: 870, ebitda: 180, da: 30, capex: 35, sbc: 0, netIncome: 90,
  cash: 150, debt: 300, shares: 100, price: 25, low52: 19, high52: 31, description: "Illustrative company. Replace the blue inputs with real figures.",
  source: "Illustrative inputs", priceAsOf: null, illustrative: true,
};

const r1 = (x: number) => Math.round(x * 10) / 10;

export function finFrom(c: CompanyLike | null): Fin {
  if (!c) return ILLUSTRATIVE;
  const l = c.ltm;
  const revenue = l.revenue ?? 0;
  const da = l.da ?? (revenue ? revenue * 0.03 : 0);
  const ebitda = l.ebitda ?? (l.operatingIncome !== null ? l.operatingIncome + da : 0);
  const shares = c.balance.sharesOut ?? (c.price && c.price.last ? c.price.marketCap / c.price.last : 0);
  return {
    ticker: c.ticker, name: c.name, periodEnd: l.periodEnd, revenue: r1(revenue), priorRevenue: l.priorRevenue !== null ? r1(l.priorRevenue) : null,
    ebitda: r1(ebitda), da: r1(da), capex: r1(l.capex ?? revenue * 0.03), sbc: r1(l.sbc ?? 0), netIncome: r1(l.netIncome ?? 0),
    cash: r1(c.balance.cash ?? 0), debt: r1(c.balance.debt ?? 0), shares: r1(shares), price: c.price?.last ?? 0,
    low52: c.price?.low52 ?? null, high52: c.price?.high52 ?? null, description: c.description, source: c.sources.factsUrl,
    priceAsOf: c.price?.asOf ?? null, illustrative: false,
  };
}

/* ---------------- Building sheets ---------------- */

export const NF = {
  num: "#,##0.0_);(#,##0.0)",
  int: "#,##0_);(#,##0)",
  pct: "0.0%_);(0.0%)",
  mult: "0.0\"x\"",
  px: "$#,##0.00_);($#,##0.00)",
  beta: "0.00",
};
export const BLUE = "#0000FF", BLACK = "#000000", GREEN = "#008000", BAND = "#DCE6F1", NOTE = "#595959", KEY = "#FFF2CC";

type F = { f: string };
const isF = (x: unknown): x is F => typeof x === "object" && x !== null && "f" in x;
export const fx = (f: string): F => ({ f: f.replace(/^=/, "") });

export class SheetBuilder {
  readonly cells: Record<string, CellData> = {};
  readonly cols: Record<string, number> = {};
  readonly sens: Sensitivity[] = [];
  freeze?: { rows: number; cols: number };
  constructor(readonly name: string, readonly id = newId("sh")) {}

  put(a: string, v: Scalar | F, s: CellStyle = {}) {
    const base: CellData = isF(v) ? { f: v.f } : { v };
    const color = s.color ?? (isF(v) ? (/!/.test(v.f) ? GREEN : BLACK) : typeof v === "number" ? BLUE : undefined);
    this.cells[a] = { ...base, s: { ...s, ...(color ? { color } : {}) } };
    return this;
  }
  label(a: string, text: string, s: CellStyle = {}) { return this.put(a, text, { color: BLACK, ...s }); }
  style(a: string, s: CellStyle) { const c = this.cells[a] ?? {}; this.cells[a] = { ...c, s: { ...c.s, ...s } }; return this; }
  /** A section heading: bold text on a light band across columns A to `to`. */
  band(row: number, text: string, to = "G", headers: Record<string, string> = {}) {
    const last = colIndexOf(to);
    for (let c = 1; c <= last; c++) {
      const a = `${colName(c)}${row}`;
      const h = headers[colName(c)];
      if (c === 1) this.put(a, text, { b: true, fill: BAND, color: BLACK });
      else if (h !== undefined) this.put(a, h, { b: true, fill: BAND, color: BLACK, al: "right" });
      else this.cells[a] = { s: { fill: BAND } };
    }
    return this;
  }
  title(text: string, note: string) {
    this.put("A1", text, { b: true, size: 14, color: BLACK });
    this.put("A2", note, { i: true, color: NOTE });
    return this;
  }
  widths(w: Record<string, number>) { Object.assign(this.cols, w); return this; }
  sheet(): SheetData {
    return { id: this.id, name: this.name, cells: this.cells, cols: this.cols, ...(this.freeze ? { freeze: this.freeze } : {}), ...(this.sens.length ? { sens: this.sens } : {}) };
  }
}

function colIndexOf(letter: string) { let n = 0; for (const ch of letter) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
const YEARS = ["C", "D", "E", "F", "G"];
const prev = (col: string) => colName(colIndexOf(col) - 1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const step = (x: number) => Math.round(x * 200) / 200; // nearest 0.5%

export type Anchors = Record<string, string>;
export type Built = { sheets: SheetData[]; anchors: Anchors; notes: string[] };

const sourceNote = (f: Fin) => f.illustrative
  ? "Illustrative inputs: replace the blue cells. USD millions except per share."
  : `USD millions except per share. LTM to ${f.periodEnd} from SEC XBRL company facts${f.priceAsOf ? `; price as of ${f.priceAsOf.slice(0, 10)} (FMP)` : ""}. Blue = input, black = formula, green = link.`;

/* ---------------- DCF ---------------- */

export function buildDcf(f: Fin, name = "DCF"): Built {
  const s = new SheetBuilder(name);
  s.title(`${f.name} (${f.ticker}): discounted cash flow`, sourceNote(f)).widths({ A: 250, B: 92, C: 92, D: 92, E: 92, F: 92, G: 92 });
  s.freeze = { rows: 4, cols: 1 };
  const ltmGrowth = f.priorRevenue ? f.revenue / f.priorRevenue - 1 : 0.08;
  const g1 = step(clamp(ltmGrowth, -0.05, 0.6));
  const g5 = step(g1 > 0.04 ? clamp(g1 * 0.45, 0.04, 0.12) : g1);
  const m0 = f.revenue ? f.ebitda / f.revenue : 0.15;
  // A loss-making company is taken to its adjusted margin (before stock-based compensation) by Year 5,
  // the path its own guidance usually implies; otherwise margins improve modestly.
  const adj = f.revenue && f.sbc > 0 ? (f.ebitda + f.sbc) / f.revenue : null;
  const m5 = step(m0 < 0.15 ? (adj !== null && adj > m0 + 0.1 ? clamp(adj, 0.1, 0.35) : Math.min(0.22, m0 + 0.15)) : Math.min(0.45, m0 + 0.03));
  const daPct = f.revenue ? clamp(f.da / f.revenue, 0.005, 0.2) : 0.03;
  const capexPct = f.revenue ? clamp(f.capex / f.revenue, 0.005, 0.25) : 0.03;

  s.band(4, "Free cash flow", "G", { B: "LTM", C: "Year 1", D: "Year 2", E: "Year 3", F: "Year 4", G: "Year 5" });
  const rows: [number, string, CellStyle?][] = [
    [5, "Revenue", { b: true }], [6, "  % growth", { i: true }], [7, "EBITDA", { b: true }], [8, "  % margin", { i: true }], [9, "D&A"], [10, "  % of revenue", { i: true }],
    [11, "EBIT", { b: true }], [12, "Less: taxes on EBIT"], [13, "NOPAT"], [14, "Plus: D&A"], [15, "Less: capital expenditures"], [16, "  % of revenue", { i: true }],
    [17, "Less: increase in net working capital"], [18, "  % of change in revenue", { i: true }], [19, "Unlevered free cash flow", { b: true }], [20, "  % margin", { i: true }],
  ];
  for (const [r, t, st] of rows) s.label(`A${r}`, t, st);
  s.put("B5", f.revenue, { nf: NF.num, b: true }).put("B6", step(ltmGrowth), { nf: NF.pct, i: true })
    .put("B7", f.ebitda, { nf: NF.num, b: true }).put("B8", fx("B7/B5"), { nf: NF.pct, i: true })
    .put("B9", f.da, { nf: NF.num }).put("B10", fx("B9/B5"), { nf: NF.pct, i: true })
    .put("B11", fx("B7-B9"), { nf: NF.num, b: true })
    .put("B15", -f.capex, { nf: NF.num }).put("B16", fx("-B15/B5"), { nf: NF.pct, i: true });
  YEARS.forEach((c, i) => {
    const p = prev(c);
    const t = i / 4;
    s.put(`${c}5`, fx(`${p}5*(1+${c}6)`), { nf: NF.num, b: true })
      .put(`${c}6`, step(g1 + (g5 - g1) * t), { nf: NF.pct, i: true })
      .put(`${c}7`, fx(`${c}5*${c}8`), { nf: NF.num, b: true })
      .put(`${c}8`, step(m0 + (m5 - m0) * ((i + 1) / 5)), { nf: NF.pct, i: true })
      .put(`${c}9`, fx(`${c}5*${c}10`), { nf: NF.num })
      .put(`${c}10`, Math.round(daPct * 1000) / 1000, { nf: NF.pct, i: true })
      .put(`${c}11`, fx(`${c}7-${c}9`), { nf: NF.num, b: true })
      .put(`${c}12`, fx(`-MAX(${c}11,0)*$C$33`), { nf: NF.num })
      .put(`${c}13`, fx(`${c}11+${c}12`), { nf: NF.num })
      .put(`${c}14`, fx(`${c}9`), { nf: NF.num })
      .put(`${c}15`, fx(`-${c}5*${c}16`), { nf: NF.num })
      .put(`${c}16`, Math.round(capexPct * 1000) / 1000, { nf: NF.pct, i: true })
      .put(`${c}17`, fx(`-(${c}5-${p}5)*${c}18`), { nf: NF.num })
      .put(`${c}18`, 0.05, { nf: NF.pct, i: true })
      .put(`${c}19`, fx(`${c}13+${c}14+${c}15+${c}17`), { nf: NF.num, b: true, bt: "thin" })
      .put(`${c}20`, fx(`${c}19/${c}5`), { nf: NF.pct, i: true });
  });
  s.style("A19", { bt: "thin" }).style("B19", { bt: "thin" });

  s.band(22, "Discounting", "G");
  s.label("A23", "Discount period (years)").label("A24", "Discount factor").label("A25", "Present value of free cash flow", { b: true });
  YEARS.forEach((c, i) => {
    s.put(`${c}23`, i === 0 ? fx("1-0.5*$C$44") : fx(`${prev(c)}23+1`), { nf: "0.00" })
      .put(`${c}24`, fx(`1/(1+$C$39)^${c}23`), { nf: "0.000" })
      .put(`${c}25`, fx(`${c}19*${c}24`), { nf: NF.num, b: true });
  });

  s.band(27, "Cost of capital (WACC)", "G");
  const wacc: [number, string, Scalar | F, string, CellStyle?][] = [
    [28, "Risk-free rate (10-year Treasury)", 0.0425, NF.pct], [29, "Equity risk premium", 0.055, NF.pct], [30, "Levered beta", 1.2, NF.beta],
    [31, "Cost of equity (CAPM)", fx("C28+C30*C29"), NF.pct], [32, "Pre-tax cost of debt", 0.065, NF.pct], [33, "Tax rate", 0.21, NF.pct],
    [34, "After-tax cost of debt", fx("C32*(1-C33)"), NF.pct], [35, "Market value of equity", fx("C52*C51"), NF.num], [36, "Debt", fx("C48"), NF.num],
    [37, "Equity / total capitalisation", fx("IFERROR(C35/(C35+C36),1)"), NF.pct], [38, "Debt / total capitalisation", fx("1-C37"), NF.pct],
    [39, "WACC", fx("C37*C31+C38*C34"), NF.pct, { b: true, fill: KEY }],
  ];
  for (const [r, t, v, nf, st] of wacc) { s.label(`A${r}`, t, st?.b ? { b: true } : {}); s.put(`C${r}`, v, { nf, ...st }); }

  s.band(41, "Valuation", "G");
  const val: [number, string, Scalar | F, string, CellStyle?][] = [
    [42, "Terminal growth rate", 0.03, NF.pct], [43, "Terminal value (perpetuity growth)", fx("G19*(1+C42)/(C39-C42)"), NF.num],
    [44, "Mid-year convention (1 = on, 0 = off)", 1, "0"], [45, "Sum of PV of free cash flow", fx("SUM(C25:G25)"), NF.num],
    [46, "PV of terminal value", fx("C43/(1+C39)^5"), NF.num], [47, "Enterprise value", fx("C45+C46"), NF.num, { b: true, bt: "thin" }],
    [48, "Less: debt", f.debt, NF.num], [49, "Plus: cash and short-term investments", f.cash, NF.num],
    [50, "Equity value", fx("C47-C48+C49"), NF.num, { b: true, bt: "thin" }], [51, "Diluted shares outstanding (mm)", f.shares, NF.num],
    [52, "Current share price", Math.round(f.price * 100) / 100, NF.px], [53, "Implied share price", fx("C50/C51"), NF.px, { b: true, fill: KEY }],
    [54, "Upside / (downside) to current", fx("C53/C52-1"), NF.pct], [55, "Terminal value as % of enterprise value", fx("C46/C47"), NF.pct],
    [56, "Implied exit multiple (TV / Year 5 EBITDA)", fx("C43/G7"), NF.mult], [57, "Implied EV / LTM EBITDA", fx("C47/B7"), NF.mult],
  ];
  for (const [r, t, v, nf, st] of val) { s.label(`A${r}`, t, st?.b ? { b: true } : {}); s.put(`C${r}`, v, { nf, ...st }); }

  s.band(59, "Sensitivity: implied share price (WACC down, terminal growth across)", "G");
  s.label("B60", "WACC \\ g", { i: true, al: "right" });
  // The steps are inputs, not numbers typed into formulas, so the grid can be widened in one place.
  s.label("A67", "Sensitivity step: WACC", { i: true }).put("C67", 0.005, { nf: "0.00%" });
  s.label("A68", "Sensitivity step: terminal growth", { i: true }).put("C68", 0.005, { nf: "0.00%" });
  const steps = [-2, -1, 0, 1, 2];
  const shifted = (base: string, k: number, stepCell: string) => (k === 0 ? base : `${base}${k < 0 ? "-" : "+"}${Math.abs(k) === 2 ? "2*" : ""}${stepCell}`);
  YEARS.forEach((c, i) => s.put(`${c}60`, fx(shifted("$C$42", steps[i], "$C$68")), { nf: NF.pct, b: true, al: "right", bb: "thin" }));
  steps.forEach((k, j) => {
    const r = 61 + j;
    s.put(`B${r}`, fx(shifted("$C$39", k, "$C$67")), { nf: NF.pct, b: true });
    YEARS.forEach((c) => s.put(`${c}${r}`, fx(`(SUMPRODUCT($C$19:$G$19,1/(1+$B${r})^$C$23:$G$23)+$G$19*(1+${c}$60)/($B${r}-${c}$60)/(1+$B${r})^5-$C$48+$C$49)/$C$51`), { nf: NF.px, ...(k === 0 && c === "E" ? { b: true, fill: KEY } : {}) }));
  });

  return {
    sheets: [s.sheet()],
    anchors: {
      revenueLtm: `${name}!B5`, growthLtm: `${name}!B6`, ebitdaLtm: `${name}!B7`, marginLtm: `${name}!B8`, fcfRow: `${name}!C19:G19`, yearLabels: `${name}!C4:G4`,
      wacc: `${name}!C39`, growth: `${name}!C42`, ev: `${name}!C47`, equity: `${name}!C50`, price: `${name}!C52`, implied: `${name}!C53`, upside: `${name}!C54`,
      tvPct: `${name}!C55`, debt: `${name}!C48`, cash: `${name}!C49`, shares: `${name}!C51`, fcfTable: `${name}!A4:G20`, sensitivity: `${name}!B60:G65`, sensitivityInner: `${name}!D62:F64`,
    },
    notes: [`Projections decay revenue growth from ${(g1 * 100).toFixed(1)}% to ${(g5 * 100).toFixed(1)}% and move the EBITDA margin from ${(m0 * 100).toFixed(1)}% to ${(m5 * 100).toFixed(1)}%${adj !== null && m0 < 0.15 && adj > m0 + 0.1 ? ` (the LTM margin before stock-based compensation is ${(adj * 100).toFixed(1)}%)` : ""}. They are starting assumptions: edit the blue cells.`],
  };
}

/* ---------------- Trading comps ---------------- */

export type CompRow = { ticker: string; name: string; price: number | null; marketCap: number | null; netDebt: number | null; revenue: number | null; ebitda: number | null; growth: number | null };

export function buildComps(target: CompRow & { shares: number | null }, peers: CompRow[], name = "Comps", asOf = "", source = "SEC XBRL, FMP"): Built {
  const s = new SheetBuilder(name);
  s.title(`${target.name} (${target.ticker}): trading comparables`, `USD millions except per share. LTM from ${source}${asOf ? `, prices as of ${asOf}` : ""}. EBITDA is reported (operating income + D&A). NM = not meaningful.`)
    .widths({ A: 210, B: 64, C: 80, D: 92, E: 86, F: 96, G: 92, H: 92, I: 78, J: 78, K: 80, L: 80 });
  s.freeze = { rows: 4, cols: 2 };
  const heads = { B: "Ticker", C: "Price", D: "Market cap", E: "Net debt", F: "Enterprise value", G: "LTM revenue", H: "LTM EBITDA", I: "Rev. growth", J: "EBITDA margin", K: "EV / Revenue", L: "EV / EBITDA" };
  s.band(4, "Company", "L", heads);
  const row = (r: number, c: CompRow, bold = false) => {
    const st: CellStyle = bold ? { b: true } : {};
    s.label(`A${r}`, c.name, st).put(`B${r}`, c.ticker, { ...st, color: BLACK })
      .put(`C${r}`, c.price, { nf: NF.px, ...st }).put(`D${r}`, c.marketCap, { nf: NF.num, ...st }).put(`E${r}`, c.netDebt, { nf: NF.num, ...st })
      .put(`F${r}`, fx(`D${r}+E${r}`), { nf: NF.num, ...st }).put(`G${r}`, c.revenue, { nf: NF.num, ...st }).put(`H${r}`, c.ebitda, { nf: NF.num, ...st })
      .put(`I${r}`, c.growth, { nf: NF.pct, ...st }).put(`J${r}`, fx(`IFERROR(H${r}/G${r},"NM")`), { nf: NF.pct, ...st })
      .put(`K${r}`, fx(`IF(G${r}>0,F${r}/G${r},"NM")`), { nf: NF.mult, al: "right", ...st }).put(`L${r}`, fx(`IF(H${r}>0,F${r}/H${r},"NM")`), { nf: NF.mult, al: "right", ...st });
  };
  const first = 5, last = first + Math.max(peers.length, 1) - 1;
  peers.forEach((p, i) => row(first + i, p));
  if (!peers.length) s.label(`A${first}`, "Add peers here", { i: true, color: NOTE });
  const stats: [string, (col: string) => string][] = [
    ["Maximum", (c) => `MAX(${c}${first}:${c}${last})`], ["75th percentile", (c) => `QUARTILE(${c}${first}:${c}${last},3)`], ["Median", (c) => `MEDIAN(${c}${first}:${c}${last})`],
    ["Mean", (c) => `AVERAGE(${c}${first}:${c}${last})`], ["25th percentile", (c) => `QUARTILE(${c}${first}:${c}${last},1)`], ["Minimum", (c) => `MIN(${c}${first}:${c}${last})`],
  ];
  const s0 = last + 2;
  stats.forEach(([label, fn], i) => {
    const r = s0 + i;
    s.label(`A${r}`, label, { b: label === "Median", ...(i === 0 ? { bt: "thin" as const } : {}) });
    for (const [c, nf] of [["I", NF.pct], ["J", NF.pct], ["K", NF.mult], ["L", NF.mult]] as const) s.put(`${c}${r}`, fx(`IFERROR(${fn(c)},"NM")`), { nf, al: "right", b: label === "Median", ...(i === 0 ? { bt: "thin" as const } : {}) });
  });
  const q1 = s0 + 4, med = s0 + 2, q3 = s0 + 1;
  const tr = s0 + stats.length + 1;
  row(tr, target, true);
  s.style(`A${tr}`, { fill: KEY });

  const b0 = tr + 2;
  s.band(b0, `Implied valuation of ${target.name}`, "L", { B: "Metric", C: "25th pct.", D: "Median", E: "75th pct.", F: "EV low", G: "EV mid", H: "EV high", I: "Price low", J: "Price mid", K: "Price high" });
  s.label(`A${b0 + 3}`, "Diluted shares (mm)").put(`B${b0 + 3}`, target.shares, { nf: NF.num });
  s.label(`A${b0 + 4}`, "Net debt").put(`B${b0 + 4}`, fx(`E${tr}`), { nf: NF.num });
  const implied = (r: number, label: string, metric: string, col: string) => {
    s.label(`A${r}`, label).put(`B${r}`, fx(metric), { nf: NF.num });
    s.put(`C${r}`, fx(`${col}${q1}`), { nf: NF.mult }).put(`D${r}`, fx(`${col}${med}`), { nf: NF.mult }).put(`E${r}`, fx(`${col}${q3}`), { nf: NF.mult });
    s.put(`F${r}`, fx(`IFERROR($B${r}*C${r},"NM")`), { nf: NF.num }).put(`G${r}`, fx(`IFERROR($B${r}*D${r},"NM")`), { nf: NF.num }).put(`H${r}`, fx(`IFERROR($B${r}*E${r},"NM")`), { nf: NF.num });
    for (const [pc, ec] of [["I", "F"], ["J", "G"], ["K", "H"]]) s.put(`${pc}${r}`, fx(`IFERROR((${ec}${r}-$B$${b0 + 4})/$B$${b0 + 3},"NM")`), { nf: NF.px, b: pc === "J" });
  };
  implied(b0 + 1, "EV / LTM revenue", `G${tr}`, "K");
  implied(b0 + 2, "EV / LTM EBITDA", `H${tr}`, "L");
  return {
    sheets: [s.sheet()],
    anchors: {
      table: `${name}!A4:L${s0 + stats.length - 1}`, targetRow: `${name}!A${tr}:L${tr}`, targetEv: `${name}!F${tr}`,
      revPriceLow: `${name}!I${b0 + 1}`, revPriceHigh: `${name}!K${b0 + 1}`, ebitdaPriceLow: `${name}!I${b0 + 2}`, ebitdaPriceHigh: `${name}!K${b0 + 2}`,
      medianEvRev: `${name}!K${med}`, medianEvEbitda: `${name}!L${med}`, implied: `${name}!A${b0}:K${b0 + 2}`,
    },
    notes: [],
  };
}

/* ---------------- Valuation summary (football field) ---------------- */

export function buildSummary(f: Fin, dcf: Anchors | null, comps: Anchors | null, name = "Summary"): Built {
  const s = new SheetBuilder(name);
  s.title(`${f.name} (${f.ticker}): valuation summary`, "Implied value per share by method. Each range links to the analysis behind it; the chart on the valuation summary slide reads this table.")
    .widths({ A: 280, B: 96, C: 96, D: 360 });
  s.band(4, "Methodology", "D", { B: "Low", C: "High", D: "Basis" });
  let r = 5;
  const line = (label: string, low: Scalar | F, high: Scalar | F, basis: string) => {
    s.label(`A${r}`, label).put(`B${r}`, low, { nf: NF.px }).put(`C${r}`, high, { nf: NF.px }).label(`D${r}`, basis, { i: true, color: NOTE });
    r++;
  };
  if (f.low52 !== null && f.high52 !== null) line("52-week trading range", f.low52, f.high52, "52-week low to high");
  if (comps) {
    line("Trading comps: EV / LTM revenue", fx(`${comps.revPriceLow}`), fx(`${comps.revPriceHigh}`), "25th to 75th percentile of peer multiples");
    // An EBITDA multiple means nothing for a company with negative EBITDA.
    if (f.ebitda > 0) line("Trading comps: EV / LTM EBITDA", fx(`${comps.ebitdaPriceLow}`), fx(`${comps.ebitdaPriceHigh}`), "25th to 75th percentile of peer multiples");
  }
  if (dcf) line("DCF: perpetuity growth", fx(`MIN(${dcf.sensitivityInner})`), fx(`MAX(${dcf.sensitivityInner})`), "WACC ±0.5%, terminal growth ±0.5%");
  const lastLine = r - 1;
  s.label(`A${r + 1}`, "Current share price", { b: true }).put(`B${r + 1}`, dcf ? fx(dcf.price) : Math.round(f.price * 100) / 100, { nf: NF.px, b: true });
  return { sheets: [s.sheet()], anchors: { football: `${name}!A5:C${lastLine}`, current: `${name}!B${r + 1}`, table: `${name}!A4:D${lastLine}` }, notes: [] };
}

/* ---------------- LBO ---------------- */

export function buildLbo(f: Fin, name = "LBO"): Built {
  const s = new SheetBuilder(name);
  // Sponsors underwrite adjusted EBITDA (before stock-based compensation) and, for a listed company,
  // a take-private at a premium to the current price.
  const adjusted = f.sbc > 0 && f.ebitda + f.sbc > 0;
  const base = adjusted ? f.ebitda + f.sbc : f.ebitda;
  // A company with negative EBITDA keeps its real revenue and gets a labelled, illustrative 15% margin.
  const lossMaking = base <= 0 && f.revenue > 0;
  const ebitda = base > 0 ? Math.round(base * 10) / 10 : lossMaking ? Math.round(f.revenue * 0.15 * 10) / 10 : 100;
  const margin = f.revenue > 0 ? ebitda / f.revenue : 0.2;
  const revenue = f.revenue > 0 ? f.revenue : ebitda / margin;
  const takePrivate = !f.illustrative && f.price > 0 && f.shares > 0 && base > 0;
  const entryMultiple = takePrivate ? Math.min(40, Math.max(6, Math.round(((f.price * f.shares * 1.25 + f.debt - f.cash) / ebitda) * 2) / 2)) : 10;
  const ltmGrowth = f.priorRevenue ? f.revenue / f.priorRevenue - 1 : 0.05;
  const g1 = step(clamp(ltmGrowth, 0, 0.4)), g5 = step(g1 > 0.04 ? Math.max(0.04, g1 * 0.5) : g1);
  s.title(`${f.name} (${f.ticker}): leveraged buyout`, `${sourceNote(f)} Interest is on average debt balances, a circular reference solved by iterative calculation; set the circularity switch to 0 to break it.`)
    .widths({ A: 270, B: 20, C: 92, D: 92, E: 92, F: 92, G: 92, H: 92 });
  s.band(4, "Transaction assumptions", "H");
  const ta: [number, string, Scalar | F, string][] = [
    [5, lossMaking ? "LTM EBITDA (illustrative: reported EBITDA is negative)" : adjusted ? "LTM adjusted EBITDA (before stock-based compensation)" : "LTM EBITDA", ebitda, NF.num], [6, takePrivate ? "Entry multiple (EV / EBITDA; 25% premium to current price)" : "Entry multiple (EV / EBITDA)", entryMultiple, NF.mult], [7, "Purchase enterprise value", fx("C5*C6"), NF.num],
    [8, "Transaction fees (% of EV)", 0.02, NF.pct], [9, "Senior debt (x EBITDA)", 4, NF.mult], [10, "Subordinated debt (x EBITDA)", 1.5, NF.mult],
    [11, "Senior interest rate", 0.085, NF.pct], [12, "Subordinated interest rate", 0.11, NF.pct], [13, "Senior mandatory amortisation (% of original per year)", 0.01, NF.pct],
    [14, "Cash sweep (% of excess cash to senior debt)", 1, NF.pct], [15, "Exit multiple (EV / EBITDA)", fx("C6"), NF.mult], [16, "Tax rate", 0.25, NF.pct],
    [17, "Circularity switch (1 = interest on average balances, 0 = beginning)", 1, "0"],
  ];
  for (const [r, t, v, nf] of ta) { s.label(`A${r}`, t); s.put(`C${r}`, v, { nf }); }

  s.band(18, "Sources and uses", "H", { C: "USD mm", D: "x EBITDA", E: "% of total" });
  const su: [number, string, F, boolean?][] = [
    [19, "Senior debt", fx("C5*C9")], [20, "Subordinated debt", fx("C5*C10")], [21, "Sponsor equity", fx("C26-C19-C20")], [22, "Total sources", fx("SUM(C19:C21)"), true],
    [24, "Purchase enterprise value", fx("C7")], [25, "Transaction fees", fx("C7*C8")], [26, "Total uses", fx("C24+C25"), true],
  ];
  for (const [r, t, v, tot] of su) {
    s.label(`A${r}`, t, tot ? { b: true } : {}).put(`C${r}`, v, { nf: NF.num, ...(tot ? { b: true, bt: "thin" as const } : {}) });
    s.put(`D${r}`, fx(`C${r}/$C$5`), { nf: NF.mult, ...(tot ? { b: true, bt: "thin" as const } : {}) }).put(`E${r}`, fx(`C${r}/$C$${r <= 22 ? 22 : 26}`), { nf: NF.pct, ...(tot ? { b: true, bt: "thin" as const } : {}) });
  }
  s.label("A23", "Uses", { b: true, i: true });

  const Y = ["D", "E", "F", "G", "H"];
  s.band(28, "Operating model", "H", { C: "Entry", D: "Year 1", E: "Year 2", F: "Year 3", G: "Year 4", H: "Year 5" });
  const labels: [number, string, CellStyle?][] = [
    [29, "Revenue", { b: true }], [30, "  % growth", { i: true }], [31, "EBITDA", { b: true }], [32, "  % margin", { i: true }], [33, "Less: D&A"], [34, "  % of revenue", { i: true }],
    [35, "EBIT"], [36, "Less: interest expense"], [37, "Pre-tax income"], [38, "Less: taxes"], [39, "Net income", { b: true }], [40, "Plus: D&A"],
    [41, "Less: capital expenditures"], [42, "  % of revenue", { i: true }], [43, "Less: increase in net working capital"], [44, "  % of change in revenue", { i: true }],
    [45, "Free cash flow before debt repayment", { b: true }],
  ];
  for (const [r, t, st] of labels) s.label(`A${r}`, t, st);
  s.put("C29", Math.round(revenue * 10) / 10, { nf: NF.num, b: true }).put("C31", fx("C5"), { nf: NF.num, b: true }).put("C32", fx("C31/C29"), { nf: NF.pct, i: true });
  const daPct = f.revenue ? clamp(f.da / f.revenue, 0.005, 0.2) : 0.03, capexPct = f.revenue ? clamp(f.capex / f.revenue, 0.005, 0.25) : 0.03;
  Y.forEach((c, i) => {
    const p = i === 0 ? "C" : Y[i - 1];
    s.put(`${c}29`, fx(`${p}29*(1+${c}30)`), { nf: NF.num, b: true }).put(`${c}30`, step(g1 + (g5 - g1) * (i / 4)), { nf: NF.pct, i: true })
      .put(`${c}31`, fx(`${c}29*${c}32`), { nf: NF.num, b: true }).put(`${c}32`, step(Math.min(0.5, margin + 0.005 * (i + 1))), { nf: NF.pct, i: true })
      .put(`${c}33`, fx(`-${c}29*${c}34`), { nf: NF.num }).put(`${c}34`, Math.round(daPct * 1000) / 1000, { nf: NF.pct, i: true })
      .put(`${c}35`, fx(`${c}31+${c}33`), { nf: NF.num })
      .put(`${c}36`, fx(`-(IF($C$17=1,(${c}49+${c}52)/2,${c}49)*$C$11+${c}54*$C$12)`), { nf: NF.num })
      .put(`${c}37`, fx(`${c}35+${c}36`), { nf: NF.num }).put(`${c}38`, fx(`-MAX(${c}37,0)*$C$16`), { nf: NF.num })
      .put(`${c}39`, fx(`${c}37+${c}38`), { nf: NF.num, b: true }).put(`${c}40`, fx(`-${c}33`), { nf: NF.num })
      .put(`${c}41`, fx(`-${c}29*${c}42`), { nf: NF.num }).put(`${c}42`, Math.round(capexPct * 1000) / 1000, { nf: NF.pct, i: true })
      .put(`${c}43`, fx(`-(${c}29-${p}29)*${c}44`), { nf: NF.num }).put(`${c}44`, 0.1, { nf: NF.pct, i: true })
      .put(`${c}45`, fx(`${c}39+${c}40+${c}41+${c}43`), { nf: NF.num, b: true, bt: "thin" });
  });

  s.band(47, "Debt schedule", "H", { C: "Entry", D: "Year 1", E: "Year 2", F: "Year 3", G: "Year 4", H: "Year 5" });
  const dl: [number, string, CellStyle?][] = [
    [48, "Senior debt", { b: true }], [49, "  Beginning balance"], [50, "  Mandatory amortisation"], [51, "  Cash sweep"], [52, "  Ending balance", { b: true }],
    [53, "Subordinated debt", { b: true }], [54, "  Beginning balance"], [55, "  Ending balance (bullet at exit)", { b: true }],
    [56, "Cash", { b: true }], [57, "  Beginning cash"], [58, "  Ending cash", { b: true }],
    [59, "Total debt", { b: true }], [60, "Net debt"], [61, "Net debt / EBITDA", { i: true }],
  ];
  for (const [r, t, st] of dl) s.label(`A${r}`, t, st);
  s.put("C52", fx("C19"), { nf: NF.num, b: true }).put("C55", fx("C20"), { nf: NF.num, b: true }).put("C58", 0, { nf: NF.num, b: true })
    .put("C59", fx("C52+C55"), { nf: NF.num, b: true }).put("C60", fx("C59-C58"), { nf: NF.num }).put("C61", fx("C60/C31"), { nf: NF.mult, i: true });
  Y.forEach((c, i) => {
    const p = i === 0 ? "C" : Y[i - 1];
    s.put(`${c}49`, fx(`${p}52`), { nf: NF.num }).put(`${c}50`, fx(`-MIN(${c}49,$C$19*$C$13)`), { nf: NF.num })
      .put(`${c}51`, fx(`-MIN(${c}49+${c}50,MAX(0,(${p}58+${c}45+${c}50)*$C$14))`), { nf: NF.num })
      .put(`${c}52`, fx(`${c}49+${c}50+${c}51`), { nf: NF.num, b: true })
      .put(`${c}54`, fx(`${p}55`), { nf: NF.num }).put(`${c}55`, fx(`${c}54`), { nf: NF.num, b: true })
      .put(`${c}57`, fx(`${p}58`), { nf: NF.num }).put(`${c}58`, fx(`${c}57+${c}45+${c}50+${c}51`), { nf: NF.num, b: true })
      .put(`${c}59`, fx(`${c}52+${c}55`), { nf: NF.num, b: true }).put(`${c}60`, fx(`${c}59-${c}58`), { nf: NF.num }).put(`${c}61`, fx(`${c}60/${c}31`), { nf: NF.mult, i: true });
  });

  s.band(63, "Returns", "H", { C: "Entry", D: "Year 1", E: "Year 2", F: "Year 3", G: "Year 4", H: "Year 5" });
  const ret: [number, string, F, string, CellStyle?][] = [
    [64, "Exit EBITDA (Year 5)", fx("H31"), NF.num], [65, "Exit enterprise value", fx("C64*C15"), NF.num], [66, "Less: net debt at exit", fx("-H60"), NF.num],
    [67, "Exit equity value", fx("C65+C66"), NF.num, { b: true, bt: "thin" }], [68, "Sponsor equity invested", fx("C21"), NF.num],
    [69, "Multiple of invested capital (MOIC)", fx("C67/C68"), NF.mult, { b: true, fill: KEY }], [70, "Internal rate of return (IRR)", fx("IRR(C72:H72)"), NF.pct, { b: true, fill: KEY }],
  ];
  for (const [r, t, v, nf, st] of ret) { s.label(`A${r}`, t, st?.b ? { b: true } : {}); s.put(`C${r}`, v, { nf, ...st }); }
  s.label("A72", "Sponsor cash flows", { i: true }).put("C72", fx("-C21"), { nf: NF.num });
  Y.forEach((c) => s.put(`${c}72`, c === "H" ? fx("C67") : 0, { nf: NF.num, color: BLACK }));

  s.band(74, "Sensitivity: IRR (entry multiple down, exit multiple across)", "H");
  const around = (m: number) => [-2, -1, 0, 1, 2].map((k) => Math.max(1, Math.round((m + k * Math.max(1, Math.round(m / 10))) * 2) / 2));
  const entry = around(entryMultiple), exit = around(entryMultiple);
  s.sens.push({ id: newId("sens"), at: "B75", output: "C70", rowInput: "C6", colInput: "C15", rowValues: entry, colValues: exit, nf: NF.pct, title: "IRR" });
  return {
    sheets: [s.sheet()],
    anchors: { sourcesUses: `${name}!A18:E26`, irr: `${name}!C70`, moic: `${name}!C69`, equity: `${name}!C21`, exitEquity: `${name}!C67`, entryEv: `${name}!C7`, leverage: `${name}!D61:H61`, sensitivity: `${name}!B75:G80`, operating: `${name}!A28:H45` },
    notes: [
      ...(lossMaking ? [`${f.name} has negative EBITDA (${f.ebitda.toFixed(1)}); the model assumes an illustrative 15% margin in C5. Replace it before relying on the returns.`] : []),
      ...(adjusted ? [`EBITDA is adjusted: reported ${f.ebitda.toFixed(1)} plus stock-based compensation of ${f.sbc.toFixed(1)}.`] : []),
      ...(takePrivate ? [`Entry at ${entryMultiple.toFixed(1)}x is a take-private at a 25% premium to the current share price.`] : []),
      "IRR sensitivity is a data table: YouBank recomputes it whenever you ask it to refresh sensitivities.",
    ],
  };
}

/* ---------------- Merger model ---------------- */

export function buildMerger(acq: Fin, tgt: Fin, name = "Merger"): Built {
  const s = new SheetBuilder(name);
  s.title(`${acq.name} acquiring ${tgt.name}: accretion / dilution`, "USD millions except per share. Net income is LTM; EPS uses diluted shares. Blue = input.")
    .widths({ A: 290, B: 70, C: 92, D: 92, E: 92, F: 92, G: 92 });
  s.band(4, "Inputs", "G");
  const inp: [number, string, Scalar | F, string][] = [
    [5, `${acq.ticker} share price`, Math.round(acq.price * 100) / 100, NF.px], [6, `${acq.ticker} diluted shares (mm)`, acq.shares, NF.num], [7, `${acq.ticker} net income (LTM)`, acq.netIncome, NF.num],
    [8, `${tgt.ticker} share price`, Math.round(tgt.price * 100) / 100, NF.px], [9, `${tgt.ticker} diluted shares (mm)`, tgt.shares, NF.num], [10, `${tgt.ticker} net income (LTM)`, tgt.netIncome, NF.num],
    [11, "Offer premium", 0.3, NF.pct], [12, "Stock consideration (% of purchase price)", 0.5, NF.pct], [13, "Pre-tax cost of new debt", 0.07, NF.pct],
    [14, "Tax rate", 0.21, NF.pct], [15, "Pre-tax synergies", 0, NF.num],
  ];
  for (const [r, t, v, nf] of inp) { s.label(`A${r}`, t); s.put(`C${r}`, v, { nf }); }
  s.band(17, "Offer", "G");
  const off: [number, string, F, string, CellStyle?][] = [
    [18, "Offer price per share", fx("C8*(1+C11)"), NF.px], [19, "Equity purchase price", fx("C18*C9"), NF.num], [20, "Paid in stock", fx("C19*C12"), NF.num],
    [21, "Paid in cash (new debt)", fx("C19-C20"), NF.num], [22, "New acquirer shares issued (mm)", fx("C20/C5"), NF.num],
  ];
  for (const [r, t, v, nf, st] of off) { s.label(`A${r}`, t); s.put(`C${r}`, v, { nf, ...st }); }
  s.band(24, "Pro forma earnings per share", "G");
  const pf: [number, string, F, string, CellStyle?][] = [
    [25, `${acq.ticker} standalone EPS`, fx("C7/C6"), NF.px], [26, "Pro forma net income", fx("C7+C10+C15*(1-C14)-C21*C13*(1-C14)"), NF.num],
    [27, "Pro forma diluted shares (mm)", fx("C6+C22"), NF.num], [28, "Pro forma EPS", fx("C26/C27"), NF.px, { b: true }],
    [29, "Accretion / (dilution) per share", fx("C28-C25"), NF.px], [30, "Accretion / (dilution)", fx("C28/C25-1"), NF.pct, { b: true, fill: KEY }],
    [31, "Pre-tax synergies to break even", fx("MAX(0,(C25*C27-(C7+C10-C21*C13*(1-C14)))/(1-C14))"), NF.num],
  ];
  for (const [r, t, v, nf, st] of pf) { s.label(`A${r}`, t, st?.b ? { b: true } : {}); s.put(`C${r}`, v, { nf, ...st }); }
  s.band(33, "Sensitivity: accretion / (dilution) (stock mix down, premium across)", "G");
  s.label("B34", "Stock \\ premium", { i: true, al: "right" });
  const prem = [0.1, 0.2, 0.3, 0.4, 0.5], stock = [0, 0.25, 0.5, 0.75, 1];
  YEARS.forEach((c, i) => s.put(`${c}34`, prem[i], { nf: NF.pct, b: true, bb: "thin", al: "right" }));
  stock.forEach((st, j) => {
    const r = 35 + j;
    s.put(`B${r}`, st, { nf: NF.pct, b: true });
    YEARS.forEach((c) => s.put(`${c}${r}`, fx(`(($C$7+$C$10+$C$15*(1-$C$14)-$C$8*(1+${c}$34)*$C$9*(1-$B${r})*$C$13*(1-$C$14))/($C$6+$C$8*(1+${c}$34)*$C$9*$B${r}/$C$5))/($C$7/$C$6)-1`), { nf: NF.pct }));
  });
  return { sheets: [s.sheet()], anchors: { accretion: `${name}!C30`, pfEps: `${name}!C28`, breakeven: `${name}!C31`, offer: `${name}!C18`, sensitivity: `${name}!B34:G39`, summary: `${name}!A17:C31` }, notes: [] };
}

/* ---------------- Cap table ---------------- */

export function buildCapTable(name = "Cap table"): Built {
  const s = new SheetBuilder(name);
  s.title("Financing round and cap table", "Shares in millions, dollars in millions except price per share. The option pool top-up is in the pre-money, the usual term-sheet convention.")
    .widths({ A: 270, B: 110, C: 92, D: 110, E: 110, F: 92 });
  s.band(4, "Round terms", "F");
  const terms: [number, string, Scalar | F, string, CellStyle?][] = [
    [5, "Pre-money valuation", 40, NF.num], [6, "New investment", 10, NF.num], [7, "Post-money valuation", fx("C5+C6"), NF.num, { b: true }],
    [8, "Option pool target (% of post-money shares)", 0.1, NF.pct], [9, "Existing fully diluted shares", fx("B19"), NF.num],
    [10, "Option pool top-up (new shares)", fx("MAX(0,(C8*(C7/C5)*C9-B16)/(1-C8*(C7/C5)))"), NF.num],
    [11, "Price per share (USD)", fx("C5/(C9+C10)"), NF.px, { b: true, fill: KEY }], [12, "New investor shares", fx("C6/C11"), NF.num],
  ];
  for (const [r, t, v, nf, st] of terms) { s.label(`A${r}`, t, st?.b ? { b: true } : {}); s.put(`C${r}`, v, { nf, ...st }); }
  s.band(14, "Holder", "F", { B: "Pre-round", C: "Pre %", D: "New shares", E: "Post-round", F: "Post %" });
  const holders: [number, string, number, F | number][] = [[15, "Founders", 8, 0], [16, "Option pool (granted and unallocated)", 1, fx("C10")], [17, "Seed investors", 1.5, 0], [18, "Series A investors (this round)", 0, fx("C12")]];
  for (const [r, t, pre, nw] of holders) {
    s.label(`A${r}`, t).put(`B${r}`, pre, { nf: NF.num }).put(`C${r}`, fx(`IFERROR(B${r}/$B$19,0)`), { nf: NF.pct })
      .put(`D${r}`, nw, { nf: NF.num, ...(typeof nw === "number" ? { color: BLACK } : {}) }).put(`E${r}`, fx(`B${r}+D${r}`), { nf: NF.num }).put(`F${r}`, fx(`E${r}/$E$19`), { nf: NF.pct });
  }
  s.label("A19", "Total", { b: true, bt: "thin" });
  for (const c of ["B", "C", "D", "E", "F"]) s.put(`${c}19`, fx(`SUM(${c}15:${c}18)`), { nf: c === "C" || c === "F" ? NF.pct : NF.num, b: true, bt: "thin" });
  return { sheets: [s.sheet()], anchors: { table: `${name}!A14:F19`, price: `${name}!C11`, post: `${name}!C7` }, notes: [] };
}

/* ---------------- Blank ---------------- */

export function blankSheet(name = "Sheet1"): SheetData {
  return { id: newId("sh"), name, cells: {}, cols: { A: 220 } };
}

export function workbookOf(sheets: SheetData[], names?: Record<string, string>): Workbook {
  return { order: sheets.map((s) => s.id), sheets: Object.fromEntries(sheets.map((s) => [s.id, s])), ...(names ? { names } : {}) };
}

export const TEMPLATES = [
  { id: "dcf", label: "DCF", blurb: "Unlevered free cash flow, WACC build, perpetuity growth, live WACC × growth sensitivity", ticker: true },
  { id: "comps", label: "Trading comps", blurb: "Peer multiples with quartiles and the implied value of the target", ticker: true },
  { id: "valuation", label: "Valuation pack", blurb: "DCF, comps and a summary sheet that feeds a football field, with a linked pitch deck", ticker: true },
  { id: "lbo", label: "LBO", blurb: "Sources and uses, debt schedule with cash sweep, IRR and MOIC, entry × exit sensitivity", ticker: true },
  { id: "merger", label: "Merger model", blurb: "Accretion / dilution with breakeven synergies and a premium × stock-mix grid", ticker: true, second: true },
  { id: "cap_table", label: "Cap table", blurb: "A priced round with option pool top-up and post-money ownership", ticker: false },
  // Crypto (src/lib/studio/crypto-templates.ts): the ticker box takes a token symbol or CoinGecko id.
  { id: "token_multiples", label: "Token multiples", blurb: "A token's market cap and FDV over its fees, revenue and holders' revenue, valued on peer multiples. Type a token (UNI, AAVE)", ticker: true },
  { id: "token_dcf", label: "Token DCF", blurb: "Discounted cash flow to tokenholders with supply dilution from unlocks, and a discount rate × growth grid. Type a token", ticker: true },
  { id: "staking_yield", label: "Staking yield", blurb: "Nominal and real staking yield, holder dilution and value from fees to stakers. Type a token (ETH, SOL)", ticker: true },
  { id: "crypto_comps", label: "Crypto comps", blurb: "Peer tokens on market cap and FDV over fees, revenue and value locked, with the implied price. Type a token", ticker: true },
  { id: "blank", label: "Blank workbook", blurb: "An empty sheet: upload a file or ask the agent to build anything", ticker: false },
] as const;
export type TemplateId = (typeof TEMPLATES)[number]["id"];
