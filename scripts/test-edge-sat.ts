/**
 * Edge's new satellite analyses (crop condition, water extent, ships at port): the scoring, the pixel
 * arithmetic, radar ship counting on synthetic scenes, the site registry and the card wording.
 *   pnpm exec tsx scripts/test-edge-sat.ts
 */
import { assess, brightTargets, inSeason, mean, ndviStats, s2Offset, sameWindowEarlier, satConfidence, satMagnitude, stdev, waterMask, waterShare } from "@/lib/edge/sat/score";
import { describeSat, dueSites, METHOD, packMask, passesFrom, satRepeats, unpackMask } from "@/lib/edge/sat/scan";
import { SAT_SITES } from "@/lib/edge/sat/sites";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}`, detail ?? ""); }
};

console.log("baseline against now");
ok("mean and sample standard deviation", mean([1, 2, 3]) === 2 && Math.abs(stdev([1, 2, 3]) - 1) < 1e-9);
const yrs = [{ label: "2022", value: 0.72 }, { label: "2023", value: 0.75 }, { label: "2024", value: 0.7 }, { label: "2025", value: 0.73 }];
const low = assess(0.55, yrs, { sdFloor: 0.03, pctMin: 0.08 });
ok("a canopy far below four earlier years is a signal, down", low.signal && low.direction === "down" && low.z < -2, low);
ok("its percent change", Math.abs(low.pct - (0.55 - 0.725) / 0.725) < 0.001, low.pct);
const close = assess(0.71, yrs, { sdFloor: 0.03 });
ok("a reading within the usual range is not", !close.signal && close.direction === "flat");
ok("too few earlier readings is not enough evidence", !assess(0.4, yrs.slice(0, 2), { sdFloor: 0.03 }).enough);
ok("a mostly cloudy scene is not enough evidence", !assess(0.4, yrs, { sdFloor: 0.03, validShare: 0.2 }).enough);
const tight = assess(0.76, [{ label: "a", value: 0.73 }, { label: "b", value: 0.7301 }, { label: "c", value: 0.7302 }], { sdFloor: 0.03 });
ok("the standard deviation floor stops a tight baseline from inflating the z-score", Math.abs(tight.z) < 1.5 && !tight.signal, tight);
ok("a big z with a tiny percent change is not a signal", !assess(101, [{ label: "a", value: 100 }, { label: "b", value: 100.1 }, { label: "c", value: 99.9 }], { pctMin: 0.08 }).signal);
ok("more ships than usual: up", assess(14, Array.from({ length: 8 }, (_, i) => ({ label: `p${i}`, value: 5 + (i % 3) })), { minN: 6, sdFloor: 1, pctMin: 0.3 }).direction === "up");
ok("confidence grows with evidence and stays in range", satConfidence({ n: 4, z: 4 }, 0.9) > satConfidence({ n: 3, z: 2 }, 0.45) && satConfidence({ n: 40, z: 40 }, 1) <= 0.92 && satConfidence({ n: 0, z: 0 }, 0) >= 0.2);
ok("magnitude in 0 to 1", satMagnitude({ z: 10, pct: 2 }) === 1 && satMagnitude({ z: 0, pct: 0 }) === 0);

console.log("pixel arithmetic");
ok("the Sentinel-2 offset starts with baseline 04.00", s2Offset("2022-01-24") === 0 && s2Offset("2022-01-25") === 1000 && s2Offset("2026-11-01") === 1000);
// Healthy crop: red 0.04, near infrared 0.40 (stored with the offset); a cloud pixel (SCL 8) and a water pixel (SCL 6) are skipped.
const red = [1400, 1400, 9000, 1100], nir = [5000, 5000, 9500, 1050], scl = [4, 4, 8, 6];
const nd = ndviStats(red, nir, scl, "2026-07-15");
ok("NDVI over clear land only", Math.abs(nd.value - (0.4 - 0.04) / 0.44) < 1e-6 && nd.valid === 0.5, nd);
const ndOld = ndviStats([400, 400], [4000, 4000], [4, 4], "2021-07-15");
ok("an older scene is read without the offset", Math.abs(ndOld.value - (0.4 - 0.04) / 0.44) < 1e-6, ndOld);
ok("nothing clear, no value", Number.isNaN(ndviStats([1000], [1000], [9], "2026-07-01").value));
// Water: green above shortwave infrared is water; land the other way round.
const w = waterShare([1800, 1800, 1300, 1500], [1100, 1150, 3000, 1400], [6, 6, 5, 3], "2026-07-01");
ok("the share of clear pixels that are water (cloud shadow skipped)", Math.abs(w.value - 2 / 3) < 1e-9 && w.valid === 0.75, w);

console.log("ships in radar");
const size = 20, n = size * size;
const sea = (lin: number) => new Float32Array(n).fill(lin);
const valid = new Uint8Array(n).fill(1);
// Three passes of sea (-20 dB) with land along the top two rows (-5 dB, bright).
const passesIn = [0, 1, 2].map(() => { const v = sea(0.01); for (let i = 0; i < 2 * size; i++) v[i] = 0.3; return { vv: v, valid }; });
const water = waterMask(passesIn);
ok("the median of several passes finds the water and leaves the land", water[0] === 0 && water[5 * size + 5] === 1 && water.reduce((t, x) => t + x, 0) === n - 2 * size);
const scene = sea(0.01);
for (let i = 0; i < 2 * size; i++) scene[i] = 0.3;
// Two ships: a 2 by 3 block and a 1 by 2 block; one speckle pixel; a bright land row (not water, ignored).
for (const [x, y] of [[4, 5], [5, 5], [6, 5], [4, 6], [5, 6], [6, 6], [12, 14], [13, 14], [17, 3]]) scene[y * size + x] = 1;
const t = brightTargets(scene, valid, water, size);
ok("two ships counted; speckle and land are not", t.count === 2, t);
ok("each ship's centre", t.centres.some(([x, y]) => x === 5 && y === 6) && t.centres.some(([x, y]) => x === 13 && y === 14), t.centres);
ok("a mask packs into bits and back", (() => { const m = new Uint8Array(37).map((_, i) => (i % 3 === 0 ? 1 : 0)); return unpackMask(packMask(m), 37).every((v, i) => v === m[i]); })());
const radar = passesFrom([
  { id: "a1", date: "2026-11-10", at: "", orbit: "ascending", relOrbit: 34, platform: "SENTINEL-1C", corners: 3 },
  { id: "a2", date: "2026-11-10", at: "", orbit: "ascending", relOrbit: 34, platform: "SENTINEL-1C", corners: 12 },
  { id: "b1", date: "2026-11-04", at: "", orbit: "descending", relOrbit: 12, platform: "SENTINEL-1A", corners: 15 },
  { id: "c1", date: "2026-10-29", at: "", orbit: "ascending", relOrbit: 34, platform: "SENTINEL-1C", corners: 3 },
]);
ok("slices of one acquisition merge; a pass that does not cover the box is dropped; newest first", radar.length === 2 && radar[0].ids.join(",") === "a1,a2" && radar[1].ids[0] === "b1", radar);

console.log("when to look, and when not to repeat");
ok("same weeks of earlier years", sameWindowEarlier(new Date("2026-07-20T00:00:00Z"), 21, 4).map((y) => y.year).join(",") === "2025,2024,2023,2022");
ok("its windows are three weeks long", (() => { const y = sameWindowEarlier(new Date("2026-07-20T00:00:00Z"), 21, 1)[0]; return y.to.toISOString().slice(0, 10) === "2025-07-20" && (y.to.getTime() - y.from.getTime()) / 86_400_000 === 21; })());
ok("the growing season, and none means always", inSeason(7, [6, 7, 8, 9]) && !inSeason(11, [6, 7, 8, 9]) && inSeason(11));
const now = Date.parse("2026-11-14T12:00:00Z");
const due = dueSites(SAT_SITES, { "sabine-pass": "2026-11-13T12:00:00Z", "gatun-lake": "2026-11-01T12:00:00Z" }, now);
ok("a site looked at yesterday on a three-day cadence is not due", !due.some((s) => s.id === "sabine-pass"));
ok("never-looked-at sites come first, then the least recent", due[0].id !== "gatun-lake" && due.some((s) => s.id === "gatun-lake"));
ok("a repeat within two weeks, same way and no stronger, is skipped", satRepeats({ at: "2026-11-07T00:00:00Z", direction: "down", z: -2.5 }, { direction: "down", z: -2.8 }, now));
ok("but a much stronger reading is not", !satRepeats({ at: "2026-11-07T00:00:00Z", direction: "down", z: -2.5 }, { direction: "down", z: -4 }, now));
ok("nor one the other way, or a month on", !satRepeats({ at: "2026-11-07T00:00:00Z", direction: "down", z: -2.5 }, { direction: "up", z: 2.6 }, now) && !satRepeats({ at: "2026-10-01T00:00:00Z", direction: "down", z: -2.5 }, { direction: "down", z: -2.6 }, now));

console.log("sites and wording");
ok("every site has tickers, companies, a thesis and a box", SAT_SITES.every((s) => s.tickers.length && s.companies.length && s.thesis.length > 60 && s.km >= 6 && s.km <= 20 && Math.abs(s.lat) <= 70 && Math.abs(s.lon) <= 180));
ok("site ids are unique", new Set(SAT_SITES.map((s) => s.id)).size === SAT_SITES.length);
ok("three analyses, each with several sites", ["crop_vigour", "water_extent", "vessel_traffic"].every((a) => SAT_SITES.filter((s) => s.analysis === a).length >= 4));
ok("crop sites say when they mean something", SAT_SITES.filter((s) => s.analysis === "crop_vigour").every((s) => s.season?.length));
ok("each analysis states its method and caveats", Object.values(METHOD).every((m) => m.method.includes("sat v1") && m.caveats.length > 80));
const words = describeSat({ name: "Central Iowa cropland", analysis: "crop_vigour", companies: ["ADM", "Bunge"] }, low, "2026-07-18", yrs);
ok("the crop card says how far from which years", words.title === "Less green than usual: Central Iowa cropland" && words.summary.includes("2022, 2023, 2024, 2025") && words.summary.includes("-24%"), words);
const ships = describeSat({ name: "Sabine Pass", analysis: "vessel_traffic", companies: ["Cheniere"] }, assess(14, Array.from({ length: 8 }, (_, i) => ({ label: `p${i}`, value: 5 + (i % 3) })), { minN: 6, sdFloor: 1, pctMin: 0.3 }), "2026-11-10", []);
ok("the ships card counts ships and passes", ships.title === "More ships than usual: Sabine Pass" && ships.summary.includes("counts 14") && ships.summary.includes("8 passes"), ships);
ok("no exclamation marks in any wording", ![words.title, words.summary, ships.summary, ...SAT_SITES.map((s) => s.thesis)].some((x) => x.includes("!")));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
