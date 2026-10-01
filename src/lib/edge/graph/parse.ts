/**
 * Reading EDGAR for the relationship graph: names made comparable, insider filings (Form 4), 5%
 * ownership filings (Schedule 13D/13G, old text and new XML), filing headers, Exhibit 21 subsidiary
 * lists, and the 10-K paragraphs that name major customers. Pure, for tests.
 */

const LEGAL = /\b(incorporated|inc|corporation|corp|company|co|llc|l l c|lp|l p|limited|ltd|plc|n v|nv|s a|sa|ag|the|s de r l|de c v|s a de c v|s a b de c v)\b/g;

/** A company or fund name made comparable: accents, punctuation, "&" and legal suffixes set aside. */
export function normName(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(LEGAL, " ").replace(/\s+/g, " ").trim();
}

const SMALL = new Set(["of", "and", "the", "de", "la", "for", "in"]);
/** "ENERGY TRANSFER LP" into "Energy Transfer LP"; short all-capital tokens (LP, LLC, II) stay capital. */
export function titleCase(s: string): string {
  return s.toLowerCase().split(/(\s+|-)/).map((w, i) => {
    if (/^(lp|llc|l\.?p\.?|l\.l\.c\.|ii|iii|iv|usa|us|nv|plc|ag|sa|gp|mlp|ngl|lng)$/i.test(w)) return w.toUpperCase();
    if (i > 0 && SMALL.has(w)) return w;
    return w.replace(/^(mc|mac)?([a-z])/, (_, p: string | undefined, c: string) => (p ? p[0].toUpperCase() + p.slice(1) : "") + c.toUpperCase());
  }).join("");
}

/** A Form 4 owner name ("WARREN KELCY L", last name first) as people write it ("Kelcy L. Warren"). */
export function personName(raw: string): string {
  const parts = raw.replace(/[,.]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return titleCase(raw.trim());
  const suffix = /^(jr|sr|ii|iii|iv)$/i.test(parts[parts.length - 1]) ? parts.pop()! : "";
  const [last, ...given] = parts;
  const g = given.map((x) => (x.length === 1 ? `${x.toUpperCase()}.` : titleCase(x)));
  return [...g, titleCase(last), suffix ? (/^(jr|sr)$/i.test(suffix) ? `${titleCase(suffix)}.` : suffix.toUpperCase()) : ""].filter(Boolean).join(" ");
}

const tag = (x: string, t: string) => { const m = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, "i").exec(x); return m ? m[1].trim() : ""; };
/** Text from XML with its character entities decoded (a Form 4 title reads "EVP &amp; CFO"). Pure. */
export const xmlText = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e: string) => {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  if (named[e.toLowerCase()]) return named[e.toLowerCase()];
  const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
});
const val = (x: string, t: string) => { const inner = tag(x, t); return /<value>/i.test(inner) ? tag(inner, "value") : inner; };
const yes = (s: string) => s === "1" || /^true$/i.test(s);
const num = (s: string) => { const n = Number(s.replace(/[,$\s]/g, "")); return s.trim() === "" || !Number.isFinite(n) ? null : n; };

export type Form4Owner = { cik: string; name: string; director: boolean; officer: boolean; title: string; tenPct: boolean };
export type Form4Tx = { date: string; code: string; shares: number | null; price: number | null; acquired: boolean; owned: number | null; derivative: boolean };
export type Form4 = { issuerCik: string; issuerName: string; ticker: string; owners: Form4Owner[]; txns: Form4Tx[] };

/** An insider filing: who (with their roles at the issuer) and what they bought or sold. */
export function parseForm4(xml: string): Form4 | null {
  const issuer = tag(xml, "issuer");
  if (!issuer) return null;
  const owners: Form4Owner[] = [...xml.matchAll(/<reportingOwner>([\s\S]*?)<\/reportingOwner>/gi)].map((m) => {
    const id = tag(m[1], "reportingOwnerId"), rel = tag(m[1], "reportingOwnerRelationship");
    return { cik: tag(id, "rptOwnerCik").replace(/^0+/, ""), name: tag(id, "rptOwnerName"), director: yes(tag(rel, "isDirector")), officer: yes(tag(rel, "isOfficer")), title: xmlText(tag(rel, "officerTitle")), tenPct: yes(tag(rel, "isTenPercentOwner")) };
  }).filter((o) => o.cik && o.name);
  const txns: Form4Tx[] = [];
  for (const [block, derivative] of [["nonDerivativeTransaction", false], ["derivativeTransaction", true]] as const) {
    for (const m of xml.matchAll(new RegExp(`<${block}>([\\s\\S]*?)</${block}>`, "gi"))) {
      const t = m[1];
      txns.push({
        date: val(t, "transactionDate").slice(0, 10), code: tag(tag(t, "transactionCoding"), "transactionCode"),
        shares: num(val(t, "transactionShares")), price: num(val(t, "transactionPricePerShare")),
        acquired: val(t, "transactionAcquiredDisposedCode").toUpperCase() === "A", owned: num(val(t, "sharesOwnedFollowingTransaction")), derivative,
      });
    }
  }
  return { issuerCik: tag(issuer, "issuerCik").replace(/^0+/, ""), issuerName: tag(issuer, "issuerName"), ticker: tag(issuer, "issuerTradingSymbol").toUpperCase(), owners, txns };
}

export type Party = { name: string; cik: string; sic: string; state: string };
export type Header = { type: string; filed: string; subject: Party | null; filers: Party[]; members: string[] };

/** A filing's SGML header: its form, date, subject company and who filed it. */
export function parseHeader(sgml: string): Header {
  const field = (block: string, name: string) => (new RegExp(`<${name}>([^\\n<]*)`).exec(block)?.[1] ?? "").trim();
  const party = (block: string): Party => ({ name: field(block, "CONFORMED-NAME"), cik: field(block, "CIK").replace(/^0+/, ""), sic: field(block, "ASSIGNED-SIC"), state: field(tag(block, "BUSINESS-ADDRESS"), "STATE") });
  const subj = /<SUBJECT-COMPANY>([\s\S]*?)<\/SUBJECT-COMPANY>/.exec(sgml)?.[1];
  const filers = [...sgml.matchAll(/<FILED-BY>([\s\S]*?)<\/FILED-BY>/g)].map((m) => party(m[1]));
  const d = field(sgml, "FILING-DATE");
  return {
    type: field(sgml, "TYPE"), filed: d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "",
    subject: subj ? party(subj) : null, filers, members: [...sgml.matchAll(/<GROUP-MEMBERS>([^\n<]*)/g)].map((m) => m[1].trim()),
  };
}

/**
 * The share of the class a Schedule 13D/13G reports, and whether the holder has dropped to 5% or less
 * (their last filing on the company). The new XML form states both; the old text form says "Percent of
 * class represented by amount in row (9): 7.2%".
 */
export function holdingPercent(doc: string): { percent: number | null; exited: boolean } {
  const xmlPct = [...doc.matchAll(/<classPercent>\s*([\d.]+)\s*<\/classPercent>/gi)].map((m) => Number(m[1])).filter(Number.isFinite);
  const five = /<classOwnership5PercentOrLess>\s*Y/i.test(doc);
  if (xmlPct.length) { const p = Math.max(...xmlPct); return { percent: p, exited: five || p < 5 }; }
  const text = doc.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  const m = /percent\s+of\s+(?:the\s+)?class\s+represented\s+by\s+amount\s+in\s+row\s*\(?\s*(?:9|11)\s*\)?\s*:?\s*([\d.]+)\s*%/i.exec(text)
    ?? /percent\s+of\s+(?:the\s+)?class[^%]{0,120}?(\d{1,3}(?:\.\d+)?)\s*%/i.exec(text);
  const percent = m ? Number(m[1]) : null;
  return { percent: percent !== null && Number.isFinite(percent) && percent <= 100 ? percent : null, exited: five || /5(?:\.0)?\s*%\s*or\s*less|ceased\s+to\s+be\s+the\s+beneficial\s+owner\s+of\s+more\s+than\s+five/i.test(text) || (percent !== null && percent < 5) };
}

/** The address of Exhibit 21 (subsidiaries) in a 10-K's filing index page. */
export function exhibit21Href(indexHtml: string): string | null {
  for (const row of indexHtml.replace(/\n/g, " ").match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length >= 4 && /^\s*EX-21/i.test(cells[3].replace(/<[^>]+>/g, "").trim())) {
      const href = /href="([^"]+)"/i.exec(cells[2])?.[1];
      if (href) return href.replace(/^\/ix\?doc=/, "");
    }
  }
  return null;
}

const decode = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/&amp;/gi, "&").replace(/&#8217;|&rsquo;/gi, "’").replace(/&#[0-9]+;/g, " ").replace(/\s+/g, " ").trim();
const HEADER_CELL = /^(name|entity|subsidiar|jurisdiction|state|country|place|organi[sz]ed|incorporat|percent|ownership|%)/i;

/** The subsidiaries an Exhibit 21 lists, with their jurisdictions, from its table (or its lines when it has none). */
export function parseExhibit21(html: string, max = 600): { name: string; jurisdiction: string }[] {
  const out: { name: string; jurisdiction: string }[] = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  if (rows.length >= 3) {
    for (const r of rows) {
      const cells = [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => decode(m[1])).filter((c) => c && c !== "*");
      if (!cells.length || HEADER_CELL.test(cells[0]) || cells[0].length < 3 || cells[0].length > 160) continue;
      out.push({ name: cells[0].replace(/\s*\(\d+\)$/, ""), jurisdiction: cells.slice(1).find((c) => /[a-z]/i.test(c) && c.length < 60) ?? "" });
      if (out.length >= max) break;
    }
  } else {
    // Lines survive the tag stripping as pilcrows (plain whitespace would be collapsed).
    const text = html.replace(/<\/(p|div|li)>|<br\s*\/?>/gi, " ¶ ").replace(/\n/g, " ¶ ");
    for (const line of decode(text).split("¶").map((l) => l.trim())) {
      if (line.length < 4 || line.length > 200 || HEADER_CELL.test(line) || /^exhibit|^list of/i.test(line)) continue;
      const m = /^(.*?)(?:\s*[,(–-]\s*|\s{2,})\(?([A-Z][A-Za-z .]+?)\)?$/.exec(line);
      out.push(m && m[1].length > 2 ? { name: m[1].trim(), jurisdiction: m[2].trim() } : { name: line, jurisdiction: "" });
      if (out.length >= max) break;
    }
  }
  const seen = new Set<string>();
  return out.filter((s) => { const k = normName(s.name); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

/** Paragraphs of a 10-K that name customers or suppliers and their share of revenue: what the extractor reads. */
export function relationParagraphs(text: string, max = 8): string[] {
  const paras = text.split(/\n{2,}|\n(?=[A-Z])/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 60 && p.length < 3000);
  const scored = paras.map((p) => {
    let s = 0;
    if (/\b(customers?|purchasers?|offtakers?|shippers?)\b/i.test(p)) s += 2;
    if (/\b(suppliers?|vendors?|sole source|single source)\b/i.test(p)) s += 2;
    if (/\b\d{1,2}(\.\d+)?\s?%|\bpercent\b/i.test(p)) s += 2;
    if (/\b(revenues?|sales|purchases)\b/i.test(p)) s += 1;
    if (/\b(accounted for|represented|comprised)\b/i.test(p)) s += 2;
    if (/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s(?:Inc|Corporation|LLC|L\.P\.|LP|Company|Co)\b/.test(p)) s += 1;
    return { p, s };
  });
  return scored.filter((x) => x.s >= 6).sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.p);
}

/** The 8-K items that make a filing worth reading for the graph or a red flag. */
export const ITEM_MEANING: Record<string, string> = {
  "1.01": "a material agreement", "1.02": "the end of a material agreement", "1.03": "bankruptcy or receivership", "2.01": "a completed acquisition or disposition",
  "2.06": "a material impairment", "3.01": "a delisting notice", "4.01": "a change of auditor", "4.02": "financial statements that can no longer be relied on",
  "5.01": "a change in control", "5.02": "a director or officer departing or being appointed",
};

/** A name from deal text that is a vehicle or a description, not a company ("MLP Acquiror", "a subsidiary of EQT"). Pure. */
export function isDealVehicle(name: string): boolean {
  return /\b(acquir(o|e)r|merger\s*sub(sidiary)?|merger\s*co|holdco|sub\s*(inc|llc|corp)|subsidiar(y|ies)\s+of)\b/i.test(name) || /^(a|an|the|certain|its|our)\s+[a-z]/.test(name.trim());
}
