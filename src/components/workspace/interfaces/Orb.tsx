"use client";

/**
 * Spectacle's navigation: a glowing orb at the bottom of the page. It leans toward the pointer when the
 * pointer comes near (on a spring), and opening it (hover, click, Enter or Space) blooms the pinned
 * features out along an arc above it, one after another, with "Everything" (the sidebar) last. Arrow keys
 * move between them, Escape folds them back and returns to the orb. Under reduced motion nothing leans and
 * the arc simply appears. Desktop only: on a phone the tab bar does this job.
 */
import Link from "next/link";
import { AnimatePresence, motion, useMotionValue, useSpring } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useNav } from "../NavContext";
import { usePinned, useStill } from "./shared";

/** Points along the upper half of an ellipse, left to right, for `n` items. Pure. */
export function arc(n: number, rx = 330, ry = 200): { x: number; y: number }[] {
  if (n <= 1) return [{ x: 0, y: -ry }];
  const from = Math.PI * 0.94, to = Math.PI * 0.06;
  return Array.from({ length: n }, (_, i) => {
    const t = from + ((to - from) * i) / (n - 1);
    return { x: Math.round(Math.cos(t) * rx), y: Math.round(-Math.sin(t) * ry) - 34 };
  });
}

const MotionLink = motion.create(Link);

export default function Orb() {
  const { items, current } = usePinned(4, 8);
  const nav = useNav();
  const [open, setOpen] = useState(false);
  const still = useStill();
  const core = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const leave = useRef<number | undefined>(undefined);
  const dx = useSpring(useMotionValue(0), { stiffness: 220, damping: 16, mass: 0.6 });
  const dy = useSpring(useMotionValue(0), { stiffness: 220, damping: 16, mass: 0.6 });

  // Magnetic: within 170px the orb leans up to 16px toward the pointer.
  useEffect(() => {
    if (still) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const b = core.current?.getBoundingClientRect();
        if (!b) return;
        const x = e.clientX - (b.left + b.width / 2 - dx.get()), y = e.clientY - (b.top + b.height / 2 - dy.get());
        const d = Math.hypot(x, y);
        const pull = d < 170 ? (1 - d / 170) * 16 : 0;
        dx.set(d ? (x / d) * pull : 0); dy.set(d ? (y / d) * pull : 0);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
  }, [still, dx, dy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); core.current?.focus(); }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const links = [...(wrap.current?.querySelectorAll<HTMLElement>(".yb-orb-item") ?? [])];
        const i = links.indexOf(document.activeElement as HTMLElement);
        const next = links[(i + (e.key === "ArrowRight" ? 1 : -1) + links.length) % links.length];
        if (next) { e.preventDefault(); next.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const enter = () => { window.clearTimeout(leave.current); setOpen(true); };
  const exit = () => { window.clearTimeout(leave.current); leave.current = window.setTimeout(() => setOpen(false), 260); };
  const points = arc(items.length + 1);
  const spring = still ? { duration: 0 } : { type: "spring" as const, stiffness: 420, damping: 26 };

  return (
    <div ref={wrap} className={`yb-orb ${open ? "yb-orb-open" : ""}`} onPointerEnter={enter} onPointerLeave={exit}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <nav aria-label="Features" id="yb-orb-menu">
        <AnimatePresence>
          {open && [...items.map((f, i) => (
            <MotionLink key={f.id} href={f.href} className="yb-orb-item" aria-current={current?.id === f.id ? "page" : undefined} onClick={() => setOpen(false)}
              style={{ translate: "-50% -50%" }}
              initial={{ opacity: 0, x: 0, y: -34, scale: 0.3 }} animate={{ opacity: 1, x: points[i].x, y: points[i].y, scale: 1 }}
              exit={{ opacity: 0, x: 0, y: -34, scale: 0.3, transition: { duration: still ? 0 : 0.18 } }}
              transition={{ ...spring, delay: still ? 0 : i * 0.035 }}>
              <Icon name={f.icon} className="h-4 w-4" />{f.label}
            </MotionLink>
          )), (
            <motion.button key="all" type="button" className="yb-orb-item" onClick={() => { setOpen(false); nav.setOpen(true); }}
              style={{ translate: "-50% -50%" }}
              initial={{ opacity: 0, x: 0, y: -34, scale: 0.3 }} animate={{ opacity: 1, x: points[items.length].x, y: points[items.length].y, scale: 1 }}
              exit={{ opacity: 0, x: 0, y: -34, scale: 0.3, transition: { duration: still ? 0 : 0.18 } }}
              transition={{ ...spring, delay: still ? 0 : items.length * 0.035 }}>
              <Icon name="LayoutGrid" className="h-4 w-4" />Everything
            </motion.button>
          )]}
        </AnimatePresence>
      </nav>
      <motion.button ref={core} type="button" className="yb-orb-core" style={{ x: dx, y: dy }} aria-expanded={open} aria-controls="yb-orb-menu"
        aria-label={open ? "Close the menu" : "Open the menu"} onClick={() => setOpen((o) => !o)}
        whileTap={still ? undefined : { scale: 0.9 }} animate={{ scale: open ? 1.08 : 1 }} transition={spring}>
        <Icon name={open ? "X" : "Sparkles"} className="h-6 w-6" strokeWidth={2} />
      </motion.button>
      <span className="yb-orb-label" aria-hidden>{current?.label ?? "Menu"}</span>
    </div>
  );
}
