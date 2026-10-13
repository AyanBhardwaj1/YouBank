"use client";

/**
 * Scenario pieces shared by every tab: the "synthetic" tag (recipe and seed on everything), the fan
 * chart of simulated paths, the histogram of outcomes, the realism panel that sets the synthetic days
 * beside the real ones (each stylised fact with its bootstrap band), and the privacy panel for tables.
 */
import { AlertTriangle, Check, ChevronDown, FlaskConical, X } from "lucide-react";
import { useState } from "react";
import type { Fan } from "@/lib/edge/scen/models";
import type { Check as RealismCheck } from "@/lib/edge/scen/realism";
import type { Realism } from "@/lib/edge/scen/stats";
import type { Privacy } from "@/lib/edge/scen/tables";

export const pct = (v: number, dp = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`;
export const money = (v: number) => (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${Math.round(v).toLocaleString("en-US")}`);

/** The label every synthetic number carries: what made it and how to make it again. */
export function SyntheticTag({ recipe, seed, paths, fictional }: { recipe: string; seed: number; paths?: number; fictional?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-accent/40 bg-accent-soft/60 px-2.5 py-1.5 text-[11px] text-accent">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-1.5 text-left">
        <FlaskConical className="h-3.5 w-3.5 shrink-0" />
        <span className="font-semibold uppercase tracking-wider">{fictional ? "Fictional" : "Synthetic"}</span>
        <span className="text-accent/80">· seed {seed}{paths ? ` · ${paths.toLocaleString("en-US")} paths` : ""}</span>
        <ChevronDown className={`ml-auto h-3 w-3 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <p className="mt-1 leading-relaxed text-fg/80">{recipe}</p>}
    </div>
  );
}

/** A fan of simulated paths: the 5-95 and 25-75 bands, the median, and a few sample paths. */
export function FanChart({ fan, checkpoints, samples, height = 220, label }: { fan: Fan; checkpoints: number[]; samples?: number[][]; height?: number; label?: string }) {
  const W = 640, H = height, L = 44, R = 10, T = 12, B = 22;
  const all = [...fan.p5, ...fan.p95, 0, ...(samples ?? []).flat()];
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 0.01;
  const days = checkpoints[checkpoints.length - 1] || 1;
  const x = (d: number) => L + (d / days) * (W - L - R), y = (v: number) => T + (1 - (v - lo) / span) * (H - T - B);
  const pts = [0, ...checkpoints];
  const band = (a: number[], b: number[]) => `M${pts.map((d, i) => `${x(d)},${y(i ? a[i - 1] : 0)}`).join(" L")} L${[...pts].reverse().map((d, i) => { const k = pts.length - 1 - i; return `${x(d)},${y(k ? b[k - 1] : 0)}`; }).join(" L")} Z`;
  const line = (v: number[]) => `M${pts.map((d, i) => `${x(d)},${y(i ? v[i - 1] : 0)}`).join(" L")}`;
  const ticks = [lo, lo + span / 2, hi];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`${label ?? fan.series}: simulated outcomes from ${pct(fan.p5[fan.p5.length - 1])} to ${pct(fan.p95[fan.p95.length - 1])}, median ${pct(fan.p50[fan.p50.length - 1])}`}>
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeDasharray="3 3" />
        {ticks.map((t, i) => <text key={i} x={L - 6} y={y(t) + 3} textAnchor="end" style={{ font: "10px var(--font-mono, monospace)", fill: "var(--muted)" }}>{pct(t, 0)}</text>)}
        <text x={W - R} y={H - 6} textAnchor="end" style={{ font: "10px var(--font-sans, system-ui)", fill: "var(--muted)" }}>{days} trading days</text>
        {(samples ?? []).slice(0, 12).map((s, i) => <path key={i} d={`M${s.map((v, d) => `${x(d + 1)},${y(v)}`).join(" L")}`} fill="none" stroke="var(--faint)" strokeWidth={0.7} opacity={0.5} />)}
        <path d={band(fan.p5, fan.p95)} fill="var(--accent)" opacity={0.14} />
        <path d={band(fan.p25, fan.p75)} fill="var(--accent)" opacity={0.22} />
        <path d={line(fan.p50)} fill="none" stroke="var(--accent)" strokeWidth={2} />
        <text x={L + 6} y={T + 10} style={{ font: "600 10px var(--font-sans, system-ui)", fill: "var(--accent)", letterSpacing: "0.08em" }}>SYNTHETIC</text>
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-3 text-[10.5px] text-muted">
        <span className="font-medium text-fg">{label ?? fan.series}</span>
        <span>median {pct(fan.p50[fan.p50.length - 1])}</span><span>middle half {pct(fan.p25[fan.p25.length - 1])} to {pct(fan.p75[fan.p75.length - 1])}</span><span>90% of paths {pct(fan.p5[fan.p5.length - 1])} to {pct(fan.p95[fan.p95.length - 1])}</span>
      </figcaption>
    </figure>
  );
}

/** Outcomes at the horizon as a histogram, with the 5th percentile marked. */
export function Histogram({ edges, counts, p5 }: { edges: number[]; counts: number[]; p5: number }) {
  const W = 320, H = 120, max = Math.max(1, ...counts), bw = W / counts.length;
  const lo = edges[0], hi = edges[edges.length - 1], xAt = (v: number) => ((v - lo) / (hi - lo || 1)) * W;
  return (
    <svg viewBox={`0 0 ${W} ${H + 16}`} className="block h-auto w-full" role="img" aria-label="Distribution of the portfolio's outcome at the horizon">
      {counts.map((c, i) => <rect key={i} x={i * bw + 0.5} y={H - (c / max) * H} width={bw - 1} height={(c / max) * H} fill={edges[i + 1] <= 0 ? "var(--neg)" : "var(--accent)"} opacity={0.55} />)}
      <line x1={xAt(p5)} x2={xAt(p5)} y1={0} y2={H} stroke="var(--neg)" strokeWidth={1.5} strokeDasharray="3 2" />
      <text x={Math.min(W - 40, xAt(p5) + 3)} y={10} style={{ font: "10px var(--font-sans, system-ui)", fill: "var(--neg)" }}>5th pct</text>
      <text x={0} y={H + 13} style={{ font: "10px var(--font-mono, monospace)", fill: "var(--muted)" }}>{pct(lo, 0)}</text>
      <text x={W} y={H + 13} textAnchor="end" style={{ font: "10px var(--font-mono, monospace)", fill: "var(--muted)" }}>{pct(hi, 0)}</text>
    </svg>
  );
}

/** A check's figure in its own unit. */
const fmtCheck = (v: number | null, unit: RealismCheck["unit"]) => (v === null || !Number.isFinite(v) ? "—" : unit === "pct" ? `${(v * 100).toFixed(2)}%` : unit === "share" ? `${Math.round(v * 100)}%` : unit === "ratio" ? `${v.toFixed(2)}×` : v.toFixed(2));

/** A fact along lags or horizons: the real data's band shaded, the real line dashed, the synthetic line solid. */
function CheckCurve({ curve, label }: { curve: NonNullable<RealismCheck["curve"]>; label: string }) {
  const W = 280, H = 30, all = [...curve.lo, ...curve.hi, ...curve.synthetic, ...curve.real], lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const x = (i: number) => 2 + (i / Math.max(1, curve.x.length - 1)) * (W - 4), y = (v: number) => H - 2 - ((v - lo) / span) * (H - 4);
  const line = (v: number[]) => `M${v.map((p, i) => `${x(i)},${y(p)}`).join(" L")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-0.5 block h-[30px] w-full" role="img" aria-label={`${label}: synthetic against the real data's band, ${curve.x[0]} to ${curve.x[curve.x.length - 1]}`}>
      <path d={`${line(curve.hi)} L${[...curve.lo].reverse().map((p, i) => `${x(curve.lo.length - 1 - i)},${y(p)}`).join(" L")} Z`} fill="var(--accent)" opacity={0.14} />
      <path d={line(curve.real)} fill="none" stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 2" />
      <path d={line(curve.synthetic)} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
    </svg>
  );
}

/** How the synthetic data compares with the real: a score, each stylised fact against its band (realism v2), the moments side by side, and plain warnings. */
export function RealismPanel({ r, note }: { r: Realism; note?: string }) {
  const [open, setOpen] = useState(false);
  const tone = r.score >= 80 ? "text-pos" : r.score >= 60 ? "text-accent" : "text-neg";
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center gap-3">
        <div className={`num text-[22px] font-semibold ${tone}`}>{r.score}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold">Realism <span className="font-normal text-muted">out of 100</span></div>
          <p className="text-[11px] text-muted">{note ?? (r.checks ? "Synthetic paths against the real last three years: each stylised fact inside the band a block bootstrap of the real days allows." : "Synthetic days against the real ones: distribution, volatility, tails, volatility clustering and correlations.")}</p>
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-[11px] text-accent hover:underline">{open ? "Hide" : "Side by side"}</button>
      </div>
      {r.checks && (
        <ul className="mt-2 space-y-1.5" aria-label="Stylised facts against the real data's bands">{r.checks.map((c) => (
          <li key={c.key} className="text-[11px]" title={c.note}>
            <div className="flex items-center gap-1.5">
              {c.pass ? <Check className="h-3 w-3 shrink-0 text-pos" aria-label="inside the band" /> : <X className="h-3 w-3 shrink-0 text-neg" aria-label="outside the band" />}
              <span className="font-medium">{c.label}</span>
              <span className="num ml-auto">{fmtCheck(c.synthetic, c.unit)}</span>
            </div>
            <div className="pl-[18px] text-[10.5px] text-muted">real <span className="num">{fmtCheck(c.real, c.unit)}</span> · band <span className="num">{fmtCheck(c.lo, c.unit)}</span> to <span className="num">{fmtCheck(c.hi, c.unit)}</span>{c.curve ? ` · ${c.key === "acf" ? "lags" : "days"} ${c.curve.x[0]}–${c.curve.x[c.curve.x.length - 1]}` : ""}</div>
            {c.curve && <div className="pl-[18px]"><CheckCurve curve={c.curve} label={c.label} /></div>}
          </li>
        ))}</ul>
      )}
      {r.warnings.length > 0 && <ul className="mt-2 space-y-0.5">{r.warnings.slice(0, 5).map((w) => <li key={w} className="flex gap-1.5 text-[11px] text-muted"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-accent" />{w}</li>)}</ul>}
      {open && (
        <div className="table-scroll mt-2 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead><tr className="text-left text-muted"><th className="font-normal">Series</th><th className="text-right font-normal">Daily vol real / synthetic</th><th className="text-right font-normal">Excess kurtosis</th><th className="text-right font-normal">Vol clustering</th><th className="text-right font-normal">KS</th></tr></thead>
            <tbody>{r.columns.map((c) => (
              <tr key={c.name} className="border-t border-line">
                <td className="py-1 font-sans">{c.name}</td>
                <td className="text-right">{(c.real.std * 100).toFixed(2)}% / {(c.synthetic.std * 100).toFixed(2)}%</td>
                <td className="text-right">{c.real.kurtosis.toFixed(1)} / {c.synthetic.kurtosis.toFixed(1)}</td>
                <td className="text-right">{c.real.acfAbs1.toFixed(2)} / {c.synthetic.acfAbs1.toFixed(2)}</td>
                <td className="text-right">{c.ks.toFixed(2)}</td>
              </tr>
            ))}</tbody>
          </table>
          {r.columns.length > 1 && <p className="mt-1 text-[10.5px] text-faint">Correlations drift by {r.correlationGap.toFixed(2)} on average.</p>}
          {r.bands && <p className="mt-1 text-[10.5px] text-faint">Bands: the middle 95% of {r.bands.resamples} block-bootstrap resamples of the real {r.bands.days} days (runs of about {r.bands.block} days), centred on the real value; synthetic figures are medians over {r.bands.paths} paths as long as the real sample.{r.v1 !== undefined ? ` The older score: ${r.v1}.` : ""}</p>}
        </div>
      )}
    </div>
  );
}

/** Privacy of a synthetic table against rows held out from its generator. */
export function PrivacyPanel({ p }: { p: Privacy }) {
  const rows: { label: string; value: string; vs: string; ok: boolean; note: string }[] = [
    { label: "Closer to training than holdout", value: `${Math.round(p.dcrShare * 100)}%`, vs: "about 50% is ideal", ok: p.dcrShare <= 0.6, note: "How often a synthetic row is nearer a row the generator learned from than any held-out row (equal-sized sets)." },
    { label: "Nearest-neighbour ratio", value: p.nndr.synthetic.toFixed(2), vs: `held-out rows ${p.nndr.holdout.toFixed(2)}`, ok: p.nndr.synthetic >= 0.7 * p.nndr.holdout, note: "Distance to the nearest training row over the second nearest (median): near 0 means rows sit on single real records." },
    { label: "Exact copies of training rows", value: `${(p.exact.synthetic * 100).toFixed(1)}%`, vs: `held-out rows ${(p.exact.holdout * 100).toFixed(1)}%`, ok: p.exact.synthetic <= p.exact.holdout + 0.01, note: "Synthetic rows identical to a training row in every column that is not an identifier." },
    { label: "Membership-inference AUC", value: p.mia.toFixed(2), vs: "0.50 is guessing", ok: p.mia <= 0.6, note: "An attacker guessing whether a row was trained on from its distance to the nearest synthetic row." },
  ];
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="text-[12px] font-semibold">Privacy <span className="font-normal text-muted">against {p.holdout.toLocaleString("en-US")} held-out rows</span></div>
      <p className="text-[11px] text-muted">The generator learned from {p.train.toLocaleString("en-US")} rows; {p.compared.toLocaleString("en-US")} synthetic rows were set beside rows it never saw.</p>
      <ul className="mt-2 space-y-1.5">{rows.map((x) => (
        <li key={x.label} className="text-[11px]" title={x.note}>
          <div className="flex items-center gap-1.5">{x.ok ? <Check className="h-3 w-3 shrink-0 text-pos" aria-label="fine" /> : <X className="h-3 w-3 shrink-0 text-neg" aria-label="a concern" />}<span className="font-medium">{x.label}</span><span className="num ml-auto">{x.value}</span></div>
          <div className="pl-[18px] text-[10.5px] text-muted">{x.vs}</div>
        </li>
      ))}</ul>
      {p.warnings.length > 0 && <ul className="mt-2 space-y-0.5">{p.warnings.map((w) => <li key={w} className="flex gap-1.5 text-[11px] text-muted"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-accent" />{w}</li>)}</ul>}
    </div>
  );
}
