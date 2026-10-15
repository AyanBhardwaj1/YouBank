/**
 * Layoff notices under the WARN Act (E3): public records each state's labour department publishes. They
 * move and change format, so the sources live in a registry (each URL can be replaced by an environment
 * variable, EDGE_WARN_<STATE>_URL, without a deploy) and each state has its own column map. A parser that
 * stops returning rows keeps its "last good" date, and one stale for three weeks is flagged on the Pulse's
 * status for administrators. This round reads Texas, California and New York; the free WARN Feed
 * aggregator is the documented fallback once its terms are checked. Parsing is pure; reading a workbook
 * uses exceljs.
 */
import { fetchText } from "../../entities/http";
import { nameScore } from "../../entities/crosswalk";
import { fetchRetry } from "@/lib/net";

export type WarnNotice = { state: string; company: string; date: string; employees: number; city: string; kind: string; key: string };
export type WarnSource = { state: string; name: string; url: string; format: "xlsx" | "csv" | "json"; page: string; columns: Record<"company" | "date" | "employees" | "city" | "kind", string[]> };

/**
 * The sources. The URLs are the last known locations and were not reachable from the sandbox this was
 * built in: confirm each (above all New York's open-data dataset id and Texas's yearly file name) before
 * relying on it, and set EDGE_WARN_<STATE>_URL when one has moved. A wrong URL fails safely: the state's
 * parser is marked not good and the Pulse says so.
 */
export const WARN_SOURCES: WarnSource[] = [
  {
    state: "TX", name: "Texas Workforce Commission WARN notices", format: "xlsx", page: "https://www.twc.texas.gov/data-reports/warn-notice",
    url: `https://www.twc.texas.gov/sites/default/files/oei/docs/warn-act-listings-${new Date().getUTCFullYear()}-twc.xlsx`,
    columns: { company: ["job_site_name", "company", "company name"], date: ["notice_date", "notice date", "wfdd_received_date"], employees: ["total_layoff_number", "total layoff number", "number of employees"], city: ["city_name", "city"], kind: ["layoff_type"] },
  },
  {
    state: "CA", name: "California EDD WARN report", format: "xlsx", page: "https://edd.ca.gov/en/jobs_and_training/Layoff_Services_WARN",
    url: "https://edd.ca.gov/siteassets/files/jobs_and_training/warn/warn_report.xlsx",
    columns: { company: ["company"], date: ["notice date", "received date", "processed date"], employees: ["no. of employees", "no of employees", "number of employees"], city: ["address", "city"], kind: ["layoff/closure", "layoff/ closure"] },
  },
  {
    state: "NY", name: "New York State Department of Labor WARN notices", format: "json", page: "https://dol.ny.gov/warn-notices",
    url: "https://data.ny.gov/resource/dxhk-wkhj.json?$limit=5000&$order=date_of_notice%20DESC",
    columns: { company: ["company_name", "company"], date: ["date_of_notice", "notice_date", "warn_date"], employees: ["number_affected", "number_of_affected_workers", "total_employees"], city: ["city", "county"], kind: ["closing_or_layoff", "type"] },
  },
];

export const sourceUrl = (s: WarnSource) => process.env[`EDGE_WARN_${s.state}_URL`]?.trim() || s.url;

const norm = (h: string) => h.toLowerCase().replace(/\s+/g, " ").trim();

/** A spreadsheet date (an Excel serial, a Date, "3/14/2025", "2025-03-14") as YYYY-MM-DD. Pure. */
export function warnDate(v: unknown): string | null {
  if (v instanceof Date && Number.isFinite(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (us) { const y = us[3].length === 2 ? `20${us[3]}` : us[3]; return `${y}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`; }
  return null;
}

/** Header-keyed rows as notices, by a source's column map; rows without a company, date or count are dropped. Pure. */
export function rowsToNotices(rows: Record<string, unknown>[], src: Pick<WarnSource, "state" | "columns">): WarnNotice[] {
  const out: WarnNotice[] = [];
  for (const r of rows) {
    const by = new Map(Object.entries(r).map(([k, v]) => [norm(k), v]));
    const pick = (aliases: string[]) => { for (const a of aliases) if (by.has(norm(a))) return by.get(norm(a)); return undefined; };
    const company = String(pick(src.columns.company) ?? "").replace(/\s+/g, " ").trim();
    const date = warnDate(pick(src.columns.date));
    const employees = Number(String(pick(src.columns.employees) ?? "").replace(/[^\d.]/g, ""));
    if (!company || !date || !(employees > 0)) continue;
    const city = String(pick(src.columns.city) ?? "").trim().slice(0, 80);
    out.push({ state: src.state, company: company.slice(0, 160), date, employees: Math.round(employees), city, kind: String(pick(src.columns.kind) ?? "").trim().slice(0, 40), key: `${src.state}:${company.toLowerCase().slice(0, 60)}:${date}:${Math.round(employees)}` });
  }
  return out;
}

/** A CSV text as header-keyed rows (quotes and doubled quotes handled). Pure. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; continue; }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

/** A workbook's first sheet as header-keyed rows: the header is the first row with three or more text cells. */
async function xlsxRows(buf: ArrayBuffer): Promise<Record<string, unknown>[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const all: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => { all.push((r.values as unknown[]).slice(1).map((v) => (v && typeof v === "object" && "text" in (v as object) ? (v as { text: string }).text : v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v))); });
  const h = all.findIndex((r) => r.filter((c) => typeof c === "string" && c.trim()).length >= 3);
  if (h < 0) return [];
  const head = all[h].map((c) => String(c ?? "").trim());
  return all.slice(h + 1).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i]])));
}

/** One state's notices, read now. Throws when the source cannot be read (the caller records it as not good). */
export async function readWarn(src: WarnSource): Promise<WarnNotice[]> {
  const url = sourceUrl(src);
  if (src.format === "xlsx") {
    const res = await fetchRetry(url, { cache: "no-store", timeoutMs: 30_000, headers: { "User-Agent": "YouBank research (Edge; +https://youbank-nu.vercel.app)" } });
    if (!res.ok) throw Object.assign(new Error(`${src.name} answered ${res.status}`), { status: 502 });
    return rowsToNotices(await xlsxRows(await res.arrayBuffer()), src);
  }
  const text = await fetchText(url, { timeoutMs: 30_000 });
  return rowsToNotices(src.format === "csv" ? parseCsv(text) : (JSON.parse(text) as Record<string, unknown>[]), src);
}

/** Notices that name one of the companies (name match at the crosswalk's 0.9 line), by company. Pure. */
export function matchNotices(notices: WarnNotice[], companies: { nodeId: number; name: string }[]): Map<number, WarnNotice[]> {
  const out = new Map<number, WarnNotice[]>();
  for (const n of notices) {
    let best: { nodeId: number; score: number } | null = null;
    for (const c of companies) { const s = nameScore(c.name, n.company).score; if (s >= 0.9 && (!best || s > best.score)) best = { nodeId: c.nodeId, score: s }; }
    if (best) out.set(best.nodeId, [...(out.get(best.nodeId) ?? []), n]);
  }
  return out;
}
