/**
 * Crypto model templates: token valuation three ways (fee and revenue multiples, a discounted token
 * cash flow, staking yield) and crypto comps. Same conventions as ./templates: blue inputs, black
 * formulas, every assumption its own cell; USD millions, supplies in millions of tokens, so value per
 * token comes out in dollars. Pure, for tests: data arrives as a `TokenFin`
 * (src/lib/crypto/studio-data.ts fills one from CoinGecko and DefiLlama).
 *
 * The arithmetic mirrors src/lib/crypto/valuation.ts; scripts/test-crypto.ts checks they agree.
 */
import { BLACK, fx, KEY, NF, NOTE, SheetBuilder, type Built } from "./templates";
import type { CellStyle, Scalar } from "./types";
import { newId } from "./types";

export type TokenFin = {
  id: string; symbol: string; name: string; category: string;
  /** USD per token. */
  price: number;
  /** Millions of tokens. */
  circulating: number; fullyDiluted: number;
  /** USD millions a year (the last 30 days annualised, or the last 365). */
  /** Maximum supply in millions of tokens, null when uncapped (ETH, SOL). Absent: the fully diluted supply is the cap. */
  maxSupply?: number | null;
  fees: number; revenue: number; holdersRevenue: number; tvl: number;
  source: string; asOf: string | null; illustrative: boolean;
};

export const ILLUSTRATIVE_TOKEN: TokenFin = {
  id: "example", symbol: "TKN", name: "Example Protocol", category: "Dexs", price: 2.5, circulating: 400, fullyDiluted: 1000,
  fees: 300, revenue: 90, holdersRevenue: 45, tvl: 2000, source: "Illustrative inputs", asOf: null, illustrative: true,
};

/** Illustrative peers for comps when no token is given. */
export const ILLUSTRATIVE_PEERS: TokenFin[] = [
  { ...ILLUSTRATIVE_TOKEN, id: "alpha", symbol: "ALP", name: "Alpha DEX", price: 8, circulating: 600, fullyDiluted: 1000, fees: 900, revenue: 150, holdersRevenue: 120, tvl: 5000 },
  { ...ILLUSTRATIVE_TOKEN, id: "beta", symbol: "BET", name: "Beta Lending", price: 120, circulating: 15, fullyDiluted: 16, fees: 600, revenue: 110, holdersRevenue: 40, tvl: 20000 },
  { ...ILLUSTRATIVE_TOKEN, id: "gamma", symbol: "GAM", name: "Gamma Perps", price: 1.2, circulating: 1500, fullyDiluted: 5000, fees: 400, revenue: 200, holdersRevenue: 180, tvl: 600 },
  { ...ILLUSTRATIVE_TOKEN, id: "delta", symbol: "DEL", name: "Delta Liquid Staking", price: 1.8, circulating: 900, fullyDiluted: 1000, fees: 1000, revenue: 100, holdersRevenue: 0, tvl: 30000 },
];

const sourceNote = (t: TokenFin) => t.illustrative
  ? "Illustrative inputs: replace the blue cells. USD millions; supplies in millions of tokens; per-token figures in dollars."
  : `USD millions; supplies in millions of tokens. Price and supply from CoinGecko${t.asOf ? ` as of ${t.asOf.slice(0, 10)}` : ""}; fees and revenue from DefiLlama, the last 30 days annualised. Blue = input, black = formula.`;

const inputs = (s: SheetBuilder, rows: [number, string, Scalar | ReturnType<typeof fx>, string, CellStyle?][]) => {
  for (const [r, t, v, nf, st] of rows) { s.label(`A${r}`, t, st?.b ? { b: true } : {}); s.put(`C${r}`, v, { nf, ...st }); }
};
/** Six significant figures: rounding to cents or tenths sent a sub-cent price (or a supply under 50,000 tokens) to zero, and with it the market cap. */
const sig = (x: number) => (Number.isFinite(x) && x !== 0 ? Number(x.toPrecision(6)) : 0);
/** Dollars and cents, or six decimals for a token priced under a dollar. */
const pxFmt = (price: number) => (price > 0 && price < 1 ? "$#,##0.000000_);($#,##0.000000)" : NF.px);

/* ---------------- Fee and revenue multiples ---------------- */

export function buildTokenMultiples(t: TokenFin, name = "Token multiples"): Built {
  const s = new SheetBuilder(name);
  s.title(`${t.name} (${t.symbol}): fee and revenue multiples`, sourceNote(t)).widths({ A: 300, B: 20, C: 96, D: 96, E: 96 });
  s.band(4, "Token and network", "E");
  inputs(s, [
    [5, "Token price (USD)", sig(t.price), pxFmt(t.price)], [6, "Circulating supply (mm tokens)", sig(t.circulating), NF.num], [7, "Fully diluted supply (mm tokens)", sig(t.fullyDiluted), NF.num],
    [8, "Market cap", fx("C5*C6"), NF.num, { b: true }], [9, "Fully diluted value (FDV)", fx("C5*C7"), NF.num, { b: true }],
    [10, "Annual fees (paid by users)", sig(t.fees), NF.num], [11, "Annual revenue (kept by the protocol)", sig(t.revenue), NF.num],
    [12, "Annual holders' revenue (reaches tokenholders)", sig(t.holdersRevenue), NF.num], [13, "Value locked (TVL)", sig(t.tvl), NF.num],
  ]);
  s.band(15, "Multiples", "E", { C: "Market cap", D: "FDV" });
  const mult: [number, string, string][] = [[16, "x fees", "C10"], [17, "x revenue", "C11"], [18, "x holders' revenue", "C12"], [19, "x value locked", "C13"]];
  for (const [r, t2, den] of mult) { s.label(`A${r}`, t2); s.put(`C${r}`, fx(`IF(${den}>0,C8/${den},"NM")`), { nf: NF.mult, al: "right" }).put(`D${r}`, fx(`IF(${den}>0,C9/${den},"NM")`), { nf: NF.mult, al: "right" }); }
  s.label("A20", "Take rate (revenue as a share of fees)").put("C20", fx(`IF(C10>0,C11/C10,"NM")`), { nf: NF.pct, al: "right" });
  s.label("A21", "Float (market cap as a share of FDV)").put("C21", fx(`IF(C9>0,C8/C9,"NM")`), { nf: NF.pct, al: "right" });

  s.band(23, "Implied value from peer multiples", "E", { C: "Low", D: "Mid", E: "High" });
  const block = (r: number, label: string, metric: string, supply: string, vals: [number, number, number], basis: string) => {
    s.label(`A${r}`, label);
    (["C", "D", "E"] as const).forEach((c, i) => s.put(`${c}${r}`, vals[i], { nf: NF.mult }));
    s.label(`A${r + 1}`, `Implied ${basis}`);
    s.label(`A${r + 2}`, "Implied price per token", { b: true });
    s.label(`A${r + 3}`, "Upside / (downside) to the price");
    for (const c of ["C", "D", "E"]) {
      s.put(`${c}${r + 1}`, fx(`${c}${r}*$${metric[0]}$${metric.slice(1)}`), { nf: NF.num });
      s.put(`${c}${r + 2}`, fx(`IF($${supply[0]}$${supply.slice(1)}>0,${c}${r + 1}/$${supply[0]}$${supply.slice(1)},"NM")`), { nf: pxFmt(t.price), b: true, ...(c === "D" ? { fill: KEY } : {}) });
      s.put(`${c}${r + 3}`, fx(`IFERROR(${c}${r + 2}/$C$5-1,"NM")`), { nf: NF.pct });
    }
  };
  block(24, "Peer FDV / revenue multiple", "C11", "C7", [15, 25, 40], "fully diluted value");
  block(29, "Peer market cap / holders' revenue multiple", "C12", "C6", [10, 20, 30], "market cap");
  s.label("A34", "Peer multiples are starting points: take them from the crypto comps template or CRYP and DEFI in the terminal.", { i: true, color: NOTE });
  return {
    sheets: [s.sheet()],
    anchors: { marketCap: `${name}!C8`, fdv: `${name}!C9`, mcapToFees: `${name}!C16`, fdvToRevenue: `${name}!D17`, impliedRevMid: `${name}!D26`, impliedHoldersMid: `${name}!D31`, multiples: `${name}!A15:D21`, implied: `${name}!A23:E32` },
    notes: [],
  };
}

/* ---------------- Discounted token cash flow ---------------- */

export function buildTokenDcf(t: TokenFin, name = "Token DCF"): Built {
  const s = new SheetBuilder(name);
  const base = t.holdersRevenue > 0 ? t.holdersRevenue : t.revenue;
  s.title(`${t.name} (${t.symbol}): discounted token cash flow`, `${sourceNote(t)} Cash flows are what reaches tokenholders; value per token divides by the supply expected in year 5, so unlocks and emissions dilute it.`)
    .widths({ A: 300, B: 92, C: 92, D: 92, E: 92, F: 92, G: 92 });
  s.freeze = { rows: 4, cols: 1 };
  s.band(4, "Assumptions", "G");
  inputs(s, [
    [5, "Token price (USD)", sig(t.price), pxFmt(t.price)], [6, "Circulating supply (mm tokens)", sig(t.circulating), NF.num], [7, "Maximum supply (mm tokens; 0 if uncapped)", sig(t.maxSupply === undefined ? t.fullyDiluted : t.maxSupply ?? 0), NF.num],
    [8, t.holdersRevenue > 0 ? "Holders' cash flow, last year" : "Protocol revenue, last year (no holders' revenue reported)", sig(base), NF.num],
    [9, "Cash flow growth, year 1", 0.3, NF.pct], [10, "Cash flow growth, year 5", 0.08, NF.pct], [11, "Discount rate (crypto cost of capital)", 0.25, NF.pct],
    [12, "Terminal growth", 0.03, NF.pct], [13, "Net supply growth a year (unlocks and emissions)", t.fullyDiluted > t.circulating && t.circulating > 0 ? Math.round(Math.min(0.15, Math.pow(t.fullyDiluted / t.circulating, 1 / 5) - 1) * 1000) / 1000 : 0.02, NF.pct],
  ]);
  const Y = ["C", "D", "E", "F", "G"];
  s.band(15, "Projection", "G", { B: "Last year", C: "Year 1", D: "Year 2", E: "Year 3", F: "Year 4", G: "Year 5" });
  const labels: [number, string, CellStyle?][] = [[16, "Year"], [17, "Cash flow to tokenholders", { b: true }], [18, "  % growth", { i: true }], [19, "Token supply (mm)"], [20, "Discount factor"], [21, "Present value of cash flow", { b: true }]];
  for (const [r, t2, st] of labels) s.label(`A${r}`, t2, st);
  s.put("B16", 0, { nf: NF.int, color: BLACK }).put("B17", fx("C8"), { nf: NF.num, b: true }).put("B19", fx("C6"), { nf: NF.num });
  Y.forEach((c, i) => {
    const p = i === 0 ? "B" : Y[i - 1];
    s.put(`${c}16`, i + 1, { nf: NF.int, color: BLACK })
      .put(`${c}17`, fx(`${p}17*(1+${c}18)`), { nf: NF.num, b: true })
      .put(`${c}18`, fx(`$C$9+($C$10-$C$9)*(${c}16-1)/($G$16-1)`), { nf: NF.pct, i: true })
      .put(`${c}19`, fx(`IF($C$7>0,MIN($C$7,${p}19*(1+$C$13)),${p}19*(1+$C$13))`), { nf: NF.num })
      .put(`${c}20`, fx(`1/(1+$C$11)^${c}16`), { nf: "0.000" })
      .put(`${c}21`, fx(`${c}17*${c}20`), { nf: NF.num, b: true });
  });
  s.band(23, "Value", "G");
  inputs(s, [
    [24, "Sum of present values, years 1 to 5", fx("SUM(C21:G21)"), NF.num], [25, "Terminal value (growing perpetuity)", fx("G17*(1+C12)/(C11-C12)"), NF.num],
    [26, "Present value of terminal value", fx("C25*G20"), NF.num], [27, "Network value to tokenholders", fx("C24+C26"), NF.num, { b: true }],
    [28, "Value per token (on year-5 supply)", fx("IF(G19>0,C27/G19,\"NM\")"), pxFmt(t.price), { b: true, fill: KEY }], [29, "Upside / (downside) to the price", fx("IFERROR(C28/C5-1,\"NM\")"), NF.pct],
    [30, "Terminal value as a share of value", fx("IF(C27>0,C26/C27,\"NM\")"), NF.pct], [31, "Value per token on today's supply (no dilution)", fx("IF(C6>0,C27/C6,\"NM\")"), pxFmt(t.price)],
  ]);
  s.band(33, "Sensitivity: value per token (discount rate down, terminal growth across)", "G");
  s.sens.push({ id: newId("sens"), at: "B34", output: "C28", rowInput: "C11", colInput: "C12", rowValues: [0.15, 0.2, 0.25, 0.3, 0.35], colValues: [0.01, 0.02, 0.03, 0.04, 0.05], nf: pxFmt(t.price), title: "Value per token" });
  return {
    sheets: [s.sheet()],
    anchors: { perToken: `${name}!C28`, upside: `${name}!C29`, value: `${name}!C27`, terminalShare: `${name}!C30`, projection: `${name}!A15:G21`, sensitivity: `${name}!B34:G39` },
    notes: [
      `Growth fades from 30% to 8% and the discount rate is 25%, a venture-style rate for a token's risk: starting assumptions to edit.${t.holdersRevenue > 0 ? "" : " No holders' revenue is reported, so the model starts from protocol revenue, which overstates what reaches holders unless the protocol distributes it."}`,
      "The sensitivity is a data table: YouBank recomputes it whenever you ask it to refresh sensitivities.",
    ],
  };
}

/* ---------------- Staking yield ---------------- */

export function buildStakingYield(t: TokenFin, name = "Staking yield", opts: { issuanceRate?: number; stakingRatio?: number; burnRate?: number; feesToStakers?: number } = {}): Built {
  const s = new SheetBuilder(name);
  s.title(`${t.name} (${t.symbol}): staking yield and dilution`, `${sourceNote(t)} A staker earns new issuance plus fees; a holder who does not stake is diluted by the issuance.`)
    .widths({ A: 320, B: 20, C: 96, D: 92, E: 92, F: 92, G: 92 });
  s.band(4, "Assumptions", "G");
  inputs(s, [
    [5, "Token price (USD)", sig(t.price), pxFmt(t.price)], [6, "Token supply (mm tokens)", sig(t.circulating), NF.num],
    [7, "Issuance to stakers (% of supply a year)", opts.issuanceRate ?? 0.03, NF.pct], [8, "Share of supply staked", opts.stakingRatio ?? 0.3, NF.pct],
    [9, "Fees and MEV paid to stakers a year", sig(opts.feesToStakers ?? (t.holdersRevenue || t.revenue * 0.5)), NF.num], [10, "Tokens burned (% of supply a year)", opts.burnRate ?? 0, NF.pct],
    [11, "Required real return for holding the token", 0.12, NF.pct], [12, "Long-run growth of fees to stakers", 0.03, NF.pct],
  ]);
  s.band(14, "Yields", "G");
  inputs(s, [
    [15, "Tokens staked (mm)", fx("C6*C8"), NF.num], [16, "New tokens issued a year (mm)", fx("C6*C7"), NF.num], [17, "Fees to stakers in tokens a year (mm)", fx("IF(C5>0,C9/C5,0)"), NF.num],
    [18, "Nominal staking yield", fx("IF(C15>0,(C16+C17)/C15,\"NM\")"), NF.pct, { b: true }], [19, "Net supply inflation", fx("C7-C10"), NF.pct],
    [20, "Real staking yield (after inflation)", fx("IFERROR((1+C18)/(1+C19)-1,\"NM\")"), NF.pct, { b: true, fill: KEY }], [21, "Fee yield (the part not paid in new tokens)", fx("IF(C15>0,C17/C15,\"NM\")"), NF.pct],
    [22, "Dilution of a holder who does not stake", fx("1/(1+C19)-1"), NF.pct],
  ]);
  s.band(24, "Value from fees to stakers", "G");
  inputs(s, [
    [25, "Value of the fee stream (fees / (required return - growth))", fx("IF(C11>C12,C9/(C11-C12),\"NM\")"), NF.num], [26, "Value per token on today's supply", fx("IFERROR(C25/C6,\"NM\")"), pxFmt(t.price), { b: true }],
    [27, "Upside / (downside) to the price", fx("IFERROR(C26/C5-1,\"NM\")"), NF.pct],
  ]);
  s.band(29, "Sensitivity: real staking yield (share staked down, issuance across)", "G");
  s.sens.push({ id: newId("sens"), at: "B30", output: "C20", rowInput: "C8", colInput: "C7", rowValues: [0.1, 0.2, 0.3, 0.5, 0.7], colValues: [0.01, 0.02, 0.03, 0.05, 0.08], nf: NF.pct, title: "Real staking yield" });
  return {
    sheets: [s.sheet()],
    anchors: { nominal: `${name}!C18`, real: `${name}!C20`, dilution: `${name}!C22`, perToken: `${name}!C26`, yields: `${name}!A14:C22`, sensitivity: `${name}!B30:G35` },
    notes: ["Issuance, staking ratio and burn are starting assumptions: take them from the network's own dashboard (for Ether, about 0.5% net issuance and about 30% staked).", "The sensitivity is a data table: YouBank recomputes it whenever you ask it to refresh sensitivities."],
  };
}

/* ---------------- Crypto comps ---------------- */

export function buildCryptoComps(target: TokenFin, peers: TokenFin[], name = "Crypto comps"): Built {
  const s = new SheetBuilder(name);
  s.title(`${target.name} (${target.symbol}): crypto comparables`, `${sourceNote(target)} NM = not meaningful (no fees, revenue or holders' revenue).`)
    .widths({ A: 200, B: 60, C: 80, D: 92, E: 92, F: 88, G: 88, H: 88, I: 92, J: 78, K: 78, L: 78, M: 84, N: 78 });
  s.freeze = { rows: 4, cols: 2 };
  s.band(4, "Token", "N", { B: "Symbol", C: "Price", D: "Market cap", E: "FDV", F: "Fees", G: "Revenue", H: "To holders", I: "Value locked", J: "Mcap / fees", K: "FDV / fees", L: "FDV / revenue", M: "Mcap / holders", N: "Mcap / TVL" });
  const row = (r: number, c: TokenFin, bold = false) => {
    const st: CellStyle = bold ? { b: true } : {};
    s.label(`A${r}`, c.name, st).put(`B${r}`, c.symbol, { ...st, color: BLACK })
      .put(`C${r}`, sig(c.price), { nf: pxFmt(c.price), ...st }).put(`D${r}`, sig(c.price * c.circulating), { nf: NF.num, ...st }).put(`E${r}`, sig(c.price * c.fullyDiluted), { nf: NF.num, ...st })
      .put(`F${r}`, sig(c.fees), { nf: NF.num, ...st }).put(`G${r}`, sig(c.revenue), { nf: NF.num, ...st }).put(`H${r}`, sig(c.holdersRevenue), { nf: NF.num, ...st }).put(`I${r}`, sig(c.tvl), { nf: NF.num, ...st });
    const m = (col: string, num: string, den: string) => s.put(`${col}${r}`, fx(`IF(${den}${r}>0,${num}${r}/${den}${r},"NM")`), { nf: NF.mult, al: "right", ...st });
    m("J", "D", "F"); m("K", "E", "F"); m("L", "E", "G"); m("M", "D", "H"); m("N", "D", "I");
  };
  const first = 5, last = first + Math.max(peers.length, 1) - 1;
  peers.forEach((p, i) => row(first + i, p));
  if (!peers.length) s.label(`A${first}`, "Add peers here", { i: true, color: NOTE });
  const stats: [string, (col: string) => string][] = [
    ["Maximum", (c) => `MAX(${c}${first}:${c}${last})`], ["75th percentile", (c) => `QUARTILE(${c}${first}:${c}${last},3)`], ["Median", (c) => `MEDIAN(${c}${first}:${c}${last})`],
    ["Mean", (c) => `AVERAGE(${c}${first}:${c}${last})`], ["25th percentile", (c) => `QUARTILE(${c}${first}:${c}${last},1)`], ["Minimum", (c) => `MIN(${c}${first}:${c}${last})`],
  ];
  const s0 = last + 2;
  stats.forEach(([label, f], i) => {
    const r = s0 + i;
    s.label(`A${r}`, label, { b: label === "Median", ...(i === 0 ? { bt: "thin" as const } : {}) });
    for (const c of ["J", "K", "L", "M", "N"]) s.put(`${c}${r}`, fx(`IFERROR(${f(c)},"NM")`), { nf: NF.mult, al: "right", b: label === "Median", ...(i === 0 ? { bt: "thin" as const } : {}) });
  });
  const q1 = s0 + 4, med = s0 + 2, q3 = s0 + 1;
  const tr = s0 + stats.length + 1;
  row(tr, target, true);
  s.style(`A${tr}`, { fill: KEY });

  const b0 = tr + 2;
  s.band(b0, `Implied value of ${target.symbol}`, "N", { B: "Metric", C: "25th pct.", D: "Median", E: "75th pct.", F: "Value low", G: "Value mid", H: "Value high", I: "Price low", J: "Price mid", K: "Price high" });
  // Supplies backed out of the target row: FDV / price and market cap / price.
  s.label(`A${b0 + 3}`, "Fully diluted supply (mm tokens)").put(`B${b0 + 3}`, fx(`IF(C${tr}>0,E${tr}/C${tr},0)`), { nf: NF.num });
  s.label(`A${b0 + 4}`, "Circulating supply (mm tokens)").put(`B${b0 + 4}`, fx(`IF(C${tr}>0,D${tr}/C${tr},0)`), { nf: NF.num });
  const implied = (r: number, label: string, metric: string, col: string, supplyRow: number) => {
    s.label(`A${r}`, label).put(`B${r}`, fx(metric), { nf: NF.num });
    s.put(`C${r}`, fx(`${col}${q1}`), { nf: NF.mult }).put(`D${r}`, fx(`${col}${med}`), { nf: NF.mult }).put(`E${r}`, fx(`${col}${q3}`), { nf: NF.mult });
    for (const [vc, mc] of [["F", "C"], ["G", "D"], ["H", "E"]]) s.put(`${vc}${r}`, fx(`IFERROR($B${r}*${mc}${r},"NM")`), { nf: NF.num });
    for (const [pc, vc] of [["I", "F"], ["J", "G"], ["K", "H"]]) s.put(`${pc}${r}`, fx(`IFERROR(${vc}${r}/$B$${supplyRow},"NM")`), { nf: pxFmt(target.price), b: pc === "J" });
  };
  implied(b0 + 1, "FDV / revenue", `G${tr}`, "L", b0 + 3);
  implied(b0 + 2, "Market cap / holders' revenue", `H${tr}`, "M", b0 + 4);
  return {
    sheets: [s.sheet()],
    anchors: { table: `${name}!A4:N${s0 + stats.length - 1}`, targetRow: `${name}!A${tr}:N${tr}`, medianFdvRevenue: `${name}!L${med}`, medianMcapHolders: `${name}!M${med}`, revPriceMid: `${name}!J${b0 + 1}`, holdersPriceMid: `${name}!J${b0 + 2}`, implied: `${name}!A${b0}:K${b0 + 2}` },
    notes: [],
  };
}

/** The crypto templates, for the Studio gallery and the agent. */
export const CRYPTO_TEMPLATE_IDS = ["token_multiples", "token_dcf", "staking_yield", "crypto_comps"] as const;
export type CryptoTemplateId = (typeof CRYPTO_TEMPLATE_IDS)[number];
export const isCryptoTemplate = (id: string): id is CryptoTemplateId => (CRYPTO_TEMPLATE_IDS as readonly string[]).includes(id);
