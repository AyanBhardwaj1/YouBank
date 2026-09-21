/**
 * UI themes. Each theme is a full set of CSS custom properties applied on <html data-theme="...">.
 * Colors live here (single source of truth) and are emitted into globals.css by `themeCss()` at build
 * time via src/app/theme.css.ts, and also applied inline for live previews in the theme picker.
 */

export type ThemeMode = "dark" | "light";
export type ThemeId =
  | "terminal" | "midnight" | "aurora" | "graphite" | "phosphor" | "evergreen" | "nordic"
  | "daylight" | "paper" | "ivory" | "ocean" | "rose" | "solar" | "lavender";

export type ThemeVars = {
  bg: string; panel: string; elevated: string; raised: string; line: string; lineStrong: string;
  fg: string; muted: string; faint: string; accent: string; accentSoft: string; accentFg: string;
  pos: string; neg: string; info: string; chart1: string; chartDim: string; chartEmphasis: string;
  /** Panel corner radius (px). Terminal styles are square; modern styles are rounder. */
  radius: number;
  /** Optional page background image (gradient mesh) for cutting-edge looks. */
  bgImage: string;
  /** Shadow used for floating layers (menus, dialogs). */
  shadow: string;
  /** Glow applied to accent controls in the flashier themes. */
  glow: string;
  /** Glass effect strength for panels (0 = solid). */
  glass: number;
};

export type ThemeDef = {
  id: ThemeId;
  name: string;
  tagline: string;
  mode: ThemeMode;
  /** Short group label shown in the picker. */
  family: "Terminal" | "Modern dark" | "Cutting edge" | "Soft light" | "Bright modern" | "Playful";
  vars: ThemeVars;
};

const base = (v: Partial<ThemeVars> & Pick<ThemeVars, "bg" | "panel" | "elevated" | "raised" | "line" | "lineStrong" | "fg" | "muted" | "faint" | "accent" | "accentSoft" | "accentFg" | "pos" | "neg" | "info" | "chart1" | "chartDim" | "chartEmphasis">): ThemeVars => ({
  radius: 6, bgImage: "none", shadow: "0 20px 50px rgba(0,0,0,.55)", glow: "none", glass: 0, ...v,
});

export const THEMES: ThemeDef[] = [
  {
    id: "terminal", name: "Terminal", tagline: "Dense, amber on black. The Bloomberg lineage.", mode: "dark", family: "Terminal",
    vars: base({ bg: "#0a0c0f", panel: "#101318", elevated: "#171b22", raised: "#1e232c", line: "#242a33", lineStrong: "#323a46", fg: "#d7dde6", muted: "#7d8794", faint: "#4d5866",
      accent: "#f5a623", accentSoft: "rgba(245,166,35,.12)", accentFg: "#0a0c0f", pos: "#3fb950", neg: "#f85149", info: "#58a6ff", chart1: "#3987e5", chartDim: "#4d5866", chartEmphasis: "#c98500", radius: 4 }),
  },
  {
    id: "midnight", name: "Midnight", tagline: "Modern dark navy with electric blue. Calm and crisp.", mode: "dark", family: "Modern dark",
    vars: base({ bg: "#0b1020", panel: "#111833", elevated: "#182146", raised: "#1f2a57", line: "#243059", lineStrong: "#33427a", fg: "#e2e8f7", muted: "#8b97bf", faint: "#586489",
      accent: "#4f8cff", accentSoft: "rgba(79,140,255,.14)", accentFg: "#ffffff", pos: "#34d399", neg: "#fb7185", info: "#7dd3fc", chart1: "#6aa2ff", chartDim: "#4b567d", chartEmphasis: "#ffb454", radius: 10, shadow: "0 24px 60px rgba(3,7,25,.7)" }),
  },
  {
    id: "aurora", name: "Aurora", tagline: "Cutting edge. Violet and cyan light over glass.", mode: "dark", family: "Cutting edge",
    vars: base({ bg: "#07060f", panel: "rgba(20,17,40,.72)", elevated: "rgba(36,30,68,.7)", raised: "rgba(52,44,96,.8)", line: "rgba(160,140,255,.16)", lineStrong: "rgba(160,140,255,.32)", fg: "#ece9ff", muted: "#9d95c9", faint: "#5d578a",
      accent: "#a78bfa", accentSoft: "rgba(167,139,250,.16)", accentFg: "#0b0820", pos: "#2dd4bf", neg: "#fb7185", info: "#22d3ee", chart1: "#8b7cf6", chartDim: "#4c4680", chartEmphasis: "#f0abfc", radius: 14, glass: 1,
      bgImage: "radial-gradient(1200px 600px at 10% -10%, rgba(124,58,237,.35), transparent 60%), radial-gradient(900px 500px at 100% 0%, rgba(34,211,238,.22), transparent 60%), radial-gradient(800px 600px at 50% 110%, rgba(236,72,153,.18), transparent 60%)",
      shadow: "0 30px 80px rgba(20,10,60,.7)", glow: "0 0 0 1px rgba(167,139,250,.35), 0 0 24px rgba(167,139,250,.35)" }),
  },
  {
    id: "graphite", name: "Graphite", tagline: "Neutral charcoal with a single ember accent. Minimal.", mode: "dark", family: "Modern dark",
    vars: base({ bg: "#121212", panel: "#181818", elevated: "#202020", raised: "#282828", line: "#2a2a2a", lineStrong: "#3a3a3a", fg: "#e8e8e8", muted: "#8f8f8f", faint: "#5a5a5a",
      accent: "#ff6b35", accentSoft: "rgba(255,107,53,.14)", accentFg: "#121212", pos: "#4ade80", neg: "#f87171", info: "#93c5fd", chart1: "#9ca3af", chartDim: "#4b4b4b", chartEmphasis: "#ff6b35", radius: 8 }),
  },
  {
    id: "phosphor", name: "Phosphor", tagline: "Green phosphor on black. Retro trading floor.", mode: "dark", family: "Terminal",
    vars: base({ bg: "#020604", panel: "#06110b", elevated: "#0a1a11", raised: "#0f2418", line: "#12301f", lineStrong: "#1c4a30", fg: "#c8f7d6", muted: "#5fae7a", faint: "#2f6b45",
      accent: "#39ff88", accentSoft: "rgba(57,255,136,.12)", accentFg: "#020604", pos: "#7dff9f", neg: "#ff6b6b", info: "#7de3ff", chart1: "#39d97a", chartDim: "#255c3a", chartEmphasis: "#eaff5a", radius: 2, glow: "0 0 12px rgba(57,255,136,.35)" }),
  },
  {
    id: "evergreen", name: "Evergreen", tagline: "Deep green and brass. Old-money desk.", mode: "dark", family: "Modern dark",
    vars: base({ bg: "#0b1512", panel: "#101e19", elevated: "#152821", raised: "#1b3229", line: "#1f362d", lineStrong: "#2d4d40", fg: "#e6efe9", muted: "#86a496", faint: "#4e6a5c",
      accent: "#d4af37", accentSoft: "rgba(212,175,55,.14)", accentFg: "#0b1512", pos: "#5ee0a0", neg: "#f47c7c", info: "#8ccff0", chart1: "#5aa88a", chartDim: "#3c5a4d", chartEmphasis: "#d4af37", radius: 8 }),
  },
  {
    id: "nordic", name: "Nordic", tagline: "Cool blue-gray with frost accents. Quiet focus.", mode: "dark", family: "Modern dark",
    vars: base({ bg: "#2e3440", panel: "#353b49", elevated: "#3b4252", raised: "#434c5e", line: "#434c5e", lineStrong: "#4c566a", fg: "#eceff4", muted: "#a3adc2", faint: "#6b7590",
      accent: "#88c0d0", accentSoft: "rgba(136,192,208,.16)", accentFg: "#2e3440", pos: "#a3be8c", neg: "#bf616a", info: "#81a1c1", chart1: "#81a1c1", chartDim: "#5b6478", chartEmphasis: "#ebcb8b", radius: 8, shadow: "0 20px 50px rgba(20,24,32,.6)" }),
  },
  {
    id: "daylight", name: "Daylight", tagline: "Bright, modern, and clean. White with vivid blue.", mode: "light", family: "Bright modern",
    vars: base({ bg: "#f6f8fb", panel: "#ffffff", elevated: "#f1f4f9", raised: "#e8edf5", line: "#e3e8f0", lineStrong: "#cbd3e0", fg: "#0f172a", muted: "#5b6b82", faint: "#9aa7ba",
      accent: "#2563eb", accentSoft: "rgba(37,99,235,.10)", accentFg: "#ffffff", pos: "#15803d", neg: "#dc2626", info: "#0284c7", chart1: "#3b82f6", chartDim: "#b6c2d4", chartEmphasis: "#f59e0b", radius: 12, shadow: "0 20px 50px rgba(15,23,42,.14)" }),
  },
  {
    id: "paper", name: "Paper", tagline: "Warm off-white and ink with a sage accent. Soft.", mode: "light", family: "Soft light",
    vars: base({ bg: "#f7f4ee", panel: "#fffdf9", elevated: "#f2eee6", raised: "#ebe6dc", line: "#e6e0d4", lineStrong: "#d2cab9", fg: "#2b2a26", muted: "#6f6a5f", faint: "#a9a294",
      accent: "#4f7f63", accentSoft: "rgba(79,127,99,.12)", accentFg: "#ffffff", pos: "#3d8b5e", neg: "#c2503d", info: "#3f6fa3", chart1: "#6f8f7a", chartDim: "#c9c2b3", chartEmphasis: "#c98500", radius: 10, shadow: "0 18px 40px rgba(60,50,30,.16)" }),
  },
  {
    id: "ivory", name: "Ivory & Gold", tagline: "Cream and gold. Private-bank stationery.", mode: "light", family: "Soft light",
    vars: base({ bg: "#faf7f0", panel: "#fffdf7", elevated: "#f4efe3", raised: "#ece5d5", line: "#e8e0cd", lineStrong: "#d6c9a8", fg: "#231f18", muted: "#736a58", faint: "#ada48f",
      accent: "#a67c00", accentSoft: "rgba(166,124,0,.12)", accentFg: "#ffffff", pos: "#2f7d4f", neg: "#b23b3b", info: "#33628f", chart1: "#8c7a4d", chartDim: "#d5ccb6", chartEmphasis: "#a67c00", radius: 8, shadow: "0 18px 40px rgba(80,60,20,.16)" }),
  },
  {
    id: "ocean", name: "Ocean", tagline: "Light glass with teal. Airy and lit up.", mode: "light", family: "Bright modern",
    vars: base({ bg: "#eef6fa", panel: "rgba(255,255,255,.78)", elevated: "rgba(233,244,250,.9)", raised: "rgba(214,234,244,.95)", line: "rgba(14,116,144,.14)", lineStrong: "rgba(14,116,144,.3)", fg: "#0c2a3a", muted: "#4f6f80", faint: "#8fa9b8",
      accent: "#0e7490", accentSoft: "rgba(14,116,144,.12)", accentFg: "#ffffff", pos: "#0f8a5f", neg: "#d64545", info: "#0369a1", chart1: "#22a3c8", chartDim: "#b7d3df", chartEmphasis: "#f59e0b", radius: 14, glass: 1,
      bgImage: "radial-gradient(900px 500px at 0% 0%, rgba(34,163,200,.22), transparent 60%), radial-gradient(800px 500px at 100% 100%, rgba(14,116,144,.14), transparent 60%)", shadow: "0 20px 50px rgba(12,42,58,.16)" }),
  },
  {
    id: "rose", name: "Rosé", tagline: "Blush and plum. Light, soft, and friendly.", mode: "light", family: "Soft light",
    vars: base({ bg: "#fbf5f7", panel: "#fffafc", elevated: "#f7eef2", raised: "#f0e3ea", line: "#ecdde4", lineStrong: "#d9c2cd", fg: "#33202b", muted: "#7b6470", faint: "#b39ca7",
      accent: "#b0407a", accentSoft: "rgba(176,64,122,.12)", accentFg: "#ffffff", pos: "#2f8f5b", neg: "#c53d3d", info: "#5b5bd6", chart1: "#c56b9a", chartDim: "#dcc6d0", chartEmphasis: "#d97706", radius: 12, shadow: "0 18px 40px rgba(80,30,60,.16)" }),
  },
  {
    id: "solar", name: "Solar", tagline: "High contrast black and yellow. Maximum legibility.", mode: "light", family: "Playful",
    vars: base({ bg: "#ffffff", panel: "#ffffff", elevated: "#f5f5f5", raised: "#ebebeb", line: "#dcdcdc", lineStrong: "#111111", fg: "#000000", muted: "#444444", faint: "#8a8a8a",
      accent: "#111111", accentSoft: "rgba(255,214,10,.35)", accentFg: "#ffd60a", pos: "#006d32", neg: "#c1121f", info: "#0033cc", chart1: "#111111", chartDim: "#bdbdbd", chartEmphasis: "#ffb703", radius: 0, shadow: "0 12px 30px rgba(0,0,0,.2)" }),
  },
  {
    id: "lavender", name: "Lavender", tagline: "Lit-up modern pastels with a violet glow.", mode: "light", family: "Playful",
    vars: base({ bg: "#f5f3ff", panel: "rgba(255,255,255,.85)", elevated: "#efeaff", raised: "#e6dfff", line: "#e2dbfb", lineStrong: "#c7b8f5", fg: "#221a3d", muted: "#6b5f8f", faint: "#a89cc9",
      accent: "#7c3aed", accentSoft: "rgba(124,58,237,.12)", accentFg: "#ffffff", pos: "#0f9d6a", neg: "#e0345c", info: "#2563eb", chart1: "#8b5cf6", chartDim: "#cfc5ee", chartEmphasis: "#f59e0b", radius: 16, glass: 1,
      bgImage: "radial-gradient(800px 500px at 10% 0%, rgba(124,58,237,.16), transparent 60%), radial-gradient(700px 500px at 100% 20%, rgba(236,72,153,.12), transparent 60%)", shadow: "0 20px 50px rgba(60,30,120,.18)", glow: "0 0 0 1px rgba(124,58,237,.25), 0 8px 24px rgba(124,58,237,.25)" }),
  },
];

export const DEFAULT_THEME: ThemeId = "terminal";
export const THEME_COOKIE = "yb-theme";

export function themeById(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function isThemeId(id: string): id is ThemeId {
  return THEMES.some((t) => t.id === id);
}

/** Inline style object for live previews: the same variables a theme sets globally. */
export function themeStyle(t: ThemeDef): Record<string, string> {
  const v = t.vars;
  return {
    "--bg": v.bg, "--panel": v.panel, "--elevated": v.elevated, "--raised": v.raised, "--line": v.line, "--line-strong": v.lineStrong,
    "--fg": v.fg, "--muted": v.muted, "--faint": v.faint, "--accent": v.accent, "--accent-soft": v.accentSoft, "--accent-fg": v.accentFg,
    "--pos": v.pos, "--neg": v.neg, "--info": v.info, "--chart-1": v.chart1, "--chart-dim": v.chartDim, "--chart-emphasis": v.chartEmphasis,
    "--radius": `${v.radius}px`, "--radius-sm": `${Math.max(2, Math.round(v.radius * 0.6))}px`, "--bg-image": v.bgImage, "--shadow-lg": v.shadow, "--glow": v.glow, "--glass": String(v.glass),
    colorScheme: t.mode,
  };
}

/**
 * CSS block for every theme, injected once into the global stylesheet.
 * The selector is `html[data-theme=...]` (specificity 0-1-1) so it outranks the `:root` fallback block
 * (0-1-0) in globals.css, which is imported after this file and would otherwise win the cascade.
 */
export function themeCss(): string {
  return THEMES.map((t) => {
    const s = themeStyle(t);
    const decls = Object.entries(s).filter(([k]) => k.startsWith("--")).map(([k, val]) => `${k}:${val};`).join("");
    return `html[data-theme="${t.id}"]{${decls}color-scheme:${t.mode};}`;
  }).join("\n");
}
