"use client";

/**
 * What this person watches in Edge: companies (their plants and pipelines) and places. Add one, look at
 * one again now, or drop it; the beta allows five each, and the team's shared watches show below.
 */
import { Building2, ChevronDown, Map as MapIcon, Plus, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { Select } from "@/components/ui/Select";
import { Ago } from "./Cards";
import { onTabKeys, tabProps } from "./tabs";
import { api, post, type EdgeState, type Watch } from "./client";
import { errorMessage } from "@/lib/client/errors";

export function WatchPanel({ state, onChanged }: { state: EdgeState; onChanged: () => void }) {
  const [kind, setKind] = useState<"company" | "place">("company");
  const [ticker, setTicker] = useState("");
  const [place, setPlace] = useState(state.places[0]?.key ?? "permian");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const mine = state.watches.filter((w) => w.mine);
  const team = state.watches.filter((w) => !w.mine);
  const full = mine.length >= state.limits.watches;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("add"); setNote(null);
    try {
      await post("/api/edge/watches", kind === "company" ? { kind, ticker: ticker.trim() } : { kind, place });
      setTicker("");
      setNote({ tone: "ok", text: "Added. Edge is looking at its sites now; new finds appear in the feed within a minute or two." });
      onChanged();
    } catch (err) {
      setNote({ tone: "err", text: errorMessage(err) });
    } finally { setBusy(null); }
  };
  const remove = async (w: Watch) => {
    setBusy(`rm-${w.id}`);
    try { await api(`/api/edge/watches/${w.id}`, { method: "DELETE" }); onChanged(); } catch (err) { setNote({ tone: "err", text: errorMessage(err) }); } finally { setBusy(null); }
  };
  const check = async (w: Watch) => {
    setBusy(`ck-${w.id}`); setNote(null);
    try { await post(`/api/edge/watches/${w.id}`, {}); setNote({ tone: "ok", text: `Looking at ${w.label} now.` }); } catch (err) { setNote({ tone: "err", text: errorMessage(err) }); } finally { setBusy(null); }
  };

  const row = (w: Watch) => (
    <li key={w.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-elevated/60">
      {w.kind === "company" ? <Building2 className="h-3.5 w-3.5 shrink-0 text-muted" /> : <MapIcon className="h-3.5 w-3.5 shrink-0 text-muted" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px]">{w.label}{w.target.ticker && w.target.ticker !== w.label ? <span className="num ml-1 text-muted">{w.target.ticker}</span> : null}</div>
        <div className="text-[10.5px] text-faint">{w.lastCheckedAt ? <>checked <Ago iso={w.lastCheckedAt} /></> : "not checked yet"}{w.mine ? "" : " · team"}</div>
      </div>
      <button type="button" onClick={() => check(w)} disabled={!!busy} title="Look again now" aria-label={`Look at ${w.label} again now`} className="rounded p-1 text-muted opacity-60 transition hover:bg-elevated hover:text-fg group-hover:opacity-100 disabled:opacity-30">
        <RefreshCw className={`h-3.5 w-3.5 ${busy === `ck-${w.id}` ? "animate-spin" : ""}`} />
      </button>
      {w.mine && (
        <button type="button" onClick={() => remove(w)} disabled={!!busy} title="Stop watching" aria-label={`Stop watching ${w.label}`} className="rounded p-1 text-muted opacity-60 transition hover:bg-elevated hover:text-neg group-hover:opacity-100 disabled:opacity-30">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );

  return (
    <section className="panel p-3" aria-label="Watches">
      {/* On a phone the panel sits above the feed, so it starts folded to one line. */}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between xl:hidden">
        <span className="text-[12.5px] font-semibold">Watching</span>
        <span className="flex items-center gap-1.5"><span className="num text-[10.5px] text-muted">{mine.length} of {state.limits.watches}</span><ChevronDown className={`h-3.5 w-3.5 text-muted transition ${open ? "rotate-180" : ""}`} /></span>
      </button>
      <div className="hidden items-center justify-between xl:flex">
        <h2 className="text-[12.5px] font-semibold">Watching</h2>
        <span className="num text-[10.5px] text-muted" title="Beta limit">{mine.length} of {state.limits.watches}</span>
      </div>
      <div className={open ? "" : "hidden xl:block"}>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, (mine.length / state.limits.watches) * 100)}%` }} /></div>
        <ul className="mt-2 space-y-0.5">{mine.map(row)}</ul>
        {!mine.length && <p className="mt-2 text-[11.5px] text-muted">Nothing yet. Add a company or a place below.</p>}
        {team.length > 0 && (
          <>
            <div className="mt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">Your team</div>
            <ul className="mt-1 space-y-0.5">{team.map(row)}</ul>
          </>
        )}
        <form onSubmit={add} className="mt-3 space-y-2 border-t border-line pt-3">
          <div className="flex rounded-md border border-line p-0.5 text-[11.5px]" role="tablist" aria-label="What to watch" onKeyDown={onTabKeys}>
            {(["company", "place"] as const).map((k) => (
              <button key={k} type="button" {...tabProps(kind === k)} onClick={() => setKind(k)} className={`flex-1 rounded px-2 py-1 capitalize transition ${kind === k ? "bg-elevated text-fg" : "text-muted hover:text-fg"}`}>{k}</button>
            ))}
          </div>
          {kind === "company" ? (
            <>
              <input list="edge-companies" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="Ticker, e.g. ET" aria-label="Company ticker" className="ctl w-full border border-line bg-bg px-2 py-1.5 text-[12.5px] outline-none placeholder:text-faint focus:border-accent/60" />
              <datalist id="edge-companies">{state.companies.map((c) => <option key={c.ticker} value={c.ticker}>{c.company}: {c.assets} mapped assets</option>)}</datalist>
            </>
          ) : (
            <Select value={place} onChange={setPlace} aria-label="Place" className="ctl w-full border border-line bg-bg px-2 py-1.5 text-left text-[12.5px] outline-none focus:border-accent/60">
              {state.places.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </Select>
          )}
          <button type="submit" disabled={full || !!busy || (kind === "company" && !ticker.trim())} className="ctl flex w-full items-center justify-center gap-1.5 bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg transition disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" /> {full ? "Watch limit reached" : "Watch"}
          </button>
          {note && <p role="status" className={`text-[11px] ${note.tone === "err" ? "text-neg" : "text-muted"}`}>{note.text}</p>}
          <p className="text-[10.5px] leading-relaxed text-faint">Maps cover the {state.covered.map((c) => c.name).join(", ")} for now; more regions come as their asset maps are added.</p>
        </form>
      </div>
    </section>
  );
}
