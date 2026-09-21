import { HOUR, edgarJson } from "./client";

export type Submissions = {
  cik: string;
  name: string;
  sic: string;
  sicDescription: string;
  fiscalYearEnd: string; // MMDD
  tickers: string[];
  exchanges: string[];
  addresses?: { business?: { city?: string; stateOrCountry?: string } };
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
      items?: string[];
    };
  };
};

export function submissionsUrl(cik: string) {
  return `https://data.sec.gov/submissions/CIK${cik}.json`;
}

export function getSubmissions(cik: string): Promise<Submissions> {
  return edgarJson<Submissions>(submissionsUrl(cik), `submissions-${cik}.json`, 6 * HOUR);
}

export function filingUrl(cik: string, accession: string, primaryDoc: string) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${primaryDoc}`;
}

const KEEP_FORMS = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "DEF 14A", "S-1", "424B4", "20-F", "6-K", "SC 13D", "SC 13D/A", "S-4", "DEFM14A", "8-K/A"]);

export function recentFilings(s: Submissions, limit = 14) {
  const r = s.filings.recent;
  const out: { form: string; filed: string; period: string; title: string; url: string }[] = [];
  for (let i = 0; i < r.form.length && out.length < limit; i++) {
    if (!KEEP_FORMS.has(r.form[i])) continue;
    out.push({
      form: r.form[i],
      filed: r.filingDate[i],
      period: r.reportDate[i] ?? "",
      title: r.primaryDocDescription[i] || r.form[i],
      url: filingUrl(s.cik.padStart(10, "0"), r.accessionNumber[i], r.primaryDocument[i]),
    });
  }
  return out;
}

/** Any recent filings, optionally filtered by form prefix, with 8-K item codes and the filing index folder. */
export function listFilings(s: Submissions, forms: string[] = [], limit = 25) {
  const r = s.filings.recent;
  const want = forms.map((f) => f.toUpperCase());
  const out: { form: string; filed: string; period: string; items: string; title: string; url: string; index: string; accession: string }[] = [];
  for (let i = 0; i < r.form.length && out.length < limit; i++) {
    const form = r.form[i];
    if (want.length && !want.some((w) => form === w || form.startsWith(w))) continue;
    const cik = s.cik.padStart(10, "0");
    out.push({
      form, filed: r.filingDate[i], period: r.reportDate[i] ?? "", items: r.items?.[i] ?? "", title: r.primaryDocDescription[i] || form, accession: r.accessionNumber[i],
      url: filingUrl(cik, r.accessionNumber[i], r.primaryDocument[i]),
      index: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${r.accessionNumber[i].replace(/-/g, "")}/`,
    });
  }
  return out;
}

export function fyeLabel(mmdd: string): string {
  if (!/^\d{4}$/.test(mmdd)) return mmdd;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(mmdd.slice(0, 2)) - 1]} ${Number(mmdd.slice(2))}`;
}
