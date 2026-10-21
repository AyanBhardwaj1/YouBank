import { form4Xml, parseForm4Doc, type Form4Line } from "./form4";
import { getSubmissions, listFilings } from "./submissions";

/** Form 4 insider transactions parsed from the XML primary documents (edgar/form4, shared with INSC). */
export type InsiderTx = { filed: string; owner: string; relationship: string; security: string; date: string; code: string; codeLabel: string; shares: number | null; price: number | null; owned: number | null; acquired: boolean; derivative: boolean; url: string };

const CODES: Record<string, string> = { P: "Open-market purchase", S: "Open-market sale", A: "Grant/award", M: "Option exercise", F: "Tax withholding", G: "Gift", D: "Disposition to issuer", C: "Conversion", J: "Other", X: "Exercise (in-the-money)", W: "Will/inheritance" };

export async function insiderTransactions(ticker: string, cik: string, limit = 12): Promise<InsiderTx[]> {
  const sub = await getSubmissions(cik);
  const filings = listFilings(sub, ["4"], limit).filter((f) => f.form === "4" || f.form === "4/A");
  const out: InsiderTx[] = [];
  await Promise.all(filings.map(async (f) => {
    try {
      // submissions points at the XSL-rendered HTML (xslF345X0n/name.xml); the raw XML sits beside it.
      const xml = await form4Xml(f.url.replace(/\/xsl[^/]*\//, "/"), f.accession);
      out.push(...parseInsiderXml(xml, f));
    } catch { /* skip unparseable */ }
  }));
  return out.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 60);
}

/** The transactions in one Form 4's XML, non-derivative then derivative. */
export function parseInsiderXml(xml: string, f: { filed: string; index: string }): InsiderTx[] {
  const d = parseForm4Doc(xml);
  const o = d.owner;
  const relationship = [o.isDirector ? "Director" : "", o.isOfficer ? o.title || "Officer" : "", o.isTenPct ? "10% owner" : ""].filter(Boolean).join(", ");
  const row = (l: Form4Line): InsiderTx => ({
    filed: f.filed, owner: o.name, relationship, security: l.security, date: l.tradeDate, code: l.code, codeLabel: CODES[l.code] ?? l.code,
    shares: l.shares, price: l.price, owned: l.ownedAfter, acquired: l.acquired, derivative: l.derivative, url: f.index,
  });
  return [...d.lines, ...d.derivativeLines].map(row);
}
