import { DAY, edgarText } from "@/lib/edgar/client";
import { parseFormD } from "../formd";
import type { NewStartup } from "../directory";

const US_STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR VI GU".split(" "));
const title = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").trim().replace(/\b\w/g, (c) => c.toUpperCase());
const FUND_NAME = /\b(fund|capital partners|co-?invest|investors? l\.?p|opportunit(y|ies)|ventures? (fund|partners)|feeder|spv|series [a-z0-9]+ (of|a series)|master l\.?p|holdings l\.?p|reit|trust)\b/i;

/** Operating companies that filed a new Form D on a given day (pooled investment funds excluded). */
export async function fetchFormDDay(date: Date): Promise<NewStartup[]> {
  const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1, d = date.getUTCDate();
  const ymd = `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
  const idxUrl = `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${Math.ceil(m / 3)}/form.${ymd}.idx`;
  let idx: string;
  try { idx = await edgarText(idxUrl, `formidx-${ymd}.json`, 30 * DAY); } catch { return []; } // weekends and holidays have no index
  const lines = idx.split("\n").filter((l) => /^D\s{2,}/.test(l));
  const out: NewStartup[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s{2,}/);
    const path = parts[parts.length - 1];
    const mm = /edgar\/data\/(\d+)\/(\d{10}-\d{2}-\d{6})\.txt/.exec(path);
    if (!mm) continue;
    const [, cik, acc] = mm;
    if (FUND_NAME.test(parts[1] ?? "")) continue;
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}/primary_doc.xml`;
    try {
      const f = parseFormD(await edgarText(docUrl, `formd-${acc}.json`, 30 * DAY));
      if (/pooled investment/i.test(f.industry) || f.exemptions.some((e) => /^3C/.test(e)) || FUND_NAME.test(f.issuer)) continue;
      const officers = f.persons.filter((p) => p.relationships.some((r) => /Executive|Director/i.test(r)) && p.name && !/LLC|L\.P\.|Inc\.?$|Corp/i.test(p.name)).map((p) => p.name);
      const raised = /^\$/.test(f.amountSold) ? Number(f.amountSold.replace(/[$M]/g, "")) * 1e6 : null;
      const country = US_STATES.has(f.state) ? "United States" : f.stateDesc ? title(f.stateDesc) : "";
      out.push({
        source: "formd", sourceId: acc, name: f.issuer, oneLiner: `${f.industry || "Private company"} · raised ${f.amountSold || "undisclosed"} in an exempt offering`, description: `Form D filed ${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6)}: ${f.entityType}${f.jurisdiction ? ` (${f.jurisdiction})` : ""}. Offering ${f.offeringTotal || "n/a"}, sold ${f.amountSold || "n/a"}, ${f.investorsSoFar || "?"} investors so far${f.dateOfFirstSale ? `, first sale ${f.dateOfFirstSale}` : ""}. Exemptions: ${f.exemptions.join(", ") || "n/a"}.`,
        website: "", url: docUrl, logo: "", program: "SEC Form D", status: "Raised", foundedYear: /^\d{4}$/.test(f.yearOfInc) ? Number(f.yearOfInc) : null, founders: officers.join(", "),
        location: [f.city ? title(f.city) : "", f.state].filter(Boolean).join(", "), country, industries: f.industry ? [f.industry] : [], tags: f.exemptions, teamSize: null, fundingStage: "Private placement (Reg D)",
        investors: [], raised: f.amountSold, raisedUsd: raised, isHiring: 0, sourceDate: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6)}`, data: { cik, phone: f.phone, address: f.issuerAddress, persons: f.persons, offeringTotal: f.offeringTotal, minimumInvestment: f.minimumInvestment },
      });
    } catch { /* skip unreadable filing */ }
  }
  return out;
}

export async function fetchFormDDays(days: number, endDate = new Date()): Promise<NewStartup[]> {
  const out: NewStartup[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(endDate); d.setUTCDate(d.getUTCDate() - i);
    out.push(...(await fetchFormDDay(d)));
  }
  return out;
}
