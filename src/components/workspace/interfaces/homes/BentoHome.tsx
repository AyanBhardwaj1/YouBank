"use client";

/**
 * Bento's Home: a box of tiles in every size. A big gradient tile with the greeting; small solid tiles
 * for the numbers that matter today (names on the watchlist, the biggest move, decisions waiting, tools
 * for the role); a wide tile for questions; then the widgets as tiles, wide ones across the whole box.
 * Tiles pop in with a bounce and squish when pressed (bento.css). The numbers come from the same stores
 * the widgets read.
 */
import Link from "next/link";
import { motion } from "motion/react";
import { useCompanies } from "@/lib/client/companies";
import { useWaiting } from "@/lib/client/waiting";
import { biggestMover } from "@/lib/desk/day-line";
import { isWide } from "@/lib/desk/desk";
import { fmtChange } from "@/lib/market/units";
import { useWorkspace } from "../../WorkspaceProvider";
import { DayLine } from "../../home/DayLine";
import { ArrangeOrEmpty, AskBox, HomeTools, Suggestions, useHello, WidgetIn, type HomeProps } from "../../home/Kit";

const pop = (i: number) => ({ initial: { opacity: 0, scale: 0.9, y: 16 }, animate: { opacity: 1, scale: 1, y: 0 }, transition: { type: "spring" as const, stiffness: 320, damping: 18, delay: Math.min(i, 10) * 0.04 } });

export default function BentoHome({ widgets, facts, brief, arranging, setArranging }: HomeProps) {
  const { hello, name, today } = useHello();
  const { config, tools } = useWorkspace();
  const { data } = useCompanies(config.watchlist);
  const waiting = useWaiting();
  const mover = biggestMover(config.watchlist.map((t) => ({ ticker: t, changePct: data[t]?.price?.changePct })));
  const stats = [
    { c: "bn-c1", v: String(config.watchlist.length), l: "names you watch", href: "/app/terminal" },
    { c: "bn-c2", v: mover ? fmtChange(mover.changePct) : "—", l: mover ? `${mover.ticker}, biggest move` : "biggest move today", href: mover ? `/app/terminal?ticker=${mover.ticker}` : "/app/terminal" },
    { c: "bn-c3", v: waiting === null ? "—" : String(waiting), l: waiting === 1 ? "decision waiting" : "decisions waiting", href: "/app" },
    { c: "bn-c4", v: String(tools.length), l: "tools for your role", href: "/app/tools" },
  ];
  return (
    <div className="home-wall h-full overflow-auto">
      <div className="bn-box">
        <ArrangeOrEmpty widgets={widgets} arranging={arranging} setArranging={setArranging} className="mb-4" />
        <div className="bn-grid">
          <motion.div className="bn-hero-cell" {...pop(0)}>
            <div className="bn-tile bn-hero">
            <div className="text-[13px] font-bold opacity-80">{today}</div>
            <div>
              <h1>{hello}{name}.</h1>
              <DayLine className="mt-2 !text-[14px] font-semibold !text-[#1a0f14]/80" />
            </div>
            <HomeTools arranging={arranging} onArrange={() => setArranging(!arranging)} className="-ml-1" item="flex items-center gap-1 rounded-full bg-black/10 px-3 py-1.5 text-[12px] font-bold text-[#1a0f14] hover:bg-black/20" />
            </div>
          </motion.div>
          {stats.map((s, i) => (
            <motion.div key={s.c} className="flex" {...pop(i + 1)}>
              <Link href={s.href} className={`bn-tile bn-stat flex-1 ${s.c}`}><b className="num">{s.v}</b><span>{s.l}</span></Link>
            </motion.div>
          ))}
          <motion.div className="bn-ask-cell" {...pop(5)}>
            <div className="bn-tile bn-ask">
            <div className="mb-3 text-[15px] font-extrabold tracking-[-0.02em]">Ask anything</div>
            <AskBox className="flex items-center gap-2 rounded-full bg-elevated py-1.5 pl-4 pr-1.5" icon={false}
              inputClass="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-faint" button="rounded-full bg-accent px-4 py-2 text-[12.5px] font-extrabold text-accent-fg disabled:opacity-40" />
            <Suggestions className="mt-3" chip="rounded-full bg-elevated px-3 py-1 text-[12px] font-semibold text-muted hover:text-fg" />
            </div>
          </motion.div>
          {widgets.map((w, i) => (
            <motion.div key={w.id} className={`bn-w ${isWide(w) ? "bn-full" : "yb-narrow"}`} {...pop(i + 6)}>
              <WidgetIn w={w} facts={facts} brief={brief} roomy />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
