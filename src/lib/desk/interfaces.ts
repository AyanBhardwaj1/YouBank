/**
 * Interfaces: whole ways of laying out and drawing the signed-in app, chosen in Settings → Style and
 * nowhere else. A theme (src/lib/themes.ts) only recolours the same frame; an interface changes the frame
 * itself, so switching one feels like opening a different app over the same data:
 * - where the navigation lives (a top bar, a line of text, a glowing orb, a composer, a tool rail, a
 *   masthead, an OS menu bar, an index, thumb tabs on a book, drawing-sheet tabs, nowhere, a dock);
 * - how Home is composed (a plain document, a cinematic reel, a conversation, a canvas, a front page,
 *   an instrument cluster, a desktop of windows, a poster, a book spread, a drawing sheet, one calm
 *   column, a bento box), from the same widgets and the same data;
 * - its motion language (how pages arrive, how things enter, how they answer the pointer);
 * - its type, density and colours, and one signature detail.
 * "Classic" is the frame as it has always been, with whichever of the fourteen themes the person picked.
 *
 * Applied as html[data-ui] (src/lib/desk/desk.ts lookAttrs), drawn by src/app/interfaces/*.css (scoped to
 * the signed-in frame, so the public pages never change), src/components/workspace/InterfaceChrome.tsx
 * (the navigation and furniture each one adds) and src/components/workspace/interfaces/homes (Home). Pure.
 */
import type { RoleId } from "@/lib/roles";

export const INTERFACES = ["classic", "bare", "spectacle", "prompt", "canvas", "broadsheet", "cockpit", "glass", "swiss", "ledger", "blueprint", "zen", "bento"] as const;
export type InterfaceId = (typeof INTERFACES)[number];
export const isInterface = (v: unknown): v is InterfaceId => typeof v === "string" && (INTERFACES as readonly string[]).includes(v);

/**
 * Where the main navigation goes on a desktop (on a phone every interface keeps the bottom tab bar, drawn
 * in its own style):
 * topbar: the pinned features in a bar along the top; textline: one line of plain numbered links;
 * orb: a floating orb that blooms into the features; command: a composer along the bottom that goes
 * anywhere or asks; toolbar: a floating tool rail beside a canvas; masthead: a newspaper nameplate with
 * its sections below; menubar: an OS menu bar over windowed pages; rail: a numbered index down the side;
 * thumbtabs: coloured tabs cut into the edge of a book; sheets: drawing-sheet tabs along the bottom;
 * hidden: nothing (⌘K and the menu); dock: big buttons floating along the bottom.
 */
export type NavPlacement = "topbar" | "textline" | "orb" | "command" | "toolbar" | "masthead" | "menubar" | "rail" | "thumbtabs" | "sheets" | "hidden" | "dock";
/** How Home is composed from the person's widgets (src/components/workspace/interfaces/homes). */
export type HomeComposition = "desk" | "document" | "cinema" | "thread" | "canvas" | "frontpage" | "instruments" | "desktop" | "poster" | "spread" | "drawing" | "calm" | "bento";
/** How pages arrive and things move (src/components/workspace/interfaces/RouteMotion.tsx and the CSS). */
export type MotionLanguage = "classic" | "none" | "cinematic" | "conversational" | "spatial" | "ink" | "boot" | "window" | "cut" | "pageturn" | "draft" | "breath" | "bounce";
/** Extra pieces of frame an interface draws around the page. */
export type Chrome = {
  nav: NavPlacement;
  /** A dock of big buttons along the bottom (as well as, or instead of, the main navigation). */
  dock: boolean;
  statusStrip: false | "instrument" | "titleblock" | "folio";
  editionLine: boolean;
  /** The page sits in one centred column. */
  centered: boolean;
  /** The page itself is drawn as something: an OS window, a bound book, a drawing sheet. */
  frame: "none" | "window" | "book" | "sheet";
};

export type InterfaceMeta = {
  id: InterfaceId;
  name: string;
  /** One line on what it is like to use. */
  tagline: string;
  /** Who it is made for. */
  suits: string;
  /** The roles it is suggested to first. */
  roles: RoleId[];
  mode: "light" | "dark";
  chrome: Chrome;
  home: HomeComposition;
  motion: MotionLanguage;
  /** Its one memorable detail. */
  signature: string;
  /** Colours and type for the miniature drawn in Settings (the real values live in the CSS). */
  preview: { bg: string; panel: string; fg: string; muted: string; accent: string; line: string; font: string; radius: number };
};

const SERIF = "var(--font-newsreader), \"Iowan Old Style\", Charter, Georgia, serif";
const GROTESK = "var(--font-inter-tight), \"Helvetica Neue\", Helvetica, Arial, sans-serif";
const MONO = "var(--font-geist-mono), ui-monospace, monospace";
const SANS = "var(--font-geist-sans), system-ui, sans-serif";
const SYSTEM = "system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif";
const DISPLAY = "var(--font-unbounded), var(--font-geist-sans), sans-serif";
const SPACE = "var(--font-space-grotesk), var(--font-geist-sans), sans-serif";

const c = (nav: NavPlacement, more: Partial<Chrome> = {}): Chrome => ({ nav, dock: false, statusStrip: false, editionLine: false, centered: false, frame: "none", ...more });

export const INTERFACE_META: Record<InterfaceId, InterfaceMeta> = {
  classic: {
    id: "classic", name: "Classic", tagline: "The dense top-bar workspace, in any of the fourteen colour styles.", suits: "Everyone; the default",
    roles: [], mode: "dark", chrome: c("topbar"), home: "desk", motion: "classic", signature: "The sliding highlight under the active tab",
    preview: { bg: "#0a0c0f", panel: "#101318", fg: "#d7dde6", muted: "#7d8794", accent: "#f5a623", line: "#242a33", font: SANS, radius: 4 },
  },
  bare: {
    id: "bare", name: "Bare", tagline: "Text and links on a white page. No boxes, no icons, no motion; numbers to jump.", suits: "Keyboard people and anyone who wants nothing in the way",
    roles: [], mode: "light", chrome: c("textline", { centered: true }), home: "document", motion: "none", signature: "Press 1–9 to jump, / to search: every link wears its key",
    preview: { bg: "#ffffff", panel: "#ffffff", fg: "#111111", muted: "#555555", accent: "#0000ee", line: "#dddddd", font: SYSTEM, radius: 0 },
  },
  spectacle: {
    id: "spectacle", name: "Spectacle", tagline: "An aurora behind everything, a glowing orb for a menu, cards that tilt toward you.", suits: "Demos, pitches and anyone who wants the app to feel like an event",
    roles: [], mode: "dark", chrome: c("orb"), home: "cinema", motion: "cinematic", signature: "The orb: it leans toward the pointer and blooms into your features",
    preview: { bg: "#07051a", panel: "rgba(255,255,255,.07)", fg: "#ffffff", muted: "#c9c3f0", accent: "#c4b5fd", line: "rgba(255,255,255,.16)", font: DISPLAY, radius: 18 },
  },
  prompt: {
    id: "prompt", name: "Prompt", tagline: "No menus: one composer at the bottom goes anywhere or asks, and Home talks to you.", suits: "People who would rather type than click",
    roles: [], mode: "dark", chrome: c("command", { centered: true }), home: "thread", motion: "conversational", signature: "Type a page's name and Enter goes there; anything else is asked",
    preview: { bg: "#0d0d0c", panel: "#171716", fg: "#ecebe6", muted: "#9c9a92", accent: "#e8b974", line: "#2a2927", font: SANS, radius: 16 },
  },
  canvas: {
    id: "canvas", name: "Canvas", tagline: "Home is a board you pan and zoom, with a tool rail and a minimap.", suits: "Visual thinkers who lay their work out in space",
    roles: [], mode: "light", chrome: c("toolbar"), home: "canvas", motion: "spatial", signature: "Drag the board (or use the arrows) and the minimap follows",
    preview: { bg: "#f3f3f1", panel: "#ffffff", fg: "#18181b", muted: "#5f5f66", accent: "#5b5bf0", line: "#dcdcd8", font: SPACE, radius: 12 },
  },
  broadsheet: {
    id: "broadsheet", name: "Broadsheet", tagline: "A financial paper: a nameplate, sections, serif headlines, ruled columns.", suits: "Analysts, consultants and readers who live in research",
    roles: ["consultant"], mode: "light", chrome: c("masthead", { editionLine: true }), home: "frontpage", motion: "ink", signature: "The front page: a banner headline, a drop cap and columns with rules",
    preview: { bg: "#f4efe4", panel: "#f4efe4", fg: "#1b1a17", muted: "#5d574c", accent: "#9b1c1c", line: "#1b1a17", font: SERIF, radius: 0 },
  },
  cockpit: {
    id: "cockpit", name: "Cockpit", tagline: "A heads-up display: a radar of your names, bracketed gauges, a live status strip.", suits: "Traders and PMs watching the tape",
    roles: ["markets"], mode: "dark", chrome: c("topbar", { statusStrip: "instrument" }), home: "instruments", motion: "boot", signature: "A radar sweep with a blip for each name, placed by how far it moved",
    preview: { bg: "#04070a", panel: "#08111a", fg: "#d3eaf1", muted: "#78a1ad", accent: "#22d3ee", line: "#133340", font: MONO, radius: 0 },
  },
  glass: {
    id: "glass", name: "Glass", tagline: "A desktop: a menu bar, every page in a frosted window, a dock that magnifies.", suits: "Founders, VCs and anyone presenting on a big screen",
    roles: ["vc"], mode: "dark", chrome: c("menubar", { dock: true, frame: "window" }), home: "desktop", motion: "window", signature: "The dock swells under the pointer, like a Mac's",
    preview: { bg: "#120d26", panel: "rgba(255,255,255,.10)", fg: "#f5f3ff", muted: "#c3bde0", accent: "#7dd3fc", line: "rgba(255,255,255,.18)", font: SANS, radius: 12 },
  },
  swiss: {
    id: "swiss", name: "Swiss", tagline: "International style: a numbered index, a poster for a Home, heavy rules and one red.", suits: "People who want hierarchy at a glance",
    roles: ["pe"], mode: "light", chrome: c("rail"), home: "poster", motion: "cut", signature: "The date set as a giant numeral, cut by a red rule",
    preview: { bg: "#ffffff", panel: "#ffffff", fg: "#0a0a0a", muted: "#525252", accent: "#e3120b", line: "#0a0a0a", font: GROTESK, radius: 0 },
  },
  ledger: {
    id: "ledger", name: "Ledger", tagline: "A bound account book open on the desk: two ruled pages and thumb tabs to turn to.", suits: "Accountants, bankers and anyone who reconciles",
    roles: ["accountant", "banker"], mode: "light", chrome: c("thumbtabs", { statusStrip: "folio", frame: "book" }), home: "spread", motion: "pageturn", signature: "Pages turn when you go somewhere, and the tabs are cut into the book",
    preview: { bg: "#3b2a1e", panel: "#f8fbf2", fg: "#1b3a2c", muted: "#4c6858", accent: "#a3262a", line: "#bccbb2", font: SERIF, radius: 2 },
  },
  blueprint: {
    id: "blueprint", name: "Blueprint", tagline: "A drafting sheet: grid paper, a zoned border, details called out, sheets as tabs.", suits: "Quants, modellers and corporate finance",
    roles: ["corpfin"], mode: "dark", chrome: c("sheets", { statusStrip: "titleblock", frame: "sheet" }), home: "drawing", motion: "draft", signature: "Crosshair coordinates follow the pointer; details draw themselves in",
    preview: { bg: "#0b3560", panel: "rgba(255,255,255,.04)", fg: "#e8f1ff", muted: "#aac4e6", accent: "#ffd166", line: "rgba(230,240,255,.45)", font: MONO, radius: 0 },
  },
  zen: {
    id: "zen", name: "Zen", tagline: "One calm column and nothing else; the rest is a keystroke away (⌘K).", suits: "Long-term investors and anyone who wants to focus",
    roles: [], mode: "light", chrome: c("hidden", { centered: true }), home: "calm", motion: "breath", signature: "A circle that breathes slowly while you read",
    preview: { bg: "#f6f4ef", panel: "#fcfbf8", fg: "#2e2c29", muted: "#6b665d", accent: "#4f7a5a", line: "#e6e1d6", font: SERIF, radius: 14 },
  },
  bento: {
    id: "bento", name: "Bento", tagline: "A box of bold coloured tiles in every size, chunky type and a dock of big buttons.", suits: "Students and new investors",
    roles: ["student"], mode: "dark", chrome: c("dock", { dock: true }), home: "bento", motion: "bounce", signature: "Tiles squish when pressed and bounce back",
    preview: { bg: "#111014", panel: "#1c1a22", fg: "#f7f5fb", muted: "#aba5b9", accent: "#ff7a59", line: "#2c2934", font: SANS, radius: 18 },
  },
};

/** The interfaces in the order Settings shows them: the one suggested for this role first after Classic. Pure. */
export function interfacesFor(role: RoleId): InterfaceMeta[] {
  const all = INTERFACES.map((id) => INTERFACE_META[id]);
  const suggested = all.filter((m) => m.roles.includes(role));
  return [all[0], ...suggested, ...all.slice(1).filter((m) => !suggested.includes(m))];
}

/** The interface suggested for a role, if one is made for it. Pure. */
export const suggestedInterface = (role: RoleId): InterfaceId | null => INTERFACES.find((id) => INTERFACE_META[id].roles.includes(role)) ?? null;

/** The frame pieces for an interface. Pure. */
export const chromeOf = (id: InterfaceId): Chrome => INTERFACE_META[id].chrome;

/** How Home is composed in an interface. Pure. */
export const homeOf = (id: InterfaceId): HomeComposition => INTERFACE_META[id].home;

/** Whether the pinned features stay in the top bar (otherwise the interface draws its own navigation). Pure. */
export const pinsInTopBar = (id: InterfaceId): boolean => ["topbar", "textline", "masthead", "menubar"].includes(chromeOf(id).nav);

/**
 * The page names an interface's composer (Prompt) can go to from what was typed: the feature whose name
 * or id starts with it, then the one that contains it. Null when nothing matches, so the text is asked. Pure.
 */
export function matchFeature<T extends { id: string; label: string }>(q: string, features: T[]): T | null {
  const s = q.trim().toLowerCase().replace(/^\/|^go( to)? /, "").trim();
  if (s.length < 2) return null;
  return features.find((f) => f.label.toLowerCase() === s || f.id === s)
    ?? features.find((f) => f.label.toLowerCase().startsWith(s) || f.id.startsWith(s))
    ?? (s.length >= 3 ? features.find((f) => f.label.toLowerCase().includes(s)) ?? null : null);
}
