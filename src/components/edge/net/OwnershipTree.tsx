"use client";

/**
 * The ownership tree: who owns the company (5% holders from Schedule 13D/13G, and parents that list it
 * as a subsidiary) above it, and what it owns (listed companies and stakes first, then subsidiaries by
 * jurisdiction) below, two levels deep. Every branch links to the filing it came from.
 */
import { ChevronRight, ExternalLink, Search } from "lucide-react";
import { useState } from "react";
import { KIND_LABEL, NODE_COLOR, type Tree, type TreeNode } from "./client";

function Row({ t, onOpen, depth = 0 }: { t: TreeNode; onOpen: (ticker: string) => void; depth?: number }) {
  const [open, setOpen] = useState(depth === 0 && t.children.length > 0 && t.children.length <= 6);
  return (
    <li>
      <div className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-elevated/50" style={{ paddingLeft: 6 + depth * 18 }}>
        {t.children.length > 0 ? <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Collapse" : "Expand"} className="text-muted hover:text-fg"><ChevronRight className={`h-3.5 w-3.5 transition ${open ? "rotate-90" : ""}`} /></button> : <span className="w-3.5" />}
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: NODE_COLOR[t.node.kind] }} title={KIND_LABEL[t.node.kind]} />
        {t.node.kind === "company" && t.node.ticker ? <button type="button" onClick={() => onOpen(t.node.ticker)} className="truncate text-left text-[12.5px] font-medium hover:text-accent hover:underline">{t.node.name} <span className="num text-muted">{t.node.ticker}</span></button> : <span className="truncate text-[12.5px]">{t.node.name}</span>}
        {t.percent !== null && <span className="num shrink-0 rounded-full bg-accent-soft px-1.5 text-[10.5px] text-accent">{t.percent}%</span>}
        {t.node.sub && t.node.kind !== "company" && <span className="hidden shrink-0 text-[10.5px] text-faint sm:inline">{t.node.sub}</span>}
        {t.children.length > 0 && <span className="shrink-0 text-[10.5px] text-muted">{t.children.length} below</span>}
        {t.url && <a href={t.url} target="_blank" rel="noreferrer" aria-label="The filing" className="ml-auto shrink-0 text-faint hover:text-fg"><ExternalLink className="h-3 w-3" /></a>}
      </div>
      {open && <ul>{t.children.map((c) => <Row key={`${c.node.id}-${c.relation}`} t={c} onOpen={onOpen} depth={depth + 1} />)}</ul>}
    </li>
  );
}

export function OwnershipTree({ tree, onOpen }: { tree: Tree; onOpen: (ticker: string) => void }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const companies = tree.down.filter((d) => d.node.kind === "company");
  const subs = tree.down.filter((d) => d.node.kind !== "company" && (!q || d.node.name.toLowerCase().includes(q.toLowerCase())));
  const places = new Map<string, number>();
  for (const s of tree.down) if (s.node.kind !== "company") places.set(s.node.sub || "Unstated", (places.get(s.node.sub || "Unstated") ?? 0) + 1);
  return (
    <div className="rounded-lg border border-line bg-bg p-3">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Owned by</div>
      {tree.up.length ? <ul className="mt-1">{tree.up.map((u) => <Row key={`u${u.node.id}-${u.relation}`} t={u} onOpen={onOpen} />)}</ul> : <p className="mt-1 text-[12px] text-muted">No holder of 5% or more has filed on it recently.</p>}
      <div className="my-2 flex items-center gap-2 rounded-md border border-accent/40 bg-accent-soft/40 px-2.5 py-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: NODE_COLOR.company }} />
        <span className="text-[13px] font-semibold">{tree.root.name}</span><span className="num text-[11px] text-muted">{tree.root.ticker}</span>
      </div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Owns</div>
      {companies.length > 0 && <ul className="mt-1">{companies.map((c) => <Row key={`d${c.node.id}-${c.relation}`} t={c} onOpen={onOpen} />)}</ul>}
      {tree.down.length - companies.length > 0 && (
        <div className="mt-2">
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
            <span>{tree.down.length - companies.length} subsidiaries in {places.size} jurisdiction{places.size === 1 ? "" : "s"}{places.size ? ` (${[...places.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p, n]) => `${p} ${n}`).join(", ")})` : ""}</span>
            <label className="ml-auto flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5"><Search className="h-3 w-3" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a subsidiary" className="w-[140px] bg-transparent text-[11.5px] text-fg outline-none placeholder:text-faint" aria-label="Find a subsidiary" /></label>
          </div>
          <ul className="mt-1 max-h-[340px] overflow-y-auto">{(all || q ? subs : subs.slice(0, 25)).map((s) => <Row key={`s${s.node.id}`} t={s} onOpen={onOpen} />)}</ul>
          {!all && !q && subs.length > 25 && <button type="button" onClick={() => setAll(true)} className="mt-1 text-[11.5px] text-accent hover:underline">Show all {subs.length}</button>}
        </div>
      )}
    </div>
  );
}
