/**
 * Which exchanges are trading now, and when that changes (Home's "World markets"). Regular sessions in
 * each exchange's own time zone, lunch breaks included, weekdays only; exchange holidays are not
 * counted, and the widget says so. Pure: `now` is passed in.
 */
export type Exchange = { id: string; name: string; city: string; tz: string; /** [open, close] in local minutes after midnight. */ sessions: [number, number][]; always?: boolean };

const hm = (h: number, m = 0) => h * 60 + m;

export const EXCHANGES: Exchange[] = [
  { id: "nyse", name: "NYSE · Nasdaq", city: "New York", tz: "America/New_York", sessions: [[hm(9, 30), hm(16)]] },
  { id: "tsx", name: "TSX", city: "Toronto", tz: "America/Toronto", sessions: [[hm(9, 30), hm(16)]] },
  { id: "lse", name: "LSE", city: "London", tz: "Europe/London", sessions: [[hm(8), hm(16, 30)]] },
  { id: "xetra", name: "Xetra", city: "Frankfurt", tz: "Europe/Berlin", sessions: [[hm(9), hm(17, 30)]] },
  { id: "euronext", name: "Euronext", city: "Paris", tz: "Europe/Paris", sessions: [[hm(9), hm(17, 30)]] },
  { id: "six", name: "SIX", city: "Zurich", tz: "Europe/Zurich", sessions: [[hm(9), hm(17, 30)]] },
  { id: "nse", name: "NSE", city: "Mumbai", tz: "Asia/Kolkata", sessions: [[hm(9, 15), hm(15, 30)]] },
  { id: "sse", name: "SSE", city: "Shanghai", tz: "Asia/Shanghai", sessions: [[hm(9, 30), hm(11, 30)], [hm(13), hm(15)]] },
  { id: "hkex", name: "HKEX", city: "Hong Kong", tz: "Asia/Hong_Kong", sessions: [[hm(9, 30), hm(12)], [hm(13), hm(16)]] },
  { id: "tse", name: "TSE", city: "Tokyo", tz: "Asia/Tokyo", sessions: [[hm(9), hm(11, 30)], [hm(12, 30), hm(15, 30)]] },
  { id: "asx", name: "ASX", city: "Sydney", tz: "Australia/Sydney", sessions: [[hm(10), hm(16)]] },
  { id: "crypto", name: "Crypto", city: "Everywhere", tz: "UTC", sessions: [], always: true },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const formatters = new Map<string, Intl.DateTimeFormat>();
const fmt = (tz: string) => {
  let f = formatters.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); formatters.set(tz, f); }
  return f;
};

/** Minutes since Monday 00:00 in the exchange's own time zone. */
export function localMinuteOfWeek(tz: string, now: Date): number {
  const parts = fmt(tz).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = DAYS.indexOf(get("weekday"));
  return Math.max(0, day) * 1440 + Number(get("hour")) * 60 + Number(get("minute"));
}

export type MarketState = "open" | "lunch" | "closed";
export type MarketStatus = { state: MarketState; /** When it next opens or closes; null when it never does (crypto). */ next: Date | null; nextIs: "opens" | "closes" | null };

/**
 * The exchange's state at `now` and its next change. Works in local minutes of the week, so a session
 * that crosses a weekend is handled; a daylight-saving change between now and the next change can move
 * that time by the hour the clocks move.
 */
export function marketStatus(ex: Exchange, now: Date): MarketStatus {
  if (ex.always) return { state: "open", next: null, nextIs: null };
  const t = localMinuteOfWeek(ex.tz, now);
  // Every open and close in the week, weekdays only, as [minute of week, opens?].
  const edges: [number, boolean][] = [];
  for (let d = 0; d < 5; d++) for (const [o, c] of ex.sessions) edges.push([d * 1440 + o, true], [d * 1440 + c, false]);
  const day = Math.floor(t / 1440), mins = t % 1440;
  const inSession = day < 5 && ex.sessions.some(([o, c]) => mins >= o && mins < c);
  const betweenSessions = day < 5 && !inSession && ex.sessions.length > 1 && mins >= ex.sessions[0][0] && mins < ex.sessions[ex.sessions.length - 1][1];
  const upcoming = edges.find(([m]) => m > t) ?? [edges[0][0] + 7 * 1440, true];
  const secs = now.getUTCSeconds();
  const next = new Date(now.getTime() + ((upcoming[0] - t) * 60 - secs) * 1000);
  return { state: inSession ? "open" : betweenSessions ? "lunch" : "closed", next, nextIs: upcoming[1] ? "opens" : "closes" };
}

/** "2h 05m", "12m", "3d 4h" from now until `then`. */
export function until(then: Date, now: Date): string {
  const m = Math.max(0, Math.round((then.getTime() - now.getTime()) / 60000));
  if (m < 60) return `${m}m`;
  if (m < 48 * 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}
