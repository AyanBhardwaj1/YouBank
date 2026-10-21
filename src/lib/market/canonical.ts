/**
 * The canonical shapes every market-data provider maps into, and the small conversions that get them
 * there. A provider adapter is a zod schema for the provider's answer plus a mapper into one of these
 * shapes; nothing downstream reads a provider's own field names or units.
 *
 * Conventions:
 * - percentages are fractions (0.0123 is 1.23%); convert with `pctToFraction` at the boundary;
 * - money is in units (dollars, not thousands or millions); `thousandsToUnits` for filings in thousands.
 *   (CompanyData keeps its documented USD-millions fields; it is a view built from these shapes);
 * - dates are ISO: `YYYY-MM-DD` for days, full ISO-8601 UTC instants for times (`epochToIso`, `nyLocalToIso`);
 * - market days are America/New_York trading days (see calendar.ts), never UTC dates;
 * - symbols are canonical (symbols.ts: `BRK.B`); each client converts to its provider's spelling.
 * Every value that came from a provider carries `Provenance`: who answered, the provider's own as-of time,
 * and whether it is delayed or stale. Pure and dependency-free, so the browser can import the types.
 */

/** Who supplied a value and how current it is. `asOf` is the provider's time for the value (trade time, period end), not when we fetched it. */
export type Provenance = { source: string; asOf: string | null; fetchedAt?: string; delayed?: boolean; stale?: boolean };

export type Quote = Provenance & {
  symbol: string; name: string; price: number; change: number | null; changePct: number | null; volume: number | null;
  previousClose: number | null; exchange: string;
};

/** One trading day's bar; `date` is the New York trading date. */
export type DailyBar = { date: string; open: number; high: number; low: number; close: number; volume: number };

/**
 * Price and description of a company. `marketCap` in dollars; null when the provider has none. `price` is
 * null from a source with no prices (SEC filings): the field-level fallthrough fills it, or says why not.
 */
export type Profile = Provenance & {
  symbol: string; name: string; price: number | null; change: number | null; changePct: number | null; marketCap: number | null;
  low52: number | null; high52: number | null; exchange: string; industry: string; sector: string; website: string; description: string;
  cik?: string; city?: string; state?: string;
};

/** One reported statement line for one period (XBRL fact), in units. Instants have no `start`. */
export type FinancialPeriod = { concept: string; start?: string; end: string; value: number; unit: string; form: string; filed: string; accn: string };

/** Consensus for one fiscal period (money in units, EPS per share). */
export type Estimate = { period: string; revenueAvg: number | null; revenueLow: number | null; revenueHigh: number | null; epsAvg: number | null; analysts: number | null };

export type Dividend = { exDate: string; amount: number; payDate: string | null; declared: string | null };

/** One point on a yield curve; `yield` is a fraction (0.0412 is 4.12%). */
export type CurvePoint = { date: string; tenor: string; years: number; yield: number };

export type MacroPoint = { series: string; date: string; value: number };

/** Units of `quote` per one `base` (EURUSD 1.08 is dollars per euro). */
export type FxRate = { base: string; quote: string; date: string; rate: number; source: string };

export type CryptoQuote = Provenance & { id: string; symbol: string; price: number; changePct: number | null; marketCap: number | null };

/* ---------------- Conversions ---------------- */

/** "$1,234.56", "+0.58%", "30,002,768", 12 -> number; "N/A", "--", "", NaN -> null. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/[$,%\s+]/g, "");
  if (!t || /^n\/?a$/i.test(t) || t === "--") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** A percent as a provider writes it (1.5, "+1.50%") to a fraction (0.015). Missing stays null. */
export function pctToFraction(v: unknown): number | null {
  const n = toNumber(v);
  return n === null ? null : Number((n / 100).toPrecision(12));
}

/** An amount reported in thousands to units. */
export const thousandsToUnits = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v * 1000 : null);

/** Unix time in seconds or milliseconds to an ISO instant; zero, negative or junk -> null. */
export function epochToIso(v: unknown): string | null {
  const n = toNumber(v);
  if (n === null || n <= 0) return null;
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
}

/** Minutes east of UTC in New York on a date (-240 in daylight saving time, -300 otherwise). */
function nyOffsetMinutes(date: string): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(`${date}T16:00:00Z`)).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute) - 16 * 60;
}

/** A New York wall-clock time ("16:00") on a date as an ISO instant (exchange-local time to UTC). */
export function nyLocalToIso(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.parse(`${date}T00:00:00Z`) + (h * 60 + m - nyOffsetMinutes(date)) * 60_000).toISOString();
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** "2026-09-25", "2026-09-25T…", "09/25/2026", "9/5/2026", "Aug 10, 2026" -> "YYYY-MM-DD"; anything else -> null. */
export function isoDay(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  return null;
}
