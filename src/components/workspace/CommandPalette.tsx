"use client";

/**
 * ⌘K (Ctrl+K) anywhere in the app: one box that goes to any feature, page or tool, opens a ticker, asks
 * the AI, and changes the workspace on the spot (Home layout, style, size, contrast, motion, which
 * features are in the navigation). Arrow keys move, Enter runs, Escape closes. What was chosen last
 * comes first next time (kept in this browser only). The terminal keeps ⌘K for its own command line;
 * there the top bar's search button opens the palette.
 */
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { lazyPanel } from "@/components/ui/lazyPanel";

/** The palette's code loads the first time it opens (or when the app is idle, or the search button is hovered). */
const LazyPalette = lazyPanel(() => import("./PalettePanel").then((m) => m.Palette));
export const preloadPalette = () => void LazyPalette.preload().catch(() => undefined);

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  // The terminal's ⌘K focuses its own command line (which is its palette); the button still opens this one.
  const ownsKey = useRef(false);
  useEffect(() => { ownsKey.current = path.startsWith("/app/terminal"); }, [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k" && !e.defaultPrevented && !ownsKey.current) { e.preventDefault(); setOpen((o) => !o); }
    };
    const onOpen = () => setOpen(true);
    // Fetch the palette's code once the page has settled, so the first ⌘K opens at once.
    const idle = window.setTimeout(preloadPalette, 4000);
    window.addEventListener("keydown", onKey);
    window.addEventListener("yb:palette", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("yb:palette", onOpen); window.clearTimeout(idle); };
  }, []);
  return open ? <LazyPalette onClose={() => setOpen(false)} /> : null;
}

/** Open the palette from a button (the top bar's search). */
export const openPalette = () => window.dispatchEvent(new Event("yb:palette"));

