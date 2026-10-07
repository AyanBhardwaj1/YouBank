"use client";

/**
 * Pieces every calendar component uses: the fetch helper (which tells the server the browser's zone),
 * the types the API returns, and time formatting on the person's own clock.
 */
import type { Meeting } from "@/lib/calendar/meetings";
import { ianaZone, utcToWall, wallDay, wallToUtc, UTC_ZONE, type Zone } from "@/lib/calendar/tz";

export type { Meeting };

export const browserTz = (): string => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
};

export async function calApi<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", "x-timezone": browserTz(), ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export type ProviderId = "google" | "microsoft" | "caldav" | "ics";
export type Account = { id: number; provider: ProviderId; address: string; displayName: string; status: string; lastError: string; lastSyncAt: string | null; host: string };
export type Cal = { id: number; accountId: number; name: string; color: string; timezone: string; canWrite: boolean; primary: boolean; visible: boolean; lastSyncedAt: string | null; push: boolean };
export type Prefs = { timezone: string; workHours: { start: string; end: string; days: number[] }; defaultCalendarId: number | null; defaultDuration: number; videoUrl: string; autoBrief: boolean; autoBriefLast: string };
export type Overview = {
  accounts: Account[]; calendars: Cal[]; prefs: Prefs;
  setup: Record<ProviderId, { ready: boolean; reason: string }>;
  presets: Record<string, { label: string; url: string; appPasswordUrl: string; note: string }>;
};

export const PROVIDER_LABEL: Record<ProviderId, string> = { google: "Google Calendar", microsoft: "Microsoft 365 / Outlook", caldav: "iCloud / CalDAV", ics: "Subscription link" };

/** Calendar colours when the provider gives none: distinct hues that read on light and dark themes. */
const PALETTE = ["#3987e5", "#c98500", "#2f9e6e", "#c2417a", "#7b61d1", "#d1583a", "#1f9bb0", "#8a8f2a"];

export function colorOf(c: { id: number; color: string }): string {
  return /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : PALETTE[c.id % PALETTE.length];
}

export function zoneFor(tz: string): Zone {
  return ianaZone(tz) ?? UTC_ZONE;
}

/** Midnight (as an instant) of the local day containing `ms`, and `days` later. */
export function dayStart(zone: Zone, ms: number, days = 0): number {
  return wallToUtc(zone, wallDay(utcToWall(zone, ms)) + days * 86_400_000);
}

/** Minutes past local midnight. */
export function minutesOfDay(zone: Zone, ms: number): number {
  const w = utcToWall(zone, ms);
  return Math.round((w - wallDay(w)) / 60_000);
}

export const fmt = {
  time: (ms: number, tz: string) => new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(ms),
  day: (ms: number, tz: string) => new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(ms),
  long: (ms: number, tz: string) => new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(ms),
  month: (ms: number, tz: string) => new Intl.DateTimeFormat(undefined, { timeZone: tz, month: "long", year: "numeric" }).format(ms),
  weekday: (ms: number, tz: string) => new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "short" }).format(ms),
  date: (ms: number, tz: string) => new Intl.DateTimeFormat(undefined, { timeZone: tz, day: "numeric" }).format(ms),
};

/** An all-day event's dates are UTC midnights; this is its YYYY-MM-DD. */
export const isoDay = (iso: string) => iso.slice(0, 10);

/** YYYY-MM-DD of an instant on the local clock. */
export function localIsoDay(zone: Zone, ms: number): string {
  return new Date(wallDay(utcToWall(zone, ms))).toISOString().slice(0, 10);
}

/** "in 12 min", "now", "2h ago": for the next-meeting line. */
export function relative(ms: number, now = Date.now()): string {
  const m = Math.round((ms - now) / 60_000);
  if (Math.abs(m) < 1) return "now";
  if (m > 0) return m < 60 ? `in ${m} min` : m < 48 * 60 ? `in ${Math.round(m / 60)}h` : `in ${Math.round(m / 1440)} days`;
  return -m < 60 ? `${-m} min ago` : -m < 48 * 60 ? `${Math.round(-m / 60)}h ago` : `${Math.round(-m / 1440)} days ago`;
}

export const btn = {
  primary: "ctl bg-fg px-2.5 py-1 text-[11.5px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-50",
  accent: "ctl bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-accent-fg transition hover:opacity-90 disabled:opacity-50",
  ghost: "ctl border border-line px-2.5 py-1 text-[11.5px] text-muted transition hover:border-accent/50 hover:text-fg disabled:opacity-50",
  link: "text-[11.5px] text-muted transition hover:text-fg disabled:opacity-50",
  danger: "text-[11.5px] text-muted transition hover:text-neg disabled:opacity-50",
};

export const input = "ctl border border-line bg-bg/60 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent/60";
