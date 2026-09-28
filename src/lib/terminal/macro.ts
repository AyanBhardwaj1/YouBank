/**
 * Macro views behind ECO (the economy) and GC (the Treasury curve).
 *
 * Data sources are chosen by licence. FRED series are displayed with attribution and nothing more.
 * Forecasts run only on primary, public-domain data: BLS for inflation, jobs and wages, and the
 * Treasury for the curve. On top: the Sahm rule (from BLS unemployment) and the New York Fed's
 * yield-curve recession probability (from Treasury yields).
 */
import { forecast } from "@/lib/inference/forecast";
import { curveShape, nelsonSiegel, recessionProbability, sahmRule, type CurvePoint } from "@/lib/inference/macro";
import { percentRank } from "@/lib/inference/stats";
import { BLS_SERIES, blsSeries, type BlsObs } from "@/lib/market/bls";
import { fredSeries, MACRO_SERIES, type Obs } from "@/lib/market/fred";
import { TENORS, treasuryCurves } from "@/lib/market/treasury";

export type MacroSeries = {
  id: string; label: string; group: string; unit: string; source: string;
  latest: { date: string; value: number } | null; prior: number | null; yearAgo: number | null;
  percentile10y: number | null; spark: number[];
};

export type Outlook = {
  id: string; label: string; unit: string; latest: { date: string; value: number } | null;
  months: string[]; point: number[]; lo80: number[]; hi80: number[];
  backtest: { mape: number | null; coverage80: number | null; origins: number };
};

/** Monthly observations: the last observation of each month (for daily and weekly series). */
function monthly(obs: Obs[]): Obs[] {
  const out: Obs[] = [];
  for (const o of obs) { const m = o.date.slice(0, 7); if (out.length && out[out.length - 1].date.slice(0, 7) === m) out[out.length - 1] = o; else out.push(o); }
  return out;
}

function transform(obs: Obs[], t: "level" | "yoy" | "diff", lag: number): Obs[] {
  if (t === "level") return obs;
  if (t === "yoy") return obs.slice(lag).map((o, i) => ({ date: o.date, value: (o.value / obs[i].value - 1) * 100 }));
  return obs.slice(1).map((o, i) => ({ date: o.date, value: o.value - obs[i].value }));
}

const nextMonths = (last: string, n: number) => Array.from({ length: n }, (_, k) => { const d = new Date(last + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + k + 1); return d.toISOString().slice(0, 7); });

/** Three-month outlooks for the BLS series, forecast on levels and transformed after, with conformal intervals. */
function outlooks(bls: Record<string, BlsObs[]>): Outlook[] {
  const out: Outlook[] = [];
  for (const [id, meta] of Object.entries(BLS_SERIES)) {
    const obs = bls[id] ?? [];
    if (obs.length < 48) continue;
    const levels = obs.map((o) => o.value);
    const f = forecast(levels.slice(-96), 3, { period: 12, model: "damped" });
    const shown = transform(obs, meta.transform, 12);
    const toShown = (lv: number, k: number) => {
      if (meta.transform === "level") return lv;
      if (meta.transform === "diff") return lv - (k === 0 ? levels[levels.length - 1] : f.point[k - 1]);
      const base = levels[levels.length - 12 + k];
      return (lv / base - 1) * 100;
    };
    out.push({
      id, label: meta.label, unit: meta.unit,
      latest: shown.length ? shown[shown.length - 1] : null,
      months: nextMonths(obs[obs.length - 1].date, 3),
      point: f.point.map(toShown), lo80: f.lower80.map(toShown), hi80: f.upper80.map(toShown),
      backtest: { mape: f.backtest.mape, coverage80: f.backtest.coverage80, origins: f.backtest.origins },
    });
  }
  return out;
}

export type MacroView = {
  series: MacroSeries[]; outlooks: Outlook[];
  sahm: ReturnType<typeof sahmRule>; recession: { probability: number; spread: number } | null; asOf: string;
};

export async function macroView(): Promise<MacroView> {
  const start = new Date(Date.now() - 12 * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const [loaded, bls, curves] = await Promise.all([
    Promise.all(MACRO_SERIES.map(async (m) => ({ m, obs: await fredSeries(m.id, start).catch(() => [] as Obs[]) }))),
    blsSeries().catch(() => ({} as Record<string, BlsObs[]>)),
    treasuryCurves().catch(() => []),
  ]);
  const series: MacroSeries[] = loaded.map(({ m, obs }) => {
    const base = m.freq === "daily" || m.freq === "weekly" ? monthly(obs) : obs;
    const lag = m.freq === "quarterly" ? 4 : 12;
    const v = transform(base, m.transform, lag);
    const vals = v.map((o) => o.value);
    const raw = transform(obs, m.transform, m.freq === "weekly" ? 52 : m.freq === "daily" ? 252 : lag);
    const latest = raw[raw.length - 1] ?? null;
    return {
      id: m.id, label: m.label, group: m.group, unit: m.unit, source: m.source,
      latest: latest ? { date: latest.date, value: latest.value } : null,
      prior: vals.length > 1 ? vals[vals.length - 2] : null,
      yearAgo: vals.length > lag ? vals[vals.length - 1 - lag] : null,
      percentile10y: vals.length > 24 ? percentRank(vals[vals.length - 1], vals.slice(-120)) : null,
      spark: vals.slice(-36),
    };
  });
  const unrate = (bls.LNS14000000 ?? []).map((o) => o.value);
  const month = curves.slice(0, 22).filter((c) => c.yields["10 Yr"] !== undefined && c.yields["3 Mo"] !== undefined);
  const spread = month.length ? month.reduce((a, c) => a + c.yields["10 Yr"] - c.yields["3 Mo"], 0) / month.length : null;
  return { series, outlooks: outlooks(bls), sahm: sahmRule(unrate), recession: spread !== null ? { probability: recessionProbability(spread), spread } : null, asOf: new Date().toISOString() };
}

export type CurveView = {
  asOf: string; labels: string[];
  curves: { label: string; date: string; yields: (number | null)[] }[];
  fit: { level: number; slope: number; curvature: number; rmse: number; fitted: number[] } | null;
  shape: ReturnType<typeof curveShape>;
  recession: { probability: number; spread: number } | null;
  history: { date: string; s2s10: number | null; s3m10y: number | null }[];
};

export async function curveView(): Promise<CurveView> {
  const rows = await treasuryCurves();
  if (!rows.length) throw new Error("Treasury rates unavailable");
  const today = rows[0];
  const nearest = (days: number) => { const d = new Date(new Date(today.date + "T00:00:00Z").getTime() - days * 86_400_000).toISOString().slice(0, 10); return rows.find((r) => r.date <= d) ?? rows[rows.length - 1]; };
  const pick = [{ label: "Today", row: today }, { label: "1 week ago", row: nearest(7) }, { label: "1 month ago", row: nearest(30) }, { label: "1 year ago", row: nearest(365) }];
  const points = (r: typeof today): CurvePoint[] => TENORS.filter(([k]) => r.yields[k] !== undefined).map(([k, t]) => ({ tenorYears: t, yield: r.yields[k] }));
  const ns = nelsonSiegel(points(today));
  const month = rows.slice(0, 22).filter((r) => r.yields["10 Yr"] !== undefined && r.yields["3 Mo"] !== undefined);
  const spread = month.length ? month.reduce((a, r) => a + r.yields["10 Yr"] - r.yields["3 Mo"], 0) / month.length : null;
  const at = (r: typeof today, k: string) => (r.yields[k] !== undefined ? r.yields[k] : null);
  return {
    asOf: today.date, labels: TENORS.map(([k]) => k.replace(" Mo", "M").replace(" Yr", "Y")),
    curves: pick.map((p) => ({ label: p.label, date: p.row.date, yields: TENORS.map(([k]) => at(p.row, k)) })),
    fit: ns ? { level: ns.level, slope: ns.slope, curvature: ns.curvature, rmse: ns.rmse, fitted: TENORS.map(([, t]) => ns.fitted(t)) } : null,
    shape: curveShape(points(today)),
    recession: spread !== null ? { probability: recessionProbability(spread), spread } : null,
    history: [...rows].reverse().map((r) => ({ date: r.date, s2s10: r.yields["10 Yr"] !== undefined && r.yields["2 Yr"] !== undefined ? r.yields["10 Yr"] - r.yields["2 Yr"] : null, s3m10y: r.yields["10 Yr"] !== undefined && r.yields["3 Mo"] !== undefined ? r.yields["10 Yr"] - r.yields["3 Mo"] : null })),
  };
}
