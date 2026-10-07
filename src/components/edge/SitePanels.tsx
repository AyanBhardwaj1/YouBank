"use client";

/**
 * Sections of a plant's panel on the map. Drilling nearby: the well permits within 10 km, New Mexico's
 * dated by approval and Texas's permitted, undrilled locations (its map has no dates, so Edge counts the
 * ones it has seen appear). Premium sections, shown only when YouBank has them set up: sharper imagery
 * (Planet's scenes of the plant) and flare volumes (EOG Nightfire, read only when asked); a plan without
 * them sees what they are with its badge.
 */
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { isPlanError, PlanNotice } from "@/components/billing/PlanNotice";
import type { FlareVolume } from "@/lib/edge/premium/nightfire";
import type { PermitsNear } from "@/lib/edge/permits";
import type { PlanetScene } from "@/lib/edge/premium/planet";
import { fmtNum, post, useApi } from "./client";

function Windows({ windows }: { windows: number[] }) {
  const max = Math.max(1, ...windows);
  return (
    <div className="flex h-7 items-end gap-1" aria-label="Permits in each 30 days over the last 120, oldest first">
      {windows.map((n, i) => <div key={i} title={`${n} permits, ${(windows.length - 1 - i) * 30} to ${(windows.length - i) * 30} days ago`} className={`flex-1 rounded-t-[2px] ${i === windows.length - 1 ? "bg-accent" : "bg-chart-dim"}`} style={{ height: `${Math.max(8, (n / max) * 100)}%` }} />)}
    </div>
  );
}

export function DrillingNearby({ asset }: { asset: number }) {
  const { data, error, loading } = useApi<PermitsNear>(`/api/edge/permits?asset=${asset}`);
  return (
    <section className="rounded-lg border border-line bg-elevated/30 p-2.5" aria-label="Drilling permits nearby">
      <div className="flex items-baseline justify-between text-[11.5px] font-semibold">Drilling nearby <span className="text-[10.5px] font-normal text-faint">within {data?.radiusKm ?? 10} km</span></div>
      {loading && !data ? <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted"><Loader2 className="h-3 w-3 animate-spin" /> Reading the state records</p>
        : error && !data ? <p className="mt-1 text-[11px] text-neg">Permits did not load: {error}</p>
        : data ? (
          <div className="mt-1 space-y-2 text-[11.5px] leading-snug">
            {data.nm && (
              <div>
                <p>New Mexico approved <span className="num font-semibold">{data.nm.last30}</span> well {data.nm.last30 === 1 ? "permit" : "permits"} in the last 30 days, against <span className="num">{data.nm.prior90}</span> in the 90 days before.</p>
                <div className="mt-1"><Windows windows={data.nm.windows} /></div>
                {data.nm.permits.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-muted">
                    {data.nm.permits.slice(0, 3).map((p) => (
                      <li key={p.api} className="flex justify-between gap-2">
                        <span className="truncate">{p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">{p.name || p.api}</a> : p.name || p.api}{p.operator ? ` · ${p.operator}` : ""}</span>
                        <span className="num shrink-0">{p.date} · {fmtNum(p.km, 1)} km</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {data.tx && (
              <p>Texas: <span className="num font-semibold">{data.tx.permitted}</span> permitted, undrilled {data.tx.permitted === 1 ? "location" : "locations"}. Its public map has no permit dates, so Edge counts the new ones it sees appear{data.tx.trackedDays >= 30 ? <>: <span className="num font-semibold">{data.tx.last30}</span> in the last 30 days.</> : <>, since {data.tx.since}{data.tx.last30 ? <> (<span className="num">{data.tx.last30}</span> so far)</> : null}.</>}</p>
            )}
            {!data.nm && !data.tx && <p className="text-muted">No state well records reach this place.</p>}
            <p className="text-[10px] text-faint">{[data.nm ? "New Mexico OCD" : "", data.tx ? "Railroad Commission of Texas" : ""].filter(Boolean).join(" and ")} public records, read {data.asOf}. A permit is not a well; some are never drilled.</p>
          </div>
        ) : null}
    </section>
  );
}

/** A premium section a plan does not include: its name, badge and the plan message. */
function Locked({ title, feature, message }: { title: string; feature: string; message: string }) {
  return (
    <section className="rounded-lg border border-line bg-elevated/30 p-2.5" aria-label={title}>
      <div className="flex items-center justify-between gap-2 text-[11.5px] font-semibold">{title} <PremiumBadge feature={feature} /></div>
      <PlanNotice error={Object.assign(new Error(message), { status: 402 })} className="mt-1.5" />
    </section>
  );
}

/** The premium sections of a plant's panel: Planet's scenes, then Nightfire's flare volumes. */
export function PlanetScenes({ asset }: { asset: number }) {
  return <><PlanetSection asset={asset} /><FlareVolumes key={`n${asset}`} asset={asset} /></>;
}

/**
 * Planet's scenes of a plant; renders nothing while loading, when Planet is not set up (the route
 * answers 404) or on an error, and the locked section for a plan without it (402).
 */
function PlanetSection({ asset }: { asset: number }) {
  const { data, error } = useApi<{ scenes: PlanetScene[] }>(`/api/edge/planet/scenes?asset=${asset}`);
  if (error && isPlanError(error)) return <Locked title="Sharper imagery (Planet)" feature="edge.planet" message={error} />;
  if (error || !data) return null;
  return (
    <section className="rounded-lg border border-line bg-elevated/30 p-2.5" aria-label="Sharper imagery from Planet">
      <div className="text-[11.5px] font-semibold">Sharper imagery (Planet)</div>
      {data.scenes.length === 0 ? <p className="mt-1 text-[11px] text-muted">No Planet scene under 20% cloud in the last 60 days.</p> : (
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {data.scenes.slice(0, 6).map((s) => (
            <figure key={s.id} className="min-w-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.thumb} alt={`${s.type === "SkySatCollect" ? "SkySat" : "PlanetScope"} scene of ${s.acquired.slice(0, 10)}`} loading="lazy" className="aspect-square w-full rounded border border-line bg-elevated object-cover" />
              <figcaption className="mt-0.5 truncate text-[10px] text-muted" title={s.id}>{s.acquired.slice(0, 10)} · {s.type === "SkySatCollect" ? "SkySat" : "PlanetScope"} {fmtNum(s.gsdM, s.gsdM < 1 ? 1 : 0)} m · {s.cloudPct}% cloud</figcaption>
            </figure>
          ))}
        </div>
      )}
      <p className="mt-1 text-[10px] text-faint">{data.scenes.length} {data.scenes.length === 1 ? "scene" : "scenes"} in the last 60 days, from Planet Labs. Full scenes are bought separately.</p>
    </section>
  );
}

/**
 * Flared gas volumes at a plant from VIIRS Nightfire (premium). Offered only when Nightfire is set up;
 * nothing is read from EOG until the button is pressed, and a plan without it gets its message here.
 */
function FlareVolumes({ asset }: { asset: number }) {
  const ready = useApi<{ ready: boolean }>("/api/edge/nightfire");
  const [state, setState] = useState<{ busy: boolean; data: FlareVolume | null; error: unknown }>({ busy: false, data: null, error: null });
  if (!ready.data?.ready) return null;
  const read = () => {
    setState({ busy: true, data: null, error: null });
    post<FlareVolume>("/api/edge/nightfire", { asset }).then((data) => setState({ busy: false, data, error: null }), (error) => setState({ busy: false, data: null, error }));
  };
  const d = state.data;
  return (
    <section className="rounded-lg border border-line bg-elevated/30 p-2.5" aria-label="Flare volumes from Nightfire">
      <div className="flex items-center justify-between gap-2 text-[11.5px] font-semibold">Flare volumes (Nightfire) <PremiumBadge feature="edge.nightfire" /></div>
      {!d && <button type="button" disabled={state.busy} onClick={read} className="ctl mt-1.5 flex items-center gap-1 border border-line px-2 py-0.5 text-[11px] hover:border-accent/50 disabled:opacity-50">{state.busy && <Loader2 className="h-3 w-3 animate-spin" />}{state.busy ? "Reading the last week of nights" : "Estimate the last week's flaring"}</button>}
      {!!state.error && <PlanNotice error={state.error} className="mt-1.5" />}
      {d && (
        <div className="mt-1 space-y-1 text-[11.5px] leading-snug">
          {d.detections === 0 ? <p className="text-muted">No flare within {d.radiusKm} km in the last {d.nightsRead} night{d.nightsRead === 1 ? "" : "s"}.</p> : (
            <>
              <p>About <span className="num font-semibold">{fmtNum(d.mmcfd, d.mmcfd < 1 ? 2 : 1)}</span> MMcf/d flared on average (<span className="num">{fmtNum(d.avgRhMw, 2)}</span> MW of radiant heat), seen on <span className="num">{d.nightsSeen}</span> of <span className="num">{d.nightsRead}</span> nights; hottest <span className="num">{d.peakTempK}</span> K.</p>
              {d.flares.length > 1 && <ul className="space-y-0.5 text-[11px] text-muted">{d.flares.slice(0, 4).map((f, i) => <li key={i} className="flex justify-between gap-2"><span>Flare {i + 1} · {fmtNum(f.km, 1)} km away</span><span className="num">{fmtNum(f.mmcfd, f.mmcfd < 1 ? 2 : 1)} MMcf/d</span></li>)}</ul>}
            </>
          )}
          <p className="text-[10px] text-faint">{d.method}</p>
        </div>
      )}
    </section>
  );
}
