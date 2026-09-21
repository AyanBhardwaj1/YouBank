"use client";

import { useState } from "react";
import type { Command } from "@/lib/functions";
import { PEER_GROUPS, type PeerGroup } from "@/lib/static-data";
import { createPeerGroup, deletePeerGroup, useDbPeerGroups, type DbPeerGroup } from "@/lib/client/persistence";

export function PgScreen({ onRun }: { onRun: (c: Command) => void }) {
  const { groups: dbGroups, error } = useDbPeerGroups();
  const [name, setName] = useState("");
  const [tickers, setTickers] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const list = tickers.toUpperCase().split(/[\s,]+/).filter(Boolean);
    if (!name.trim() || list.length === 0) return;
    setBusy(true); setMsg(null);
    try {
      await createPeerGroup({ name: name.trim(), members: list.map((t) => ({ ticker: t, tier: "core", rationale: "Added manually" })) });
      setName(""); setTickers(""); setMsg("Saved");
    } catch (err) { setMsg(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  const card = (g: PeerGroup | DbPeerGroup, saved: boolean) => {
    const core = g.members.filter((m) => m.tier === "core");
    const adj = g.members.filter((m) => m.tier === "adjacent");
    return (
      <div key={g.id} className="flex flex-col rounded-md border border-line bg-elevated/50 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-semibold">{g.name}</span>
          <span className="num shrink-0 text-[10.5px] text-muted">{g.members.length} members{saved ? ` · ${(g as DbPeerGroup).createdBy ?? ""}` : " · built-in"}</span>
        </div>
        {g.description && <p className="mt-1 text-[11px] text-muted">{g.description}</p>}
        <div className="mt-2 text-[10px] uppercase tracking-wider text-muted">Core</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {core.map((m) => (
            <button key={m.ticker} type="button" title={m.rationale} onClick={() => onRun({ ticker: m.ticker, fn: "COMPS" })}
              className="num rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent hover:bg-accent/25">{m.ticker}</button>
          ))}
        </div>
        {adj.length > 0 && (
          <>
            <div className="mt-2 text-[10px] uppercase tracking-wider text-muted">Adjacent</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {adj.map((m) => (
                <button key={m.ticker} type="button" title={m.rationale} onClick={() => onRun({ ticker: m.ticker, fn: "COMPS" })}
                  className="num rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-accent">{m.ticker}</button>
              ))}
            </div>
          </>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-line pt-2 text-[10.5px] text-muted">
          <span>Click a ticker to open its comps with this group.</span>
          {saved && <button type="button" onClick={() => { if (window.confirm(`Delete "${g.name}"?`)) void deletePeerGroup((g as DbPeerGroup).dbId); }} className="text-muted hover:text-neg">delete</button>}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <form onSubmit={create} className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-line p-2 text-[11px]">
        <span className="text-muted">New group</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="rounded border border-line bg-bg px-2 py-0.5 text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none" />
        <input value={tickers} onChange={(e) => setTickers(e.target.value)} placeholder="Tickers, e.g. CRWD ZS PANW" className="num w-56 rounded border border-line bg-bg px-2 py-0.5 uppercase text-fg placeholder:normal-case placeholder:text-faint focus:border-accent/60 focus:outline-none" />
        <button type="submit" disabled={busy} className="rounded bg-accent px-2 py-0.5 font-semibold text-bg disabled:opacity-50">Save to Neon</button>
        {msg && <span className={msg === "Saved" ? "text-pos" : "text-neg"}>{msg}</span>}
        {error && <span className="text-neg">{error}</span>}
      </form>
      {dbGroups.length > 0 && <div className="text-[10px] uppercase tracking-wider text-muted">Saved groups</div>}
      <div className="grid gap-3 lg:grid-cols-2">{dbGroups.map((g) => card(g, true))}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted">Built-in groups</div>
      <div className="grid gap-3 lg:grid-cols-2">{PEER_GROUPS.map((g) => card(g, false))}</div>
    </div>
  );
}
