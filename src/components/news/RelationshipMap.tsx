"use client";

/**
 * Who is in a story and how they are tied: the story at the centre, the deal's buyer and target facing
 * each other, investors and advisors beside the side they work for, people beside their company and,
 * inside the app only, your own contacts at those companies. Lines are SVG; nodes and labels are HTML
 * so they stay crisp and readable at phone width. Hovering or focusing a node lights its ties and names
 * them; a company with a ticker links where `linkFor` says (the terminal, in the app).
 */
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { layoutGraph, type GraphNode, type StoryGraph } from "@/lib/news/storyviz";
import { useDrawIn } from "./StoryCharts";

const KIND: Record<GraphNode["kind"], { dot: string; label: string }> = {
  story: { dot: "bg-accent", label: "Story" },
  company: { dot: "bg-fg", label: "Company" },
  investor: { dot: "bg-chart-1", label: "Investor" },
  fund: { dot: "bg-chart-1", label: "Fund" },
  advisor: { dot: "bg-chart-emphasis", label: "Advisor" },
  person: { dot: "bg-muted", label: "Person" },
  agency: { dot: "bg-info", label: "Agency" },
  contact: { dot: "bg-pos", label: "Your contact" },
};

export function RelationshipMap({ graph, linkFor }: { graph: StoryGraph; linkFor?: (n: GraphNode) => string | null }) {
  const { ref, on, animate } = useDrawIn<HTMLDivElement>();
  const pos = useMemo(() => layoutGraph(graph), [graph]);
  const [focus, setFocus] = useState<string | null>(null);
  if (graph.nodes.length < 2) return null;
  const lit = (from: string, to: string) => !focus || from === focus || to === focus;
  const kinds = [...new Set(graph.nodes.filter((n) => n.kind !== "story").map((n) => n.kind))];
  return (
    <div ref={ref}>
      <div className="relative aspect-square w-full sm:aspect-[16/9]">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          {graph.edges.map((e, i) => {
            const a = pos.get(e.from), b = pos.get(e.to);
            if (!a || !b) return null;
            // The deal arcs over the story so its line and label never hide behind it.
            const d = e.kind === "deal" ? `M${a.x * 100},${a.y * 100} Q${((a.x + b.x) / 2) * 100},${(Math.min(a.y, b.y) - 0.3) * 100} ${b.x * 100},${b.y * 100}` : `M${a.x * 100},${a.y * 100} L${b.x * 100},${b.y * 100}`;
            return (
              <motion.path key={`${e.from}-${e.to}`} d={d} fill="none"
                stroke={e.kind === "deal" ? "var(--accent)" : e.kind === "works" ? "var(--pos)" : e.kind === "named" ? "var(--line-strong)" : "var(--chart-1)"}
                strokeWidth={e.kind === "deal" ? 2.5 : 1.25} strokeDasharray={e.kind === "named" ? "3 3" : e.kind === "works" ? "1 3" : undefined} vectorEffect="non-scaling-stroke"
                initial={animate ? { opacity: 0 } : false} animate={on ? { opacity: lit(e.from, e.to) ? 0.9 : 0.15 } : undefined} transition={{ duration: animate ? 0.5 : 0, delay: animate ? 0.1 + i * 0.04 : 0 }} />
            );
          })}
        </svg>
        {/* Edge labels: always for the deal, otherwise for the focused node's ties. */}
        {graph.edges.filter((e) => e.kind !== "named" && (e.kind === "deal" || (focus && (e.from === focus || e.to === focus)))).map((e) => {
          const a = pos.get(e.from)!, b = pos.get(e.to)!;
          const my = e.kind === "deal" ? (a.y + 2 * (Math.min(a.y, b.y) - 0.3) + b.y) / 4 : (a.y + b.y) / 2;
          return <span key={`l-${e.from}-${e.to}`} className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-bg/90 px-1.5 text-[9.5px] text-muted shadow-sm" style={{ left: `${((a.x + b.x) / 2) * 100}%`, top: `${my * 100}%` }}>{e.label}</span>;
        })}
        {graph.nodes.map((n, i) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const href = linkFor?.(n) ?? null;
          const dim = focus && focus !== n.id && !graph.edges.some((e) => (e.from === focus && e.to === n.id) || (e.to === focus && e.from === n.id));
          const content = n.kind === "story"
            ? <span className="block max-w-[150px] rounded-[var(--nr-radius,10px)] border border-accent/50 bg-accent-soft px-2 py-1 text-center text-[10.5px] font-semibold leading-tight text-accent sm:max-w-[190px]">{n.label}</span>
            : (
              <span className="flex flex-col items-center">
                <span className={`h-3 w-3 rounded-full ring-[3px] ring-bg ${KIND[n.kind].dot} ${n.side === "buyer" || n.side === "target" ? "h-4 w-4" : ""}`} />
                <span className={`mt-1 max-w-[110px] truncate rounded px-1 text-center text-[10.5px] leading-tight sm:max-w-[150px] ${n.kind === "contact" ? "text-pos" : "text-fg"} ${href ? "group-hover:text-accent" : ""}`}>{n.label}</span>
                {(n.ticker || n.side) && <span className="num text-[9.5px] text-muted">{[n.ticker, n.side === "buyer" ? "buyer" : n.side === "target" ? "target" : ""].filter(Boolean).join(" · ")}</span>}
              </span>
            );
          const common = {
            className: "group absolute z-20 -translate-x-1/2 -translate-y-1/2 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded",
            style: { left: `${p.x * 100}%`, top: `${p.y * 100}%` },
            onMouseEnter: () => setFocus(n.id), onMouseLeave: () => setFocus(null), onFocus: () => setFocus(n.id), onBlur: () => setFocus(null),
            title: `${KIND[n.kind].label}${n.role && n.kind !== "story" ? `: ${n.role}` : ""}`,
          };
          const anim = { initial: animate ? { opacity: 0, scale: 0.6 } : false, animate: on ? { opacity: dim ? 0.3 : 1, scale: 1 } : undefined, transition: animate ? { type: "spring" as const, stiffness: 380, damping: 26, delay: 0.05 + i * 0.04 } : { duration: 0 } };
          return href
            ? <motion.a key={n.id} href={href} {...common} {...anim}>{content}</motion.a>
            : <motion.span key={n.id} tabIndex={0} {...common} {...anim}>{content}</motion.span>;
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted">
        {kinds.map((k) => <span key={k} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${KIND[k].dot}`} />{KIND[k].label}</span>)}
        {graph.edges.some((e) => e.kind === "deal") && <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-accent" />The deal</span>}
      </div>
    </div>
  );
}
