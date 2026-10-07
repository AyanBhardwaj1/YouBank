/**
 * CUSIP to ticker, the pure parts. A 13F names securities by CUSIP; brokers and price feeds want
 * tickers. The mapping is layered, most trusted first (see securities.ts for the order it runs in):
 * 1. a manual override (the owner's table, then the handful built in below);
 * 2. OpenFIGI, Bloomberg's free identifier service, asked for the US composite listing of the CUSIP;
 * 3. the issuer's name matched against SEC's company_tickers.json, only when exactly one listed company
 *    has that name and the share class is unambiguous.
 * SEC's quarterly Official List of Section 13(f) Securities says which CUSIPs are 13(f) securities, which
 * have listed options, and the issuer's name and class as SEC writes them, which the name match uses.
 */

/** The ninth character of a CUSIP from the first eight (the "modulus 10 double add double" rule). */
export function cusipCheckDigit(first8: string): number | null {
  if (!/^[0-9A-Z*@#]{8}$/.test(first8)) return null;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const c = first8[i];
    let v = /\d/.test(c) ? Number(c) : /[A-Z]/.test(c) ? c.charCodeAt(0) - 55 : c === "*" ? 36 : c === "@" ? 37 : 38;
    if (i % 2 === 1) v *= 2;
    sum += Math.floor(v / 10) + (v % 10);
  }
  return (10 - (sum % 10)) % 10;
}

export function validCusip(c: string): boolean {
  const s = c.trim().toUpperCase();
  return s.length === 9 && cusipCheckDigit(s.slice(0, 8)) === Number(s[8]);
}

/** A row of SEC's Official List of Section 13(f) Securities. */
export type ListedSecurity = { cusip: string; hasOptions: boolean; issuer: string; description: string; status: "" | "ADDED" | "DELETED" };

/**
 * SEC's 13(f) list as text. The layout is fixed-width in principle (CUSIP in columns 1-9 as
 * "XXXXXX XX X" with spaces, an asterisk when options are listed, then issuer name, description and
 * status), but the spacing drifts between editions, so this reads it by pattern rather than by column.
 */
export function parse13fList(text: string): ListedSecurity[] {
  const out: ListedSecurity[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*([0-9A-Z]{6})\s?([0-9A-Z]{2})\s?([0-9])\s*(\*)?\s+(.+?)\s*$/.exec(raw);
    if (!m) continue;
    const cusip = `${m[1]}${m[2]}${m[3]}`;
    if (!validCusip(cusip)) continue;
    let rest = m[5];
    let status: ListedSecurity["status"] = "";
    const st = /\s+(ADDED|DELETED)$/.exec(rest);
    if (st) { status = st[1] as "ADDED" | "DELETED"; rest = rest.slice(0, st.index); }
    const parts = rest.split(/\s{2,}/);
    const issuer = (parts[0] ?? "").trim();
    const description = parts.slice(1).join(" ").trim();
    out.push({ cusip, hasOptions: !!m[4], issuer, description, status });
  }
  return out;
}

/** The share class a 13F title names ("CL A", "CLASS B", "SHS CL C", "COM CL A"), or null. */
export function shareClassOf(title: string): string | null {
  const m = /\b(?:CL|CLASS|SER|SERIES)\.?\s*([A-F])\b/i.exec(title);
  return m ? m[1].toUpperCase() : null;
}

/** Whether a title is a common or ordinary share (as opposed to a note, warrant, right, unit or preferred). */
export function isCommonTitle(title: string): boolean {
  const t = title.toUpperCase();
  if (/\b(NOTE|NOTES|BOND|DEB|DBCV|WARRANT|WTS?|RIGHTS?|UNITS?|PFD|PREF|PREFERRED|CALL|PUT)\b/.test(t)) return false;
  return true;
}

/** A listed ticker for one company (from company_tickers.json). */
export type TickerRow = { cik: string; ticker: string; name: string };

/**
 * The ticker for a share class among a company's listings. SEC lists the primary class first, writes
 * classes as "BRK-B", and lists some classes (Alphabet's GOOG and GOOGL) without a class letter. With a
 * class named: the one listing that ends in that letter, else nothing (ambiguous). Without one: the
 * only listing, or the primary one when the title is plain common stock.
 */
export function tickerForClass(rows: TickerRow[], cls: string | null): string | null {
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0].ticker;
  if (cls) {
    const hit = rows.filter((r) => new RegExp(`[-./]${cls}$`).test(r.ticker));
    return hit.length === 1 ? hit[0].ticker : null;
  }
  return rows[0].ticker;
}

/* ---------------- OpenFIGI ---------------- */

export const OPENFIGI_URL = "https://api.openfigi.com/v3/mapping";
/** Jobs per request and requests per window: 100 and 25 per 6 s with a key, 10 and 25 per minute without. */
export const openFigiLimits = (hasKey: boolean) => (hasKey ? { jobs: 100, perWindow: 25, windowMs: 6_000 } : { jobs: 10, perWindow: 25, windowMs: 60_000 });

export const openFigiJobs = (cusips: string[]) => cusips.map((c) => ({ idType: "ID_CUSIP", idValue: c, exchCode: "US" }));

type FigiRow = { figi?: string; ticker?: string; name?: string; exchCode?: string; marketSector?: string; securityType?: string; securityType2?: string };

/** The US-listed equity ticker in one OpenFIGI answer ("BRK/B" written as SEC writes it, "BRK-B"), or null. */
export function pickFigi(answer: { data?: FigiRow[]; warning?: string; error?: string } | undefined): { ticker: string; figi: string; name: string; type: string } | null {
  const rows = (answer?.data ?? []).filter((r) => r.ticker && (!r.marketSector || r.marketSector === "Equity"));
  const us = rows.find((r) => r.exchCode === "US") ?? rows[0];
  if (!us?.ticker) return null;
  return { ticker: us.ticker.toUpperCase().replace(/[/ ]/g, "-"), figi: us.figi ?? "", name: us.name ?? "", type: us.securityType2 || us.securityType || "" };
}

/* ---------------- Built-in overrides ---------------- */

/**
 * CUSIPs whose tickers a name match cannot settle (several classes under one name) or that are common
 * enough to be worth fixing in code. The owner's own overrides (copy_cusip_overrides) win over these.
 */
export const BUILTIN_OVERRIDES: Record<string, string> = {
  "037833100": "AAPL", "594918104": "MSFT", "023135106": "AMZN", "02079K305": "GOOGL", "02079K107": "GOOG",
  "084670702": "BRK-B", "084670108": "BRK-A", "30303M102": "META", "67066G104": "NVDA", "191216100": "KO",
  "060505104": "BAC", "025816109": "AXP", "166764100": "CVX", "674599105": "OXY", "500754106": "KHC",
  "92826C839": "V", "57636Q104": "MA", "169656105": "CMG",
};

/** Tickers as brokers and quote services write them: SEC's "BRK-B" is "BRK.B" at most brokers. */
export const brokerTicker = (t: string) => t.replace(/-/g, ".");
