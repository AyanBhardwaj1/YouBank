"use client";

/**
 * Driver forecasts: where the market, oil and gas stocks, crude, gas and the 10-year yield may go over
 * the next weeks, as a median and a 10-90% band after the last two years. The free forecast (drift and
 * volatility) is open to everyone; TimesFM through BigQuery is premium, with its badge, and runs only
 * when pressed. Both are drawn alike so they can be compared.
 */
import { useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { PlanNotice } from "@/components/billing/PlanNotice";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import type { DriverForecast as Forecast } from "@/lib/edge/premium/timesfm";
import { post } from "../client";

/** The drivers (lib/edge/scen/data.ts holds the same; that module reads files on the server, so it stays there). */
const DRIVERS: { id: string; label: string }[] = [
  { id: "market", label: "U.S. stock market" }, { id: "energy", label: "Oil and gas stocks" }, { id: "oil", label: "WTI crude" },
  { id: "gas", label: "Henry Hub gas" }, { id: "rates", label: "10-year Treasury yield" },
];

const fmt = (f: Forecast, v: number, dp = 1) => (f.unit === "pp" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)} pts` : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`);

function Chart({ f }: { f: Forecast }) {
  const W = 640, H = 200, L = 52, R = 10, T = 12, B = 22;
  const all = [...f.history.map((h) => h.value), ...f.points.flatMap((p) => [p.p10, p.p90]), 0];
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 0.01;
  const n = f.history.length + f.points.length;
  const x = (i: number) => L + (i / Math.max(1, n - 1)) * (W - L - R), y = (v: number) => T + (1 - (v - lo) / span) * (H - T - B);
  const h0 = f.history.length - 1;
  const hist = `M${f.history.map((h, i) => `${x(i)},${y(h.value)}`).join(" L")}`;
  const ahead = [{ p10: 0, p50: 0, p90: 0 }, ...f.points];
  const band = `M${ahead.map((p, i) => `${x(h0 + i)},${y(p.p90)}`).join(" L")} L${[...ahead].reverse().map((p, i) => `${x(h0 + ahead.length - 1 - i)},${y(p.p10)}`).join(" L")} Z`;
  const mid = `M${ahead.map((p, i) => `${x(h0 + i)},${y(p.p50)}`).join(" L")}`;
  const end = f.points[f.points.length - 1];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`${f.label}: median ${fmt(f, end.p50)} in ${f.horizonWeeks} weeks, 10-90% from ${fmt(f, end.p10)} to ${fmt(f, end.p90)}`}>
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeDasharray="3 3" />
        {[lo, hi].map((t, i) => <text key={i} x={L - 6} y={y(t) + 3} textAnchor="end" style={{ font: "10px var(--font-mono, monospace)", fill: "var(--muted)" }}>{fmt(f, t, 0)}</text>)}
        <line x1={x(h0)} x2={x(h0)} y1={T} y2={H - B} stroke="var(--line)" />
        <text x={x(h0) + 4} y={H - 6} style={{ font: "10px var(--font-sans, system-ui)", fill: "var(--muted)" }}>{f.asOf}</text>
        <path d={hist} fill="none" stroke="var(--fg)" strokeWidth={1.2} opacity={0.7} />
        <path d={band} fill="var(--accent)" opacity={0.16} />
        <path d={mid} fill="none" stroke="var(--accent)" strokeWidth={2} />
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-3 text-[10.5px] text-muted">
        <span className="font-medium text-fg">{f.label}, change from {f.asOf}</span>
        <span>median {fmt(f, end.p50)} in {f.horizonWeeks} weeks</span><span>10-90% {fmt(f, end.p10)} to {fmt(f, end.p90)}</span>
      </figcaption>
    </figure>
  );
}

export function DriverForecast() {
  const [factor, setFactor] = useState<string>("oil");
  const [horizon, setHorizon] = useState("26");
  const [busy, setBusy] = useState<"free" | "timesfm" | null>(null);
  const [results, setResults] = useState<Forecast[]>([]);
  const [error, setError] = useState<unknown>(null);
  const run = (timesfm: boolean) => {
    setBusy(timesfm ? "timesfm" : "free"); setError(null);
    post<Forecast>("/api/edge/scenarios/forecast", { factor, horizon: Number(horizon), timesfm })
      .then((f) => setResults((r) => [f, ...r.filter((x) => !(x.factor === f.factor && x.method === f.method))].slice(0, 4)), setError)
      .finally(() => setBusy(null));
  };
  return (
    <section className="panel space-y-3 p-3" aria-label="Driver forecasts">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <Icon name="LineChart" className="h-4 w-4 text-accent" />
        <span className="text-[13px] font-semibold">Driver forecasts</span>
        <Select value={factor} onChange={setFactor} aria-label="Driver" className="ctl border border-line bg-bg px-2 py-0.5 text-left text-[11.5px]">
          {DRIVERS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </Select>
        <Select value={horizon} onChange={setHorizon} aria-label="Horizon" className="ctl border border-line bg-bg px-2 py-0.5 text-left text-[11.5px]">
          <option value="4">4 weeks</option><option value="13">13 weeks</option><option value="26">26 weeks</option><option value="52">52 weeks</option>
        </Select>
        <button type="button" disabled={!!busy} onClick={() => run(false)} className="ctl border border-line px-2.5 py-1 text-[12px] hover:border-accent/50 disabled:opacity-50">{busy === "free" ? "Forecasting…" : "Forecast"}</button>
        <button type="button" disabled={!!busy} onClick={() => run(true)} className="ctl flex items-center gap-1.5 border border-accent/50 px-2.5 py-1 text-[12px] text-accent hover:bg-accent-soft disabled:opacity-50">{busy === "timesfm" ? "Asking TimesFM…" : "Forecast with TimesFM"}<PremiumBadge feature="edge.timesfm" /></button>
      </div>
      <p className="text-[11px] text-muted">A view of the drivers your scenarios move, not a trading signal. The free forecast follows the recent average and volatility; TimesFM is Google&apos;s time-series foundation model.</p>
      {!!error && <PlanNotice error={error} />}
      {results.map((f) => (
        <div key={`${f.factor}-${f.method}`} className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">{f.method === "timesfm" ? f.model : "Drift and volatility"}</div>
          <Chart f={f} />
          <p className="text-[10.5px] text-faint">{f.note}</p>
        </div>
      ))}
    </section>
  );
}
