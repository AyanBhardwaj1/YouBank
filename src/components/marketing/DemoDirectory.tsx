"use client";

import { useMemo, useState } from "react";
import { DEMO } from "@/lib/demo";
import { CountUp } from "@/components/motion/Reveal";

const SOURCE_LABEL: Record<string, string> = { yc: "Y Combinator", a16z: "a16z", thiel: "Thiel Fellows", hn: "Show HN", formd: "SEC Form D", web: "Web discovery", user: "Added" };
const SOURCE_STYLE: Record<string, string> = { yc: "bg-accent-soft text-accent", a16z: "bg-info/15 text-info", thiel: "bg-pos/15 text-pos", hn: "bg-elevated text-fg/80", formd: "bg-neg/10 text-neg", web: "bg-raised text-muted", user: "bg-raised text-muted" };
const COUNTS: { source: string; n: number }[] = [
  { source: "yc", n: 6220 }, { source: "hn", n: 9725 }, { source: "formd", n: 1139 }, { source: "a16z", n: 859 }, { source: "thiel", n: 20 }, { source: "web", n: 38 },
];

/** Startup directory demo: source chips, live search over the sample, and the real corpus counts. */
export function DemoDirectory() {
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return DEMO.startups.filter((r) => (!source || r.source === source) && (!s || `${r.name} ${r.oneLiner} ${r.industries.join(" ")} ${r.country}`.toLowerCase().includes(s))).slice(0, 8);
  }, [q, source]);

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-elevated/50 px-3 py-2 text-[11px]">
        <span className="ctl bg-accent-soft px-1.5 py-0.5 font-semibold tracking-wider text-accent">VC</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search 18,001 startups…" className="ctl w-44 border border-line bg-bg px-2 py-1 text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none" />
        <button type="button" onClick={() => setSource("")} className={`rounded-full border px-2 py-0.5 ${!source ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>All</button>
        {COUNTS.map((c) => (
          <button key={c.source} type="button" onClick={() => setSource(source === c.source ? "" : c.source)} className={`rounded-full border px-2 py-0.5 ${source === c.source ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>
            {SOURCE_LABEL[c.source]} <span className="num opacity-60">{c.n.toLocaleString()}</span>
          </button>
        ))}
      </div>
      <ul className="stagger divide-y divide-line/60">
        {rows.map((r) => (
          <li key={`${r.source}-${r.name}`} className="flex items-start gap-2.5 px-3 py-2 transition-colors hover:bg-elevated/60">
            <span className={`ctl mt-0.5 shrink-0 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase ${SOURCE_STYLE[r.source] ?? "bg-raised text-muted"}`}>{SOURCE_LABEL[r.source] ?? r.source}</span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[12.5px] font-semibold">{r.name}</span>
                {r.program && <span className="num text-[10px] text-muted">{r.program}</span>}
                {r.country && <span className="text-[10px] text-muted">{r.country}</span>}
                {r.raised && <span className="num text-[10px] text-pos">{r.raised}</span>}
              </span>
              <span className="mt-0.5 block truncate text-[11.5px] text-muted">{r.oneLiner || r.industries.join(", ") || "—"}</span>
            </span>
            {r.industries[0] && <span className="hidden shrink-0 rounded-full border border-line px-2 py-0.5 text-[10px] text-muted sm:inline">{r.industries[0]}</span>}
          </li>
        ))}
        {rows.length === 0 && <li className="px-3 py-6 text-center text-[11.5px] text-muted">Nothing in the sample matches. The live directory searches all {DEMO.directoryTotal.toLocaleString()} and can discover more with AI.</li>}
      </ul>
      <div className="grid grid-cols-3 gap-2 border-t border-line p-3 text-center">
        <div><div className="num text-[18px] font-semibold text-accent"><CountUp value={18001} /></div><div className="text-[10.5px] text-muted">startups indexed</div></div>
        <div><div className="num text-[18px] font-semibold text-accent"><CountUp value={6} /></div><div className="text-[10.5px] text-muted">sources, refreshed nightly</div></div>
        <div><div className="num text-[18px] font-semibold text-accent"><CountUp value={1139} /></div><div className="text-[10.5px] text-muted">Form D raises with officers</div></div>
      </div>
    </div>
  );
}
