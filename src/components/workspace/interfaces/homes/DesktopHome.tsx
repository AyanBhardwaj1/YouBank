"use client";

/**
 * Glass's Home: the desktop itself, with no window around it. A large clock and the date with the
 * greeting, a Spotlight bar for questions, the pinned features as desktop icons, and every widget as a
 * small frosted window with traffic lights and its name in the title bar, laid out like windows left
 * open on a big screen (glass.css). Windows rise into place one after another.
 */
import Link from "next/link";
import { motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { WIDGET_LABEL } from "@/lib/desk/desk";
import { DayLine } from "../../home/DayLine";
import { ArrangeOrEmpty, AskBox, HomeTools, useHello, WidgetIn, type HomeProps } from "../../home/Kit";
import { usePinned } from "../shared";

export default function DesktopHome({ widgets, facts, brief, arranging, setArranging }: HomeProps) {
  const { hello, name, today, now } = useHello();
  const { items } = usePinned(4, 8);
  const clock = now === null ? " " : new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/, "");
  return (
    <div className="home-wall h-full overflow-auto">
      <div className="gl-desktop">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-6">
          <div className="min-w-0">
            <div className="gl-clock">{clock}</div>
            <div className="mt-2 text-[15px] font-medium text-fg">{today}</div>
            <h1 className="mt-6 text-[26px]">{hello}{name}.</h1>
            <DayLine className="mt-1 text-[13.5px] text-muted" />
            <div className="gl-spot mt-6 max-w-[680px]">
              <AskBox className="flex flex-1 items-center gap-3" placeholder="Spotlight: ask about a company, a deal or a number…"
                inputClass="min-w-0 flex-1 bg-transparent text-[17px] text-fg outline-none placeholder:text-faint" button="rounded-lg bg-white/15 px-3 py-1.5 text-[12.5px] font-semibold text-fg hover:bg-white/25 disabled:opacity-40" />
            </div>
            <HomeTools arranging={arranging} onArrange={() => setArranging(!arranging)} className="mt-3 -ml-2" />
          </div>
          <nav aria-label="Desktop" className="gl-icons">
            <div className="grid grid-cols-2 gap-x-2 gap-y-3">
              {items.map((f) => (
                <Link key={f.id} href={f.href} className="gl-icon"><span><Icon name={f.icon} className="h-6 w-6" /></span><span className="w-full truncate">{f.label}</span></Link>
              ))}
            </div>
          </nav>
        </div>
        <ArrangeOrEmpty widgets={widgets} arranging={arranging} setArranging={setArranging} className="mt-8" />
        <div className="gl-windows">
          {widgets.map((w, i) => (
            <motion.div key={w.id} className="gl-win yb-narrow" initial={{ opacity: 0, y: 30, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} whileHover={{ y: -3 }}
              transition={{ type: "spring", stiffness: 200, damping: 22, delay: Math.min(i, 8) * 0.05 }}>
              <div className="gl-bar"><i aria-hidden /><i aria-hidden /><i aria-hidden /><span>{WIDGET_LABEL[w.id]}</span></div>
              <div className="gl-body p-1"><WidgetIn w={w} facts={facts} brief={brief} /></div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
