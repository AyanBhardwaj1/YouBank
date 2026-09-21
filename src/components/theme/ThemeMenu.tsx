"use client";

import { useEffect, useRef, useState } from "react";
import { THEMES } from "@/lib/themes";
import { useTheme } from "./ThemeProvider";
import { ThemeThumb } from "./ThemePicker";
import { Icon } from "@/components/ui/Icon";

/** Compact style switcher for headers and navs: a swatch button that opens a preview grid. */
export function ThemeMenu({ align = "right" }: { align?: "left" | "right" }) {
  const { theme, themeId, setTheme, preview } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); preview(null); } };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); preview(null); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, preview]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} title={`Style: ${theme.name}`} aria-label="Change style"
        className="ctl flex items-center gap-1.5 border border-line px-2 py-1.5 text-[12px] text-muted transition hover:border-accent/50 hover:text-fg">
        <Icon name="Palette" className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{theme.name}</span>
        <span className="flex gap-0.5">
          {[theme.vars.accent, theme.vars.chart1, theme.vars.panel].map((c, i) => <span key={i} className="h-2.5 w-2.5 rounded-sm border border-line" style={{ background: c }} />)}
        </span>
      </button>
      {open && (
        <div className={`rise float absolute z-50 mt-1.5 w-[440px] max-w-[88vw] ctl border border-line-strong bg-raised p-2 ${align === "right" ? "right-0" : "left-0"}`} onMouseLeave={() => preview(null)}>
          <div className="mb-1.5 flex items-baseline justify-between px-1 text-[10.5px] uppercase tracking-wider text-muted"><span>Interface style</span><span className="normal-case tracking-normal">hover to preview</span></div>
          <div className="grid max-h-[62vh] grid-cols-3 gap-1.5 overflow-auto sm:grid-cols-4">
            {THEMES.map((t) => (
              <button key={t.id} type="button" onMouseEnter={() => preview(t.id)} onFocus={() => preview(t.id)} onClick={() => { setTheme(t.id); setOpen(false); }}
                className={`ctl border p-1 text-left transition ${t.id === themeId ? "border-accent bg-accent-soft" : "border-line hover:border-accent/50"}`} title={t.tagline}>
                <ThemeThumb theme={t} active={t.id === themeId} size="sm" />
                <div className={`truncate px-0.5 pt-1 text-[10.5px] font-semibold ${t.id === themeId ? "text-accent" : ""}`}>{t.name}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
