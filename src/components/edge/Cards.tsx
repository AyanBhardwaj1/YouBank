"use client";

/**
 * Edge feed cards. Each finding shows its visual first (a before/after wipe for ground change, the
 * county screen for a deal, the edits to a watched company's risk factors), then what it means, how
 * sure Edge is and why, and where every part came from, with the audit trail one click away.
 */
import { motion, useReducedMotion } from "motion/react";
import { AlertTriangle, ArrowRight, ArrowUpRight, ChevronDown, Download, ExternalLink, Film, Map as MapIcon, MapPin, Mountain, Network, Radar, Sparkles, Users } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Compare } from "./Compare";
import { TerrainPanel } from "./Terrain";
import { Timelapse } from "./Timelapse";
import { wordDiff } from "@/lib/edge/docs/text";
import { ago, confidenceLabel, fmtNum, useClock, type EdgeCard, type FilingVisual, type FlagVisual, type FlaringVisual, type GroundVisual, type MethaneVisual, type PermitsVisual, type PredictionVisual, type ProformaVisual, type RadarVisual } from "./client";

/** "4m", "Yesterday", "Sep 26": kept fresh by the shared clock, so a tick re-renders only the times. */
export function Ago({ iso }: { iso: string }) {
  const now = useClock();
  return <>{now ? ago(iso, now) : iso.slice(0, 10)}</>;
}

export function Confidence({ value }: { value: number }) {
  const { label, tone } = confidenceLabel(value);
  const bars = Math.max(1, Math.round(value * 5));
  const color = tone === "pos" ? "bg-pos" : tone === "accent" ? "bg-accent" : "bg-faint";
  return (
    <span className="inline-flex items-center gap-1.5 text-[10.5px] text-muted" title={`${label}: ${Math.round(value * 100)} of 100`}>
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => <span key={i} className={`w-[3px] rounded-sm ${i < bars ? color : "bg-line-strong"}`} style={{ height: 4 + i * 2 }} />)}
      </span>
      {label}
    </span>
  );
}

function Reasons({ card }: { card: EdgeCard }) {
  return (
    <div className="flex flex-wrap gap-1">
      {card.reasons.slice(0, 2).map((r) => (
        <span key={r} className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-[10.5px] text-accent">
          {card.scope === "team" ? <Users className="h-3 w-3" /> : card.scope === "trending" ? <Sparkles className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}{r}
        </span>
      ))}
    </div>
  );
}

function Provenance({ card }: { card: EdgeCard }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-line pt-2">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-1.5 text-left text-[11px] text-muted hover:text-fg">
        <ChevronDown className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} /> Why we think so · {card.sources.length} {card.sources.length === 1 ? "source" : "sources"}
      </button>
      {open && (
        <div className="rise mt-2 space-y-2 text-[11.5px] leading-relaxed">
          <p className="text-muted">{card.why}</p>
          <ul className="space-y-1.5">
            {card.sources.map((s, i) => (
              <li key={i} className="rounded-md border border-line bg-elevated/40 px-2 py-1.5">
                <div className="font-medium text-fg">{s.url && /^https?:/.test(s.url) ? <a href={s.url.split(" ")[0]} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">{s.name}</a> : s.name}</div>
                <div className="text-[10.5px] text-muted">{s.license}{s.method ? ` · ${s.method}` : ""}{s.modelVersion ? ` · ${s.modelVersion}` : ""} · retrieved {s.retrievedAt.slice(0, 10)}</div>
              </li>
            ))}
          </ul>
          <a href={`/api/edge/audit?detection=${card.id}`} className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"><Download className="h-3 w-3" /> Audit trail (CSV)</a>
        </div>
      )}
    </div>
  );
}

function Shell({ card, index, children, kicker, icon }: { card: EdgeCard; index: number; children: React.ReactNode; kicker: string; icon: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.article
      id={`edge-card-${card.id}`}
      initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 360, damping: 32, delay: Math.min(index, 8) * 0.04 }}
      className="panel flex scroll-mt-20 flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between gap-2 px-3.5 pt-3">
        <div className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-accent">
          <Icon name={icon} className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{kicker}</span>
        </div>
        <Confidence value={card.confidence} />
      </div>
      {children}
    </motion.article>
  );
}

export type OnMap = (card: EdgeCard, opts?: { threeD?: boolean }) => void;

export function GroundCard({ card, index, onMap }: { card: EdgeCard; index: number; onMap?: OnMap }) {
  const v = card.visual as GroundVisual;
  const when = card.observedAt ?? card.detectedAt;
  const [terrain, setTerrain] = useState(false);
  const [film, setFilm] = useState(false);
  return (
    <Shell card={card} index={index} kicker={`Earth · ground change${v.site.ticker ? ` · ${v.site.ticker}` : ""}`} icon="Globe">
      <div className="mt-2.5 px-3.5">
        <div className="overflow-hidden rounded-lg">
          <Compare before={v.before} after={v.after} overlay={v.overlay} label={v.site.name} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 px-3.5 pb-3 pt-2.5">
        <h3 className="text-[15px] font-semibold leading-snug tracking-tight">{card.title}</h3>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {v.stats.clearedHa >= 0.1 && <span className="num rounded-md bg-accent-soft px-1.5 py-0.5 text-accent">{fmtNum(v.stats.clearedHa, 1)} ha new bare ground</span>}
          {v.stats.darkenedHa >= 0.1 && <span className="num rounded-md bg-info/15 px-1.5 py-0.5 text-info">{fmtNum(v.stats.darkenedHa, 1)} ha new dark surface</span>}
          <span className="rounded-md bg-elevated px-1.5 py-0.5 text-muted">{v.site.name}{v.site.company ? ` · ${v.site.company}` : ""}</span>
        </div>
        <p className="text-[12.5px] leading-relaxed text-muted">{card.summary}</p>
        <Reasons card={card} />
        {film && <Timelapse detection={card.id} before={v.before?.date} after={v.after?.date} />}
        {terrain && <TerrainPanel detection={card.id} onView3D={onMap ? () => onMap(card, { threeD: true }) : undefined} />}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[10.5px] text-faint">
          <span>Seen <Ago iso={when} /> · Sentinel-2, 10 m</span>
          <span className="flex items-center gap-2.5">
            <button type="button" onClick={() => setFilm((x) => !x)} aria-expanded={film} className="inline-flex items-center gap-1 text-accent hover:underline"><Film className="h-3 w-3" /> {film ? "Hide the months" : "Month by month"}</button>
            <button type="button" onClick={() => setTerrain((x) => !x)} aria-expanded={terrain} className="inline-flex items-center gap-1 text-accent hover:underline"><Mountain className="h-3 w-3" /> {terrain ? "Hide the terrain" : "Terrain"}</button>
            {onMap && <button type="button" onClick={() => onMap(card)} className="inline-flex items-center gap-1 text-accent hover:underline"><MapIcon className="h-3 w-3" /> On the map</button>}
          </span>
        </div>
        <Provenance card={card} />
      </div>
    </Shell>
  );
}

/** The hot spots around a plant, to scale: the circle Edge counts within, the plant at its centre, each detection a dot sized by its heat and shaded by day. */
function HotspotPlot({ v }: { v: FlaringVisual }) {
  const R = 46, c = 50, r = v.radiusKm * 1000;
  const kmLat = 110_574, kmLon = 111_320 * Math.cos((v.site.lat * Math.PI) / 180);
  const day = (d: string) => Math.max(0, v.days.findIndex((x) => x.date === d));
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label={`${v.hits.length} hot spots within ${v.radiusKm} km of ${v.site.name}`}>
      <circle cx={c} cy={c} r={R} fill="var(--elevated)" stroke="var(--line)" strokeDasharray="2 2" />
      <circle cx={c} cy={c} r={R / 2} fill="none" stroke="var(--line)" strokeWidth="0.5" />
      {v.hits.map((h, i) => {
        const x = c + (((h.lon - v.site.lon) * kmLon) / r) * R, y = c - (((h.lat - v.site.lat) * kmLat) / r) * R;
        const recent = 0.35 + (0.65 * day(h.date)) / Math.max(1, v.days.length - 1);
        return <circle key={i} cx={x} cy={y} r={1.6 + Math.min(4.4, Math.sqrt(h.frp) * 1.4)} fill="#F76707" fillOpacity={recent} stroke="#FFD43B" strokeOpacity={recent} strokeWidth="0.5"><title>{`${h.date} ${h.time.slice(0, 2)}:${h.time.slice(2)} UTC · ${h.sat} · ${h.frp} MW · ${h.m} m from the plant`}</title></circle>;
      })}
      <rect x={c - 2.2} y={c - 2.2} width="4.4" height="4.4" fill="var(--fg)" transform={`rotate(45 ${c} ${c})`} />
      <text x={c} y={97} textAnchor="middle" fontSize="6" fill="var(--muted)">{v.radiusKm} km</text>
    </svg>
  );
}

export function FlaringCard({ card, index, onMap }: { card: EdgeCard; index: number; onMap?: OnMap }) {
  const v = card.visual as FlaringVisual;
  const s = v.stats;
  const maxFrp = Math.max(1, ...v.days.map((d) => d.frp));
  const weeks = v.history.slice(-12);
  const maxWeek = Math.max(1, ...weeks.map((w) => w.days));
  const [film, setFilm] = useState(false);
  return (
    <Shell card={card} index={index} kicker={`Earth · flaring${v.site.ticker ? ` · ${v.site.ticker}` : ""}`} icon="Flame">
      <div className="mt-2.5 px-3.5">
        {v.heat ? (
          <div className="overflow-hidden rounded-lg">
            <Compare before={{ url: v.heat.photo, date: `Photo ${v.heat.date}` }} after={{ url: v.heat.url, date: `Heat ${v.heat.date}` }} label={`${v.site.name} in shortwave infrared`} />
          </div>
        ) : (
          <div className="mx-auto aspect-square w-3/4 max-w-[320px]"><HotspotPlot v={v} /></div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-3.5 pb-3 pt-2.5">
        <h3 className="text-[15px] font-semibold leading-snug tracking-tight">{card.title}</h3>
        <div className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-3">
          <div>
            <div className="flex gap-1" aria-label="Days with flaring">
              {v.days.map((d) => (
                <div key={d.date} className="flex-1 text-center" title={`${d.date}: ${d.n} hot spot${d.n === 1 ? "" : "s"}${d.frp ? `, ${d.frp} MW` : ""}${d.sats.length ? ` (${d.sats.join(", ")})` : ""}`}>
                  <div className="h-7 rounded-[4px] border border-line" style={{ background: d.n ? `rgba(247, 103, 7, ${0.3 + 0.7 * (d.frp / maxFrp)})` : "var(--elevated)" }} />
                  <div className="num mt-0.5 text-[9.5px] text-faint">{new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" })}</div>
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
              <span className="num rounded-md bg-[#F76707]/15 px-1.5 py-0.5 text-[#E8590C]">{s.days} of {v.days.length} days</span>
              <span className="num rounded-md bg-elevated px-1.5 py-0.5 text-muted">{s.detections} hot spots · {fmtNum(s.frpTotal, 1)} MW</span>
              {v.heat && v.heat.hot > 0 && <span className="num rounded-md bg-elevated px-1.5 py-0.5 text-muted">{v.heat.hot} hot pixels in Sentinel-2</span>}
            </div>
          </div>
          {v.heat ? <div className="aspect-square w-full"><HotspotPlot v={v} /></div> : <div />}
        </div>
        <p className="text-[12.5px] leading-relaxed text-muted">{card.summary}</p>
        {v.reported && (
          <div className="rounded-lg border border-line bg-elevated/40 px-2.5 py-2 text-[11.5px]">
            <div className="font-medium">Reported to New Mexico for {v.reported.period}</div>
            <div className="text-muted"><span className="num">{fmtNum(v.reported.flaredMcf)}</span> Mcf flared and <span className="num">{fmtNum(v.reported.ventedMcf)}</span> Mcf vented by facilities within {v.reported.radiusKm} km</div>
            <ul className="mt-1 space-y-0.5">
              {v.reported.facilities.slice(0, 3).map((f) => <li key={f.id} className="truncate text-[11px] text-muted"><a href={f.url} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">{f.name}</a> ({f.operator}, {f.km} km): <span className="num">{fmtNum(f.flaredMcf)}</span> flared</li>)}
            </ul>
          </div>
        )}
        {weeks.length >= 3 && (
          <div>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Days flaring, week by week</div>
            <div className="flex h-8 items-end gap-[3px]" aria-label="Days flaring each week on Edge's record">
              {weeks.map((w) => <div key={w.week} title={`${w.week}: ${w.days} days, ${w.frp} MW`} className="flex-1 rounded-t-[2px] bg-[#F76707]" style={{ height: `${Math.max(6, (w.days / maxWeek) * 100)}%`, opacity: w.days ? 0.85 : 0.18 }} />)}
            </div>
          </div>
        )}
        <Reasons card={card} />
        {film && <Timelapse detection={card.id} />}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[10.5px] text-faint">
          <span>Seen <Ago iso={card.observedAt ?? card.detectedAt} /> · NASA VIIRS, 375 m</span>
          <span className="flex items-center gap-2.5">
            <button type="button" onClick={() => setFilm((x) => !x)} aria-expanded={film} className="inline-flex items-center gap-1 text-accent hover:underline"><Film className="h-3 w-3" /> {film ? "Hide the months" : "Month by month"}</button>
            {onMap && <button type="button" onClick={() => onMap(card)} className="inline-flex items-center gap-1 text-accent hover:underline"><MapIcon className="h-3 w-3" /> On the map</button>}
          </span>
        </div>
        <Provenance card={card} />
      </div>
    </Shell>
  );
}

const compass = (where: string) => (where === "at" ? "At the plant" : `${where.charAt(0).toUpperCase()}${where.slice(1)} the plant`);

export function RadarCard({ card, index, onMap }: { card: EdgeCard; index: number; onMap?: OnMap }) {
  const v = card.visual as RadarVisual;
  const s = v.stats;
  return (
    <Shell card={card} index={index} kicker={`Earth · radar change${v.site.ticker ? ` · ${v.site.ticker}` : ""}`} icon="Radar">
      <div className="mt-2.5 px-3.5">
        <div className="overflow-hidden rounded-lg">
          <Compare before={{ url: v.before.url, date: v.before.date }} after={{ url: v.after.url, date: v.after.date }} overlay={v.overlay} label={`${v.site.name} in radar`} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 px-3.5 pb-3 pt-2.5">
        <h3 className="text-[15px] font-semibold leading-snug tracking-tight">{card.title}</h3>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="num rounded-md bg-accent-soft px-1.5 py-0.5 text-accent">{s.newObjects} new · {fmtNum(s.newAreaM2)} m²</span>
          {s.strong > 0 && <span className="num rounded-md bg-elevated px-1.5 py-0.5 text-muted">{s.strong} hard {s.strong === 1 ? "return" : "returns"}</span>}
          {s.goneObjects > 0 && <span className="num rounded-md bg-info/15 px-1.5 py-0.5 text-info">{s.goneObjects} gone · {fmtNum(s.goneAreaM2)} m²</span>}
          <span className="rounded-md bg-elevated px-1.5 py-0.5 text-muted">{v.site.name}{v.site.company ? ` · ${v.site.company}` : ""}</span>
        </div>
        {v.objects.length > 0 && (
          <ul className="space-y-0.5 rounded-lg border border-line bg-elevated/40 px-2.5 py-1.5 text-[11px]" aria-label="The largest new objects">
            {v.objects.slice(0, 3).map((o, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="truncate">{compass(o.where)}{o.fresh ? "" : <span className="text-faint"> (in an earlier card)</span>}</span>
                <span className="num shrink-0 text-muted">{fmtNum(o.areaM2)} m² · {o.peakDb > 0 ? "+" : ""}{fmtNum(o.peakDb, 1)} dB</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[12.5px] leading-relaxed text-muted">{card.summary}</p>
        <Reasons card={card} />
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[10.5px] text-faint">
          <span>Seen <Ago iso={card.observedAt ?? card.detectedAt} /> · Sentinel-1 radar, 10 m, {v.stats.passes.after} passes against {v.stats.passes.before}</span>
          {onMap && <button type="button" onClick={() => onMap(card)} className="inline-flex shrink-0 items-center gap-1 text-accent hover:underline"><MapIcon className="h-3 w-3" /> On the map</button>}
        </div>
        <Provenance card={card} />
      </div>
    </Shell>
  );
}

/** Points around a plant, to scale: the circle Edge counts within, the plant at its centre, each point a dot (bright when recent). */
function RingPlot({ site, radiusKm, points, label }: { site: { lon: number; lat: number }; radiusKm: number; points: { lon: number; lat: number; recent: boolean; title: string; r?: number }[]; label: string }) {
  const R = 46, c = 50, r = radiusKm * 1000;
  const kmLat = 110_574, kmLon = 111_320 * Math.cos((site.lat * Math.PI) / 180);
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label={label}>
      <circle cx={c} cy={c} r={R} fill="var(--elevated)" stroke="var(--line)" strokeDasharray="2 2" />
      <circle cx={c} cy={c} r={R / 2} fill="none" stroke="var(--line)" strokeWidth="0.5" />
      {points.map((p, i) => {
        const x = c + (((p.lon - site.lon) * kmLon) / r) * R, y = c - (((p.lat - site.lat) * kmLat) / r) * R;
        return <circle key={i} cx={x} cy={y} r={p.r ?? 2.2} fill={p.recent ? "var(--accent)" : "var(--faint)"} fillOpacity={p.recent ? 0.85 : 0.55} stroke="var(--bg)" strokeWidth="0.4"><title>{p.title}</title></circle>;
      })}
      <rect x={c - 2.2} y={c - 2.2} width="4.4" height="4.4" fill="var(--fg)" transform={`rotate(45 ${c} ${c})`} />
      <text x={c} y={97} textAnchor="middle" fontSize="6" fill="var(--muted)">{radiusKm} km</text>
    </svg>
  );
}

export function PermitsCard({ card, index, onMap }: { card: EdgeCard; index: number; onMap?: OnMap }) {
  const v = card.visual as PermitsVisual;
  const maxW = Math.max(1, ...v.windows);
  const pace = v.prior90 / 3;
  return (
    <Shell card={card} index={index} kicker={`Earth · drilling permits${v.site.ticker ? ` · ${v.site.ticker}` : ""}`} icon="ScrollText">
      <div className="flex flex-1 flex-col gap-2 px-3.5 pb-3 pt-2">
        <h3 className="text-[15px] font-semibold leading-snug tracking-tight">{card.title}</h3>
        <div className="grid grid-cols-[minmax(0,1fr)_104px] items-center gap-3">
          <div>
            {/* Columns stretch to the row's height, so each bar's percentage has a height to resolve against. */}
            <div className="flex h-14 items-stretch gap-1.5" aria-label="Permits in each 30 days, oldest first">
              {v.windows.map((n, i) => (
                <div key={i} className="flex flex-1 flex-col items-center justify-end gap-0.5">
                  <span className="num text-[10px] text-muted">{n}</span>
                  <div className={`w-full rounded-t-[3px] ${i === v.windows.length - 1 ? "bg-accent" : "bg-chart-dim"}`} style={{ height: `${Math.max(4, (n / maxW) * 72)}%` }} title={`${n} permits, ${(v.windows.length - 1 - i) * 30} to ${(v.windows.length - i) * 30} days ago`} />
                </div>
              ))}
            </div>
            <div className="mt-0.5 flex justify-between text-[9.5px] text-faint"><span>120 days ago</span><span>Last 30 days</span></div>
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
              <span className="num rounded-md bg-accent-soft px-1.5 py-0.5 text-accent">{v.last30} in 30 days</span>
              <span className="num rounded-md bg-elevated px-1.5 py-0.5 text-muted">{fmtNum(pace, 1)} a month before</span>
              {v.tx && <span className="num rounded-md bg-elevated px-1.5 py-0.5 text-muted">{v.tx.permitted} permitted, undrilled in Texas</span>}
            </div>
          </div>
          <div className="aspect-square w-full"><RingPlot site={v.site} radiusKm={v.radiusKm} label={`The newest permits within ${v.radiusKm} km of ${v.site.name}`} points={v.permits.map((p) => ({ lon: p.lon, lat: p.lat, recent: p.date >= v.from, title: `${p.name || p.api} · ${p.operator || "operator not on the map"} · ${p.date} · ${p.km} km` }))} /></div>
        </div>
        <p className="text-[12.5px] leading-relaxed text-muted">{card.summary}</p>
        {v.permits.length > 0 && (
          <ul className="space-y-0.5 rounded-lg border border-line bg-elevated/40 px-2.5 py-1.5 text-[11px]" aria-label="The newest permits">
            {v.permits.slice(0, 4).map((p) => (
              <li key={p.api} className="flex items-center justify-between gap-2">
                <span className="truncate">{p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">{p.name || p.api}</a> : p.name || p.api}{p.operator ? <span className="text-muted"> · {p.operator}</span> : null}</span>
                <span className="num shrink-0 text-muted">{p.date} · {fmtNum(p.km, 1)} km</span>
              </li>
            ))}
          </ul>
        )}
        <Reasons card={card} />
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[10.5px] text-faint">
          <span>As of {v.asOf} · {v.dated ? "New Mexico OCD records" : "State records"}</span>
          {onMap && <button type="button" onClick={() => onMap(card)} className="inline-flex shrink-0 items-center gap-1 text-accent hover:underline"><MapIcon className="h-3 w-3" /> On the map</button>}
        </div>
        <Provenance card={card} />
      </div>
    </Shell>
  );
}

export function MethaneCard({ card, index, onMap }: { card: EdgeCard; index: number; onMap?: OnMap }) {
  const v = card.visual as MethaneVisual;
  return (
    <Shell card={card} index={index} kicker={`Earth · methane${v.site.ticker ? ` · ${v.site.ticker}` : ""}`} icon="Gauge">
      <div className="mt-2.5 px-3.5">
        {v.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.image} alt={`Methane plume near ${v.site.name}, ${v.date}`} className="aspect-square w-full rounded-lg border border-line bg-elevated object-contain" />
        ) : (
          <div className="mx-auto aspect-square w-3/4 max-w-[320px]"><RingPlot site={v.site} radiusKm={v.radiusKm} label={`Methane plumes within ${v.radiusKm} km of ${v.site.name}`} points={v.plumes.map((p) => ({ lon: p.lon, lat: p.lat, recent: true, r: 2 + Math.min(4, Math.sqrt(p.rateKgH ?? 0) / 10), title: `${p.rateKgH !== null ? `${fmtNum(p.rateKgH)} kg/h` : "no estimate"} · ${fmtNum(p.m)} m from the plant` }))} /></div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-3.5 pb-3 pt-2.5">
        <h3 className="text-[15px] font-semibold leading-snug tracking-tight">{card.title}</h3>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {v.rateKgH !== null && <span className="num rounded-md bg-accent-soft px-1.5 py-0.5 text-accent">{fmtNum(v.rateKgH)} ± {fmtNum(v.uncertaintyKgH ?? 0)} kg/h</span>}
          <span className="num rounded-md bg-elevated px-1.5 py-0.5 text-muted">{fmtNum(v.nearestM)} m from the plant</span>
          {v.platform && <span className="rounded-md bg-elevated px-1.5 py-0.5 text-muted">{v.platform}, {v.date}</span>}
        </div>
        <p className="text-[12.5px] leading-relaxed text-muted">{card.summary}</p>
        {v.earlier.length > 0 && (
          <div className="rounded-lg border border-line bg-elevated/40 px-2.5 py-1.5 text-[11px]">
            <div className="font-medium">Earlier plumes within {v.radiusKm} km</div>
            <ul className="mt-0.5 space-y-0.5 text-muted">
              {v.earlier.slice(0, 3).map((e) => <li key={e.id} className="flex justify-between gap-2"><span>{e.date} · {e.platform}</span><span className="num">{e.rateKgH !== null ? `${fmtNum(e.rateKgH)} kg/h` : "no estimate"} · {fmtNum(e.m)} m</span></li>)}
            </ul>
          </div>
        )}
        <Reasons card={card} />
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[10.5px] text-faint">
          <span>Seen <Ago iso={card.observedAt ?? card.detectedAt} /> · {v.credit}</span>
          {onMap && <button type="button" onClick={() => onMap(card)} className="inline-flex shrink-0 items-center gap-1 text-accent hover:underline"><MapIcon className="h-3 w-3" /> On the map</button>}
        </div>
        <Provenance card={card} />
      </div>
    </Shell>
  );
}

const FLAG_TEXT: Record<string, string> = { high: "Screens high", watch: "Worth a look", "": "" };

export function ProformaCard({ card, index, onOpen }: { card: EdgeCard; index: number; onOpen?: (card: EdgeCard) => void }) {
  const v = card.visual as ProformaVisual;
  const p = v.proforma;
  const maxCap = Math.max(1, ...p.parties.map((x) => x.capacityMMcfd));
  return (
    <Shell card={card} index={index} kicker="Earth · deal what-if" icon="Handshake">
      <div className="flex flex-1 flex-col gap-2.5 px-3.5 pb-3 pt-2">
        <h3 className="text-[15px] font-semibold leading-snug tracking-tight">{card.title}</h3>
        {v.deal.headline && (
          <a href={v.deal.sourceUrl || undefined} target="_blank" rel="noreferrer" className="group inline-flex items-start gap-1 text-[11.5px] text-muted hover:text-fg">
            <span className="line-clamp-2">{v.deal.headline}</span><ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 opacity-60 group-hover:opacity-100" />
          </a>
        )}
        <div className="space-y-1.5 rounded-lg border border-line bg-elevated/40 p-2.5">
          {p.parties.map((x) => (
            <div key={x.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-[11.5px]">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: x.color }} /><span className="truncate font-medium">{x.label}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full" style={{ width: `${(x.capacityMMcfd / maxCap) * 100}%`, background: x.color }} /></div>
              </div>
              <div className="num text-right text-[10.5px] text-muted">{fmtNum(x.capacityMMcfd)} MMcfd · {x.plants} plants<br />{fmtNum(x.pipelineKm)} km pipe</div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-1 border-t border-line pt-1.5 text-[11px]">
            <span className="text-muted">Together</span>
            <span className="num">{fmtNum(p.combined.capacityMMcfd)} MMcfd · <span className="text-accent">{Math.round(p.combined.capacityShare * 100)}% of the basin&apos;s mapped processing</span></span>
          </div>
        </div>
        {p.counties.length > 0 && (
          <div>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">County concentration (HHI)</div>
            <ul className="space-y-1">
              {p.counties.slice(0, 5).map((c) => (
                <li key={c.geoid} className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-2 text-[11px]">
                  <span className="truncate">{c.name}</span>
                  <span className="relative h-2 overflow-hidden rounded-full bg-line" title={`${c.hhiBefore ?? "n/a"} before, ${c.hhiAfter ?? "n/a"} after`}>
                    <span className="absolute inset-y-0 left-0 rounded-full bg-faint" style={{ width: `${Math.min(100, (c.hhiAfter ?? 0) / 100)}%` }} />
                    <span className="absolute inset-y-0 left-0 rounded-full bg-muted" style={{ width: `${Math.min(100, (c.hhiBefore ?? 0) / 100)}%` }} />
                    <span className="absolute inset-y-0 w-px bg-neg" style={{ left: "18%" }} />
                  </span>
                  <span className={`num text-right ${c.flag === "high" ? "text-neg" : c.flag === "watch" ? "text-accent" : "text-muted"}`}>{c.delta ? `+${fmtNum(c.delta)}` : "—"} {FLAG_TEXT[c.flag]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {p.divestitures.length > 0 && (
          <div className="rounded-lg border border-neg/30 bg-neg/5 px-2.5 py-2 text-[11.5px]">
            <div className="font-medium text-neg">Likely divestitures</div>
            <div className="mt-0.5 text-muted">{p.divestitures.slice(0, 3).map((d) => `${d.plant.name} (${d.plant.company}, ${fmtNum(d.plant.capacityMMcfd)} MMcfd)`).join("; ")}</div>
          </div>
        )}
        <Reasons card={card} />
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[10.5px] text-faint">
          <span>Announced <Ago iso={v.deal.announcedAt} /> · EIA and Census maps</span>
          {onOpen && <button type="button" onClick={() => onOpen(card)} className="inline-flex items-center gap-1 text-accent hover:underline"><MapIcon className="h-3 w-3" /> Open the map</button>}
        </div>
        <Provenance card={card} />
      </div>
    </Shell>
  );
}

const STATUS_STYLE: Record<string, { label: string; bar: string; text: string }> = {
  added: { label: "New", bar: "bg-pos", text: "text-pos" }, removed: { label: "Dropped", bar: "bg-neg", text: "text-neg" }, changed: { label: "Reworded", bar: "bg-info", text: "text-info" },
};

/** A reworded passage with its edits marked (the diff is worked out once per passage, not per render). */
function Reworded({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => wordDiff(before, after), [before, after]);
  return <span className="line-clamp-4">{parts.map((p, j) => <span key={j} className={p.t === "add" ? "text-pos" : p.t === "del" ? "text-neg line-through" : "text-muted"}>{p.s} </span>)}</span>;
}

export function FilingCard({ card, index, onOpen }: { card: EdgeCard; index: number; onOpen?: (card: EdgeCard) => void }) {
  const v = card.visual as FilingVisual;
  const c = v.counts;
  const total = c.added + c.removed + c.changed + c.unchanged || 1;
  return (
    <Shell card={card} index={index} kicker={`Documents · filing change · ${v.ticker}`} icon="FileSearch">
      <div className="flex flex-1 flex-col gap-2.5 px-3.5 pb-3 pt-2">
        <h3 className="text-[15px] font-semibold leading-snug tracking-tight">{card.title}</h3>
        <div>
          <div className="flex h-2 overflow-hidden rounded-full bg-line" aria-hidden>
            {[["bg-pos", c.added], ["bg-info", c.changed], ["bg-neg", c.removed], ["bg-chart-dim", c.unchanged]].map(([cls, n], i) => (n ? <span key={i} className={`${cls} h-full`} style={{ width: `${((n as number) / total) * 100}%` }} /> : null))}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[10.5px]"><span className="text-pos">{c.added} new</span><span className="text-info">{c.changed} reworded</span><span className="text-neg">{c.removed} dropped</span><span className="text-muted">{c.unchanged} unchanged</span></div>
        </div>
        {v.summary.length > 0 ? <ul className="space-y-1 border-l-2 border-accent pl-2.5 text-[12px] leading-relaxed">{v.summary.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}</ul> : <p className="text-[12.5px] leading-relaxed text-muted">{card.summary}</p>}
        <ul className="space-y-1.5">
          {v.samples.slice(0, 2).map((x, i) => {
            const st = STATUS_STYLE[x.status] ?? STATUS_STYLE.added;
            return (
              <li key={i} className="flex gap-2 rounded-md border border-line bg-elevated/30 p-2 text-[11.5px] leading-relaxed">
                <span className={`w-1 shrink-0 rounded-full ${st.bar}`} aria-hidden />
                <div className="min-w-0"><span className={`mr-1 text-[10px] font-semibold uppercase tracking-wider ${st.text}`}>{st.label}</span>
                  {x.status === "changed" && x.before
                    ? <Reworded before={x.before} after={x.text} />
                    : <span className={`line-clamp-4 ${x.status === "removed" ? "text-muted line-through decoration-neg/40" : ""}`}>{x.text}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          {v.prior && <a href={v.prior.url} target="_blank" rel="noreferrer" className="num hover:text-fg">{v.form} {v.prior.filed}</a>}
          <ArrowRight className="h-3 w-3" />
          {v.current && <a href={v.current.url} target="_blank" rel="noreferrer" className="num hover:text-fg">{v.form} {v.current.filed}</a>}
        </div>
        <Reasons card={card} />
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[10.5px] text-faint">
          <span>Filed {v.current ? <Ago iso={v.current.filed} /> : ""} · SEC EDGAR</span>
          {onOpen && <button type="button" onClick={() => onOpen(card)} className="inline-flex items-center gap-1 text-accent hover:underline"><Radar className="h-3 w-3" /> Every change</button>}
        </div>
        <Provenance card={card} />
      </div>
    </Shell>
  );
}

export function FlagCard({ card, index, onOpen }: { card: EdgeCard; index: number; onOpen?: (ticker: string) => void }) {
  const v = card.visual as FlagVisual;
  return (
    <Shell card={card} index={index} kicker={`Networks · red flag · ${v.company.ticker}`} icon="Network">
      <div className="flex flex-1 flex-col gap-2 px-3.5 pb-3 pt-2">
        <div className={`flex items-start gap-2 rounded-lg border p-2.5 ${v.flag.severity === "high" ? "border-neg/50 bg-neg/5" : "border-line bg-elevated/40"}`}>
          <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${v.flag.severity === "high" ? "text-neg" : "text-muted"}`} />
          <div className="min-w-0"><h3 className="text-[14.5px] font-semibold leading-snug tracking-tight">{card.title}</h3><p className="mt-1 text-[12px] leading-relaxed text-muted">{v.flag.detail}</p></div>
        </div>
        {v.flag.urls?.length ? <div className="flex flex-wrap gap-2">{v.flag.urls.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[11px] text-accent hover:underline">Filing {i + 1}<ExternalLink className="h-3 w-3" /></a>)}</div> : null}
        <Reasons card={card} />
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[10.5px] text-faint">
          <span><Ago iso={v.flag.date} /> · SEC EDGAR</span>
          {onOpen && <button type="button" onClick={() => onOpen(v.company.ticker)} className="inline-flex items-center gap-1 text-accent hover:underline"><Network className="h-3 w-3" /> The network</button>}
        </div>
        <Provenance card={card} />
      </div>
    </Shell>
  );
}

export function PredictionCard({ card, index, onOpen }: { card: EdgeCard; index: number; onOpen?: (ticker: string) => void }) {
  const v = card.visual as PredictionVisual;
  const max = Math.max(1e-6, ...v.items.map((i) => i.score));
  return (
    <Shell card={card} index={index} kicker={`Networks · likely ${v.direction === "acquirers" ? "buyers" : "targets"} · ${v.subject.ticker}`} icon="Network">
      <div className="flex flex-1 flex-col gap-2.5 px-3.5 pb-3 pt-2">
        <h3 className="text-[15px] font-semibold leading-snug tracking-tight">{card.title}</h3>
        <ol className="space-y-1 rounded-lg border border-line bg-elevated/40 p-2.5">
          {v.items.slice(0, 5).map((it) => (
            <li key={it.id} className="grid grid-cols-[18px_minmax(0,1fr)_64px] items-center gap-2 text-[12px]">
              <span className="num text-[10.5px] text-muted">{it.rank}</span>
              <span className="truncate">{it.name}{it.ticker ? <span className="num ml-1 text-muted">{it.ticker}</span> : null}{it.fresh && <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 text-[9.5px] font-semibold uppercase text-accent">new</span>}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-accent" style={{ width: `${(it.score / max) * 100}%` }} /></span>
            </li>
          ))}
        </ol>
        <p className="text-[11.5px] leading-relaxed text-muted">{v.scorecard}</p>
        <Reasons card={card} />
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[10.5px] text-faint">
          <span>Deal model {v.version} · a ranking, not a forecast</span>
          {onOpen && <button type="button" onClick={() => onOpen(v.subject.ticker)} className="inline-flex items-center gap-1 text-accent hover:underline"><Network className="h-3 w-3" /> Why, with paths</button>}
        </div>
        <Provenance card={card} />
      </div>
    </Shell>
  );
}

/** One finding as its card. Memoized: a card re-renders only when its finding or handlers change. */
export const EdgeCardView = memo(function EdgeCardView(props: { card: EdgeCard; index: number; onMap?: OnMap; onOpenDeal?: (card: EdgeCard) => void; onOpenRadar?: (card: EdgeCard) => void; onOpenNetworks?: (ticker: string) => void }) {
  if (props.card.kind === "deal_proforma") return <ProformaCard card={props.card} index={props.index} onOpen={props.onOpenDeal} />;
  if (props.card.kind === "ground_change") return <GroundCard card={props.card} index={props.index} onMap={props.onMap} />;
  if (props.card.kind === "flaring") return <FlaringCard card={props.card} index={props.index} onMap={props.onMap} />;
  if (props.card.kind === "radar_change") return <RadarCard card={props.card} index={props.index} onMap={props.onMap} />;
  if (props.card.kind === "permits") return <PermitsCard card={props.card} index={props.index} onMap={props.onMap} />;
  if (props.card.kind === "methane_plume") return <MethaneCard card={props.card} index={props.index} onMap={props.onMap} />;
  if (props.card.kind === "filing_change") return <FilingCard card={props.card} index={props.index} onOpen={props.onOpenRadar} />;
  if (props.card.kind === "graph_flag") return <FlagCard card={props.card} index={props.index} onOpen={props.onOpenNetworks} />;
  if (props.card.kind === "graph_prediction") return <PredictionCard card={props.card} index={props.index} onOpen={props.onOpenNetworks} />;
  return null;
});
