"use client";

/**
 * The dock (Glass and Bento): the pinned features as big buttons floating along the bottom, names on hover
 * and focus, with the button for everything else after a divider. In Glass it swells under the pointer as
 * a Mac's dock does (each button grows with its distance to the pointer, on a spring); in Bento the
 * buttons are squishy tiles (bento.css). Desktop only: on a phone the tab bar does this job.
 */
import Link from "next/link";
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { useRef } from "react";
import type { NavFeature } from "@/lib/nav";
import { Icon } from "@/components/ui/Icon";
import { useNav } from "../NavContext";
import { usePinned, useStill } from "./shared";

const MotionLink = motion.create(Link);

function Magnified({ f, current, mouseX }: { f: NavFeature; current: boolean; mouseX: MotionValue<number> }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const distance = useTransform(mouseX, (x) => {
    const b = ref.current?.getBoundingClientRect();
    return b ? x - b.left - b.width / 2 : Infinity;
  });
  const size = useSpring(useTransform(distance, [-150, 0, 150], [48, 74, 48]), { mass: 0.12, stiffness: 190, damping: 14 });
  return (
    <MotionLink ref={ref} href={f.href} aria-current={current ? "page" : undefined} aria-label={f.label} className="yb-dock-item" style={{ width: size, height: size }}>
      <Icon name={f.icon} className="h-[42%] w-[42%]" />
      <span className="yb-dock-tip" aria-hidden>{f.label}</span>
    </MotionLink>
  );
}

export default function Dock({ magnify }: { magnify: boolean }) {
  const { items, current } = usePinned();
  const nav = useNav();
  const mouseX = useMotionValue(Infinity);
  const still = useStill();
  const swell = magnify && !still;
  return (
    <nav aria-label="Pinned features" className="yb-dock" onMouseMove={swell ? (e) => mouseX.set(e.clientX) : undefined} onMouseLeave={swell ? () => mouseX.set(Infinity) : undefined}>
      {items.map((f) => swell
        ? <Magnified key={f.id} f={f} current={current?.id === f.id} mouseX={mouseX} />
        : (
          <Link key={f.id} href={f.href} aria-current={current?.id === f.id ? "page" : undefined} aria-label={f.label} className="yb-dock-item">
            <Icon name={f.icon} className="h-5 w-5" />
            <span className="yb-dock-tip" aria-hidden>{f.label}</span>
          </Link>
        ))}
      <span className="yb-dock-sep" aria-hidden />
      <button type="button" onClick={() => nav.setOpen(!nav.open)} aria-expanded={nav.open} aria-label="All features and workflows" className="yb-dock-item">
        <Icon name="LayoutGrid" className="h-5 w-5" />
        <span className="yb-dock-tip" aria-hidden>Everything</span>
      </button>
    </nav>
  );
}
