/**
 * The starter list of well-known 13F filers. Pure data, safe on the client.
 *
 * CIKs are SEC's identifiers for the filing entity, which is not always the brand: Druckenmiller files
 * as Duquesne Family Office, Pabrai as Dalal Street, Icahn in his own name. `match` is a word the
 * filer's EDGAR name must contain: ingestion checks it against SEC's submissions record and refuses to
 * show a filer under the wrong name, so a mistyped CIK fails loudly rather than misleading anyone.
 *
 * A 13F lists US-listed long positions (and listed options) only: no shorts, no cash, no bonds other
 * than convertibles, no non-US listings, no private holdings. Managers like Bridgewater and Renaissance
 * file thousands of lines that look nothing like their funds; they are here because people search for
 * them, and the fund page says so.
 */
export type CuratedFund = { cik: string; name: string; manager: string; style: string; match: string; note?: string };

export const CURATED: CuratedFund[] = [
  { cik: "0001067983", name: "Berkshire Hathaway", manager: "Warren Buffett, Greg Abel", style: "Concentrated value", match: "berkshire" },
  { cik: "0001336528", name: "Pershing Square", manager: "Bill Ackman", style: "Activist, concentrated", match: "pershing" },
  { cik: "0001656456", name: "Appaloosa", manager: "David Tepper", style: "Macro-aware equity", match: "appaloosa" },
  { cik: "0001061768", name: "Baupost Group", manager: "Seth Klarman", style: "Deep value", match: "baupost", note: "Much of Baupost's book is private and credit, which a 13F does not show." },
  { cik: "0001079114", name: "Greenlight Capital", manager: "David Einhorn", style: "Value, long/short", match: "greenlight", note: "Greenlight runs large shorts, which a 13F does not show." },
  { cik: "0001040273", name: "Third Point", manager: "Dan Loeb", style: "Event-driven, activist", match: "third point" },
  { cik: "0001649339", name: "Scion Asset Management", manager: "Michael Burry", style: "Contrarian", match: "scion", note: "Scion often holds large put options, which are listed but never cloned." },
  { cik: "0001061165", name: "Lone Pine Capital", manager: "Stephen Mandel's successors", style: "Growth, long/short", match: "lone pine" },
  { cik: "0001167483", name: "Tiger Global Management", manager: "Chase Coleman", style: "Growth, technology", match: "tiger global" },
  { cik: "0001536411", name: "Duquesne Family Office", manager: "Stanley Druckenmiller", style: "Macro, concentrated equity", match: "duquesne" },
  { cik: "0001029160", name: "Soros Fund Management", manager: "Soros family office", style: "Macro, multi-strategy", match: "soros" },
  { cik: "0001709323", name: "Himalaya Capital", manager: "Li Lu", style: "Concentrated value", match: "himalaya" },
  { cik: "0001549575", name: "Dalal Street (Pabrai)", manager: "Mohnish Pabrai", style: "Concentrated value", match: "dalal" },
  { cik: "0001112520", name: "Akre Capital Management", manager: "Akre team", style: "Quality compounders", match: "akre" },
  { cik: "0000921669", name: "Carl Icahn", manager: "Carl Icahn", style: "Activist", match: "icahn" },
  { cik: "0001135730", name: "Coatue Management", manager: "Philippe Laffont", style: "Growth, technology", match: "coatue" },
  { cik: "0001103804", name: "Viking Global Investors", manager: "Andreas Halvorsen", style: "Long/short equity", match: "viking" },
  { cik: "0001418814", name: "ValueAct", manager: "ValueAct team", style: "Activist", match: "valueact" },
  { cik: "0001345471", name: "Trian Fund Management", manager: "Nelson Peltz", style: "Activist", match: "trian" },
  { cik: "0001517137", name: "Starboard Value", manager: "Jeff Smith", style: "Activist", match: "starboard" },
  { cik: "0001747057", name: "D1 Capital Partners", manager: "Dan Sundheim", style: "Long/short equity", match: "d1 capital" },
  { cik: "0001569205", name: "Fundsmith", manager: "Terry Smith", style: "Quality compounders", match: "fundsmith" },
  { cik: "0001720792", name: "Ruane, Cunniff & Goldfarb", manager: "Sequoia Fund team", style: "Value", match: "ruane" },
  { cik: "0001166559", name: "Gates Foundation Trust", manager: "Gates Foundation", style: "Endowment", match: "gates" },
  { cik: "0001350694", name: "Bridgewater Associates", manager: "Bridgewater", style: "Systematic macro", match: "bridgewater", note: "Bridgewater's 13F is mostly index-like holdings; its macro book is futures and bonds, which a 13F does not show." },
  { cik: "0001037389", name: "Renaissance Technologies", manager: "Renaissance", style: "Quantitative", match: "renaissance", note: "A quarterly snapshot of a fast quantitative book says little about how it trades." },
];

const BY_CIK = new Map(CURATED.map((f) => [f.cik, f]));
export const curatedByCik = (cik: string) => BY_CIK.get(padCik(cik));

/** A CIK as SEC writes it in file names: ten digits. Null when it is not a number. */
export function padCik(v: string | number): string {
  const s = String(v).trim().replace(/^CIK/i, "");
  return /^\d{1,10}$/.test(s) ? s.padStart(10, "0") : "";
}

/** Whether a filer's EDGAR name fits the curated entry (the guard against a mistyped CIK). */
export const nameFits = (f: CuratedFund, edgarName: string) => edgarName.toLowerCase().includes(f.match);

/** Sector labels for display. */
export const SECTOR_LABEL: Record<string, string> = { tech: "Technology", healthcare: "Healthcare", energy: "Energy and utilities", financials: "Financials", consumer: "Consumer", industrials: "Industrials and materials", media: "Media and telecom", realestate: "Real estate", other: "Other" };
