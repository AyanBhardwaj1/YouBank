"use client";

import { useEffect, useRef, useState } from "react";

/** Adds the "in" class when the element scrolls into view (CSS handles the transition). */
export function Reveal({ children, className = "", delay = 0, as: Tag = "div", once = true }: { children: React.ReactNode; className?: string; delay?: number; as?: "div" | "section" | "li" | "article"; once?: boolean }) {
  const ref = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { setInView(true); if (once) io.disconnect(); }
        else if (!once) setInView(false);
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [once]);
  const Comp = Tag as unknown as React.ElementType;
  return <Comp ref={ref} className={`reveal ${inView ? "in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</Comp>;
}

/** Animates a number from 0 to its value when it enters the viewport. */
export function CountUp({ value, format = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 }), duration = 1200, className = "" }: { value: number; format?: (v: number) => string; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  // Starts at the final value so the server-rendered HTML carries the real number; the animation resets it on mount.
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const run = () => {
      setShown(0);
      const start = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        setShown(value * eased);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    if (typeof IntersectionObserver === "undefined") { const t = setTimeout(run, 0); return () => { clearTimeout(t); cancelAnimationFrame(raf); }; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { run(); io.disconnect(); } }, { threshold: 0.3 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value, duration]);
  return <span ref={ref} className={`num ${className}`}>{format(shown)}</span>;
}

/** Types out text character by character. */
export function Typewriter({ text, speed = 28, start = true, className = "", onDone, caret = true }: { text: string; speed?: number; start?: boolean; className?: string; onDone?: () => void; caret?: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!start) return;
    let i = 0;
    const id = setInterval(() => { i++; setN(i); if (i >= text.length) { clearInterval(id); onDone?.(); } }, speed);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, speed, start]);
  return <span className={`${className} ${caret && n < text.length ? "caret" : ""}`}>{text.slice(0, n)}</span>;
}
