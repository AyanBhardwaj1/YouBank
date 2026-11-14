/**
 * Interfaces: whole ways of laying out and drawing the signed-in app, chosen in Settings → Style and
 * nowhere else. A theme (src/lib/themes.ts) only recolours the same frame; an interface changes the frame
 * itself: where the navigation lives (top bar, a dock along the bottom, an index down the side, a masthead),
 * what a panel is (a ruled column, a bracketed instrument, a frosted pane, a ledger page, a drafting sheet,
 * a coloured tile), the type, the density and its own colours. "Classic" is the frame as it has always been,
 * with whichever of the fourteen themes the person picked.
 *
 * Applied as html[data-ui] (src/lib/desk/desk.ts lookAttrs), drawn by src/app/interfaces.css (scoped to the
 * signed-in frame, so the public pages never change) and src/components/workspace/InterfaceChrome.tsx (the
 * pieces some interfaces add: the dock, the index rail, the status strip, the edition line). Pure.
 */
import type { RoleId } from "@/lib/roles";

export const INTERFACES = ["classic", "broadsheet", "cockpit", "glass", "swiss", "ledger", "blueprint", "zen", "bento"] as const;
export type InterfaceId = (typeof INTERFACES)[number];
export const isInterface = (v: unknown): v is InterfaceId => typeof v === "string" && (INTERFACES as readonly string[]).includes(v);

/** Where the main navigation goes in an interface (on a phone every interface keeps the bottom tab bar). */
export type NavPlacement = "topbar" | "masthead" | "dock" | "rail" | "hidden";
/** Extra pieces of frame an interface draws around the page. */
export type Chrome = { nav: NavPlacement; statusStrip: false | "instrument" | "titleblock" | "folio"; editionLine: boolean; centered: boolean };

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
  /** Colours and type for the preview drawn in Settings (the real values live in interfaces.css). */
  preview: { bg: string; panel: string; fg: string; muted: string; accent: string; line: string; font: string; radius: number; pattern?: string };
};

const SERIF = "\"Iowan Old Style\", Charter, Georgia, serif";
const GROTESK = "\"Helvetica Neue\", Helvetica, Arial, sans-serif";
const MONO = "var(--font-geist-mono), ui-monospace, monospace";
const SANS = "var(--font-geist-sans), system-ui, sans-serif";

export const INTERFACE_META: Record<InterfaceId, InterfaceMeta> = {
  classic: {
    id: "classic", name: "Classic", tagline: "The dense top-bar workspace, in any of the fourteen colour styles.", suits: "Everyone; the default",
    roles: [], mode: "dark", chrome: { nav: "topbar", statusStrip: false, editionLine: false, centered: false },
    preview: { bg: "#0a0c0f", panel: "#101318", fg: "#d7dde6", muted: "#7d8794", accent: "#f5a623", line: "#242a33", font: SANS, radius: 4 },
  },
  broadsheet: {
    id: "broadsheet", name: "Broadsheet", tagline: "A financial paper: masthead, serif headlines, ruled columns and no boxes.", suits: "Analysts, consultants and readers who live in research",
    roles: ["consultant"], mode: "light", chrome: { nav: "masthead", statusStrip: false, editionLine: true, centered: false },
    preview: { bg: "#f4efe4", panel: "#f4efe4", fg: "#1b1a17", muted: "#6b655a", accent: "#9b1c1c", line: "#1b1a17", font: SERIF, radius: 0 },
  },
  cockpit: {
    id: "cockpit", name: "Cockpit", tagline: "An instrument panel: bracketed gauges, monospaced readouts and a live status strip.", suits: "Traders and PMs watching the tape",
    roles: ["markets"], mode: "dark", chrome: { nav: "topbar", statusStrip: "instrument", editionLine: false, centered: false },
    preview: { bg: "#04070a", panel: "#08111a", fg: "#cfe8ef", muted: "#5f8792", accent: "#22d3ee", line: "#12303a", font: MONO, radius: 0, pattern: "brackets" },
  },
  glass: {
    id: "glass", name: "Glass", tagline: "Frosted panes over colour, a floating bar and a dock along the bottom.", suits: "Founders, VCs and anyone presenting on a big screen",
    roles: ["vc"], mode: "dark", chrome: { nav: "dock", statusStrip: false, editionLine: false, centered: false },
    preview: { bg: "#140f2a", panel: "rgba(255,255,255,.10)", fg: "#f4f2ff", muted: "#b9b3d9", accent: "#7dd3fc", line: "rgba(255,255,255,.18)", font: SANS, radius: 14, pattern: "blobs" },
  },
  swiss: {
    id: "swiss", name: "Swiss", tagline: "International style: an index down the side, heavy rules, big type and one red.", suits: "People who want hierarchy at a glance",
    roles: ["pe"], mode: "light", chrome: { nav: "rail", statusStrip: false, editionLine: false, centered: false },
    preview: { bg: "#ffffff", panel: "#ffffff", fg: "#0a0a0a", muted: "#5c5c5c", accent: "#e3120b", line: "#0a0a0a", font: GROTESK, radius: 0 },
  },
  ledger: {
    id: "ledger", name: "Ledger", tagline: "A bound account book: ruled green paper, a red margin and figures in ink.", suits: "Accountants, bankers and anyone who reconciles",
    roles: ["accountant", "banker"], mode: "light", chrome: { nav: "topbar", statusStrip: "folio", editionLine: false, centered: false },
    preview: { bg: "#eef3e6", panel: "#f8fbf2", fg: "#1d3b2e", muted: "#5b7365", accent: "#a3262a", line: "#b9c9b0", font: SERIF, radius: 2, pattern: "ruled" },
  },
  blueprint: {
    id: "blueprint", name: "Blueprint", tagline: "A drafting sheet: grid paper, dashed construction lines and a title block.", suits: "Quants, modellers and corporate finance",
    roles: ["corpfin"], mode: "dark", chrome: { nav: "topbar", statusStrip: "titleblock", editionLine: false, centered: false },
    preview: { bg: "#0b3560", panel: "rgba(255,255,255,.04)", fg: "#e6f0ff", muted: "#9cb8dc", accent: "#ffd166", line: "rgba(230,240,255,.45)", font: MONO, radius: 0, pattern: "grid" },
  },
  zen: {
    id: "zen", name: "Zen", tagline: "One calm column, no chrome, everything a keystroke away (⌘K).", suits: "Long-term investors and anyone who wants to focus",
    roles: [], mode: "light", chrome: { nav: "hidden", statusStrip: false, editionLine: false, centered: true },
    preview: { bg: "#f6f4ef", panel: "#fbfaf7", fg: "#2e2c29", muted: "#8a857c", accent: "#5f8a6a", line: "#e8e3d9", font: SANS, radius: 14 },
  },
  bento: {
    id: "bento", name: "Bento", tagline: "Bold rounded tiles in colour, chunky type and a dock of big buttons.", suits: "Students and new investors",
    roles: ["student"], mode: "dark", chrome: { nav: "dock", statusStrip: false, editionLine: false, centered: false },
    preview: { bg: "#111014", panel: "#1c1a22", fg: "#f7f5fb", muted: "#a49fb3", accent: "#ff7a59", line: "#2c2934", font: SANS, radius: 18, pattern: "tiles" },
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
