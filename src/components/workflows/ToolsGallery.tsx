"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ALL_TOOL_DEFS, toolsFor } from "@/lib/workflows/registry";
import { CATEGORIES, type ToolDef } from "@/lib/workflows/types";
import { ROLES, type RoleId } from "@/lib/roles";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { Icon } from "@/components/ui/Icon";

export function ToolCard({ t, href, compact = false }: { t: ToolDef; href?: string; compact?: boolean }) {
  return (
    <Link href={href ?? `/app/tools/${t.id}`} className={`lift group panel flex flex-col ${compact ? "p-2.5" : "p-3.5"}`}>
      <div className="flex items-start gap-2.5">
        <span className={`grid shrink-0 place-items-center ctl ${t.kind === "ai" ? "bg-accent-soft text-accent" : "bg-info/10 text-info"} ${compact ? "h-7 w-7" : "h-9 w-9"}`}><Icon name={t.icon} className={compact ? "h-3.5 w-3.5" : "h-4.5 w-4.5"} /></span>
        <div className="min-w-0 flex-1">
          <div className={`font-semibold leading-tight ${compact ? "text-[12px]" : "text-[13px]"}`}>{t.title}</div>
          <div className={`mt-0.5 text-muted ${compact ? "line-clamp-1 text-[10.5px]" : "line-clamp-2 text-[11.5px]"}`}>{t.tagline}</div>
        </div>
      </div>
      {!compact && (
        <div className="mt-3 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted">
          <span className={`rounded px-1.5 py-px ${t.kind === "ai" ? "bg-accent-soft text-accent" : "bg-info/10 text-info"}`}>{t.kind === "ai" ? "AI" : "Calc"}</span>
          <span className="truncate">{t.category}</span>
          {t.savesMinutes ? <span className="ml-auto normal-case tracking-normal">~{t.savesMinutes >= 60 ? `${Math.round(t.savesMinutes / 60)}h` : `${t.savesMinutes}m`} saved</span> : null}
        </div>
      )}
    </Link>
  );
}

export function ToolsGallery({ role: roleProp }: { role?: RoleId }) {
  const { profile } = useWorkspace();
  const role = roleProp ?? profile.role;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("");
  const [kind, setKind] = useState<"" | "ai" | "calc">("");
  const [allRoles, setAllRoles] = useState(false);
  const base = useMemo(() => (allRoles ? ALL_TOOL_DEFS : toolsFor({ role, specialty: profile.specialty })), [allRoles, role, profile.specialty]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return base.filter((t) => (!cat || t.category === cat) && (!kind || t.kind === kind) && (!s || [t.title, t.tagline, t.description, ...(t.tags ?? []), t.category].join(" ").toLowerCase().includes(s)));
  }, [base, q, cat, kind]);
  const cats = CATEGORIES.filter((c) => base.some((t) => t.category === c));
  const forYou = list.filter((t) => t.roles !== "all" && t.specialties?.includes(profile.specialty));
  const rest = list.filter((t) => !forYou.includes(t));
  const counts = { ai: base.filter((t) => t.kind === "ai").length, calc: base.filter((t) => t.kind === "calc").length };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div>
          <h1 className="text-[16px] font-semibold">Tools for {ROLES[role].label.toLowerCase()}s{profile.specialty ? ` · ${profile.specialty}` : ""}</h1>
          <div className="text-[11px] text-muted">{counts.ai} AI workflows and {counts.calc} calculators{allRoles ? " across every role" : " tailored to your profile"}. Each run is saved to your library.</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tools…" className="ctl w-56 border border-line bg-bg px-2.5 py-1.5 text-[12px] placeholder:text-faint focus:border-accent/60 focus:outline-none" />
          <div className="flex overflow-hidden ctl border border-line text-[11px]">
            {(["", "ai", "calc"] as const).map((k) => <button key={k} type="button" onClick={() => setKind(k)} className={`px-2.5 py-1.5 ${kind === k ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{k === "" ? "All" : k === "ai" ? "AI" : "Calculators"}</button>)}
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-muted"><input type="checkbox" checked={allRoles} onChange={(e) => setAllRoles(e.target.checked)} /> every role</label>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2">
        <button type="button" onClick={() => setCat("")} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${!cat ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>All categories</button>
        {cats.map((c) => <button key={c} type="button" onClick={() => setCat(cat === c ? "" : c)} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${cat === c ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{c} <span className="num opacity-60">{base.filter((t) => t.category === c).length}</span></button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {forYou.length > 0 && (
          <>
            <div className="mb-2 text-[10.5px] uppercase tracking-wider text-muted">Built for {profile.specialty}</div>
            <div className="stagger mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{forYou.map((t) => <ToolCard key={t.id} t={t} />)}</div>
            <div className="mb-2 text-[10.5px] uppercase tracking-wider text-muted">Everything else for {ROLES[role].label.toLowerCase()}s</div>
          </>
        )}
        <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{rest.map((t) => <ToolCard key={t.id} t={t} />)}</div>
        {list.length === 0 && <div className="p-6 text-center text-[12px] text-muted">No tools match. Try another search or turn on every role.</div>}
      </div>
    </div>
  );
}
