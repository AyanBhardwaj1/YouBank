/**
 * FDA recalls through openFDA's enforcement endpoints (drugs, medical devices, food): every recall FDA
 * classifies, with the recalling firm, the class (I is the most serious: a reasonable chance of serious
 * harm), the reason, the quantity and the dates. Public domain (CC0 per openFDA's terms), no key needed
 * (an optional OPENFDA_API_KEY raises the daily limit from 1,000 requests). Updated weekly by FDA.
 * Parsing is pure.
 */
import { cacheJson } from "@/lib/cache";
import { fetchRetry } from "@/lib/net";
import type { SourceInfo } from "./eia";

export const OPENFDA: SourceInfo = {
  key: "openfda-enforcement",
  name: "openFDA recall enforcement reports (drugs, devices, food)",
  url: "https://open.fda.gov/apis/drug/enforcement/",
  license: "Public domain / CC0 (openFDA terms of service)",
  vintage: "weekly, as FDA classifies recalls",
};

export type FdaCategory = "drug" | "device" | "food";
export type FdaRecall = {
  number: string; category: FdaCategory; classification: "Class I" | "Class II" | "Class III" | "";
  firm: string; product: string; reason: string; quantity: string; distribution: string; status: string;
  reportDate: string; initiated: string;
};

/** openFDA's YYYYMMDD as YYYY-MM-DD ("" when missing). Pure. */
export const fdaDate = (v: unknown) => { const s = String(v ?? ""); return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : ""; };

/** An enforcement response's results as recalls. Pure. */
export function parseEnforcement(json: unknown, category: FdaCategory): FdaRecall[] {
  const rows = ((json as { results?: unknown[] })?.results ?? []) as Record<string, unknown>[];
  return rows.map((r) => {
    const c = String(r.classification ?? "").trim();
    return {
      number: String(r.recall_number ?? "").trim(), category, classification: (c === "Class I" || c === "Class II" || c === "Class III" ? c : "") as FdaRecall["classification"],
      firm: String(r.recalling_firm ?? "").trim(), product: String(r.product_description ?? "").replace(/\s+/g, " ").trim().slice(0, 300), reason: String(r.reason_for_recall ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
      quantity: String(r.product_quantity ?? "").trim().slice(0, 120), distribution: String(r.distribution_pattern ?? "").trim().slice(0, 160), status: String(r.status ?? "").trim(),
      reportDate: fdaDate(r.report_date), initiated: fdaDate(r.recall_initiation_date),
    };
  }).filter((r) => r.number && r.firm && r.reportDate);
}

/** The query for a category's recalls reported in a date window (YYYY-MM-DD). Pure. */
export function enforcementUrl(category: FdaCategory, from: string, to: string, limit = 1000, key = ""): string {
  const d = (s: string) => s.replace(/-/g, "");
  return `https://api.fda.gov/${category}/enforcement.json?search=report_date:[${d(from)}+TO+${d(to)}]&limit=${limit}${key ? `&api_key=${encodeURIComponent(key)}` : ""}`;
}

/** Recalls reported in the window for one category. openFDA answers 404 when nothing matches, which is an empty list. */
async function window(category: FdaCategory, from: string, to: string): Promise<FdaRecall[]> {
  const res = await fetchRetry(enforcementUrl(category, from, to, 1000, process.env.OPENFDA_API_KEY?.trim() ?? ""), { cache: "no-store", timeoutMs: 25_000 });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`openFDA ${category} enforcement answered ${res.status}`);
  return parseEnforcement(await res.json(), category);
}

/** Recalls of every category reported in the last `days` days (as far back as a year for the baseline). Shared for six hours. */
export async function readRecalls(days: number): Promise<FdaRecall[]> {
  const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return cacheJson(`edge:openfda:v1:${days}:${to}`, 6 * 3_600_000, async () => {
    const got = await Promise.all((["drug", "device", "food"] as FdaCategory[]).map((c) => window(c, from, to).catch(() => null)));
    if (got.every((g) => g === null)) throw new Error("openFDA did not answer");
    return got.flatMap((g) => g ?? []);
  }, { staleIfErrorMs: 3 * 86_400_000 });
}

/** A count response (`count=recalling_firm.exact`) as firm and count. Pure. */
export function parseCounts(json: unknown): { firm: string; count: number }[] {
  return (((json as { results?: unknown[] })?.results ?? []) as { term?: unknown; count?: unknown }[])
    .map((r) => ({ firm: String(r.term ?? "").trim(), count: Number(r.count ?? 0) })).filter((r) => r.firm && Number.isFinite(r.count) && r.count > 0);
}

/**
 * How many recalls each firm had reported in a window `fromDays` to `toDays` days ago, all categories:
 * the baseline a burst of recalls is measured against. Shared for a day.
 */
export async function readFirmCounts(fromDays: number, toDays: number): Promise<{ firm: string; count: number }[]> {
  const d = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
  const key = process.env.OPENFDA_API_KEY?.trim() ?? "";
  return cacheJson(`edge:openfda:counts:v1:${fromDays}:${toDays}:${d(0)}`, 86_400_000, async () => {
    const got = await Promise.all((["drug", "device", "food"] as FdaCategory[]).map(async (c) => {
      const res = await fetchRetry(`https://api.fda.gov/${c}/enforcement.json?search=report_date:[${d(fromDays)}+TO+${d(toDays)}]&count=recalling_firm.exact&limit=1000${key ? `&api_key=${encodeURIComponent(key)}` : ""}`, { cache: "no-store", timeoutMs: 25_000 }).catch(() => null);
      if (!res || res.status === 404) return [];
      if (!res.ok) return null;
      return parseCounts(await res.json());
    }));
    if (got.every((g) => g === null)) throw new Error("openFDA did not answer");
    return got.flatMap((g) => g ?? []);
  }, { staleIfErrorMs: 7 * 86_400_000 });
}
