/**
 * Flaring that stays current: the hourly pass's pure parts (merging the 24-hour files into the kept week,
 * the newest detection, whether a card's numbers moved), when a pass is due, and the New and Updated marks.
 *   pnpm exec tsx scripts/test-edge-flares.ts
 * scripts/fixtures/edge/firms-24h.csv is written in FIRMS's published VIIRS C2 column layout; it was not
 * downloaded (the sandbox cannot reach NASA), so it checks the parser against the documented format.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { byDay, flareStats, mergeSpots, newestSpot, spotKey, spotsNear, statsMoved } from "@/lib/edge/flares";
import { agoWords, arrived, freshness } from "@/lib/edge/fresh";
import { firmsFileUrl, parseFirmsCsv, type Hotspot } from "@/lib/edge/sources/firms";
import { FLARE_EVERY_MS, OPEN_REFRESH_MS, lastOk, passDue } from "@/lib/edge/passes";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}`, detail ?? ""); }
};

const csv = readFileSync(join(__dirname, "fixtures/edge/firms-24h.csv"), "utf8");
const permian: [number, number, number, number] = [-104.6, 30.4, -100.4, 33.9];

console.log("the 24-hour files");
const spots = parseFirmsCsv(csv, permian);
ok("rows outside the box are dropped", spots.length === 4, spots.length);
ok("satellite codes become names (N20, N21, N)", spots.map((s) => s.sat).join(",") === "NOAA-20,NOAA-20,NOAA-21,Suomi NPP", spots.map((s) => s.sat));
ok("confidence letters become words", spots[1].conf === "high" && spots[3].conf === "low");
ok("night and day are read", spots[0].night && !spots[3].night);
ok("the 24-hour file name follows the seven-day one", firmsFileUrl({ dir: "noaa-20-viirs-c2", file: "J1_VIIRS_C2" }, "24h") === "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv");
ok("and the seven-day one is unchanged", firmsFileUrl({ dir: "suomi-npp-viirs-c2", file: "SUOMI_VIIRS_C2" }, "7d").endsWith("SUOMI_VIIRS_C2_USA_contiguous_and_Hawaii_7d.csv"));

console.log("merging new detections into the kept week");
const old: Hotspot[] = [
  { lon: -103.711, lat: 32.214, date: "2026-11-06", time: "0840", sat: "NOAA-20", conf: "nominal", frp: 5, night: true },
  { lon: -103.711, lat: 32.214, date: "2026-11-09", time: "0840", sat: "NOAA-20", conf: "nominal", frp: 7, night: true },
  spots[0],
];
const merged = mergeSpots(old, spots, "2026-11-13");
ok("a detection in both the kept week and the new file is counted once", merged.filter((s) => spotKey(s) === spotKey(spots[0])).length === 1);
ok("detections older than seven days age out", !merged.some((s) => s.date === "2026-11-06"));
ok("the week keeps older detections the 24-hour file no longer has", merged.some((s) => s.date === "2026-11-09"));
ok("all four new detections are in", spots.every((s) => merged.some((m) => spotKey(m) === spotKey(s))));
ok("oldest first", merged.every((s, i) => i === 0 || merged[i - 1].date + merged[i - 1].time <= s.date + s.time));
ok("detections dated after the window's end are not kept", mergeSpots([], [{ ...spots[0], date: "2026-11-20" }], "2026-11-13").length === 0);
ok("the newest detection's time", newestSpot(merged) === "2026-11-13T19:51Z", newestSpot(merged));
ok("no detections, no time", newestSpot([]) === null);

console.log("cards move only when their numbers do");
const near = spotsNear(merged, -103.7111, 32.2143);
const s1 = flareStats(near, byDay(near, "2026-11-13"));
ok("a week with detections on three days", s1.days === 3 && s1.detections === 5, s1);
ok("a card with no earlier numbers moved", statsMoved(null, s1));
ok("the same numbers did not move", !statsMoved({ ...s1 }, s1));
ok("a new detection moved it", statsMoved({ ...s1, detections: s1.detections - 1 }, s1));
ok("half a megawatt more heat moved it", statsMoved({ ...s1, frpTotal: s1.frpTotal - 0.6 }, s1) && !statsMoved({ ...s1, frpTotal: s1.frpTotal - 0.2 }, s1));

console.log("when a pass is due");
const now = Date.parse("2026-11-14T12:00:00Z");
ok("never run: due", passDue(null, now, FLARE_EVERY_MS));
ok("never read: no 'checked' time to show", lastOk(null) === null && lastOk({ at: "2026-11-14T11:00:00Z", by: "open", ok: false }) === null);
ok("a good read is the checked time", lastOk({ at: "2026-11-14T11:00:00Z", by: "hourly", ok: true }) === "2026-11-14T11:00:00Z");
ok("a failed try keeps the last good read's time", lastOk({ at: "2026-11-14T12:00:00Z", by: "hourly", ok: false, okAt: "2026-11-14T11:00:00Z" }) === "2026-11-14T11:00:00Z");
ok("ran 20 minutes ago: not due", !passDue({ at: "2026-11-14T11:40:00Z", ok: true }, now, FLARE_EVERY_MS));
ok("ran 56 minutes ago: due for the hourly tick", passDue({ at: "2026-11-14T11:04:00Z", ok: true }, now, FLARE_EVERY_MS));
ok("ran 56 minutes ago: not yet for the page-open refresh (an hour)", !passDue({ at: "2026-11-14T11:04:00Z", ok: true }, now, OPEN_REFRESH_MS));
ok("ran 61 minutes ago: due for the page-open refresh", passDue({ at: "2026-11-14T10:59:00Z", ok: true }, now, OPEN_REFRESH_MS));
ok("failed 5 minutes ago: not retried yet", !passDue({ at: "2026-11-14T11:55:00Z", ok: false }, now, FLARE_EVERY_MS));
ok("failed 15 minutes ago: retried", passDue({ at: "2026-11-14T11:45:00Z", ok: false }, now, FLARE_EVERY_MS));
ok("a garbled time is due", passDue({ at: "yesterday", ok: true }, now, FLARE_EVERY_MS));

console.log("New and Updated marks");
ok("found two hours ago: new", freshness("2026-11-14T10:00:00Z", null, now) === "new");
ok("found a day ago, updated an hour ago: updated", freshness("2026-11-13T12:00:00Z", "2026-11-14T11:00:00Z", now) === "updated");
ok("found a day ago, updated five hours ago: nothing", freshness("2026-11-13T12:00:00Z", "2026-11-14T07:00:00Z", now) === null);
ok("written once at creation (updated = found): new, never updated", freshness("2026-11-14T09:00:00Z", "2026-11-14T09:00:00Z", now) === "new" && freshness("2026-11-13T09:00:00Z", "2026-11-13T09:00:00Z", now) === null);
ok("a future time is not new", freshness("2026-11-15T10:00:00Z", null, now) === null);
ok("minutes ago", agoWords("2026-11-14T11:48:00Z", now) === "12 minutes ago");
ok("one hour ago", agoWords("2026-11-14T11:00:00Z", now) === "1 hour ago");
ok("days ago", agoWords("2026-11-11T12:00:00Z", now) === "3 days ago");
ok("never", agoWords(null, now) === "not yet");
ok("cards that arrived after the first load", arrived(new Set([1, 2, 3]), [4, 1, 2, 5]).join(",") === "4,5");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
