"use client";

/**
 * Edge feed cards. Each finding shows its visual first (a before/after wipe for ground change, the
 * county screen for a deal), then what it means, how sure Edge is and why, and where every part came
 * from, with the audit trail one click away.
 */
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, ChevronDown, Download, Map as MapIcon, MapPin, Sparkles, Users } from "lucide-react";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Compare } from "./Compare";
import { ago, confidenceLabel, fmtNum, type EdgeCard, type GroundVisual, type ProformaVisual } from "./client";

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
      initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 360, damping: 32, delay: Math.min(index, 8) * 0.04 }}
      className="panel flex flex-col overflow-hidden"
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

export function GroundCard({ card, index, now, onMap }: { card: EdgeCard; index: number; now: number; onMap?: (card: EdgeCard) => void }) {
  const v = card.visual as GroundVisual;
  const when = card.observedAt ?? card.detectedAt;
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
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[10.5px] text-faint">
          <span>Seen {now ? ago(when, now) : when.slice(0, 10)} · Sentinel-2, 10 m</span>
          {onMap && <button type="button" onClick={() => onMap(card)} className="inline-flex items-center gap-1 text-accent hover:underline"><MapIcon className="h-3 w-3" /> On the map</button>}
        </div>
        <Provenance card={card} />
      </div>
    </Shell>
  );
}

const FLAG_TEXT: Record<string, string> = { high: "Screens high", watch: "Worth a look", "": "" };

export function ProformaCard({ card, index, now, onOpen }: { card: EdgeCard; index: number; now: number; onOpen?: (card: EdgeCard) => void }) {
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
          <span>Announced {now ? ago(v.deal.announcedAt, now) : v.deal.announcedAt.slice(0, 10)} · EIA and Census maps</span>
          {onOpen && <button type="button" onClick={() => onOpen(card)} className="inline-flex items-center gap-1 text-accent hover:underline"><MapIcon className="h-3 w-3" /> Open the map</button>}
        </div>
        <Provenance card={card} />
      </div>
    </Shell>
  );
}

export function EdgeCardView(props: { card: EdgeCard; index: number; now: number; onMap?: (card: EdgeCard) => void; onOpenDeal?: (card: EdgeCard) => void }) {
  if (props.card.kind === "deal_proforma") return <ProformaCard card={props.card} index={props.index} now={props.now} onOpen={props.onOpenDeal} />;
  if (props.card.kind === "ground_change") return <GroundCard card={props.card} index={props.index} now={props.now} onMap={props.onMap} />;
  return null;
}
