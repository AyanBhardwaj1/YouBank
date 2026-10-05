/**
 * The app's features and the workflows inside them, for the top bar and the sidebar. Each person
 * chooses which features are pinned to the top bar, in what order, and whether it shows labels; the
 * sidebar holds everything. Kept in profiles.extra.nav, so it follows them across devices.
 */
import type { RoleId } from "./roles";

export type NavId = "home" | "terminal" | "news" | "tools" | "studio" | "edge" | "vc" | "crm" | "collab" | "library" | "team" | "settings";

/**
 * A workflow inside a feature. `event` switches the view in place when the feature's page is already
 * open (see src/lib/subnav.ts); otherwise the link opens the page on that view.
 */
export type NavLink = { label: string; href: string; hint?: string; event?: { path: string; value: string } };

/** `beta` features show only to people who turned them on (see NavOpts). */
export type NavFeature = { id: NavId; href: string; label: string; icon: string; blurb: string; roles?: RoleId[]; beta?: boolean; links?: NavLink[] };

const fn = (code: string, label: string): NavLink => ({ label, hint: code, href: `/app/terminal?fn=${code}`, event: { path: "/app/terminal", value: code } });
const tab = (path: string, param: string, value: string, label: string, isDefault = false): NavLink =>
  ({ label, href: isDefault ? path : `${path}?${param}=${value}`, event: { path, value } });

export const FEATURES: NavFeature[] = [
  { id: "home", href: "/app", label: "Home", icon: "Home", blurb: "Your brief, tools and watchlist" },
  {
    id: "terminal", href: "/app/terminal", label: "Terminal", icon: "Terminal", blurb: "Markets, comps, filings and news",
    links: [fn("TOP", "Top news"), fn("WEI", "World indices"), fn("ECO", "Economy"), fn("MA", "M&A"), fn("EQS", "Screener"), fn("GC", "Treasury curve")],
  },
  {
    id: "news", href: "/app/news", label: "Newsroom", icon: "Newspaper", blurb: "News for your desk, deals and filings",
    links: [tab("/app/news", "view", "today", "Today", true), tab("/app/news", "view", "deals", "Deals"), tab("/app/news", "view", "radar", "Radar"), tab("/app/news", "view", "saved", "Saved")],
  },
  { id: "tools", href: "/app/tools", label: "Tools", icon: "Wand2", blurb: "Calculators and AI workflows" },
  { id: "studio", href: "/app/studio", label: "Studio", icon: "FileSpreadsheet", blurb: "Models and decks the agent builds with you" },
  {
    id: "edge", href: "/app/edge", label: "Edge", icon: "Radar", blurb: "Alternative data: what satellites, networks and documents show", beta: true,
    links: [tab("/app/edge", "view", "feed", "Feed", true), tab("/app/edge", "view", "canvases", "Canvases"), tab("/app/edge", "view", "documents", "Documents"), tab("/app/edge", "view", "networks", "Networks"), tab("/app/edge", "view", "scenarios", "Scenarios"), tab("/app/edge", "view", "map", "Map"), tab("/app/edge", "view", "whatif", "Deal what-if")],
  },
  {
    id: "vc", href: "/app/vc", label: "Private markets", icon: "Rocket", blurb: "Startups and private raises", roles: ["vc", "pe"],
    links: [tab("/app/vc", "tab", "directory", "Startup directory", true), tab("/app/vc", "tab", "formd", "Private raises")],
  },
  {
    id: "crm", href: "/app/crm", label: "Relationships", icon: "Network", blurb: "Email, meetings, pipeline and follow-ups",
    links: [
      tab("/app/crm", "tab", "drafts", "Review queue", true), tab("/app/crm", "tab", "inbox", "Inbox"), tab("/app/crm", "tab", "pipeline", "Pipeline"),
      tab("/app/crm", "tab", "contacts", "Contacts"), tab("/app/crm", "tab", "meetings", "Meetings"), tab("/app/crm", "tab", "insights", "Insights"), tab("/app/crm", "tab", "campaigns", "Campaigns"),
      tab("/app/crm", "tab", "nurture", "Nurture"), tab("/app/crm", "tab", "agent", "Agent & autopilot"),
    ],
  },
  { id: "collab", href: "/app/collab", label: "Together", icon: "Users", blurb: "Work through a tool together, live" },
  { id: "library", href: "/app/library", label: "Library", icon: "Library", blurb: "Your saved work" },
  { id: "team", href: "/app/team", label: "Team", icon: "Building", blurb: "Members, roles and sharing" },
  {
    id: "settings", href: "/app/settings", label: "Settings", icon: "Settings", blurb: "Style, AI model, alerts and data",
    links: [
      tab("/app/settings", "tab", "style", "Style", true), tab("/app/settings", "tab", "ai", "AI model"), tab("/app/settings", "tab", "news", "News and alerts"),
      tab("/app/settings", "tab", "desk", "My desk"), tab("/app/settings", "tab", "data", "Data and privacy"), tab("/app/settings", "tab", "labs", "Labs"),
      tab("/app/settings", "tab", "desktop", "Desktop app"),
    ],
  },
];

/** Which beta features this person turned on. */
export type NavOpts = { edge?: boolean };

export const featuresFor = (role: RoleId, opts: NavOpts = {}) => FEATURES.filter((f) => (!f.roles || f.roles.includes(role)) && (!f.beta || (f.id === "edge" && opts.edge === true)));

export type NavLabels = "full" | "icons";
export type NavPrefs = {
  /** Features in the top bar, in order. Everything else is in the sidebar. */
  pinned: NavId[];
  labels: NavLabels;
  /** Keep the sidebar open beside the page instead of over it. */
  dock: boolean;
};

export function defaultPinned(role: RoleId): NavId[] {
  return ["home", "terminal", "news", "tools", "studio", ...(role === "vc" || role === "pe" ? (["vc"] as NavId[]) : []), "crm"];
}

export const defaultNavPrefs = (role: RoleId): NavPrefs => ({ pinned: defaultPinned(role), labels: "full", dock: false });

/** Stored preferences, cleaned: unknown, role-gated or switched-off beta features drop out; malformed values fall back. */
export function normalizeNavPrefs(raw: unknown, role: RoleId, opts: NavOpts = {}): NavPrefs {
  const d = defaultNavPrefs(role);
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const valid = new Set<string>(featuresFor(role, opts).map((f) => f.id));
  const pinned = Array.isArray(r.pinned) ? [...new Set(r.pinned.filter((x): x is NavId => typeof x === "string" && valid.has(x)))] : d.pinned;
  return { pinned, labels: r.labels === "icons" ? "icons" : "full", dock: r.dock === true };
}

/** The feature a path belongs to: the longest matching href ("/app" only for Home itself). */
export function featureOf(path: string, features: NavFeature[]): NavFeature | undefined {
  return features.filter((f) => (f.href === "/app" ? path === "/app" : path === f.href || path.startsWith(`${f.href}/`))).sort((a, b) => b.href.length - a.href.length)[0];
}
