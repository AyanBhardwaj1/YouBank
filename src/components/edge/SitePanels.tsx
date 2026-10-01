"use client";

/**
 * Sections of a plant's panel on the map. Drilling nearby: the well permits within 10 km, New Mexico's
 * dated by approval and Texas's permitted, undrilled locations (its map has no dates, so Edge counts the
 * ones it has seen appear). Sharper imagery: Planet's scenes of the plant, shown only when Planet is set up.
 */
import { Loader2 } from "lucide-react";
import type { PermitsNear } from "@/lib/edge/permits";
import type { PlanetScene } from "@/lib/edge/premium/planet";
import { fmtNum, useApi } from "./client";

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

/** Planet's scenes of a plant; renders nothing while loading, when Planet is not set up (the route answers 404) or on an error. */
export function PlanetScenes({ asset }: { asset: number }) {
  const { data, error } = useApi<{ scenes: PlanetScene[] }>(`/api/edge/planet/scenes?asset=${asset}`);
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
