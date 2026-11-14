/**
 * U.S. nuclear plants' power, day by day: the Nuclear Regulatory Commission's Power Reactor Status
 * report, which every licensee files each morning (each unit's percent of rated power at 4 a.m. Eastern),
 * published as a pipe-delimited file of the last 365 days. Public domain, no key. Few investors read it;
 * an unplanned outage at a merchant plant is lost revenue days before anyone reports it. Parsing is pure.
 */
import { cacheJson } from "@/lib/cache";
import { fetchRetry } from "@/lib/net";
import type { SourceInfo } from "./eia";

export const NRC: SourceInfo = {
  key: "nrc-power-reactor-status",
  name: "U.S. NRC Power Reactor Status Report (last 365 days)",
  url: "https://www.nrc.gov/reading-rm/doc-collections/event-status/reactor-status/",
  license: "Public domain (U.S. Government work)",
  vintage: "daily, each unit's power at 4 a.m. Eastern",
};

export const NRC_FILE = "https://www.nrc.gov/reading-rm/doc-collections/event-status/reactor-status/PowerReactorStatusForLast365Days.txt";

export type ReactorDay = { date: string; unit: string; power: number };

/** "11/13/2026 12:00:00 AM", "2026-11-13" or "11/13/2026" as "2026-11-13", or null. Pure. */
export function nrcDate(raw: string): string | null {
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}

/** The file as rows (header "ReportDt|Unit|Power", in any order and case). Pure. */
export function parseReactorStatus(text: string): ReactorDay[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const head = lines[0].split("|").map((h) => h.trim().toLowerCase());
  const iDate = head.findIndex((h) => h.startsWith("reportdt") || h === "date"), iUnit = head.indexOf("unit"), iPower = head.indexOf("power");
  if (iDate < 0 || iUnit < 0 || iPower < 0) return [];
  const out: ReactorDay[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split("|");
    const date = nrcDate(c[iDate] ?? ""), unit = (c[iUnit] ?? "").trim(), power = Number((c[iPower] ?? "").trim());
    if (!date || !unit || !Number.isFinite(power)) continue;
    out.push({ date, unit, power: Math.max(0, Math.min(110, power)) });
  }
  return out;
}

/** The last year of every unit's daily power. Shared for three hours (the file changes once a day). */
export async function readReactorStatus(): Promise<ReactorDay[]> {
  const bucket = Math.floor(Date.now() / (3 * 3_600_000));
  return cacheJson(`edge:nrc:status:v1:${bucket}`, 3 * 3_600_000, async () => {
    const res = await fetchRetry(NRC_FILE, { cache: "no-store", timeoutMs: 30_000, headers: { "User-Agent": "YouBank research (Edge)" } });
    if (!res.ok) throw new Error(`NRC reactor status answered ${res.status}`);
    const rows = parseReactorStatus(await res.text());
    if (!rows.length) throw new Error("NRC reactor status file had no rows");
    return rows;
  }, { staleIfErrorMs: 2 * 86_400_000 });
}
