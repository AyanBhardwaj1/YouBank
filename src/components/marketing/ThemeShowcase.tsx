"use client";

import { THEMES } from "@/lib/themes";
import { useTheme } from "@/components/theme/ThemeProvider";
import { ThemeThumb } from "@/components/theme/ThemePicker";

/** Landing-page style switcher: clicking a style re-themes the whole site instantly, before sign-in. */
export function ThemeShowcase() {
  const { themeId, setTheme, preview } = useTheme();
  const active = THEMES.find((t) => t.id === themeId) ?? THEMES[0];
  return (
    <div onMouseLeave={() => preview(null)}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[13px] font-semibold">Now showing: <span className="text-accent">{active.name}</span></span>
        <span className="text-[11.5px] text-muted">{active.tagline}</span>
        <span className="ml-auto text-[11px] text-muted">Hover to preview, click to keep. Your choice follows you into the app.</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {THEMES.map((t) => (
          <button key={t.id} type="button" onMouseEnter={() => preview(t.id)} onFocus={() => preview(t.id)} onBlur={() => preview(null)} onClick={() => setTheme(t.id)}
            className="lift group text-left" title={`${t.name}: ${t.tagline}`} aria-pressed={t.id === themeId}>
            <div className={`overflow-hidden rounded-[var(--radius)] border p-1 ${t.id === themeId ? "border-accent bg-accent-soft" : "border-line bg-panel"}`}>
              <ThemeThumb theme={t} active={t.id === themeId} size="sm" />
              <div className="flex items-baseline justify-between px-0.5 pt-1">
                <span className={`text-[11px] font-semibold ${t.id === themeId ? "text-accent" : ""}`}>{t.name}</span>
                <span className="text-[9px] uppercase tracking-wider text-muted">{t.mode}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
