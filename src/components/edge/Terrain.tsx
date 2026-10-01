"use client";

/**
 * Terrain views. A site: the ground before a change, shaded relief with the change outlined, its slope
 * and relief, where it sits against the ground around it, and the earth new ground took to level. A
 * pipeline: its elevation profile with the steepest stretch marked. Each says which elevation data it
 * read (lidar, USGS 3DEP or Copernicus) and how good that is.
 */
import { Box, Loader2, Mountain } from "lucide-react";
import type { AssetTerrain } from "@/lib/edge/ground";
import type { Pad, PipelineProfile, SiteTerrain } from "@/lib/edge/terrain";
import { positionWords } from "@/lib/edge/terrain-view";
import { useApi } from "./client";

const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US");
const vol = (v: number) => (v >= 10_000 ? `${n0(Math.round(v / 100) * 100)}` : n0(Math.round(v / 10) * 10));

function SourceLine({ t }: { t: { source: SiteTerrain["source"] } }) {
  return (
    <p className="text-[10.5px] leading-snug text-faint">
      <a href={t.source.url} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">{t.source.name}</a>, {t.source.resolutionM} m{t.source.vintage ? `, ${t.source.vintage}` : ""}; good to {t.source.accuracy}. {t.source.license}.
    </p>
  );
}

function PadLine({ p }: { p: Pad }) {
  return (
    <li className="text-[11.5px] leading-snug">
      <span className={`mr-1 inline-block h-2 w-2 rounded-sm ${p.kind === "cleared" ? "bg-accent" : "bg-info"}`} />
      <span className="num font-medium">{n1(p.hectares)} ha</span> {p.kind === "cleared" ? "new bare ground" : "new dark surface"} on ground at <span className="num">{n1(p.groundM)} m</span>, sloping {n1(p.slopeDeg)}°{p.reliefM >= 0.5 ? ` (${n1(p.reliefM)} m from one side to the other)` : ""}.
      {p.cutM3 !== undefined && <> Levelling it moved about <span className="num font-medium">{vol(p.cutM3)} m³</span> of earth from the high side to the low side{p.hectares > 0 ? ` (${n1((2 * p.cutM3) / (p.hectares * 10_000))} m on average)` : ""}.</>}
      <span className="text-muted"> It sits {positionWords(p.position)}.</span>
    </li>
  );
}

export function SiteTerrainView({ t, onView3D }: { t: SiteTerrain; onView3D?: () => void }) {
  const pads = t.pads.slice(0, 4);
  return (
    <div className="space-y-2">
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {t.image && <img src={t.image} alt="Shaded relief of the site before the change, with the change outlined" width={128} height={128} className="h-32 w-32 shrink-0 rounded-md border border-line object-cover" />}
        <div className="min-w-0 space-y-1 text-[11.5px] leading-snug">
          <p>The ground here lies between <span className="num font-medium">{n0(t.elevation.min)}</span> and <span className="num font-medium">{n0(t.elevation.max)}</span> m{t.elevation.atSite !== null ? <> (<span className="num">{n0(t.elevation.atSite)}</span> m at the site)</> : null}: a relief of <span className="num">{n1(t.reliefM)}</span> m across the area, sloping <span className="num">{n1(t.slope.meanDeg)}</span>° on average and <span className="num">{n1(t.slope.p90Deg)}</span>° on its steeper tenth.</p>
          {t.elevation.positionAtSite !== null && !t.pads.length && <p className="text-muted">The site sits {positionWords(t.elevation.positionAtSite)}.</p>}
          {t.earthwork && <p className="rounded-md bg-accent-soft/40 px-2 py-1">Levelling the <span className="num">{n1(t.earthwork.hectares)} ha</span> of new bare ground took roughly <span className="num font-semibold">{vol(t.earthwork.cutM3)} m³</span> of cut, filled back on site.</p>}
        </div>
      </div>
      {pads.length > 0 && <ul className="space-y-1">{pads.map((p, i) => <PadLine key={i} p={p} />)}</ul>}
      {t.notes.length > 0 && <p className="text-[10.5px] leading-snug text-muted">{t.notes.join(" ")}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SourceLine t={t} />
        {onView3D && <button type="button" onClick={onView3D} className="inline-flex shrink-0 items-center gap-1 text-[11px] text-accent hover:underline"><Box className="h-3 w-3" /> See it in 3D</button>}
      </div>
    </div>
  );
}

/** A pipeline's elevation profile as an area chart, the steepest stretch in red. */
export function ProfileChart({ p }: { p: PipelineProfile }) {
  const W = 360, H = 140, L = 36, R = 6, T = 8, B = 18;
  const kmMax = p.points[p.points.length - 1]?.km || 1;
  const lo = Math.min(...p.points.map((x) => x.m)), hi = Math.max(...p.points.map((x) => x.m));
  const span = Math.max(10, hi - lo), mLo = lo - span * 0.08, mHi = hi + span * 0.08;
  const X = (km: number) => L + (km / kmMax) * (W - L - R), Y = (m: number) => T + (1 - (m - mLo) / (mHi - mLo)) * (H - T - B);
  const line = p.points.map((x, i) => `${i ? "L" : "M"}${X(x.km).toFixed(1)},${Y(x.m).toFixed(1)}`).join("");
  const area = `${line}L${X(kmMax).toFixed(1)},${H - B}L${X(0).toFixed(1)},${H - B}Z`;
  const steep = p.points.filter((x) => x.km >= p.steepest.fromKm && x.km <= p.steepest.toKm);
  const ticks = [0, kmMax / 2, kmMax];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Elevation along ${p.lengthKm} km, from ${n0(lo)} to ${n0(hi)} m`}>
      <defs><linearGradient id="profile-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0.03" /></linearGradient></defs>
      {[mLo + (mHi - mLo) * 0.15, (mLo + mHi) / 2, mHi - (mHi - mLo) * 0.15].map((m, i) => (
        <g key={i}><line x1={L} x2={W - R} y1={Y(m)} y2={Y(m)} stroke="var(--line)" strokeWidth="1" /><text x={L - 4} y={Y(m) + 3} textAnchor="end" fontSize="9" fill="var(--muted)">{n0(m)}</text></g>
      ))}
      <path d={area} fill="url(#profile-fill)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.3" />
      {steep.length > 1 && <path d={steep.map((x, i) => `${i ? "L" : "M"}${X(x.km).toFixed(1)},${Y(x.m).toFixed(1)}`).join("")} fill="none" stroke="var(--neg)" strokeWidth="2.4" strokeLinecap="round" />}
      <circle cx={X(p.high.km)} cy={Y(p.high.m)} r="2.4" fill="var(--fg)" /><circle cx={X(p.low.km)} cy={Y(p.low.m)} r="2.4" fill="var(--info)" />
      {ticks.map((k, i) => <text key={i} x={X(k)} y={H - 5} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fontSize="9" fill="var(--muted)">{n0(k)} km</text>)}
      <text x={L - 4} y={T + 2} textAnchor="end" fontSize="8" fill="var(--faint)">m</text>
    </svg>
  );
}

export function ProfileView({ p }: { p: PipelineProfile }) {
  return (
    <div className="space-y-2">
      <ProfileChart p={p} />
      <div className="grid grid-cols-3 gap-1.5 text-center">
        {[["Length", `${n1(p.lengthKm)} km`], ["Climbs", `${n0(p.climbM)} m`], ["Descends", `${n0(p.descentM)} m`], ["Highest", `${n0(p.high.m)} m`], ["Lowest", `${n0(p.low.m)} m`], ["Steepest", `${n1(p.steepest.gradePct)}%`]].map(([k, v]) => (
          <div key={k} className="rounded-md bg-elevated/60 px-1.5 py-1"><div className="text-[9.5px] uppercase tracking-wider text-muted">{k}</div><div className="num text-[13px] font-semibold">{v}</div></div>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-muted">End to end it {p.netM >= 0 ? "rises" : "falls"} <span className="num">{n0(Math.abs(p.netM))}</span> m. The steepest stretch, in red, is <span className="num">{n1(p.steepest.gradePct)}</span>% over {n1(p.steepest.overKm)} km from km {n1(p.steepest.fromKm)}; ups and downs smaller than the data can resolve are left out of the climb. EIA&apos;s line approximates the route, so a steep stretch can be the drawn line crossing a slope the pipe itself skirts.</p>
      {p.notes.length > 0 && <p className="text-[10.5px] text-muted">{p.notes.join(" ")}</p>}
      <SourceLine t={p} />
    </div>
  );
}

/** Terrain for a finding or a mapped asset, read when opened. */
export function TerrainPanel({ detection, asset, onView3D }: { detection?: number; asset?: number; onView3D?: () => void }) {
  const url = detection ? `/api/edge/terrain?detection=${detection}` : asset ? `/api/edge/terrain?asset=${asset}` : null;
  const { data, error } = useApi<SiteTerrain | AssetTerrain>(url);
  if (error) return <p className="text-[11.5px] text-neg">{error}</p>;
  if (!data) return <p className="flex items-center gap-1.5 text-[11.5px] text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the elevation (lidar where it has been flown)…</p>;
  return (
    <div className="rounded-lg border border-line bg-elevated/30 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted"><Mountain className="h-3.5 w-3.5" /> {data.kind === "profile" ? "Elevation along the pipeline" : "Terrain"}</div>
      {data.kind === "profile" ? <ProfileView p={data} /> : <SiteTerrainView t={data} onView3D={onView3D} />}
    </div>
  );
}
