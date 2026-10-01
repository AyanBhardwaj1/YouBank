"use client";

/**
 * What Networks finds for the company in view, one tab at a time: its likely buyers and targets (the
 * deal model's picks, each with the paths that connect the two, drawn on the graph when chosen), warm
 * introductions, who a shock would reach, red flags, and its deal history. Every step links to its
 * filing.
 */
import { AlertTriangle, Check, Copy, ExternalLink, Loader2, Mail, Users } from "lucide-react";
import { useState } from "react";
import { post, useApi } from "@/components/news/client";
import { type CompanyView, type Exposure, type Intros, type Picks, type Prediction, type Step } from "./client";

type Tab = "buyers" | "targets" | "intros" | "exposure" | "flags" | "deals";
const TABS: { id: Tab; label: string }[] = [{ id: "buyers", label: "Likely buyers" }, { id: "targets", label: "Likely targets" }, { id: "intros", label: "Warm intros" }, { id: "exposure", label: "Exposure" }, { id: "flags", label: "Red flags" }, { id: "deals", label: "Deals" }];

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-0.5">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-1.5 text-[11.5px] leading-snug">
          <span className="num mt-px shrink-0 text-faint">{i + 1}.</span>
          <span className="min-w-0">{s.text}{s.asOf ? <span className="text-faint"> · {s.asOf.slice(0, 7)}</span> : null}{s.url && /^https?:/.test(s.url) ? <a href={s.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex align-[-1px] text-faint hover:text-fg" aria-label="The filing"><ExternalLink className="h-3 w-3" /></a> : null}</span>
        </li>
      ))}
    </ol>
  );
}

function PickList({ data, onPick, picked, onOpen }: { data: Picks | null; onPick: (p: Prediction | null, graph: Picks["graph"]) => void; picked: number | null; onOpen: (ticker: string) => void }) {
  if (!data) return <div className="h-40 animate-pulse rounded-md bg-elevated/40" />;
  const max = Math.max(1e-6, ...data.items.map((i) => i.score));
  return (
    <div className="space-y-2">
      <p className="rounded-md bg-elevated/50 px-2.5 py-1.5 text-[11.5px] text-muted">{data.scorecard}{data.version ? <span className="text-faint"> · model {data.version}</span> : null}</p>
      {!data.items.length && <p className="text-[12px] text-muted">{data.version ? "No picks for this company in the latest model." : "The deal model trains every week on the whole graph; its picks appear here after the first run."}</p>}
      <ol className="space-y-1.5">
        {data.items.map((p) => {
          const on = picked === p.node.id;
          return (
            <li key={p.node.id} className={`rounded-md border px-2.5 py-2 transition ${on ? "border-accent/60 bg-accent-soft/30" : "border-line hover:border-accent/40"}`}>
              <button type="button" onClick={() => onPick(on ? null : p, data.graph)} className="flex w-full items-center gap-2 text-left" aria-expanded={on}>
                <span className="num w-5 shrink-0 text-[11px] text-muted">{p.rank}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{p.node.name}{p.node.ticker ? <span className="num ml-1 text-muted">{p.node.ticker}</span> : null}</span>
                <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-accent" style={{ width: `${(p.score / max) * 100}%` }} /></span>
              </button>
              {on && (
                <div className="rise mt-2 space-y-2 border-t border-line pt-2">
                  {p.paths.length ? p.paths.map((path, i) => <div key={i}><div className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Path {i + 1}</div><Steps steps={path} /></div>) : <p className="text-[11.5px] text-muted">No short path joins them in the graph; the model ranks them on features and the wider network.</p>}
                  {p.also.length > 0 && <ul className="flex flex-wrap gap-1">{p.also.map((a) => <li key={a} className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-muted">{a}</li>)}</ul>}
                  {p.node.ticker && <button type="button" onClick={() => onOpen(p.node.ticker)} className="text-[11.5px] text-accent hover:underline">Open {p.node.ticker} in Networks</button>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="text-[10.5px] text-faint">A ranking from a model trained on past deals, not a forecast that a deal will happen.</p>
    </div>
  );
}

function IntroList({ ticker, name }: { ticker: string; name: string }) {
  const { data, reload } = useApi<Intros>(`/api/edge/graph/intros?ticker=${encodeURIComponent(ticker)}`);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [drafting, setDrafting] = useState<number | null>(null);
  const [drafted, setDrafted] = useState<Record<number, { ok: boolean; text: string }>>({});
  const toggle = async () => { setBusy(true); try { await post("/api/edge/graph/pool", { on: !data?.pooled }); reload(); } finally { setBusy(false); } };
  // Written by the Relationships agent in the person's voice, then queued or sent under their autopilot rules.
  const request = async (i: number) => {
    setDrafting(i);
    try {
      const r = await post<{ to: string; scheduled: boolean; reasons: string[] }>("/api/edge/graph/intro", { ticker, index: i });
      setDrafted((d) => ({ ...d, [i]: { ok: true, text: r.scheduled ? `Written to ${r.to}; autopilot sends it after its hold, inside your sending hours.` : `Written to ${r.to}; it is waiting in your review queue.` } }));
    } catch (e) { setDrafted((d) => ({ ...d, [i]: { ok: false, text: e instanceof Error ? e.message : String(e) } })); } finally { setDrafting(null); }
  };
  const draft = (i: number) => {
    const it = data!.items[i];
    const last = it.steps[it.steps.length - 1]?.text ?? "";
    const text = `Hi ${it.contact.name.split(" ")[0] || "there"},\n\nI'm looking to connect with the team at ${name}. I saw that ${last.charAt(0).toLowerCase()}${last.slice(1)}. Would you be open to a short introduction?\n\nThanks,`;
    void navigator.clipboard.writeText(text).then(() => { setCopied(i); setTimeout(() => setCopied(null), 1500); });
  };
  if (!data) return <div className="h-32 animate-pulse rounded-md bg-elevated/40" />;
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-[11.5px]">
        <Users className="h-3.5 w-3.5 text-muted" /><span className="flex-1">Share my CRM contacts with my team for warm intros</span>
        <button type="button" role="switch" aria-checked={data.pooled} disabled={busy} onClick={() => void toggle()} className={`relative h-4 w-7 rounded-full transition ${data.pooled ? "bg-accent" : "bg-line-strong"}`}><span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition ${data.pooled ? "left-3.5" : "left-0.5"}`} /></button>
      </label>
      {!data.items.length ? <p className="text-[12px] text-muted">No one in your CRM{data.pooled ? " or your team's pooled contacts" : ""} connects to {name}&apos;s board, officers or business partners yet.</p> : (
        <ol className="space-y-1.5">
          {data.items.map((it, i) => (
            <li key={i} className="rounded-md border border-line px-2.5 py-2">
              <div className="flex items-center gap-2 text-[12.5px]"><span className="font-medium">{it.contact.name}</span><span className="text-[10.5px] text-muted">{it.contact.via} · {it.hops} step{it.hops === 1 ? "" : "s"}</span>
                <span className="ml-auto flex items-center gap-2.5">
                  <button type="button" disabled={drafting !== null || !!drafted[i]?.ok} onClick={() => void request(i)} className="flex items-center gap-1 text-[11px] text-accent hover:underline disabled:opacity-50">{drafting === i ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}Draft an intro request</button>
                  <button type="button" onClick={() => draft(i)} className="flex items-center gap-1 text-[11px] text-muted hover:text-fg" aria-label="Copy an intro request">{copied === i ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied === i ? "Copied" : "Copy"}</button>
                </span>
              </div>
              <div className="mt-1"><Steps steps={it.steps} /></div>
              {drafted[i] && <p className={`mt-1 text-[11px] ${drafted[i].ok ? "text-muted" : "text-neg"}`}>{drafted[i].text}{drafted[i].ok && <a href="/app/crm?tab=drafts" className="ml-1 text-accent hover:underline">Open the queue</a>}</p>}
            </li>
          ))}
        </ol>
      )}
      <p className="text-[10.5px] text-faint">Contacts come from your CRM (and your teammates&apos;, when they opt in). People appear only in their public roles from SEC filings.</p>
    </div>
  );
}

export function Findings({ ticker, company, onPick, picked, onOpen }: { ticker: string; company: CompanyView; onPick: (p: Prediction | null, graph: Picks["graph"]) => void; picked: number | null; onOpen: (ticker: string) => void }) {
  const [tab, setTab] = useState<Tab>("buyers");
  const q = `ticker=${encodeURIComponent(ticker)}`;
  const buyers = useApi<Picks>(tab === "buyers" ? `/api/edge/graph/acquirers?${q}` : null);
  const targets = useApi<Picks>(tab === "targets" ? `/api/edge/graph/targets?${q}` : null);
  const exposure = useApi<Exposure>(tab === "exposure" ? `/api/edge/graph/exposure?${q}` : null);
  const flags = company.flags;
  return (
    <div className="panel p-3">
      <div className="-mx-1 flex flex-wrap gap-1 pb-2" role="tablist" aria-label="Findings">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); onPick(null, { nodes: [], links: [] }); }} className={`rounded-full border px-2 py-0.5 text-[11.5px] ${tab === t.id ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>
            {t.label}{t.id === "flags" && flags.length ? <span className={`ml-1 num ${flags.some((f) => f.severity === "high") ? "text-neg" : ""}`}>{flags.length}</span> : null}
          </button>
        ))}
      </div>
      {tab === "buyers" && <PickList data={buyers.data} onPick={onPick} picked={picked} onOpen={onOpen} />}
      {tab === "targets" && <PickList data={targets.data} onPick={onPick} picked={picked} onOpen={onOpen} />}
      {(buyers.error || targets.error || exposure.error) && <p className="text-[12px] text-neg">{buyers.error ?? targets.error ?? exposure.error}</p>}
      {tab === "intros" && <IntroList ticker={ticker} name={company.node.name} />}
      {tab === "exposure" && (!exposure.data ? <div className="h-32 animate-pulse rounded-md bg-elevated/40" /> : !exposure.data.items.length ? <p className="text-[12px] text-muted">No customers, suppliers, joint ventures or controlling stakes connect {company.node.name} to other companies in the graph yet.</p> : (
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted">If {company.node.name} were hit, who would feel it: dependence travels through customers and suppliers (by share of revenue), joint ventures and controlling stakes, not passive index holdings.</p>
          <ol className="space-y-1.5">{exposure.data.items.map((x) => (
            <li key={x.node.id} className="rounded-md border border-line px-2.5 py-2">
              <div className="flex items-center gap-2 text-[12.5px]"><span className="min-w-0 flex-1 truncate font-medium">{x.node.name}{x.node.ticker ? <span className="num ml-1 text-muted">{x.node.ticker}</span> : null}</span><span className="h-1.5 w-16 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-neg/70" style={{ width: `${x.score * 100}%` }} /></span></div>
              {x.via.length > 0 && <div className="mt-1"><Steps steps={x.via} /></div>}
            </li>
          ))}</ol>
        </div>
      ))}
      {tab === "flags" && (!flags.length ? <p className="text-[12px] text-muted">No red flags in the filings Edge has read: no restatement or auditor change, no cluster of insider selling, no ownership loop, no director on both sides of a business relationship.</p> : (
        <ol className="space-y-1.5">{flags.map((f, i) => (
          <li key={i} className={`rounded-md border px-2.5 py-2 ${f.severity === "high" ? "border-neg/50 bg-neg/5" : "border-line"}`}>
            <div className="flex items-start gap-1.5 text-[12.5px] font-medium"><AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${f.severity === "high" ? "text-neg" : "text-muted"}`} /><span className="flex-1">{f.title}</span><span className="num shrink-0 text-[10.5px] text-muted">{f.date}</span></div>
            <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{f.detail}</p>
            {f.urls?.length ? <div className="mt-1 flex flex-wrap gap-2">{f.urls.map((u, j) => <a key={j} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[11px] text-accent hover:underline">Filing {j + 1}<ExternalLink className="h-3 w-3" /></a>)}</div> : null}
          </li>
        ))}</ol>
      ))}
      {tab === "deals" && (!company.deals.length ? <p className="text-[12px] text-muted">No deals recorded yet from merger filings, 8-K Item 2.01 or the Newsroom.</p> : (
        <ol className="space-y-1">{company.deals.map((d) => (
          <li key={d.id} className="flex items-start gap-2 rounded-md px-1.5 py-1 text-[12px] hover:bg-elevated/40">
            <span className="num w-[58px] shrink-0 text-[11px] text-muted">{d.asOf?.slice(0, 7) ?? ""}</span>
            <span className="min-w-0 flex-1">{d.label}</span>
            {d.url && <a href={d.url} target="_blank" rel="noreferrer" aria-label="The filing" className="shrink-0 text-faint hover:text-fg"><ExternalLink className="h-3 w-3" /></a>}
          </li>
        ))}</ol>
      ))}
    </div>
  );
}
