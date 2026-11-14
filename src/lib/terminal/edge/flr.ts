/**
 * FLR: the flaring monitor across every mapped processing plant. From the hourly flare passes: the week
 * of VIIRS hot spots kept between passes (each plant's last seven days of radiant heat), the weekly record
 * per plant (up to twelve weeks), the change against the plant's average week, the plant's owner and
 * ticker, its current flaring card when it has one, and when the satellites last passed. When the last
 * pass failed the board still shows the last good record and says so. Server only.
 */
import { sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheGet } from "@/lib/cache";
import { byDay, HIST, isoWeek, plants, spotsNear, SPOTS, type FlareWeek } from "@/lib/edge/flares";
import { FLARE_EVERY_MS, FLARE_PASS, lastOk, passState, type PassState } from "@/lib/edge/passes";
import type { Hotspot } from "@/lib/edge/sources/firms";
import { flareRow, type FlareRow } from "../edge-signals";
import { attempt, stateOf, type SourceState } from "./common";

const DAY = 86_400_000;
export type FlrRow = FlareRow & { card: { id: number; title: string; heat: string | null } | null };
export type FlrView = {
  rows: FlrRow[]; plants: number; flaring: number; week: string; to: string;
  pass: { checkedAt: string | null; tried: string | null; ok: boolean; by: string | null; newestSpot: string | null; satellites: string[]; note: string | null; /** When the next quick pass is due (the hourly tick, or this board's refresh). */ nextDue: string | null };
  sources: SourceState[]; asOf: string;
};

const readJson = async <T,>(key: string): Promise<T | null> => { const v = await cacheGet(key); return v ? (JSON.parse(v) as T) : null; };

/** This and last week's flaring cards by plant (asset id). */
async function cardsByPlant(): Promise<Map<number, FlrRow["card"]>> {
  const rows = await requireDb().select({ id: schema.edgeDetections.id, title: schema.edgeDetections.title, assetIds: schema.edgeDetections.assetIds, heat: sql<string | null>`${schema.edgeDetections.visual}->'heat'->>'url'` })
    .from(schema.edgeDetections).where(sql`${schema.edgeDetections.kind} = 'flaring' and ${schema.edgeDetections.ownerId} is null and ${schema.edgeDetections.detectedAt} > now() - interval '14 days'`)
    .orderBy(sql`${schema.edgeDetections.detectedAt} asc`).limit(500);
  const out = new Map<number, FlrRow["card"]>();
  for (const r of rows) for (const a of r.assetIds) out.set(a, { id: r.id, title: r.title, heat: r.heat });
  return out;
}

export async function flrView(opts: { all?: boolean } = {}, now = Date.now()): Promise<FlrView> {
  const [ps, hist, kept, pass, cards] = await Promise.all([
    attempt("flr-plants", [] as Awaited<ReturnType<typeof plants>>, () => plants()),
    attempt("flr-hist", null as Record<string, FlareWeek[]> | null, () => readJson<Record<string, FlareWeek[]>>(HIST)),
    attempt("flr-spots", null as { spots: Hotspot[]; satellites: string[] } | null, () => readJson<{ spots: Hotspot[]; satellites: string[] }>(SPOTS)),
    attempt("flr-pass", null as PassState | null, () => passState(FLARE_PASS)),
    attempt("flr-cards", new Map<number, FlrRow["card"]>(), cardsByPlant),
  ]);
  const spots = kept.value?.spots ?? [];
  const yesterday = new Date(now - DAY).toISOString().slice(0, 10);
  const to = spots.reduce((m, s) => (s.date > m ? s.date : m), yesterday);
  const week = isoWeek(to);
  const all = ps.value.map((p) => ({ ...flareRow(p, byDay(spotsNear(spots, p.lon, p.lat), to), hist.value?.[p.id] ?? [], week), card: cards.value.get(p.id) ?? null }));
  const hot = all.filter((r) => r.frp7 > 0 || r.weekly.some((w) => w > 0) || r.card);
  const rows = (opts.all ? all : hot).sort((a, b) => b.frp7 - a.frp7 || b.weekly.reduce((s, x) => s + x, 0) - a.weekly.reduce((s, x) => s + x, 0) || a.name.localeCompare(b.name));
  const p = pass.value;
  const checkedAt = lastOk(p);
  const satellites = kept.value?.satellites ?? [];
  const sources: SourceState[] = [
    stateOf("firms", "NASA FIRMS (VIIRS active fires)", pass.ok && !!p && (p.ok || !!checkedAt), checkedAt ? 1 : 0, checkedAt, {
      note: !p ? "no flare pass has run yet" : p.ok ? `${p.by ?? "hourly"} pass; ${satellites.length ? satellites.join(", ") : "satellites not recorded"}` : `the last pass did not complete (${p.note ?? "the source did not answer"}); showing the last good record`,
      staleAfterMs: 3 * 3_600_000, now, url: "https://firms.modaps.eosdis.nasa.gov/",
    }),
    stateOf("record", "Edge weekly flare record", hist.ok, hist.value ? Object.keys(hist.value).length : 0, null, { note: "up to 26 weeks kept per plant" }),
    stateOf("eia", "EIA processing plants", ps.ok, ps.value.length, null, { note: "Permian, 2017 vintage", url: "https://www.eia.gov/maps/layer_info-m.php" }),
  ];
  return {
    rows, plants: ps.value.length, flaring: all.filter((r) => r.daysFlaring > 0).length, week, to,
    pass: { checkedAt, tried: p?.at ?? null, ok: p?.ok ?? false, by: p?.by ?? null, newestSpot: p?.newestSpot ?? null, satellites, note: p?.note ?? null, nextDue: checkedAt ? new Date(Date.parse(checkedAt) + FLARE_EVERY_MS).toISOString() : null },
    sources, asOf: new Date(now).toISOString(),
  };
}
