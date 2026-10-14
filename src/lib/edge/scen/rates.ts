/**
 * The LBO Stress Lab's (E6) short-rate driver: a two-regime AR(1) on the monthly short rate. Each month the
 * rate moves toward its regime's level at its regime's speed, plus a shock of its regime's size; the regime
 * (calm or stressed) switches by a Markov chain. Fitted on month-end 3-month Treasury bill yields from the
 * Treasury's own daily curve files (public domain), anchored to today's SOFR from the New York Fed's public
 * API. The shock is joined to the factor paths through the 10-year yield's standardised move (correlation
 * estimated from the same history), so rates and the market move together as they did.
 *
 * When the history cannot be read, stated default parameters are used and the result says so. Pure apart
 * from `rateHistory()`, which fetches and caches the history in R2 for a week.
 */
import { logError } from "@/lib/errors";
import { getJson, putJson, r2Ready } from "../infra/r2";
import { mean, std } from "./stats";

export type Regime = { mu: number; phi: number; sigma: number };
export type RateModel = {
  regimes: [Regime, Regime]; P: [[number, number], [number, number]];
  /** Today's short rate (%), the regime it starts in, and SOFR minus the bill yield (%). */
  start: number; startRegime: 0 | 1; basis: number;
  /** Correlation of the rate shock with the 10-year yield factor's standardised move. */
  rho: number;
  fitted: { months: number; from: string; to: string } | null;
  source: string;
};

/** Stated defaults: calm drifts slowly toward 2.75% with 12bp monthly moves; stressed toward 2% with 45bp moves. */
export const DEFAULT_RATES: RateModel = {
  regimes: [{ mu: 2.75, phi: 0.03, sigma: 0.12 }, { mu: 2.0, phi: 0.06, sigma: 0.45 }], P: [[0.97, 0.03], [0.15, 0.85]],
  start: 4.0, startRegime: 0, basis: 0.05, rho: 0.5, fitted: null,
  source: "stated defaults (the Treasury's bill history could not be read): calm regime toward 2.75% at 3% a month with 12bp moves; stressed toward 2.0% at 6% with 45bp moves",
};

/** OLS of the month's change on last month's level: phi (speed) and mu (level), and the residuals' sd. Pure. */
function ar1(levels: number[], idx: number[]): Regime | null {
  const xs: number[] = [], ys: number[] = [];
  for (const t of idx) if (t > 0) { xs.push(levels[t - 1]); ys.push(levels[t] - levels[t - 1]); }
  if (xs.length < 12) return null;
  const mx = mean(xs), my = mean(ys);
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0), sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const b = sxx > 0 ? sxy / sxx : 0, a = my - b * mx;
  const phi = Math.max(0.005, Math.min(0.5, -b));
  const mu = Math.max(0, Math.min(8, a / phi));
  const resid = ys.map((y, i) => y - (a + b * xs[i]));
  return { mu, phi, sigma: Math.max(0.02, std(resid)) };
}

/**
 * Fit the two regimes on month-end levels (%): months whose trailing six-month volatility of changes is in the
 * top quarter are stressed; each regime gets its own AR(1); switches are counted. Pure.
 */
export function fitRates(levels: number[], opts: { from?: string; to?: string; rates10y?: number[] } = {}): RateModel | null {
  if (levels.length < 60) return null;
  const d = levels.map((v, t) => (t ? v - levels[t - 1] : 0));
  const vol = d.map((_, t) => (t < 6 ? NaN : std(d.slice(t - 5, t + 1))));
  const cut = [...vol.filter(Number.isFinite)].sort((a, b) => a - b)[Math.floor(vol.filter(Number.isFinite).length * 0.75)] ?? Infinity;
  const reg = vol.map((v) => (Number.isFinite(v) && v >= cut ? 1 : 0));
  const calm = ar1(levels, reg.map((r, t) => (r === 0 ? t : -1)).filter((t) => t > 0));
  const stressed = ar1(levels, reg.map((r, t) => (r === 1 ? t : -1)).filter((t) => t > 0));
  if (!calm || !stressed) return null;
  const n = [[1, 1], [1, 1]];
  for (let t = 7; t < reg.length; t++) n[reg[t - 1]][reg[t]]++;
  const P: RateModel["P"] = [[n[0][0] / (n[0][0] + n[0][1]), n[0][1] / (n[0][0] + n[0][1])], [n[1][0] / (n[1][0] + n[1][1]), n[1][1] / (n[1][0] + n[1][1])]];
  let rho = 0.5;
  if (opts.rates10y && opts.rates10y.length === levels.length) {
    const a = d.slice(1), b = opts.rates10y.slice(1);
    const ma = mean(a), mb = mean(b), sa = std(a), sb = std(b);
    if (sa > 0 && sb > 0) rho = Math.max(-0.95, Math.min(0.95, a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / ((a.length - 1) * sa * sb)));
  }
  return {
    regimes: [calm, { ...stressed, sigma: Math.max(stressed.sigma, calm.sigma) }], P, start: levels[levels.length - 1], startRegime: reg[reg.length - 1] as 0 | 1, basis: 0.05, rho,
    fitted: { months: levels.length, from: opts.from ?? "", to: opts.to ?? "" },
    source: `two-regime AR(1) fitted on ${levels.length} month-end 3-month Treasury bill yields${opts.from ? ` (${opts.from} to ${opts.to})` : ""}, U.S. Treasury (public domain)`,
  };
}

/** Whether every regime mean-reverts (0 < phi < 2), so simulated rates cannot wander off. Pure. */
export const stationary = (m: RateModel) => m.regimes.every((r) => r.phi > 0 && r.phi < 2);

/**
 * One path of monthly short rates (%), floored at zero: `z(m)` is the factor's standardised shock that month
 * (the correlated part), `u` and `n` the path's uniforms and normals. Pure.
 */
export function rateStep(m: RateModel): (z: number, u: () => number, n: () => number) => number {
  let r = m.start, s: 0 | 1 = m.startRegime;
  return (z, u, n) => {
    const g = m.regimes[s];
    const e = m.rho * z + Math.sqrt(Math.max(0, 1 - m.rho * m.rho)) * n();
    r = Math.max(0, r + g.phi * (g.mu - r) + g.sigma * e);
    s = u() < m.P[s][1] ? 1 : 0;
    return r;
  };
}

/** Month-end 3-month bill yields (%) from a Treasury daily curve CSV. Pure. */
export function monthEnds(csv: string): { month: string; y3m: number; y10: number | null }[] {
  const [head, ...lines] = csv.trim().split("\n");
  const cols = head.split(",").map((c) => c.replace(/"/g, "").trim());
  const i3 = cols.indexOf("3 Mo"), i10 = cols.indexOf("10 Yr");
  const last = new Map<string, { date: string; y3m: number; y10: number | null }>();
  for (const l of lines) {
    const v = l.split(","), [mm, dd, yy] = v[0].split("/");
    if (!yy) continue;
    const date = `${yy}-${mm}-${dd}`, y3 = Number(v[i3]), y10 = Number(v[i10]);
    if (i3 < 0 || v[i3] === "" || !Number.isFinite(y3)) continue;
    const month = date.slice(0, 7), cur = last.get(month);
    if (!cur || cur.date < date) last.set(month, { date, y3m: y3, y10: i10 >= 0 && v[i10] !== "" && Number.isFinite(y10) ? y10 : null });
  }
  return [...last.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, x]) => ({ month, y3m: x.y3m, y10: x.y10 }));
}

const KEY = "scen/rates-v1.json";
let memo: { at: number; model: RateModel } | null = null;

/**
 * The fitted rate model: from memory, R2 (a week old at most), or the Treasury's yearly curve files since 2001
 * and SOFR's latest print. Never throws: on failure, the stated defaults with today's bill yield if known.
 */
export async function rateModel(): Promise<RateModel> {
  if (memo && Date.now() - memo.at < 6 * 3_600_000) return memo.model;
  if (r2Ready()) {
    const c = await getJson<{ builtAt: string; model: RateModel }>(KEY).catch(() => null);
    if (c?.model && Date.now() - Date.parse(c.builtAt) < 7 * 86_400_000) { memo = { at: Date.now(), model: c.model }; return c.model; }
  }
  let model: RateModel = DEFAULT_RATES;
  try {
    const now = new Date().getUTCFullYear();
    const years = Array.from({ length: now - 2001 + 1 }, (_, i) => 2001 + i);
    const rows: ReturnType<typeof monthEnds> = [];
    for (let i = 0; i < years.length; i += 6) {
      const got = await Promise.all(years.slice(i, i + 6).map(async (y) => {
        const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`;
        const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
        return r.ok ? monthEnds(await r.text()) : [];
      }));
      rows.push(...got.flat());
    }
    rows.sort((a, b) => a.month.localeCompare(b.month));
    const ok = rows.filter((r) => r.y10 !== null);
    const fit = fitRates(ok.map((r) => r.y3m), { from: ok[0]?.month, to: ok.at(-1)?.month, rates10y: ok.map((r) => r.y10!) });
    const sofr = await fetch("https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json", { signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { refRates?: { percentRate?: number; effectiveDate?: string }[] } | null;
    const s = sofr?.refRates?.[0]?.percentRate;
    if (fit) model = { ...fit, ...(typeof s === "number" && Number.isFinite(s) ? { basis: Math.max(-0.5, Math.min(0.5, s - fit.start)), source: `${fit.source}; anchored to SOFR ${s.toFixed(2)}% (${sofr?.refRates?.[0]?.effectiveDate ?? "latest"}, Federal Reserve Bank of New York)` } : {}) };
    else if (rows.length) model = { ...DEFAULT_RATES, start: rows[rows.length - 1].y3m };
  } catch (e) { logError(e, { where: "edge-scen-rates" }); }
  if (r2Ready() && model.fitted) await putJson(KEY, { builtAt: new Date().toISOString(), model }).catch(() => undefined);
  memo = { at: Date.now(), model };
  return model;
}
