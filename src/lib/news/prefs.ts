/**
 * How each person likes their Newsroom: the edition (a look paired with a layout), or, with the advanced
 * switch, any look with any layout; how a story opens; how much motion; when the morning brief comes
 * and where alerts go. Kept in profiles.extra.news, defaulted from the role.
 */
import type { Profile, RoleId } from "@/lib/roles";
import { SECTOR_KEYS, type SectorKey } from "./desks";

export type LookId = "terminal" | "editorial" | "brief" | "modern";
export type LayoutId = "wire" | "magazine" | "hybrid" | "dashboard";
export type EditionId = LookId;

export const EDITIONS: Record<EditionId, { label: string; look: LookId; layout: LayoutId; inspired: string; blurb: string }> = {
  terminal: { label: "Terminal", look: "terminal", layout: "wire", inspired: "Bloomberg Terminal", blurb: "Dense rows, monospaced numbers, colour only where it means something. Keyboard first." },
  editorial: { label: "Editorial", look: "editorial", layout: "magazine", inspired: "The Information, the FT", blurb: "Serif headlines, a lead story, room to read. Calm and considered." },
  brief: { label: "Brief", look: "brief", layout: "hybrid", inspired: "Axios, Morning Brew", blurb: "The morning brief up top, bold lead-ins, why it matters first, the wire alongside." },
  modern: { label: "Modern", look: "modern", layout: "dashboard", inspired: "Apple News, Linear", blurb: "Soft depth, crisp type, tiles you can scan: market watch, deals, calendar, stories." },
};
export const LOOKS: Record<LookId, string> = { terminal: "Terminal", editorial: "Editorial", brief: "Brief", modern: "Modern" };
export const LAYOUTS: Record<LayoutId, { label: string; blurb: string }> = {
  wire: { label: "Wire", blurb: "One fast, dense column of stories as they land." },
  magazine: { label: "Magazine", blurb: "A lead story, the next three, then sections." },
  hybrid: { label: "Hybrid", blurb: "The brief on top, story rails below, the wire beside." },
  dashboard: { label: "Dashboard", blurb: "Tiles: market watch, deals, calendar, stories, filings." },
};

export type Channel = "email" | "push" | "slack";
export type NewsPrefs = {
  edition: EditionId;
  /** When true, `look` and `layout` are chosen separately; otherwise they follow the edition. */
  advanced: boolean;
  look: LookId;
  layout: LayoutId;
  reading: "peek" | "page";
  motion: "rich" | "subtle" | "off";
  /** A desk to read other than your own (a banker covering a second group). Empty means your own. */
  desk: string;
  /** The sector radar to show ("tech", "energy", ...). Empty means your desk's sector. */
  radar: SectorKey | "";
  brief: { enabled: boolean; time: string; timezone: string; channels: Channel[] };
  alerts: {
    enabled: boolean; watchlist: boolean; network: boolean; filings: boolean; bigDeals: boolean;
    /** 0 to 1: how important a desk story must be to alert on its own. */
    threshold: number; channels: Channel[]; quiet: { from: number; to: number } | null;
  };
  follows: { tickers: string[]; topics: string[] };
  mutes: { sources: string[]; topics: string[] };
  /** Slack incoming webhook, encrypted at rest (crm/crypto). Never sent back to the browser. */
  slack?: string;
};

const ROLE_EDITION: Record<RoleId, EditionId> = {
  banker: "brief", corpfin: "brief", accountant: "brief", markets: "terminal", vc: "editorial", consultant: "editorial", student: "editorial", pe: "modern",
};

export function defaultNewsPrefs(p: Pick<Profile, "role">): NewsPrefs {
  const edition = ROLE_EDITION[p.role] ?? "brief";
  return {
    edition, advanced: false, look: EDITIONS[edition].look, layout: EDITIONS[edition].layout, reading: "peek", motion: "rich", desk: "", radar: "",
    brief: { enabled: true, time: "07:00", timezone: "America/New_York", channels: [] },
    alerts: { enabled: true, watchlist: true, network: true, filings: true, bigDeals: true, threshold: 0.8, channels: [], quiet: { from: 22, to: 7 } },
    follows: { tickers: [], topics: [] },
    mutes: { sources: [], topics: [] },
  };
}

const isEdition = (x: unknown): x is EditionId => typeof x === "string" && x in EDITIONS;
const isLook = (x: unknown): x is LookId => typeof x === "string" && x in LOOKS;
const isLayout = (x: unknown): x is LayoutId => typeof x === "string" && x in LAYOUTS;
const channels = (x: unknown): Channel[] => (Array.isArray(x) ? [...new Set(x.filter((c): c is Channel => c === "email" || c === "push" || c === "slack"))] : []);
const strings = (x: unknown, max = 50): string[] => (Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean))].slice(0, max) : []);
const validTz = (tz: unknown): tz is string => { if (typeof tz !== "string" || !tz) return false; try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };

/** Fill and clean stored preferences against the role's defaults; anything malformed falls back. */
export function normalizeNewsPrefs(raw: unknown, p: Pick<Profile, "role">): NewsPrefs {
  const d = defaultNewsPrefs(p);
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const edition = isEdition(r.edition) ? r.edition : d.edition;
  const advanced = r.advanced === true;
  const b = (r.brief && typeof r.brief === "object" ? r.brief : {}) as Record<string, unknown>;
  const a = (r.alerts && typeof r.alerts === "object" ? r.alerts : {}) as Record<string, unknown>;
  const f = (r.follows && typeof r.follows === "object" ? r.follows : {}) as Record<string, unknown>;
  const m = (r.mutes && typeof r.mutes === "object" ? r.mutes : {}) as Record<string, unknown>;
  const q = a.quiet && typeof a.quiet === "object" ? (a.quiet as Record<string, unknown>) : null;
  const hour = (x: unknown, dflt: number) => (typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 23 ? x : dflt);
  return {
    edition, advanced,
    look: advanced && isLook(r.look) ? r.look : EDITIONS[edition].look,
    layout: advanced && isLayout(r.layout) ? r.layout : EDITIONS[edition].layout,
    reading: r.reading === "page" ? "page" : "peek",
    motion: r.motion === "subtle" || r.motion === "off" ? r.motion : "rich",
    desk: typeof r.desk === "string" ? r.desk.slice(0, 40) : "",
    radar: typeof r.radar === "string" && (SECTOR_KEYS as string[]).includes(r.radar) ? (r.radar as SectorKey) : "",
    brief: {
      enabled: b.enabled !== false,
      time: typeof b.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.time) ? b.time : d.brief.time,
      timezone: validTz(b.timezone) ? b.timezone : d.brief.timezone,
      channels: channels(b.channels),
    },
    alerts: {
      enabled: a.enabled !== false, watchlist: a.watchlist !== false, network: a.network !== false, filings: a.filings !== false, bigDeals: a.bigDeals !== false,
      threshold: typeof a.threshold === "number" && a.threshold >= 0.3 && a.threshold <= 1 ? a.threshold : d.alerts.threshold,
      channels: channels(a.channels),
      quiet: a.quiet === null ? null : q ? { from: hour(q.from, 22), to: hour(q.to, 7) } : d.alerts.quiet,
    },
    follows: { tickers: strings(f.tickers).map((t) => t.toUpperCase()).filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)), topics: strings(f.topics, 30) },
    mutes: { sources: strings(m.sources, 50), topics: strings(m.topics, 30) },
    ...(typeof r.slack === "string" && r.slack ? { slack: r.slack } : {}),
  };
}

/** What the browser may see: everything except the Slack secret, replaced by whether one is set. */
export function publicPrefs(p: NewsPrefs): Omit<NewsPrefs, "slack"> & { slackConnected: boolean } {
  const { slack, ...rest } = p;
  return { ...rest, slackConnected: !!slack };
}

/** Local wall-clock parts of `at` in a time zone. */
export function localParts(at: Date, timeZone: string): { date: string; hour: number; minute: number; weekday: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(at).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute), weekday };
}

/** Is it quiet hours for this person now? A window may wrap midnight (22 to 7). */
export function inQuietHours(at: Date, prefs: NewsPrefs): boolean {
  const q = prefs.alerts.quiet;
  if (!q || q.from === q.to) return false;
  const { hour } = localParts(at, prefs.brief.timezone);
  return q.from < q.to ? hour >= q.from && hour < q.to : hour >= q.from || hour < q.to;
}

/** Has this person's brief time passed today (in their zone), and on which local date? */
export function briefDue(at: Date, prefs: NewsPrefs): { due: boolean; date: string } {
  const { date, hour, minute } = localParts(at, prefs.brief.timezone);
  const [h, m] = prefs.brief.time.split(":").map(Number);
  return { due: hour * 60 + minute >= h * 60 + m, date };
}
