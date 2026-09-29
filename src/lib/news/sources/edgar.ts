/**
 * Filing signals: EDGAR's latest-filings feed turned into stories, often before the press writes them
 * up. 8-Ks are kept for the items that matter (a merger agreement, a bankruptcy, a restatement, an
 * auditor change...), and IPO registrations, activist stakes, tender offers, going-private filings,
 * merger proxies, late-filing notices and Form D raises (and fund closes) come through by form.
 * SEC filings are public records: text and numbers can be used freely, with the link to EDGAR.
 */
import { XMLParser } from "fast-xml-parser";
import { cacheGet, cacheSet } from "@/lib/cache";
import { edgarFetch } from "@/lib/edgar/client";
import { getSubmissions } from "@/lib/edgar/submissions";
import { tickerMap } from "@/lib/edgar/tickers";
import { parseFormD } from "@/lib/vc/formd";
import { EIGHT_K_ITEMS, FILING_FORMS, sectorOfSic, type Tag } from "../desks";
import { stripHtml } from "../normalize";
import type { FetchResult, RawItem } from "../types";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text", parseTagValue: false, processEntities: true, htmlEntities: true });
const arr = <T,>(x: T | T[] | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

export type CurrentFiling = { form: string; company: string; cik: string; role: string; accession: string; url: string; filedAt: Date; items: string[] };

export const currentFeedUrl = (form: string, count = 100) =>
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&CIK=&type=${encodeURIComponent(form)}&company=&dateb=&owner=include&start=0&count=${count}&output=atom`;

/** Entries of EDGAR's latest-filings Atom feed. Pure, for tests. */
export function parseCurrentFeed(xml: string): CurrentFiling[] {
  const feed = (parser.parse(xml) as { feed?: { entry?: unknown } }).feed;
  const out: CurrentFiling[] = [];
  for (const e of arr(feed?.entry as Record<string, unknown>[])) {
    const title = typeof e.title === "string" ? e.title : String((e.title as Record<string, unknown>)?.["#text"] ?? "");
    const m = /^(.+?) - (.+) \((\d{10})\) \(([^)]+)\)\s*$/.exec(title.trim());
    if (!m) continue;
    const summary = stripHtml(typeof e.summary === "string" ? e.summary : String((e.summary as Record<string, unknown>)?.["#text"] ?? ""), 4000);
    const id = String(e.id ?? "");
    const accession = /accession-number=([\d-]+)/.exec(id)?.[1] ?? /AccNo:\s*([\d-]+)/.exec(summary)?.[1] ?? "";
    const link = arr(e.link as Record<string, string>[])[0]?.["@href"] ?? "";
    if (!accession) continue;
    out.push({
      form: m[1].trim(), company: m[2].trim(), cik: m[3], role: m[4].trim(), accession, url: link.startsWith("http") ? link : `https://www.sec.gov${link}`,
      filedAt: new Date(String(e.updated ?? Date.now())), items: [...new Set([...summary.matchAll(/Item (\d\.\d\d)/g)].map((x) => x[1]))],
    });
  }
  return out;
}

const SUFFIX: Record<string, string> = { INC: "Inc.", CORP: "Corp.", CO: "Co.", LTD: "Ltd.", LLC: "LLC", LP: "LP", PLC: "plc", NV: "N.V.", SA: "S.A.", AG: "AG", ETF: "ETF", REIT: "REIT", II: "II", III: "III", IV: "IV", USA: "USA", US: "US" };

/** "KIMBERLY CLARK CORP" as "Kimberly Clark Corp."; mixed-case names are left alone. */
export function prettyName(name: string): string {
  const n = name.replace(/\s*\/[A-Z]{2}\/?$/, "").replace(/\s+/g, " ").trim();
  if (/[a-z]/.test(n)) return n;
  return n.split(" ").map((w) => {
    const bare = w.replace(/[.,]/g, "");
    if (SUFFIX[bare]) return SUFFIX[bare];
    if (/^[A-Z]{2,4}$/.test(bare) && !/[AEIOU]/.test(bare)) return bare; // acronyms like "BGC" keep their case
    return w.charAt(0) + w.slice(1).toLowerCase();
  }).join(" ");
}

let cikTicker: Promise<Map<string, string>> | null = null;
/** CIK (10 digits) to its primary ticker, from SEC's ticker file. */
export function tickerForCik(): Promise<Map<string, string>> {
  if (!cikTicker) {
    cikTicker = tickerMap().then((m) => {
      const out = new Map<string, string>();
      for (const r of m.values()) { const prev = out.get(r.cik); if (!prev || r.ticker.length < prev.length) out.set(r.cik, r.ticker); }
      return out;
    });
    cikTicker.catch(() => { cikTicker = null; });
  }
  return cikTicker;
}

const HEADLINE: Record<string, (c: string, filer: string) => string> = {
  "S-1": (c) => `${c} files to go public`,
  "F-1": (c) => `${c} files for a U.S. IPO`,
  "424B4": (c) => `${c} prices its offering`,
  "SC 13D": (c, f) => (f && f !== c ? `${f} discloses a stake in ${c}` : `${c}: new 13D stake disclosed`),
  "SCHEDULE 13D": (c, f) => (f && f !== c ? `${f} discloses a stake in ${c}` : `${c}: new 13D stake disclosed`),
  "SC TO-T": (c, f) => (f && f !== c ? `${f} launches a tender offer for ${c}` : `Tender offer launched for ${c}`),
  "SC 13E3": (c) => `${c}: going-private transaction filed`,
  "DEFM14A": (c) => `${c} files its definitive merger proxy`,
  "PREM14A": (c) => `${c} files a preliminary merger proxy`,
  "S-4": (c) => `${c} registers shares for a merger`,
  "NT 10-K": (c) => `${c} says its annual report will be late`,
  "NT 10-Q": (c) => `${c} says its quarterly report will be late`,
};

/** Stories from the latest filings of one form. 8-Ks keep only the items listed in EIGHT_K_ITEMS. */
export function filingsToItems(filings: CurrentFiling[], tickers: Map<string, string>, sectors: Map<string, Tag | null>): RawItem[] {
  const byAcc = new Map<string, CurrentFiling[]>();
  for (const f of filings) byAcc.set(f.accession, [...(byAcc.get(f.accession) ?? []), f]);
  const out: RawItem[] = [];
  for (const [accession, group] of byAcc) {
    const subject = group.find((g) => /subject/i.test(g.role)) ?? group.find((g) => /filer/i.test(g.role)) ?? group[0];
    const filedBy = group.find((g) => /filed by/i.test(g.role));
    const form = subject.form.replace(/\/A$/, "");
    const def = FILING_FORMS.find((x) => x.form === form);
    if (!def || form === "D") continue;
    const company = prettyName(subject.company), filer = filedBy ? prettyName(filedBy.company) : "";
    const ticker = tickers.get(subject.cik);
    const sector = sectors.get(subject.cik) ?? null;
    let title: string, weight = def.weight, category = "filings";
    const tags = new Set<Tag>(def.tags);
    if (form === "8-K") {
      const signif = subject.items.filter((i) => EIGHT_K_ITEMS[i]).sort((a, b) => EIGHT_K_ITEMS[b].weight - EIGHT_K_ITEMS[a].weight);
      if (!signif.length) continue;
      const top = EIGHT_K_ITEMS[signif[0]];
      title = `${company}: ${top.label}`;
      weight = Math.min(1, top.weight + 0.05 * (signif.length - 1));
      category = top.category;
      for (const i of signif) for (const t of EIGHT_K_ITEMS[i].tags) tags.add(t);
    } else {
      title = (HEADLINE[form] ?? ((c: string) => `${c}: ${def.label}`))(company, filer);
      category = /13D|TO-T|13E3|M14A|S-4/.test(form) ? "deals" : form.startsWith("NT") ? "filings" : "markets";
    }
    if (subject.form.endsWith("/A")) { title += " (amended)"; weight *= 0.6; }
    if (sector) tags.add(sector);
    const itemText = form === "8-K" ? subject.items.map((i) => `Item ${i}${EIGHT_K_ITEMS[i] ? ` (${EIGHT_K_ITEMS[i].label})` : ""}`).join(", ") : def.label;
    out.push({
      key: `sec:${accession}`, url: subject.url, title, snippet: `${subject.form} filed with the SEC ${subject.filedAt.toISOString().slice(0, 10)}: ${itemText}.${filer ? ` Filed by ${filer}.` : ""}`,
      source: "SEC EDGAR", domain: "sec.gov", kind: "filing", publishedAt: subject.filedAt, tags: [...tags], tickers: ticker ? [ticker] : [], tier: 1,
      meta: { form: subject.form, items: subject.items, cik: subject.cik, accession, company, ...(filer ? { filer, filerCik: filedBy?.cik } : {}), weight, category },
    });
  }
  return out;
}

/** Sector of each filer from its SIC code: one submissions lookup per new company (at most `max` a run), remembered 30 days. */
export async function sectorsFor(ciks: string[], max = 10): Promise<Map<string, Tag | null>> {
  const out = new Map<string, Tag | null>();
  let fetched = 0;
  for (const cik of [...new Set(ciks)]) {
    const key = `news:sic:${cik}`;
    const hit = await cacheGet(key);
    if (hit !== null) { out.set(cik, (hit || null) as Tag | null); continue; }
    if (fetched >= max) continue;
    fetched++;
    const s = await getSubmissions(cik).catch(() => null);
    const sector = s ? sectorOfSic(Number(s.sic)) : null;
    out.set(cik, sector);
    if (s) await cacheSet(key, sector ?? "", 30 * 86_400_000);
  }
  return out;
}

/** One form's latest filings as stories. */
export async function fetchFilings(form: string): Promise<FetchResult> {
  try {
    const res = await edgarFetch(currentFeedUrl(form));
    if (!res.ok) return { status: "error", items: [], error: `HTTP ${res.status}` };
    const filings = parseCurrentFeed(await res.text());
    if (form === "D") return { status: "ok", items: await formDItems(filings) };
    const tickers = await tickerForCik().catch(() => new Map<string, string>());
    const keep = filings.filter((f) => form !== "8-K" || f.items.some((i) => EIGHT_K_ITEMS[i]));
    const sectors = await sectorsFor(keep.map((f) => f.cik));
    return { status: "ok", items: filingsToItems(filings, tickers, sectors) };
  } catch (e) {
    return { status: "error", items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

const num = (xml: string, tag: string) => { const m = new RegExp(`<${tag}>\\s*([\\d.]+)\\s*</${tag}>`).exec(xml); return m ? Number(m[1]) : null; };
const usd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`);

/**
 * Form D: raises by operating companies ($3M and up) and fund raises ($25M and up), from each filing's
 * primary document. Amendments and small or undisclosed amounts are skipped.
 */
export async function formDItems(filings: CurrentFiling[], max = 12): Promise<RawItem[]> {
  const out: RawItem[] = [];
  for (const f of filings.filter((x) => x.form === "D").slice(0, max)) {
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(f.cik)}/${f.accession.replace(/-/g, "")}/primary_doc.xml`;
    const res = await edgarFetch(url).catch(() => null);
    if (!res?.ok) continue;
    const xml = await res.text();
    const d = parseFormD(xml);
    const sold = num(xml, "totalAmountSold") ?? 0, offered = num(xml, "totalOfferingAmount");
    const fund = /pooled investment fund/i.test(d.industry);
    const fundType = /<investmentFundType>([^<]+)<\/investmentFundType>/.exec(xml)?.[1]?.trim() ?? "";
    if (d.isAmendment || sold < (fund ? 25e6 : 3e6)) continue;
    const name = prettyName(d.issuer || f.company);
    // Securitization and financing vehicles file Form Ds too; they are not raises anyone follows.
    if (/\b\d{4}-\d+\b|\b(trust|funding|issuer|securiti[sz]ation|receivables|CLO|ABS|warehouse|SPV|notes?)\b/i.test(name)) continue;
    const tags: Tag[] = fund ? (/venture/i.test(fundType) ? ["vc", "pe"] : /hedge/i.test(fundType) ? ["markets"] : ["pe", "privcredit"]) : ["vc"];
    const sector: Tag | null = /biotech|pharma|health|hospital|medical/i.test(d.industry) ? "healthcare" : /tech|computer|telecom|internet/i.test(d.industry) ? "tech" : /energy|oil|gas|electric|coal/i.test(d.industry) ? "energy" : /bank|insurance|lending|investing/i.test(d.industry) && !fund ? "financials" : /real estate|reit|construction/i.test(d.industry) ? "realestate" : /retail|restaurant/i.test(d.industry) ? "consumer" : null;
    if (sector) tags.push(sector);
    const officers = d.persons.filter((p) => p.relationships.some((r) => /officer|director|promoter/i.test(r))).map((p) => p.name).filter(Boolean).slice(0, 4);
    out.push({
      key: `sec:${f.accession}`, url: f.url,
      title: fund ? `${name} has raised ${usd(sold)} for a ${fundType ? fundType.toLowerCase() : "pooled fund"}` : `${name} raises ${usd(sold)}`,
      snippet: `Form D filed ${f.filedAt.toISOString().slice(0, 10)}: ${usd(sold)} sold${offered ? ` of a ${usd(offered)} offering` : ""}${d.industry ? `, ${d.industry}` : ""}${d.city ? `, ${d.city}${d.state ? `, ${d.state}` : ""}` : ""}.${officers.length ? ` Named: ${officers.join(", ")}.` : ""}`,
      source: "SEC EDGAR", domain: "sec.gov", kind: "filing", publishedAt: f.filedAt, tags, tickers: [], tier: 1,
      meta: { form: "D", cik: f.cik, accession: f.accession, company: name, amountUsd: sold, offeringUsd: offered, industry: d.industry, fund, fundType, officers, weight: Math.min(0.75, 0.3 + Math.log10(Math.max(sold, 1e6) / 1e6) * 0.15), category: "funding" },
    });
  }
  return out;
}
