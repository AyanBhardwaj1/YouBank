/**
 * Links into Edge from elsewhere in the app (the Terminal, the Newsroom, emails) and what a Terminal
 * command asks Edge for. Pure, so the client can use them.
 */

const PLACES = new Set(["permian", "delaware", "midland", "waha"]);

/** The deal what-if, drawn for these companies (tickers or operators' names). */
export function whatIfUrl(parties: string[], place = "permian"): string {
  const clean = [...new Set(parties.map((p) => p.trim()).filter(Boolean))].slice(0, 4);
  return `/app/edge?view=whatif&parties=${encodeURIComponent(clean.join(","))}&place=${PLACES.has(place) ? place : "permian"}`;
}

/** Parties and place from a what-if link's query, or null when there are not two companies. */
export function whatIfFrom(parties: string, place: string): { parties: string[]; place: string } | null {
  const list = [...new Set(parties.split(",").map((p) => p.trim().slice(0, 60)).filter(Boolean))].slice(0, 4);
  return list.length >= 2 ? { parties: list, place: PLACES.has(place) ? place : "permian" } : null;
}

/** A company's change radar in Documents, and its network. */
export const radarUrl = (ticker: string, form: "10-K" | "10-Q" = "10-K") => `/app/edge?radar=${encodeURIComponent(ticker)}&form=${form}`;
export const networkUrl = (ticker: string) => `/app/edge?company=${encodeURIComponent(ticker)}`;

const REPLAYS: Record<string, string> = { "2008": "2008", "2020": "2020", "2022": "2022", "2014": "oil2014", "2015": "oil2014", "2016": "oil2014", "oil2014": "oil2014" };

/**
 * The scenario a Terminal SIM command runs: nothing after SIM is the base case for three months, a year
 * with a history replay (2008, 2020, 2022, oil 2014) replays it, and anything else is a written shock
 * ("oil -30%", "rates +150bp", or a sentence).
 */
export function simRequest(ticker: string, arg?: string): Record<string, unknown> {
  const text = (arg ?? "").trim();
  const base = { kind: "market", tickers: [ticker], horizon: 60, method: "auto" };
  if (!text) return { ...base, driver: "none" };
  const replay = REPLAYS[text.toLowerCase().replace(/\s+/g, "")];
  if (replay) return { ...base, driver: "replay", replay };
  return { ...base, driver: "shock", shockText: text.slice(0, 400) };
}
