/**
 * The desk's calendar and market watch. Only dates that can be relied on: the weekly releases that
 * run on a fixed schedule (EIA's petroleum and natural gas reports, the rig count, jobless claims)
 * and the next earnings date for watchlist companies. Monthly releases move around, so they are left
 * to the stories themselves rather than guessed.
 */
import { historyFrom } from "@/lib/market/data";
import { backupEnabled, nasdaqEarningsDate } from "@/lib/market/nasdaq";
import type { Desk } from "./desks";

export type CalEvent = { at: string; label: string; kind: "data" | "earnings"; ticker?: string; estimated?: boolean };
export type WatchRow = { symbol: string; label: string; last: number | null; change: number | null; spark: number[]; via?: string };

/** UTC time of a wall-clock time in New York on a date (handles daylight saving). */
export function nyToUtc(date: string, hour: number, minute: number): Date {
  const guess = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  const off = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(guess).find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const h = Number(/GMT([+-]\d+)/.exec(off)?.[1] ?? -5);
  return new Date(guess.getTime() - h * 3_600_000);
}

const WEEKLY: { weekday: number; hour: number; minute: number; label: string; desks: (d: Desk) => boolean }[] = [
  { weekday: 3, hour: 10, minute: 30, label: "EIA weekly petroleum status report", desks: (d) => d.sectors.includes("energy") },
  { weekday: 4, hour: 10, minute: 30, label: "EIA natural gas storage report", desks: (d) => d.sectors.includes("energy") },
  { weekday: 5, hour: 13, minute: 0, label: "Baker Hughes rig count", desks: (d) => d.sectors.includes("energy") },
  { weekday: 4, hour: 8, minute: 30, label: "Weekly jobless claims", desks: (d) => d.lenses.some((l) => ["markets", "macro", "dcm", "credit", "event"].includes(l)) },
];

/** The recurring releases for a desk over the next `days` days. Pure, for tests. */
export function recurringEvents(desk: Desk, now: Date, days = 7): CalEvent[] {
  const out: CalEvent[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() + i * 86_400_000);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    for (const w of WEEKLY) {
      if (w.weekday !== weekday || !w.desks(desk)) continue;
      const at = nyToUtc(date, w.hour, w.minute);
      if (at.getTime() > now.getTime()) out.push({ at: at.toISOString(), label: w.label, kind: "data" });
    }
  }
  return out;
}

/** Next earnings dates for watchlist companies within `days` days (Nasdaq's calendar, cached six hours). */
export async function earningsEvents(tickers: string[], now: Date, days = 14): Promise<CalEvent[]> {
  if (!backupEnabled()) return [];
  const until = now.getTime() + days * 86_400_000;
  const rows = await Promise.all(tickers.slice(0, 10).map(async (t) => ({ t, d: await nasdaqEarningsDate(t).catch(() => null) })));
  return rows.filter((r) => r.d?.date && Date.parse(r.d.date) >= now.getTime() - 86_400_000 && Date.parse(r.d.date) <= until)
    .map((r) => ({ at: `${r.d!.date}T12:00:00.000Z`, label: `${r.t} reports earnings`, kind: "earnings" as const, ticker: r.t, estimated: r.d!.estimated }));
}

export async function calendarFor(desk: Desk, watch: string[], now = new Date()): Promise<CalEvent[]> {
  const [earn] = await Promise.all([earningsEvents(watch, now).catch(() => [])]);
  return [...recurringEvents(desk, now), ...earn].sort((a, b) => (a.at < b.at ? -1 : 1)).slice(0, 10);
}

/** Last close, the day's change and a 30-day line for each symbol on the desk's market watch. */
export async function marketWatch(items: { symbol: string; label: string }[]): Promise<WatchRow[]> {
  const from = new Date(Date.now() - 50 * 86_400_000).toISOString().slice(0, 10);
  return Promise.all(items.map(async ({ symbol, label }) => {
    const h = await historyFrom(symbol, from, true).catch(() => null);
    const c = (h?.data ?? []).map((b) => b.close);
    const last = c[c.length - 1] ?? null, prev = c[c.length - 2] ?? null;
    return { symbol, label, last, change: last && prev ? last / prev - 1 : null, spark: c.slice(-30), ...(h?.via ? { via: h.via } : {}) };
  }));
}
