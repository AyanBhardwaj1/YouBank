"use client";

import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { useCompanies } from "@/lib/client/companies";

/** Scrolling ticker tape from live FMP prices. Duplicated once so the loop is seamless. */
export function Tape() {
  const { config } = useWorkspace();
  const { data } = useCompanies(config.watchlist);
  const items = config.watchlist.map((t) => data[t]?.price ? { t, p: data[t].price!.last, chg: data[t].price!.changePct } : null)
    .filter((x): x is { t: string; p: number; chg: number } => x !== null);
  if (items.length === 0) return <div className="h-6 border-t border-line bg-panel px-4 text-[11px] leading-6 text-muted">Loading prices…</div>;
  const row = [...items, ...items];
  return (
    <div className="relative h-6 overflow-hidden border-t border-line bg-panel" aria-hidden>
      <div className="tape-track flex h-full w-max items-center whitespace-nowrap">
        {row.map((i, idx) => (
          <span key={idx} className="num flex items-center gap-1.5 px-4 text-[11px]">
            <span className="font-semibold text-fg">{i.t}</span>
            <span className="text-muted">{i.p.toFixed(2)}</span>
            <span className={i.chg >= 0 ? "text-pos" : "text-neg"}>{i.chg >= 0 ? "▲" : "▼"} {Math.abs(i.chg).toFixed(2)}%</span>
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-panel to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-panel to-transparent" />
    </div>
  );
}
