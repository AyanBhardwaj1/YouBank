"use client";

/**
 * Spectacle's Home: a title sequence, then a reel. The greeting rises word by word out of a blur in a
 * moving gradient, the day follows, the question box glows; below, every widget is a card on a reel that
 * snaps into place, each tilting toward the pointer on a spring with a light across its glass. The reel
 * scrolls sideways by trackpad, drag, the arrow buttons or the keyboard (each card is reachable by Tab).
 * Under reduced motion the words simply appear and nothing tilts.
 */
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { useRef } from "react";
import { Icon } from "@/components/ui/Icon";
import { isWide, type WidgetPref } from "@/lib/desk/desk";
import type { HomeFacts } from "../../home/Widgets";
import type { BriefSeed } from "@/components/news/HomeBrief";
import { DayLine } from "../../home/DayLine";
import { ArrangeOrEmpty, AskBox, HomeTools, Suggestions, useHello, WidgetIn, type HomeProps } from "../../home/Kit";

function TiltCard({ w, facts, brief, i }: { w: WidgetPref; facts: HomeFacts; brief?: BriefSeed; i: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const rx = useSpring(useMotionValue(0), { stiffness: 180, damping: 18 });
  const ry = useSpring(useMotionValue(0), { stiffness: 180, damping: 18 });
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || reduce || e.pointerType !== "mouse") return;
    const b = el.getBoundingClientRect();
    const px = (e.clientX - b.left) / b.width, py = (e.clientY - b.top) / b.height;
    ry.set((px - 0.5) * 9); rx.set((0.5 - py) * 7);
    el.style.setProperty("--sx", `${px * 100}%`); el.style.setProperty("--sy", `${py * 100}%`);
  };
  return (
    <motion.div className={`sp-card ${isWide(w) ? "sp-wide" : "yb-narrow"}`} initial={{ opacity: 0, y: 60, scale: 0.94 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} viewport={{ once: true, amount: 0.2 }}
      transition={{ type: "spring", stiffness: 140, damping: 18, delay: Math.min(i, 6) * 0.06 }}>
      <motion.div ref={ref} className="sp-tilt relative" style={{ rotateX: rx, rotateY: ry }} onPointerMove={onMove} onPointerLeave={() => { rx.set(0); ry.set(0); }}>
        <WidgetIn w={w} facts={facts} brief={brief} roomy />
        <span className="sp-shine" aria-hidden />
      </motion.div>
    </motion.div>
  );
}

export default function CinemaHome({ widgets, facts, brief, arranging, setArranging }: HomeProps) {
  const { hello, name, today } = useHello();
  const reduce = useReducedMotion();
  const reel = useRef<HTMLDivElement>(null);
  const words = `${hello}${name}.`.split(" ");
  const step = (d: number) => reel.current?.scrollBy({ left: d * Math.min(480, reel.current.clientWidth * 0.8), behavior: reduce ? "auto" : "smooth" });
  return (
    <div className="home-wall h-full overflow-auto">
      <section className="mx-auto max-w-[1240px] px-6 pb-4 pt-[clamp(28px,7vh,80px)]">
        <motion.p className="text-[12px] uppercase tracking-[0.32em] text-muted" initial={{ opacity: 0, letterSpacing: "0.6em" }} animate={{ opacity: 1, letterSpacing: "0.32em" }} transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}>
          {today}
        </motion.p>
        <h1 className="sp-title mt-4" aria-label={`${hello}${name}.`}>
          {words.map((wd, i) => (
            <motion.span key={`${wd}-${i}`} aria-hidden className="mr-[0.22em] inline-block" initial={{ opacity: 0, y: "0.6em", filter: "blur(14px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ type: "spring", stiffness: 110, damping: 16, delay: 0.15 + i * 0.12 }}>
              <span className="sp-word">{wd}</span>
            </motion.span>
          ))}
        </h1>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
          <DayLine className="mt-4 text-[15px] text-muted" />
          <div className="sp-ask mt-8 max-w-[760px]">
            <AskBox className="flex items-center gap-3 py-2 pl-5 pr-2" inputClass="min-w-0 flex-1 bg-transparent text-[16px] text-fg outline-none placeholder:text-faint"
              button="rounded-full bg-accent px-5 py-2.5 text-[13px] font-bold text-accent-fg disabled:opacity-40" />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Suggestions className="" chip="sp-chip max-w-[360px]" />
            <HomeTools arranging={arranging} onArrange={() => setArranging(!arranging)} item="sp-chip flex items-center gap-1.5" />
          </div>
        </motion.div>
      </section>
      <ArrangeOrEmpty widgets={widgets} arranging={arranging} setArranging={setArranging} className="mx-auto max-w-[1240px] px-6" />
      {arranging ? (
        <div className="mx-auto grid max-w-[1240px] gap-5 px-6 pb-10 lg:grid-cols-2">
          {widgets.map((w) => <WidgetIn key={w.id} w={w} facts={facts} brief={brief} roomy />)}
        </div>
      ) : widgets.length > 0 && (
        <section aria-label="Your widgets" className="relative">
          <div className="mx-auto flex max-w-[1240px] items-center justify-between px-6">
            <h2 className="text-[11px] uppercase tracking-[0.3em] text-muted">Now showing · {widgets.length}</h2>
            <div className="flex gap-2">
              <button type="button" onClick={() => step(-1)} aria-label="Previous cards" className="sp-chip grid h-9 w-9 place-items-center p-0"><Icon name="ChevronLeft" className="h-4 w-4" /></button>
              <button type="button" onClick={() => step(1)} aria-label="Next cards" className="sp-chip grid h-9 w-9 place-items-center p-0"><Icon name="ChevronRight" className="h-4 w-4" /></button>
            </div>
          </div>
          <div ref={reel} className="sp-reel">
            {widgets.map((w, i) => <TiltCard key={w.id} w={w} facts={facts} brief={brief} i={i} />)}
          </div>
        </section>
      )}
    </div>
  );
}
