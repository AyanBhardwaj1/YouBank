/**
 * Vehicle recalls from NHTSA's recalls dataset on the Department of Transportation's open-data portal
 * (Socrata, data.transportation.gov dataset 6axg-epim): each campaign's manufacturer, component, summary,
 * the number of vehicles potentially affected and when NHTSA received the report. Public domain, no key
 * (an optional EDGE_SOCRATA_APP_TOKEN raises the rate limit). The field names were not confirmed against
 * a live response when this was written, so the parser accepts the names the dataset and NHTSA's own
 * flat file have used; a response with none of them yields no rows rather than wrong ones.
 */
import { cacheJson } from "@/lib/cache";
import { fetchRetry } from "@/lib/net";
import type { SourceInfo } from "./eia";

export const NHTSA: SourceInfo = {
  key: "nhtsa-recalls",
  name: "NHTSA vehicle and equipment recalls (data.transportation.gov)",
  url: "https://data.transportation.gov/Automobiles/Recalls-Data/6axg-epim",
  license: "Public domain (U.S. Government work)",
  vintage: "updated as NHTSA receives recall reports",
};

export const NHTSA_DATASET = process.env.EDGE_NHTSA_URL?.trim() || "https://data.transportation.gov/resource/6axg-epim.json";

export type VehicleRecall = { id: string; maker: string; component: string; subject: string; units: number; received: string; parkIt: boolean; url: string };

const pick = (r: Record<string, unknown>, names: string[]) => { for (const n of names) { const v = r[n]; if (v !== undefined && v !== null && String(v).trim()) return v; } return undefined; };
const dateOf = (v: unknown): string => {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : "";
};
const linkOf = (v: unknown, id: string) => {
  const u = typeof v === "object" && v ? String((v as { url?: string }).url ?? "") : String(v ?? "");
  return /^https:\/\//.test(u) ? u : `https://www.nhtsa.gov/recalls?nhtsaId=${encodeURIComponent(id)}`;
};

/** The dataset's rows as recalls, one per campaign (the dataset can repeat a campaign per component). Pure. */
export function parseVehicleRecalls(json: unknown): VehicleRecall[] {
  const rows = (Array.isArray(json) ? json : []) as Record<string, unknown>[];
  const by = new Map<string, VehicleRecall>();
  for (const r of rows) {
    const id = String(pick(r, ["nhtsa_id", "campno", "nhtsa_campaign_number", "campaign_number"]) ?? "").trim();
    const maker = String(pick(r, ["manufacturer", "mfgname", "mfr_name", "maker"]) ?? "").trim();
    const received = dateOf(pick(r, ["report_received_date", "rcdate", "recall_date", "report_date"]));
    if (!id || !maker || !received) continue;
    const units = Number(String(pick(r, ["potentially_affected", "potaff", "number_affected"]) ?? "0").replace(/[^0-9.]/g, "")) || 0;
    const subject = String(pick(r, ["subject", "summary", "desc_defect", "defect_summary"]) ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    const component = String(pick(r, ["component", "compname"]) ?? "").trim().slice(0, 120);
    const text = `${subject} ${String(pick(r, ["park_outside_advisory", "do_not_drive_advisory", "consequence_summary", "conequence_defect"]) ?? "")}`;
    const parkIt = /\b(yes|do not drive|park (?:outside|outdoors))\b/i.test(String(pick(r, ["park_outside_advisory", "do_not_drive_advisory"]) ?? "")) || /\b(do not drive|park (?:outside|outdoors))\b/i.test(text);
    const prev = by.get(id);
    if (prev) { prev.units = Math.max(prev.units, units); prev.parkIt ||= parkIt; continue; }
    by.set(id, { id, maker, component, subject, units, received, parkIt, url: linkOf(pick(r, ["recall_link", "link"]), id) });
  }
  return [...by.values()];
}

/** The query for recalls received since a date (SoQL), newest first. Pure. */
export function recallsUrl(since: string, limit = 5000, base = NHTSA_DATASET): string {
  return `${base}?$where=${encodeURIComponent(`report_received_date >= '${since}T00:00:00'`)}&$order=${encodeURIComponent("report_received_date DESC")}&$limit=${limit}`;
}

/** Recalls received in the last `days` days. Shared for six hours. */
export async function readVehicleRecalls(days: number): Promise<VehicleRecall[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const token = process.env.EDGE_SOCRATA_APP_TOKEN?.trim();
  return cacheJson(`edge:nhtsa:v1:${days}:${new Date().toISOString().slice(0, 10)}`, 6 * 3_600_000, async () => {
    const headers: Record<string, string> = { Accept: "application/json", ...(token ? { "X-App-Token": token } : {}) };
    let res = await fetchRetry(recallsUrl(since), { cache: "no-store", timeoutMs: 30_000, headers });
    // If the date column is named otherwise, the filtered query fails; read the newest rows instead and filter here.
    if (res.status === 400) res = await fetchRetry(`${NHTSA_DATASET}?$limit=5000`, { cache: "no-store", timeoutMs: 30_000, headers });
    if (!res.ok) throw new Error(`NHTSA recalls answered ${res.status}`);
    return parseVehicleRecalls(await res.json()).filter((r) => r.received >= since);
  }, { staleIfErrorMs: 3 * 86_400_000 });
}
