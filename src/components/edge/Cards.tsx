"use client";

/**
 * Edge feed cards. Each finding shows its visual first (a before/after wipe for ground change, the
 * county screen for a deal, the edits to a watched company's risk factors), then what it means, how
 * sure Edge is and why, and where every part came from, with the audit trail one click away.
 */
import { motion, useReducedMotion } from "motion/react";
import { AlertTriangle, ArrowRight, ArrowUpRight, ChevronDown, Download, ExternalLink, Map as MapIcon, MapPin, Network, Radar, Sparkles, Users } from "lucide-react";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Compare } from "./Compare";
import { wordDiff } from "@/lib/edge/docs/text";
import { ago, confidenceLabel, fmtNum, type EdgeCard, type FilingVisual, type FlagVisual, type GroundVisual, type PredictionVisual, type ProformaVisual } from "./client";

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

const STATUS_STYLE: Record<string, { label: string; bar: string; text: string }> = {
  added: { label: "New", bar: "bg-pos", text: "text-pos" }, removed: { label: "Dropped", bar: "bg-neg", text: "text-neg" }, changed: { label: "Reworded", bar: "bg-info", text: "text-info" },
};

export function FilingCard({ card, index, now, onOpen }: { card: EdgeCard; index: number; now: number; onOpen?: (card: EdgeCard) => void }) {
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
                    ? <span className="line-clamp-4">{wordDiff(x.before, x.text).map((p, j) => <span key={j} className={p.t === "add" ? "text-pos" : p.t === "del" ? "text-neg line-through" : "text-muted"}>{p.s} </span>)}</span>
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
          <span>Filed {now && v.current ? ago(v.current.filed, now) : v.current?.filed ?? ""} · SEC EDGAR</span>
          {onOpen && <button type="button" onClick={() => onOpen(card)} className="inline-flex items-center gap-1 text-accent hover:underline"><Radar className="h-3 w-3" /> Every change</button>}
        </div>
        <Provenance card={card} />
      </div>
    </Shell>
  );
}

export function FlagCard({ card, index, now, onOpen }: { card: EdgeCard; index: number; now: number; onOpen?: (ticker: string) => void }) {
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
          <span>{now ? ago(v.flag.date, now) : v.flag.date} · SEC EDGAR</span>
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

export function EdgeCardView(props: { card: EdgeCard; index: number; now: number; onMap?: (card: EdgeCard) => void; onOpenDeal?: (card: EdgeCard) => void; onOpenRadar?: (card: EdgeCard) => void; onOpenNetworks?: (ticker: string) => void }) {
  if (props.card.kind === "deal_proforma") return <ProformaCard card={props.card} index={props.index} now={props.now} onOpen={props.onOpenDeal} />;
  if (props.card.kind === "ground_change") return <GroundCard card={props.card} index={props.index} now={props.now} onMap={props.onMap} />;
  if (props.card.kind === "filing_change") return <FilingCard card={props.card} index={props.index} now={props.now} onOpen={props.onOpenRadar} />;
  if (props.card.kind === "graph_flag") return <FlagCard card={props.card} index={props.index} now={props.now} onOpen={props.onOpenNetworks} />;
  if (props.card.kind === "graph_prediction") return <PredictionCard card={props.card} index={props.index} onOpen={props.onOpenNetworks} />;
  return null;
}
