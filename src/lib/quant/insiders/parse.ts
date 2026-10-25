/**
 * Q7: reading insider and activist filings. Pure.
 *
 * - parseForm4: a Form 4 (or 4/A) XML primary document: issuer, the reporting owner and their roles, the
 *   Rule 10b5-1 checkbox (added to the form in 2023) or a footnote naming a 10b5-1 plan, and every
 *   non-derivative transaction line.
 * - parseCurrentFeed: EDGAR's latest-filings Atom feed (getcurrent), whose <updated> is the filing's
 *   acceptance time; each filing appears once per party, so entries are de-duplicated by accession.
 * - parseAcceptance: the ACCEPTANCE-DATETIME of a filing's .hdr.sgml (Eastern time).
 * - parseInsiderDataset: the SEC's quarterly Insider Transactions Data Sets (SUBMISSION, REPORTINGOWNER and
 *   NONDERIV_TRANS tab-separated files), field names as in the SEC's readme (prior knowledge; verify against a
 *   downloaded file). They carry the filing date, not the acceptance time.
 * Fixtures under scripts/fixtures/quant/insiders/ are constructed from these layouts (the sandbox could not reach
 * sec.gov) and labelled as such.
 */
import { parseForm4Doc, type Owner } from "@/lib/edgar/form4";
import { newYorkTime } from "../pit/calendar";

export type { Owner };
export type TxLine = { line: number; code: string; acquired: boolean; shares: number; price: number | null; ownedAfter: number | null; tradeDate: string; security: string; direct: boolean };
export type Form4 = { form: string; issuerCik: string; issuerName: string; symbol: string; period: string; owner: Owner; owners: Owner[]; plan10b51: boolean; lines: TxLine[] };

const tag = (x: string, t: string) => new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(x)?.[1]?.trim() ?? "";

/** A Form 4 as INSC stores it: the shared reader (edgar/form4), non-derivative lines, symbols as BRK-B. */
export function parseForm4(xml: string): Form4 {
  const d = parseForm4Doc(xml);
  return {
    form: d.form, issuerCik: d.issuerCik, issuerName: d.issuerName, symbol: d.symbol.replace(/\./g, "-"), period: d.period, owner: d.owner, owners: d.owners, plan10b51: d.plan10b51,
    lines: d.lines.map((l) => ({ line: l.line, code: l.code, acquired: l.acquired, shares: l.shares ?? 0, price: l.price, ownedAfter: l.ownedAfter, tradeDate: l.tradeDate, security: l.security, direct: l.direct })),
  };
}

export type FeedEntry = { accession: string; form: string; acceptedAt: string; indexUrl: string; cik: string; title: string };

export function parseCurrentFeed(atom: string): FeedEntry[] {
  const out = new Map<string, FeedEntry>();
  for (const m of atom.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const acc = /accession-number=([\d-]+)/.exec(tag(e, "id"))?.[1] ?? /AccNo:\s*([\d-]+)/.exec(tag(e, "summary"))?.[1];
    const href = /<link[^>]*href="([^"]+)"/.exec(e)?.[1] ?? "";
    const updated = tag(e, "updated");
    const form = /<category[^>]*term="([^"]+)"/.exec(e)?.[1] ?? tag(e, "title").split(" - ")[0];
    if (!acc || !updated || !Number.isFinite(Date.parse(updated))) continue;
    if (!out.has(acc)) out.set(acc, { accession: acc, form, acceptedAt: new Date(updated).toISOString(), indexUrl: href.replace(/&amp;/g, "&"), cik: /\/data\/(\d+)\//.exec(href)?.[1] ?? "", title: tag(e, "title") });
  }
  return [...out.values()];
}

/** ACCEPTANCE-DATETIME (YYYYMMDDhhmmss, Eastern) from a .hdr.sgml, as an ISO instant. */
export function parseAcceptance(sgml: string): string | null {
  const m = /<ACCEPTANCE-DATETIME>(\d{14})/.exec(sgml);
  if (!m) return null;
  const s = m[1];
  const date = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return new Date(Date.parse(newYorkTime(date, `${s.slice(8, 10)}:${s.slice(10, 12)}`)) + Number(s.slice(12, 14)) * 1000).toISOString();
}

/* ---------------- SEC Insider Transactions Data Sets ---------------- */

const tsv = (text: string) => {
  const [head, ...rows] = text.split(/\r?\n/).filter(Boolean);
  const cols = head.split("\t").map((c) => c.trim().toUpperCase());
  return rows.map((r) => { const v = r.split("\t"); return Object.fromEntries(cols.map((c, i) => [c, (v[i] ?? "").trim()])); });
};

const ddMon = (s: string) => {
  // The data sets write dates like 09-OCT-2026.
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/i.exec(s.trim());
  if (!m) return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
  const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(m[2].toUpperCase()) + 1;
  return mon ? `${m[3]}-${String(mon).padStart(2, "0")}-${m[1]}` : "";
};

export type DatasetTx = { accession: string; line: number; issuerCik: string; symbol: string; owner: Owner; filedOn: string; tradeDate: string; code: string; acquired: boolean; shares: number; price: number | null; ownedAfter: number | null; plan10b51: boolean; form: string };

export function parseInsiderDataset(files: { submission: string; reportingOwner: string; nonderivTrans: string }): DatasetTx[] {
  const subs = new Map(tsv(files.submission).map((r) => [r.ACCESSION_NUMBER, r]));
  const owners = new Map<string, Record<string, string>>();
  for (const r of tsv(files.reportingOwner)) if (!owners.has(r.ACCESSION_NUMBER)) owners.set(r.ACCESSION_NUMBER, r);
  const out: DatasetTx[] = [];
  const count = new Map<string, number>();
  for (const t of tsv(files.nonderivTrans)) {
    const s = subs.get(t.ACCESSION_NUMBER), o = owners.get(t.ACCESSION_NUMBER);
    if (!s || !o) continue;
    const rel = (o.RPTOWNER_RELATIONSHIP ?? "").toLowerCase();
    const k = (count.get(t.ACCESSION_NUMBER) ?? 0) + 1;
    count.set(t.ACCESSION_NUMBER, k);
    out.push({
      accession: t.ACCESSION_NUMBER, line: k, issuerCik: (s.ISSUERCIK ?? "").replace(/^0+/, ""), symbol: (s.ISSUERTRADINGSYMBOL ?? "").toUpperCase().replace(/\./g, "-"),
      owner: { cik: (o.RPTOWNERCIK ?? "").replace(/^0+/, ""), name: o.RPTOWNERNAME ?? "", isDirector: rel.includes("director"), isOfficer: rel.includes("officer"), isTenPct: rel.includes("tenpercentowner") || rel.includes("10%"), title: o.RPTOWNER_TITLE ?? "" },
      filedOn: ddMon(s.FILING_DATE ?? ""), tradeDate: ddMon(t.TRANS_DATE ?? ""), code: (t.TRANS_CODE ?? "").toUpperCase(), acquired: (t.TRANS_ACQUIRED_DISP_CD ?? "A").toUpperCase() !== "D",
      shares: Number(t.TRANS_SHARES) || 0, price: t.TRANS_PRICEPERSHARE ? Number(t.TRANS_PRICEPERSHARE) : null, ownedAfter: t.SHRS_OWND_FOLWNG_TRANS ? Number(t.SHRS_OWND_FOLWNG_TRANS) : null,
      plan10b51: /^(1|true|y)/i.test(s.AFF10B5ONE ?? ""), form: s.DOCUMENT_TYPE ?? "4",
    });
  }
  return out;
}
