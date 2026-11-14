"use client";

/**
 * The parts of an interface that are behaviour rather than drawing, loaded only for the interface in use:
 * - how a page arrives after navigation (its motion language, src/lib/desk/interfaces.ts): out of a blur
 *   (Spectacle), a typed-in rise (Prompt), a zoom (Canvas), ink settling (Broadsheet), a boot flicker
 *   (Cockpit), a window opening from the dock (Glass), a hard wipe (Swiss), a page turning (Ledger), a
 *   sheet being drawn (Blueprint), a slow breath (Zen), a bounce (Bento); Bare does not move;
 * - Bare's keys: 1 to 9 open the pinned features in order, "/" opens search;
 * - Spectacle's light that follows the pointer;
 * - Blueprint's crosshair and its coordinates in the title block;
 * - Glass's window title.
 * The page is animated with the Web Animations API on .yb-main, so nothing re-renders and nothing is
 * remounted, and no transform is left behind once it ends (a lasting one would trap fixed dialogs).
 * Everything here stands still under reduced motion (the system's or Settings → Style's).
 */
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { INTERFACE_META, type InterfaceId, type MotionLanguage } from "@/lib/desk/interfaces";
import { useNav } from "../NavContext";
import { openPalette } from "../CommandPalette";
import { reducedMotion, typingIn, usePinned } from "./shared";

type Arrival = { frames: Keyframe[]; options: KeyframeAnimationOptions };
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
export const ARRIVALS: Record<MotionLanguage, Arrival | null> = {
  classic: null,
  none: null,
  cinematic: { frames: [{ opacity: 0, transform: "translateY(16px) scale(0.985)", filter: "blur(12px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], options: { duration: 640, easing: EASE_OUT } },
  conversational: { frames: [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], options: { duration: 300, easing: EASE_OUT } },
  spatial: { frames: [{ opacity: 0, transform: "scale(0.965)" }, { opacity: 1, transform: "none" }], options: { duration: 380, easing: EASE_OUT } },
  ink: { frames: [{ opacity: 0 }, { opacity: 1 }], options: { duration: 520, easing: "ease-out" } },
  boot: { frames: [{ opacity: 0, transform: "scaleY(0.97)" }, { opacity: 0.8, offset: 0.18 }, { opacity: 0.15, offset: 0.32 }, { opacity: 0.9, offset: 0.5 }, { opacity: 1, transform: "none" }], options: { duration: 340, easing: "linear" } },
  window: { frames: [{ opacity: 0, transform: "translateY(60px) scale(0.9)", transformOrigin: "50% 100%" }, { opacity: 1, transform: "none", transformOrigin: "50% 100%" }], options: { duration: 460, easing: "cubic-bezier(0.2, 0.9, 0.25, 1.05)" } },
  cut: { frames: [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], options: { duration: 420, easing: "cubic-bezier(0.7, 0, 0.2, 1)" } },
  pageturn: { frames: [{ opacity: 0.35, transform: "perspective(1800px) rotateY(-12deg)", transformOrigin: "0% 50%" }, { opacity: 1, transform: "perspective(1800px) rotateY(0deg)", transformOrigin: "0% 50%" }], options: { duration: 560, easing: EASE_OUT } },
  draft: { frames: [{ opacity: 0.2, clipPath: "inset(0 0 100% 0)" }, { opacity: 1, clipPath: "inset(0 0 0 0)" }], options: { duration: 560, easing: "cubic-bezier(0.6, 0, 0.2, 1)" } },
  breath: { frames: [{ opacity: 0 }, { opacity: 1 }], options: { duration: 900, easing: "ease" } },
  bounce: { frames: [{ opacity: 0, transform: "translateY(14px) scale(0.96)" }, { opacity: 1, transform: "translateY(-2px) scale(1.006)", offset: 0.65 }, { opacity: 1, transform: "none" }], options: { duration: 480, easing: "ease-out" } },
};

function RouteMotion({ language }: { language: MotionLanguage }) {
  const path = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const arrival = ARRIVALS[language];
    const main = document.querySelector<HTMLElement>(".app-frame .yb-main");
    if (!arrival || !main || reducedMotion() || typeof main.animate !== "function") return;
    const a = main.animate(arrival.frames, { ...arrival.options, fill: "none" });
    return () => a.cancel();
  }, [path, language]);
  return null;
}

function BareKeys() {
  const nav = useNav();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typingIn(e)) return;
      // Pages with their own keyboard (the terminal's function keys, the Studio grid) keep the digits.
      if (/^\/app\/(terminal|studio)/.test(path)) return;
      if (e.key === "/") { e.preventDefault(); openPalette(); return; }
      if (!/^[1-9]$/.test(e.key)) return;
      const byId = new Map(nav.features.map((f) => [f.id, f]));
      const f = nav.prefs.pinned.flatMap((id) => byId.get(id) ?? [])[Number(e.key) - 1];
      if (f) { e.preventDefault(); router.push(f.href); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav.features, nav.prefs.pinned, router, path]);
  return null;
}

function PointerLight() {
  const spot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reducedMotion()) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { if (spot.current) spot.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`; });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
  }, []);
  return <div ref={spot} className="yb-spot" aria-hidden style={{ transform: "translate3d(50vw, 30vh, 0)" }} />;
}

function Crosshair() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reducedMotion()) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = box.current;
        const main = document.querySelector<HTMLElement>(".app-frame .yb-main");
        if (!el || !main) return;
        const b = main.getBoundingClientRect();
        const inside = e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
        el.style.opacity = inside ? "1" : "0";
        const [h, v] = el.children as unknown as HTMLElement[];
        h.style.transform = `translateY(${e.clientY}px)`;
        v.style.transform = `translateX(${e.clientX}px)`;
        const out = document.getElementById("yb-coords");
        if (out) out.textContent = inside ? `X ${String(Math.round((e.clientX - b.left) / 4)).padStart(4, "0")}  Y ${String(Math.round((e.clientY - b.top) / 4)).padStart(4, "0")}` : "X ----  Y ----";
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
  }, []);
  return <div ref={box} className="yb-cross" aria-hidden style={{ opacity: 0 }}><i /><i /></div>;
}

function WindowTitle() {
  const { current } = usePinned();
  const label = current?.label ?? "YouBank";
  useEffect(() => {
    const main = document.querySelector<HTMLElement>(".app-frame .yb-main");
    if (main) main.dataset.window = label;
    return () => { if (main) delete main.dataset.window; };
  }, [label]);
  return null;
}

export default function Effects({ ui }: { ui: InterfaceId }) {
  return (
    <>
      <RouteMotion language={INTERFACE_META[ui].motion} />
      {ui === "bare" && <BareKeys />}
      {ui === "spectacle" && <PointerLight />}
      {ui === "blueprint" && <Crosshair />}
      {ui === "glass" && <WindowTitle />}
    </>
  );
}
