/**
 * A person's workspace: which features are on, how Home is laid out, and which widgets it shows in what
 * order (profiles.extra.desk), plus how the whole app looks beyond the theme (profiles.extra.look, mirrored
 * in the yb-look cookie so the first paint is already right).
 *
 * YouBank sets it up for the person from their survey (recommendDesk): their role decides the starting set,
 * and words in their goals switch on what they mentioned ("crypto", "outreach", "backtest"). It can also be
 * set up from a sentence they write (src/app/api/desk/setup, a model call checked against these same
 * vocabularies), and every choice stays theirs to change in Settings → My desk and Style. Pure.
 */
import { FEATURES, defaultPinned, type NavId } from "@/lib/nav";
import type { RoleId } from "@/lib/roles";
import { isThemeId, type ThemeId } from "@/lib/themes";

/* ---------------- Home ---------------- */

/** Focus: one question box and the few things that need you. Home: a calm, roomy page for the day. Desk: everything, dense. */
export const LAYOUTS = ["focus", "home", "desk"] as const;
export type HomeLayout = (typeof LAYOUTS)[number];

export const WIDGETS = ["checklist", "brief", "agenda", "waiting", "watchlist", "movers", "start", "ask", "runs", "notes", "private", "saved", "markets", "calc", "recent"] as const;
export type WidgetId = (typeof WIDGETS)[number];

export const WIDGET_LABEL: Record<WidgetId, string> = {
  checklist: "Getting started", brief: "Today's brief", agenda: "Coming up", waiting: "Waiting for you", watchlist: "Watchlist", movers: "Movers",
  start: "Tools to start with", ask: "Ask the assistant", runs: "Recent runs", notes: "Notes", private: "Private markets", saved: "Saved work", markets: "World markets", calc: "Quick calc", recent: "Jump back in",
};
export const WIDGET_HINT: Record<WidgetId, string> = {
  checklist: "The steps that make YouBank yours, ticked as you do them", brief: "The morning brief for your desk", agenda: "Meetings in the next day, with prep briefs", waiting: "Drafts, questions and suggestions the agents left for you",
  watchlist: "Prices, multiples and trends for your names", movers: "The names that moved most today", start: "Tools picked for your role",
  ask: "Suggested questions for the assistant", runs: "Your latest tool runs", notes: "A scratchpad kept on your account",
  private: "The startup directory and new private raises", saved: "Comps sheets and peer groups",
  markets: "Which exchanges trade now, and when they open or close in your time", calc: "Arithmetic with k, m, b and %, plus npv, irr and pmt", recent: "The pages, tools and tickers you opened last, on this device",
};

/** Widgets that take the full width of the page (or the Desk layout's main column) unless the person says otherwise. */
export const DEFAULT_WIDE: ReadonlySet<WidgetId> = new Set<WidgetId>(["checklist", "brief", "start", "watchlist", "movers"]);
export type WidgetSize = "wide" | "narrow";
export type WidgetPref = { id: WidgetId; on: boolean; /** Set when the person changed it on Home; otherwise DEFAULT_WIDE decides. */ size?: WidgetSize };
export const isWide = (w: Pick<WidgetPref, "id" | "size">) => (w.size ? w.size === "wide" : DEFAULT_WIDE.has(w.id));

/**
 * The list with `id` moved to where `to` is (Home's arrange mode: drag a widget onto another). Moving
 * down puts it after `to`, moving up before it, as a drag reads. Unknown ids leave the list as it was.
 */
export function moveWidget(list: WidgetPref[], id: WidgetId, to: WidgetId): WidgetPref[] {
  const from = list.findIndex((w) => w.id === id);
  const target = list.findIndex((w) => w.id === to);
  if (from < 0 || target < 0 || from === target) return list;
  const out = [...list];
  const [w] = out.splice(from, 1);
  out.splice(target, 0, w);
  return out;
}

/**
 * The list with `id` moved one place among the widgets that are on (the arrows in arrange mode), or,
 * with `among`, among those it picks: on the Desk layout, the widgets in the same column.
 */
export function nudgeWidget(list: WidgetPref[], id: WidgetId, by: -1 | 1, among: (w: WidgetPref) => boolean = () => true): WidgetPref[] {
  const on = list.filter((w) => w.on && among(w));
  const i = on.findIndex((w) => w.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= on.length) return list;
  return moveWidget(list, id, on[j].id);
}

/** Switch a widget on at the end of what is shown (the arrange tray), or off where it is. */
export function toggleWidget(list: WidgetPref[], id: WidgetId, on: boolean): WidgetPref[] {
  const w = list.find((x) => x.id === id);
  if (!w || w.on === on) return list;
  if (!on) return list.map((x) => (x.id === id ? { ...x, on: false } : x));
  const rest = list.filter((x) => x.id !== id);
  const lastOn = rest.reduce((n, x, i) => (x.on ? i : n), -1);
  return [...rest.slice(0, lastOn + 1), { ...w, on: true }, ...rest.slice(lastOn + 1)];
}
export type DeskPrefs = {
  layout: HomeLayout;
  /** Every widget, in the order shown; `on: false` keeps its place for when it is switched back on. */
  widgets: WidgetPref[];
  /** Features taken out of the navigation. Their pages still open from a link. */
  hidden: NavId[];
  /** How the current setup was made: from the survey, from the person's own words, or by hand. */
  source: "auto" | "ai" | "you";
  setupAt: string | null;
  /** The Notes widget's text. */
  notes: string;
};

/** Features that are always there: the app is unusable without them. */
export const CORE_FEATURES: NavId[] = ["home", "settings"];
export const NOTES_MAX = 4000;

const isLayout = (v: unknown): v is HomeLayout => typeof v === "string" && (LAYOUTS as readonly string[]).includes(v);
const isWidget = (v: unknown): v is WidgetId => typeof v === "string" && (WIDGETS as readonly string[]).includes(v);

/** The widgets on by default for each layout. */
const LAYOUT_WIDGETS: Record<HomeLayout, WidgetId[]> = {
  focus: ["checklist", "waiting", "agenda", "brief"],
  home: ["checklist", "agenda", "recent", "brief", "waiting", "watchlist", "notes", "runs"],
  desk: ["checklist", "brief", "start", "watchlist", "movers", "ask", "runs", "waiting", "agenda", "saved"],
};

/** A widget list with every widget once: the given order first, then the rest switched off. */
function completeWidgets(list: WidgetPref[]): WidgetPref[] {
  const seen = new Set<WidgetId>();
  const out: WidgetPref[] = [];
  for (const w of list) if (!seen.has(w.id)) { seen.add(w.id); out.push(w); }
  for (const id of WIDGETS) if (!seen.has(id)) out.push({ id, on: false });
  return out;
}

export const widgetsFor = (layout: HomeLayout, role?: RoleId): WidgetPref[] => {
  const on = [...LAYOUT_WIDGETS[layout], ...(layout === "desk" && (role === "vc" || role === "pe") ? (["private"] as WidgetId[]) : []), ...(layout !== "focus" && role === "markets" ? (["markets"] as WidgetId[]) : [])];
  return completeWidgets(on.map((id) => ({ id, on: true })));
};

export const defaultDesk = (role: RoleId): DeskPrefs => ({ layout: "desk", widgets: widgetsFor("desk", role), hidden: [], source: "auto", setupAt: null, notes: "" });

/** Stored desk preferences, cleaned. Unknown widgets and features drop out; a missing list falls back to the layout's. */
export function normalizeDesk(raw: unknown, role: RoleId): DeskPrefs {
  const d = defaultDesk(role);
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const layout = isLayout(r.layout) ? r.layout : d.layout;
  const widgets = Array.isArray(r.widgets)
    ? completeWidgets(r.widgets.flatMap((w) => {
      const o = (w && typeof w === "object" ? w : {}) as Record<string, unknown>;
      return isWidget(o.id) ? [{ id: o.id, on: o.on !== false, ...(o.size === "wide" || o.size === "narrow" ? { size: o.size } : {}) }] : [];
    }))
    : widgetsFor(layout, role);
  const known = new Set(FEATURES.map((f) => f.id));
  const hidden = Array.isArray(r.hidden) ? [...new Set(r.hidden.filter((x): x is NavId => typeof x === "string" && known.has(x as NavId) && !CORE_FEATURES.includes(x as NavId)))] : [];
  const source = r.source === "ai" || r.source === "you" ? r.source : "auto";
  return { layout, widgets, hidden, source, setupAt: typeof r.setupAt === "string" ? r.setupAt : null, notes: typeof r.notes === "string" ? r.notes.slice(0, NOTES_MAX) : "" };
}

/* ---------------- Setting it up for the person ---------------- */

/** Every optional feature, so a recommendation can say what it hid and why. */
const OPTIONAL: NavId[] = ["terminal", "news", "tools", "studio", "edge", "vc", "crypto", "copy", "algo", "quant", "crm", "calendar", "collab", "library", "team"];

/** What each role starts with: features shown, the Home layout, and what goes in the top bar. */
const ROLE_SETUP: Record<RoleId, { show: NavId[]; layout: HomeLayout; pinned?: NavId[] }> = {
  banker: { show: ["terminal", "news", "tools", "studio", "edge", "crm", "calendar", "collab", "library", "team"], layout: "desk", pinned: ["home", "terminal", "studio", "crm", "news"] },
  pe: { show: ["terminal", "news", "tools", "studio", "edge", "vc", "crm", "calendar", "collab", "library", "team", "quant"], layout: "desk", pinned: ["home", "terminal", "vc", "studio", "crm"] },
  vc: { show: ["terminal", "news", "tools", "studio", "edge", "vc", "crm", "calendar", "collab", "library", "team"], layout: "home", pinned: ["home", "vc", "crm", "news", "tools"] },
  markets: { show: ["terminal", "news", "tools", "studio", "edge", "quant", "copy", "algo", "calendar", "library", "team"], layout: "desk", pinned: ["home", "terminal", "news", "quant", "edge"] },
  corpfin: { show: ["terminal", "news", "tools", "studio", "edge", "calendar", "collab", "library", "team"], layout: "desk", pinned: ["home", "terminal", "studio", "tools", "news"] },
  consultant: { show: ["terminal", "news", "tools", "studio", "edge", "crm", "calendar", "collab", "library", "team"], layout: "home", pinned: ["home", "tools", "studio", "news", "crm"] },
  accountant: { show: ["terminal", "news", "tools", "studio", "calendar", "collab", "library", "team"], layout: "focus", pinned: ["home", "tools", "terminal", "studio"] },
  student: { show: ["terminal", "news", "tools", "studio", "edge", "library", "calendar"], layout: "home", pinned: ["home", "terminal", "tools", "news", "studio"] },
};

/** Words in a person's goals (or their own description) that switch features on. */
const KEYWORDS: [RegExp, NavId[]][] = [
  [/\b(crypto|bitcoin|btc|ethereum|eth|defi|token|stablecoin|on-?chain|web3)\b/i, ["crypto"]],
  [/\b(algo|algorithmic|systematic|backtest|trading bot|quant|factor|alpha|signals?)\b/i, ["algo", "quant"]],
  [/\b(13f|hedge funds?|copy (trading|portfolios?)|clone)\b/i, ["copy"]],
  [/\b(outreach|cold email|email|inbox|follow[- ]?ups?|pipeline|crm|relationships?|fundrais\w*|investors?|lps?|prospects?)\b/i, ["crm"]],
  [/\b(meetings?|calendar|schedule|calls?)\b/i, ["calendar"]],
  [/\b(startups?|venture|seed|series [a-d]|form d|private (markets?|companies)|sourcing)\b/i, ["vc"]],
  [/\b(models?|dcf|lbo|decks?|pitch ?books?|excel|powerpoint|spreadsheets?)\b/i, ["studio"]],
  [/\b(satellite|alternative data|alt data|supply chain|deal radar|precedents?|theses|thesis)\b/i, ["edge"]],
  [/\b(news|headlines|briefs?|morning)\b/i, ["news"]],
  [/\b(team|colleagues|together|collaborat\w*)\b/i, ["team", "collab"]],
];

/** Words that pick a Home layout. */
const LAYOUT_WORDS: [RegExp, HomeLayout][] = [
  [/\b(minimal|clean|simple|focus(ed)?|distraction|calm|quiet|uncluttered)\b/i, "focus"],
  [/\b(cozy|cosy|homey|warm|relaxed|friendly|comfortable|comfy)\b/i, "home"],
  [/\b(dense|everything|power user|bloomberg|terminal|all the data|dashboard)\b/i, "desk"],
];

export type DeskRecommendation = { desk: DeskPrefs; pinned: NavId[]; reasons: string[] };

/**
 * The desk YouBank would set up from a role and some words (the survey's goals and specialty, or the
 * person's own description). Pure: the same input always gives the same setup.
 */
export function recommendDesk(role: RoleId, words = "", now = new Date()): DeskRecommendation {
  const base = ROLE_SETUP[role] ?? ROLE_SETUP.banker;
  const show = new Set<NavId>(base.show);
  const reasons: string[] = [`Started from what a ${role === "pe" ? "private equity" : role === "vc" ? "venture" : role === "corpfin" ? "corporate finance" : role} desk uses most.`];
  const mentioned: NavId[] = [];
  for (const [re, ids] of KEYWORDS) {
    const hit = re.exec(words);
    if (!hit) continue;
    for (const id of ids) if (!mentioned.includes(id) && FEATURES.some((f) => f.id === id && (!f.roles || f.roles.includes(role)))) mentioned.push(id);
    const added = ids.filter((id) => !show.has(id) && FEATURES.find((f) => f.id === id && (!f.roles || f.roles.includes(role))));
    for (const id of added) show.add(id);
    if (added.length) reasons.push(`You mentioned “${hit[0]}”, so ${added.map((id) => FEATURES.find((f) => f.id === id)?.label ?? id).join(" and ")} ${added.length === 1 ? "is" : "are"} on.`);
  }
  let layout = base.layout;
  for (const [re, l] of LAYOUT_WORDS) {
    const hit = re.exec(words);
    if (hit) { layout = l; reasons.push(`You asked for something “${hit[0]}”, so Home uses the ${l === "focus" ? "Focus" : l === "home" ? "Home" : "Desk"} layout.`); break; }
  }
  const hidden = OPTIONAL.filter((id) => !show.has(id) && FEATURES.some((f) => f.id === id && (!f.roles || f.roles.includes(role))));
  if (hidden.length) reasons.push(`Out of the way for now, and one switch away in Settings → My desk: ${hidden.map((id) => FEATURES.find((f) => f.id === id)?.label ?? id).join(", ")}.`);
  // What the person named goes first in the bar (after Home), then the role's usual pins, five or six in all.
  const rolePins = [...(base.pinned ?? defaultPinned(role))].filter((id) => !hidden.includes(id));
  const pinned = [...new Set<NavId>(["home", ...mentioned, ...rolePins])].filter((id) => !hidden.includes(id)).slice(0, Math.max(rolePins.length, 6));
  const widgets = widgetsFor(layout, role).map((w) => (w.id === "private" && !show.has("vc") ? { ...w, on: false } : w));
  return { desk: { layout, widgets, hidden, source: words.trim() ? "ai" : "auto", setupAt: now.toISOString(), notes: "" }, pinned, reasons };
}

/* ---------------- How it looks ---------------- */

export const SCALES = [0.9, 1, 1.1, 1.25] as const;
export const RADII = ["theme", "square", "soft", "round"] as const;
export const FONTS = ["sans", "serif", "mono", "system"] as const;
export const BACKGROUNDS = ["theme", "plain", "mesh", "grid", "dots"] as const;
/** Soft backdrops at the top of Home, over any style. */
export const WALLPAPERS = ["none", "dawn", "dusk", "ocean", "forest", "aurora", "paper"] as const;
/** Accent swatches people can pick instead of the theme's own (any other #rrggbb is allowed too). */
export const ACCENTS = ["theme", "#f5a623", "#4f8cff", "#a78bfa", "#2dd4bf", "#34d399", "#fb7185", "#f472b6", "#facc15", "#38bdf8", "#e879f9"] as const;
/** "theme" or a plain six-digit hex colour, lower case: nothing else ever reaches a style attribute. */
export type Accent = "theme" | `#${string}`;
export const asAccent = (v: unknown): Accent | null => (v === "theme" ? "theme" : typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? (v.toLowerCase() as Accent) : null);

export type LookPrefs = {
  scale: (typeof SCALES)[number];
  radius: (typeof RADII)[number];
  font: (typeof FONTS)[number];
  accent: Accent;
  background: (typeof BACKGROUNDS)[number];
  wallpaper: (typeof WALLPAPERS)[number];
  motion: "full" | "reduced";
  contrast: "normal" | "high";
  /** Follow the device's light or dark setting, with these two styles. */
  system: boolean;
  lightTheme: ThemeId;
  darkTheme: ThemeId;
};
export const DEFAULT_LOOK: LookPrefs = { scale: 1, radius: "theme", font: "sans", accent: "theme", background: "theme", wallpaper: "none", motion: "full", contrast: "normal", system: false, lightTheme: "daylight", darkTheme: "terminal" };
export const LOOK_COOKIE = "yb-look";

const oneOf = <T,>(list: readonly T[], v: unknown, d: T): T => (list.includes(v as T) ? (v as T) : d);

/** Stored look preferences (or the cookie's), cleaned: anything unknown takes the default. */
export function normalizeLook(raw: unknown): LookPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    scale: oneOf(SCALES, typeof r.scale === "string" ? Number(r.scale) : r.scale, DEFAULT_LOOK.scale),
    radius: oneOf(RADII, r.radius, DEFAULT_LOOK.radius),
    font: oneOf(FONTS, r.font, DEFAULT_LOOK.font),
    accent: asAccent(r.accent) ?? DEFAULT_LOOK.accent,
    background: oneOf(BACKGROUNDS, r.background, DEFAULT_LOOK.background),
    wallpaper: oneOf(WALLPAPERS, r.wallpaper, DEFAULT_LOOK.wallpaper),
    motion: r.motion === "reduced" ? "reduced" : "full",
    contrast: r.contrast === "high" ? "high" : "normal",
    system: r.system === true,
    lightTheme: typeof r.lightTheme === "string" && isThemeId(r.lightTheme) ? r.lightTheme : DEFAULT_LOOK.lightTheme,
    darkTheme: typeof r.darkTheme === "string" && isThemeId(r.darkTheme) ? r.darkTheme : DEFAULT_LOOK.darkTheme,
  };
}

/** The look as a short cookie value (only what differs from the default). Pure. */
export function lookCookie(l: LookPrefs): string {
  const diff = Object.fromEntries(Object.entries(l).filter(([k, v]) => DEFAULT_LOOK[k as keyof LookPrefs] !== v));
  return encodeURIComponent(JSON.stringify(diff));
}
export function readLookCookie(v: string | undefined): LookPrefs {
  if (!v) return DEFAULT_LOOK;
  try { return normalizeLook(JSON.parse(decodeURIComponent(v))); } catch { return DEFAULT_LOOK; }
}

/** The attributes and CSS variables the look sets on <html>. Pure, so the server and the browser agree. */
export function lookAttrs(l: LookPrefs): { attrs: Record<string, string>; vars: Record<string, string> } {
  const attrs: Record<string, string> = {};
  const vars: Record<string, string> = {};
  if (l.scale !== 1) vars["--ui-scale"] = String(l.scale);
  if (l.radius !== "theme") {
    const [r, s] = l.radius === "square" ? [0, 0] : l.radius === "soft" ? [8, 6] : [16, 12];
    vars["--radius"] = `${r}px`; vars["--radius-sm"] = `${s}px`;
  }
  if (l.font !== "sans") attrs["data-font"] = l.font;
  if (l.accent !== "theme") {
    vars["--accent"] = l.accent;
    vars["--accent-soft"] = `${l.accent}24`;
    vars["--accent-fg"] = accentInk(l.accent);
    vars["--chart-1"] = l.accent;
  }
  if (l.background !== "theme") attrs["data-bg"] = l.background;
  if (l.wallpaper !== "none") attrs["data-wall"] = l.wallpaper;
  if (l.motion === "reduced") attrs["data-motion"] = "reduced";
  if (l.contrast === "high") attrs["data-contrast"] = "high";
  return { attrs, vars };
}

/* ---------------- Saved looks ---------------- */

/** A style and a look together, under a name: built in, saved by the person, or pasted from a code. */
export type LookPreset = { name: string; theme: ThemeId; look: LookPrefs };
export const PRESETS_MAX = 12;

/** Looks that come with YouBank, to start from. */
export const BUILTIN_LOOKS: LookPreset[] = [
  { name: "Night trader", theme: "terminal", look: { ...DEFAULT_LOOK, scale: 0.9, radius: "square", font: "mono", background: "grid" } },
  { name: "Calm paper", theme: "paper", look: { ...DEFAULT_LOOK, scale: 1.1, radius: "round", font: "serif", background: "plain", wallpaper: "paper" } },
  { name: "Big and clear", theme: "daylight", look: { ...DEFAULT_LOOK, scale: 1.25, contrast: "high", motion: "reduced", background: "plain" } },
  { name: "Neon", theme: "aurora", look: { ...DEFAULT_LOOK, accent: "#e879f9", radius: "round", background: "mesh" } },
  { name: "Forest desk", theme: "evergreen", look: { ...DEFAULT_LOOK, accent: "#34d399", radius: "soft", background: "dots", wallpaper: "forest" } },
  { name: "Ocean", theme: "ocean", look: { ...DEFAULT_LOOK, accent: "#38bdf8", radius: "round", background: "mesh", scale: 1.1, wallpaper: "ocean" } },
];

export function normalizePreset(raw: unknown): LookPreset | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.replace(/\s+/g, " ").trim().slice(0, 40) : "";
  if (!name || typeof r.theme !== "string" || !isThemeId(r.theme)) return null;
  return { name, theme: r.theme, look: normalizeLook(r.look) };
}

/** Saved looks, cleaned: valid ones only, one per name (the later wins), at most PRESETS_MAX. */
export function normalizePresets(raw: unknown): LookPreset[] {
  if (!Array.isArray(raw)) return [];
  const byName = new Map<string, LookPreset>();
  for (const p of raw.map(normalizePreset)) if (p) { byName.delete(p.name.toLowerCase()); byName.set(p.name.toLowerCase(), p); }
  return [...byName.values()].slice(-PRESETS_MAX);
}

/** A look as a code to paste elsewhere ("yb1." and base64url JSON, only what differs from the default). */
export function lookCode(p: LookPreset): string {
  const diff = Object.fromEntries(Object.entries(p.look).filter(([k, v]) => DEFAULT_LOOK[k as keyof LookPrefs] !== v));
  const json = JSON.stringify({ n: p.name, t: p.theme, l: diff });
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, "utf8").toString("base64");
  return `yb1.${b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/** The look in a pasted code, or null when it is not one. */
export function readLookCode(code: string): LookPreset | null {
  const m = /^yb1\.([A-Za-z0-9_-]{4,2000})$/.exec(code.trim());
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, "base64").toString("utf8");
    const o = JSON.parse(json) as { n?: unknown; t?: unknown; l?: unknown };
    return normalizePreset({ name: o.n, theme: o.t, look: o.l });
  } catch { return null; }
}

/* ---------------- Sharing a whole setup ---------------- */

const toB64Url = (json: string) => (typeof btoa === "function" ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, "utf8").toString("base64")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (s: string) => { const b64 = s.replace(/-/g, "+").replace(/_/g, "/"); return typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, "base64").toString("utf8"); };

/** A whole workspace to hand to a teammate: Home (layout, widgets and widths), the features shown, the style and the look. Never the notes. */
export type SetupShare = { desk: Pick<DeskPrefs, "layout" | "widgets" | "hidden">; theme: ThemeId; look: LookPrefs };

export function setupCode(s: SetupShare): string {
  const look = Object.fromEntries(Object.entries(s.look).filter(([k, v]) => DEFAULT_LOOK[k as keyof LookPrefs] !== v));
  const widgets = s.desk.widgets.filter((w) => w.on).map((w) => (w.size ? `${w.id}:${w.size[0]}` : w.id));
  return `yb2.${toB64Url(JSON.stringify({ l: s.desk.layout, w: widgets, h: s.desk.hidden, t: s.theme, k: look }))}`;
}

/** The setup in a pasted code, cleaned for this person's role, or null when it is not one. */
export function readSetupCode(code: string, role: RoleId): SetupShare | null {
  const m = /^yb2\.([A-Za-z0-9_-]{4,4000})$/.exec(code.trim());
  if (!m) return null;
  try {
    const o = JSON.parse(fromB64Url(m[1])) as { l?: unknown; w?: unknown; h?: unknown; t?: unknown; k?: unknown };
    if (typeof o.t !== "string" || !isThemeId(o.t) || !Array.isArray(o.w)) return null;
    const widgets = o.w.flatMap((x) => {
      if (typeof x !== "string") return [];
      const [id, size] = x.split(":");
      return [{ id, on: true, ...(size === "w" ? { size: "wide" } : size === "n" ? { size: "narrow" } : {}) }];
    });
    const desk = normalizeDesk({ layout: o.l, widgets, hidden: o.h }, role);
    return { desk: { layout: desk.layout, widgets: desk.widgets, hidden: desk.hidden }, theme: o.t, look: normalizeLook(o.k) };
  } catch { return null; }
}

/** Black or white text on an accent, whichever reads better (WCAG relative luminance). */
export function accentInk(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#0a0c0f" : "#ffffff";
}
