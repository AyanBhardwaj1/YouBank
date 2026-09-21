import { DAY, edgarText } from "./client";
import { getSubmissions, listFilings } from "./submissions";

/** Form 4 insider transactions parsed from the XML primary documents. */
export type InsiderTx = { filed: string; owner: string; relationship: string; security: string; date: string; code: string; codeLabel: string; shares: number | null; price: number | null; owned: number | null; derivative: boolean; url: string };

const CODES: Record<string, string> = { P: "Open-market purchase", S: "Open-market sale", A: "Grant/award", M: "Option exercise", F: "Tax withholding", G: "Gift", D: "Disposition to issuer", C: "Conversion", J: "Other", X: "Exercise (in-the-money)", W: "Will/inheritance" };
const tag = (x: string, t: string) => { const m = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(x); return m ? m[1].trim() : ""; };
const val = (x: string, t: string) => tag(tag(x, t), "value");
const num = (s: string) => (s === "" ? null : Number(s.replace(/,/g, "")));

export async function insiderTransactions(ticker: string, cik: string, limit = 12): Promise<InsiderTx[]> {
  const sub = await getSubmissions(cik);
  const filings = listFilings(sub, ["4"], limit).filter((f) => f.form === "4" || f.form === "4/A");
  const out: InsiderTx[] = [];
  await Promise.all(filings.map(async (f) => {
    try {
      // submissions points at the XSL-rendered HTML (xslF345X0n/name.xml); the raw XML sits beside it.
      const rawUrl = f.url.replace(/\/xsl[^/]*\//, "/");
      const xml = await edgarText(rawUrl, `form4raw-${f.accession}.json`, 90 * DAY);
      const owner = tag(tag(xml, "reportingOwnerId"), "rptOwnerName");
      const rel = tag(xml, "reportingOwnerRelationship");
      const relationship = [tag(rel, "isDirector") === "1" || tag(rel, "isDirector") === "true" ? "Director" : "", tag(rel, "isOfficer") === "1" || tag(rel, "isOfficer") === "true" ? tag(rel, "officerTitle") || "Officer" : "", tag(rel, "isTenPercentOwner") === "1" || tag(rel, "isTenPercentOwner") === "true" ? "10% owner" : ""].filter(Boolean).join(", ");
      for (const [block, derivative] of [["nonDerivativeTransaction", false], ["derivativeTransaction", true]] as const) {
        for (const m of xml.matchAll(new RegExp(`<${block}>([\\s\\S]*?)</${block}>`, "g"))) {
          const t = m[1];
          const code = val(t, "transactionCode") || tag(tag(t, "transactionCoding"), "transactionCode");
          out.push({ filed: f.filed, owner, relationship, security: val(t, "securityTitle"), date: val(t, "transactionDate"), code, codeLabel: CODES[code] ?? code, shares: num(val(t, "transactionShares")), price: num(val(t, "transactionPricePerShare")), owned: num(val(t, "sharesOwnedFollowingTransaction")), derivative, url: f.index });
        }
      }
    } catch { /* skip unparseable */ }
  }));
  return out.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 60);
}
