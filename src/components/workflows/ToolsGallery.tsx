"use client";

import { useMemo, useState } from "react";
import { TOOL_CATALOG, catalogFor } from "@/lib/workflows/catalog";
import { CATEGORIES } from "@/lib/workflows/categories";
import { ROLES, type RoleId } from "@/lib/roles";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { ToolCard } from "./ToolCard";

export { ToolCard };

export function ToolsGallery({ role: roleProp }: { role?: RoleId }) {
  const { profile } = useWorkspace();
  const role = roleProp ?? profile.role;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("");
  const [kind, setKind] = useState<"" | "ai" | "calc">("");
  const [allRoles, setAllRoles] = useState(false);
  const base = useMemo(() => (allRoles ? TOOL_CATALOG : catalogFor({ role, specialty: profile.specialty })), [allRoles, role, profile.specialty]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return base.filter((t) => (!cat || t.category === cat) && (!kind || t.kind === kind) && (!s || [t.title, t.tagline, ...(t.tags ?? []), t.category].join(" ").toLowerCase().includes(s)));
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
        <div className="ml-auto flex items-center gap-2 max-md:ml-0 max-md:w-full max-md:flex-wrap">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tools…" aria-label="Search tools" className="ctl w-56 border border-line bg-bg px-2.5 py-1.5 text-[12px] placeholder:text-faint focus:border-accent/60 focus:outline-none max-md:min-h-10 max-md:w-full" />
          <div className="flex overflow-hidden ctl border border-line text-[11px] max-md:[&>button]:min-h-9 max-md:[&>button]:px-3.5">
            {(["", "ai", "calc"] as const).map((k) => <button key={k} type="button" onClick={() => setKind(k)} className={`px-2.5 py-1.5 ${kind === k ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{k === "" ? "All" : k === "ai" ? "AI" : "Calculators"}</button>)}
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-muted max-md:min-h-9"><input type="checkbox" checked={allRoles} onChange={(e) => setAllRoles(e.target.checked)} /> every role</label>
        </div>
      </div>
      {/* Categories: wrapped chips on a big screen, one sideways-scrolling row on a phone. */}
      <div className="no-scrollbar flex flex-wrap gap-1.5 border-b border-line px-4 py-2 max-md:flex-nowrap max-md:overflow-x-auto max-md:[&>button]:shrink-0 max-md:[&>button]:whitespace-nowrap max-md:[&>button]:py-1.5">
        <button type="button" onClick={() => setCat("")} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${!cat ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>All categories</button>
        {cats.map((c) => <button key={c} type="button" onClick={() => setCat(cat === c ? "" : c)} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${cat === c ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{c} <span className="num opacity-60">{base.filter((t) => t.category === c).length}</span></button>)}
      </div>
      <div className="scroll-touch min-h-0 flex-1 overflow-auto p-4">
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
