"use client";

/**
 * Keyboard shortcuts across the app: G then a letter goes to a feature (G H Home, G T Terminal, G N
 * Newsroom…), ? shows them all. Never while typing in a field, never with a modifier held, and a page
 * that uses a key for itself keeps it (the terminal's own ? and /, the Newsroom's /).
 */
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { NavId } from "@/lib/nav";
import { useNav } from "./NavContext";
import { openPalette } from "./CommandPalette";

/** The letter after G for each feature. */
export const GO_KEYS: Partial<Record<NavId, string>> = {
  home: "h", book: "k", terminal: "t", news: "n", tools: "o", studio: "s", edge: "e", vc: "v", crypto: "x", copy: "f", algo: "a", quant: "q", crm: "r", calendar: "c", collab: "b", library: "l", team: "m", settings: "p",
};

/**
 * Keys belong to what has focus: a field, or anything focusable that is not a plain control (Studio's
 * grid takes typing on a focused <div>, a chart takes arrows). Shortcuts act only from the page itself,
 * a link or a button.
 */
const typing = (t: EventTarget | null) => {
  const el = t instanceof HTMLElement ? t : null;
  if (!el || el === document.body) return false;
  if (el.isContentEditable || el.closest("input, textarea, select, [contenteditable=true], [role=textbox], [role=grid], .monaco-editor")) return true;
  return el.tabIndex >= 0 && !el.matches("a, button, summary, [role=button], [role=tab], [role=menuitem], [role=radio], [role=switch], [role=option], [role=link]");
};

/** Show the shortcuts sheet (the command palette's "Keyboard shortcuts"). */
export const openShortcuts = () => window.dispatchEvent(new Event("yb:shortcuts"));

export function Shortcuts() {
  const nav = useNav();
  const router = useRouter();
  const path = usePathname();
  const [help, setHelp] = useState(false);
  const pending = useRef<number | null>(null);
  const state = useRef({ features: nav.features, path });
  useEffect(() => { state.current = { features: nav.features, path }; }, [nav.features, path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const { features, path: here } = state.current;
      const k = e.key.toLowerCase();
      if (pending.current !== null) {
        window.clearTimeout(pending.current);
        pending.current = null;
        const f = features.find((x) => GO_KEYS[x.id] === k);
        if (f) { e.preventDefault(); if (here !== f.href) router.push(f.href); }
        return;
      }
      if (k === "g" && !e.shiftKey) { pending.current = window.setTimeout(() => { pending.current = null; }, 1200); return; }
      // The terminal has its own ? sheet.
      if (e.key === "?" && !here.startsWith("/app/terminal")) { e.preventDefault(); setHelp((h) => !h); }
    };
    const onOpen = () => setHelp(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("yb:shortcuts", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("yb:shortcuts", onOpen); if (pending.current !== null) window.clearTimeout(pending.current); };
  }, [router]);

  useEffect(() => {
    if (!help) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setHelp(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [help]);

  if (!help) return null;
  const kbd = "inline-grid min-w-[1.5rem] place-items-center rounded border border-line-strong bg-panel px-1.5 py-0.5 font-mono text-[11px] text-fg";
  const go = nav.features.filter((f) => GO_KEYS[f.id]);
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-bg/55 px-3 backdrop-blur-[3px]" onMouseDown={(e) => { if (e.target === e.currentTarget) setHelp(false); }}>
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="rise float w-full max-w-[560px] ctl border border-line-strong bg-raised p-4">
        <div className="mb-3 flex items-center gap-2">
          <Icon name="Keyboard" className="h-4 w-4 text-accent" />
          <h2 className="text-[14px] font-semibold">Keyboard shortcuts</h2>
          <button type="button" onClick={() => setHelp(false)} aria-label="Close" className="ml-auto grid h-7 w-7 place-items-center ctl text-muted hover:bg-elevated hover:text-fg"><Icon name="X" className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
          <div className="flex items-center justify-between gap-2"><span>Search, go anywhere, ask</span><span className="flex gap-1"><kbd className={kbd}>⌘</kbd><kbd className={kbd}>K</kbd></span></div>
          <div className="flex items-center justify-between gap-2"><span>Open or close the sidebar</span><span className="flex gap-1"><kbd className={kbd}>⌘</kbd><kbd className={kbd}>\</kbd></span></div>
          <div className="flex items-center justify-between gap-2"><span>This sheet</span><kbd className={kbd}>?</kbd></div>
          <div className="flex items-center justify-between gap-2"><span>Close a dialog</span><kbd className={kbd}>esc</kbd></div>
        </div>
        <div className="mb-1.5 mt-4 text-[10.5px] uppercase tracking-wider text-muted">Go to: press G, then</div>
        <div className="grid gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
          {go.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><Icon name={f.icon} className="h-3.5 w-3.5 text-muted" />{f.label}</span><span className="flex gap-1"><kbd className={kbd}>G</kbd><kbd className={kbd}>{GO_KEYS[f.id]!.toUpperCase()}</kbd></span></div>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-muted">The terminal, Newsroom and Studio add their own; press ? there. Or <button type="button" onClick={() => { setHelp(false); openPalette(); }} className="text-accent hover:underline">open the palette</button> and type what you want.</p>
      </div>
    </div>
  );
}
