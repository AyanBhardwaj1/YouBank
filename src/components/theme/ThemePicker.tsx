"use client";

import { THEMES, themeStyle, type ThemeDef, type ThemeId } from "@/lib/themes";
import { useTheme } from "./ThemeProvider";

/** Miniature terminal rendered with a theme's variables. Pure CSS variables, so it previews any theme without switching. */
export function ThemeThumb({ theme, active = false, size = "md" }: { theme: ThemeDef; active?: boolean; size?: "sm" | "md" | "lg" }) {
  const h = size === "sm" ? 64 : size === "lg" ? 150 : 104;
  return (
    <div style={themeStyle(theme) as React.CSSProperties} className="w-full overflow-hidden" aria-hidden>
      <div className={`relative w-full overflow-hidden border ${active ? "border-[var(--accent)]" : "border-[var(--line)]"}`}
        style={{ height: h, background: theme.vars.bg, backgroundImage: theme.vars.bgImage, borderRadius: "var(--radius)" }}>
        <div className="absolute inset-x-0 top-0 flex h-[16%] items-center gap-1 px-2" style={{ background: theme.vars.panel, borderBottom: `1px solid ${theme.vars.line}` }}>
          <span className="h-2 w-2 rounded-sm" style={{ background: theme.vars.accent }} />
          <span className="h-1 w-8 rounded-sm" style={{ background: theme.vars.muted, opacity: 0.6 }} />
          <span className="ml-auto h-1 w-5 rounded-sm" style={{ background: theme.vars.pos, opacity: 0.8 }} />
        </div>
        <div className="absolute bottom-[8%] left-2 top-[24%] w-[26%]" style={{ background: theme.vars.panel, border: `1px solid ${theme.vars.line}`, borderRadius: "var(--radius-sm)" }}>
          {[0.9, 0.6, 0.75, 0.5].map((w, i) => (
            <div key={i} className="mx-1 mt-1 flex items-center gap-1">
              <span className="h-1 rounded-sm" style={{ width: `${w * 60}%`, background: i === 0 ? theme.vars.accent : theme.vars.muted, opacity: i === 0 ? 1 : 0.5 }} />
              <span className="ml-auto h-1 w-2 rounded-sm" style={{ background: i % 2 ? theme.vars.neg : theme.vars.pos, opacity: 0.8 }} />
            </div>
          ))}
        </div>
        <div className="absolute bottom-[8%] right-2 top-[24%] w-[66%]" style={{ background: theme.vars.panel, border: `1px solid ${theme.vars.line}`, borderRadius: "var(--radius-sm)" }}>
          <div className="flex h-full items-end gap-[3px] px-2 pb-2 pt-3">
            {[0.35, 0.5, 0.42, 0.66, 0.58, 0.8, 0.72, 1].map((v, i) => (
              <span key={i} className="flex-1 rounded-t-sm" style={{ height: `${v * 100}%`, background: i === 7 ? theme.vars.chartEmphasis : theme.vars.chart1, opacity: i === 7 ? 1 : 0.85 }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Theme gallery. Hover previews live, click applies (and persists when signed in). */
export function ThemePicker({ compact = false, onPick }: { compact?: boolean; onPick?: (id: ThemeId) => void }) {
  const { themeId, setTheme, preview } = useTheme();
  const families = [...new Set(THEMES.map((t) => t.family))];
  return (
    <div className="space-y-4" onMouseLeave={() => preview(null)}>
      {families.map((fam) => (
        <div key={fam}>
          <div className="mb-2 text-[10.5px] uppercase tracking-wider text-muted">{fam}</div>
          <div className={`grid gap-2 ${compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}`}>
            {THEMES.filter((t) => t.family === fam).map((t) => {
              const active = t.id === themeId;
              return (
                <button key={t.id} type="button" onMouseEnter={() => preview(t.id)} onFocus={() => preview(t.id)} onBlur={() => preview(null)}
                  onClick={() => { setTheme(t.id); onPick?.(t.id); }}
                  className={`lift group text-left transition ${active ? "" : ""}`} aria-pressed={active} title={t.tagline}>
                  <div className={`overflow-hidden rounded-[var(--radius)] border p-1.5 ${active ? "border-accent bg-accent-soft" : "border-line bg-panel"}`}>
                    <ThemeThumb theme={t} active={active} size={compact ? "sm" : "md"} />
                    <div className="mt-1.5 flex items-center justify-between px-0.5">
                      <span className={`text-[12px] font-semibold ${active ? "text-accent" : "text-fg"}`}>{t.name}</span>
                      <span className="text-[10px] uppercase tracking-wider text-muted">{t.mode}</span>
                    </div>
                    {!compact && <div className="px-0.5 pb-0.5 text-[10.5px] leading-snug text-muted">{t.tagline}</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
