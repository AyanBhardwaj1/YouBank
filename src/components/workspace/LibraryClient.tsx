"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toolById } from "@/lib/workflows/registry";
import { Icon } from "@/components/ui/Icon";

export type LibRun = { id: number; toolId: string; title: string; model: string; provider: string; status: string; durationMs: number; createdAt: string };
export type LibSheet = { id: number; name: string; targetTicker: string; updatedAt: string };
export type LibGroup = { id: number; name: string; description: string; createdAt: string };

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function LibraryClient({ runs, sheets, groups }: { runs: LibRun[]; sheets: LibSheet[]; groups: LibGroup[] }) {
  const [tab, setTab] = useState<"runs" | "sheets" | "groups">("runs");
  const [q, setQ] = useState("");
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return runs.filter((r) => !removed.has(r.id) && (!s || `${r.title} ${r.toolId} ${r.model}`.toLowerCase().includes(s)));
  }, [runs, q, removed]);

  const del = async (id: number) => {
    setRemoved((prev) => new Set(prev).add(id));
    await fetch(`/api/tools/runs/${id}`, { method: "DELETE" }).catch(() => {});
  };

  const tabs = [
    { id: "runs" as const, label: "Workflow runs", n: runs.length, icon: "Wand2" },
    { id: "sheets" as const, label: "Comps sheets", n: sheets.length, icon: "Table" },
    { id: "groups" as const, label: "Peer groups", n: groups.length, icon: "Users" },
  ];

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1100px] px-5 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">Library</h1>
            <p className="mt-1 text-[12px] text-muted">Everything you have saved: workflow output with its sources, comps sheets, and peer groups.</p>
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search runs…" className="ctl w-56 border border-line bg-bg px-2.5 py-1.5 text-[12px] placeholder:text-faint focus:border-accent/60 focus:outline-none" />
        </div>

        <div className="mt-5 flex flex-wrap gap-1.5 border-b border-line pb-3">
          {tabs.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`ctl flex items-center gap-1.5 px-3 py-1.5 text-[12px] ${tab === t.id ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>
              <Icon name={t.icon} className="h-3.5 w-3.5" /> {t.label} <span className="num opacity-60">{t.n}</span>
            </button>
          ))}
        </div>

        {tab === "runs" && (
          <div className="mt-4 rise">
            {list.length === 0 ? (
              <div className="panel p-6 text-center text-[12px] text-muted">No saved runs yet. <Link href="/app/tools" className="text-accent hover:underline">Run a workflow</Link> and it lands here with every source it used.</div>
            ) : (
              <ul className="stagger space-y-1.5">
                {list.map((r) => {
                  const t = toolById(r.toolId);
                  return (
                    <li key={r.id} className="lift panel flex items-center gap-3 p-3">
                      <span className={`grid h-8 w-8 shrink-0 place-items-center ctl ${r.provider === "calc" ? "bg-info/10 text-info" : "bg-accent-soft text-accent"}`}><Icon name={t?.icon ?? "Wand2"} className="h-4 w-4" /></span>
                      <Link href={`/app/tools/${r.toolId}?run=${r.id}`} className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold">{r.title || t?.title || r.toolId}</div>
                        <div className="num mt-0.5 truncate text-[10.5px] text-muted">{t?.title ?? r.toolId} · {when(r.createdAt)} · {r.provider === "calc" ? "calculator" : `${r.model}${r.durationMs ? ` · ${(r.durationMs / 1000).toFixed(0)}s` : ""}`}{r.status === "error" ? " · had an error" : ""}</div>
                      </Link>
                      <button type="button" onClick={() => del(r.id)} title="Delete" className="shrink-0 text-muted hover:text-neg"><Icon name="X" className="h-3.5 w-3.5" /></button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {tab === "sheets" && (
          <div className="mt-4 rise">
            {sheets.length === 0 ? (
              <div className="panel p-6 text-center text-[12px] text-muted">No comps sheets yet. Open <Link href="/app/terminal" className="text-accent hover:underline">the terminal</Link>, build a peer set, and save the sheet.</div>
            ) : (
              <ul className="stagger grid gap-2 sm:grid-cols-2">
                {sheets.map((s) => (
                  <li key={s.id}>
                    <Link href={`/app/terminal?ticker=${s.targetTicker}&fn=COMPS`} className="lift block panel p-3">
                      <div className="flex items-baseline justify-between"><span className="text-[13px] font-semibold">{s.name}</span><span className="num text-[11px] text-accent">{s.targetTicker}</span></div>
                      <div className="num mt-1 text-[10.5px] text-muted">updated {when(s.updatedAt)}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "groups" && (
          <div className="mt-4 rise">
            {groups.length === 0 ? (
              <div className="panel p-6 text-center text-[12px] text-muted">No peer groups yet. Ask the assistant to propose peers on any comps screen and save the set.</div>
            ) : (
              <ul className="stagger grid gap-2 sm:grid-cols-2">
                {groups.map((g) => (
                  <li key={g.id} className="panel p-3">
                    <div className="text-[13px] font-semibold">{g.name}</div>
                    {g.description && <div className="mt-1 text-[11.5px] text-muted">{g.description}</div>}
                    <div className="num mt-1 text-[10.5px] text-muted">created {when(g.createdAt)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
