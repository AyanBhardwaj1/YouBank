/**
 * One Form 4 reader for the app: INS (edgar/insiders.ts) and INSC's ingestion (quant/insiders) both
 * parse the XML primary document here and fetch it through one cache key per filing, so a document is
 * downloaded and read once, the same way, whichever screen asks first. Parsing is pure.
 *
 * Values are read with or without the <value> wrapper filers use inconsistently; a field that is
 * missing reads as null (never 0); the acquired/disposed code (A/D) is kept on every line.
 */
import { DAY, edgarText } from "./client";

export type Owner = { cik: string; name: string; isDirector: boolean; isOfficer: boolean; isTenPct: boolean; title: string };
export type Form4Line = {
  line: number; code: string; acquired: boolean; shares: number | null; price: number | null; ownedAfter: number | null;
  tradeDate: string; security: string; direct: boolean; derivative: boolean;
};
export type Form4Doc = {
  form: string; issuerCik: string; issuerName: string; symbol: string; period: string; owner: Owner; owners: Owner[]; plan10b51: boolean;
  /** Non-derivative lines (stock bought, sold, granted…). */
  lines: Form4Line[];
  /** Derivative lines (options exercised, granted…). */
  derivativeLines: Form4Line[];
};

const FORM4_TTL_MS = 90 * DAY;

const tag = (x: string, t: string) => new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(x)?.[1]?.trim() ?? "";
/** A field's text whether or not it is wrapped in <value>, with footnote references removed. */
const val = (x: string, t: string) => { const inner = tag(x, t); const v = tag(inner, "value"); return (v || inner).replace(/<[^>]+>/g, "").trim(); };
const yes = (s: string) => s === "1" || /^true$/i.test(s) || /^y/i.test(s);
const num = (s: string) => { const n = Number(s.replace(/,/g, "")); return s !== "" && Number.isFinite(n) ? n : null; };

function ownerOf(block: string): Owner {
  const id = tag(block, "reportingOwnerId"), rel = tag(block, "reportingOwnerRelationship");
  return { cik: tag(id, "rptOwnerCik").replace(/^0+/, ""), name: tag(id, "rptOwnerName"), isDirector: yes(tag(rel, "isDirector")), isOfficer: yes(tag(rel, "isOfficer")), isTenPct: yes(tag(rel, "isTenPercentOwner")), title: tag(rel, "officerTitle") };
}

function linesOf(xml: string, block: "nonDerivativeTransaction" | "derivativeTransaction"): Form4Line[] {
  return [...xml.matchAll(new RegExp(`<${block}>([\\s\\S]*?)</${block}>`, "g"))].map((m, i) => {
    const t = m[1];
    return {
      line: i + 1, code: tag(tag(t, "transactionCoding"), "transactionCode") || val(t, "transactionCode"), acquired: val(t, "transactionAcquiredDisposedCode") !== "D",
      shares: num(val(t, "transactionShares")), price: num(val(t, "transactionPricePerShare")), ownedAfter: num(val(t, "sharesOwnedFollowingTransaction")),
      tradeDate: val(t, "transactionDate").slice(0, 10), security: val(t, "securityTitle"), direct: val(t, "directOrIndirectOwnership") !== "I", derivative: block === "derivativeTransaction",
    };
  });
}

/** A Form 4 (or 4/A) XML primary document. Throws when it has no reporting owner (not a Form 4). */
export function parseForm4Doc(xml: string): Form4Doc {
  const owners = [...xml.matchAll(/<reportingOwner>([\s\S]*?)<\/reportingOwner>/g)].map((m) => ownerOf(m[1]));
  if (!owners.length) throw new Error("Not a Form 4: no reporting owner");
  const issuer = tag(xml, "issuer");
  const footnotes = [...xml.matchAll(/<footnote[^>]*>([\s\S]*?)<\/footnote>/g)].map((m) => m[1]).join(" ");
  return {
    form: tag(xml, "documentType") || "4", issuerCik: tag(issuer, "issuerCik").replace(/^0+/, ""), issuerName: tag(issuer, "issuerName"),
    symbol: tag(issuer, "issuerTradingSymbol").toUpperCase(), period: tag(xml, "periodOfReport"), owner: owners[0], owners,
    plan10b51: yes(tag(xml, "aff10b5One")) || /10b5-1/i.test(footnotes), lines: linesOf(xml, "nonDerivativeTransaction"), derivativeLines: linesOf(xml, "derivativeTransaction"),
  };
}

/** The one cache key for a filing's Form 4 XML. */
export const form4CacheKey = (accession: string) => `form4-${accession}.json`;

/** A Form 4's XML from sec.gov (throttled, cached under the filing's one key). */
export const form4Xml = (url: string, accession: string): Promise<string> => edgarText(url, form4CacheKey(accession), FORM4_TTL_MS);
