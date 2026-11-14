/**
 * The globe: NASA GIBS imagery layers and their dates, and findings as markers (where each sits, its
 * group and colour, the line on why it may move the stock, the New mark).
 *   pnpm exec tsx scripts/test-edge-globe.ts
 */
import { clampDate, GIBS_LAYERS, gibsLayer, gibsTiles, latestDate, shiftDate } from "@/lib/edge/gibs";
import { centreOf, GROUP_COLOR, GROUP_LABEL, GROUP_OF, markerOf, moveWhy } from "@/lib/edge/globe-core";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}`, detail ?? ""); }
};

const now = Date.parse("2026-11-14T12:00:00Z");

console.log("imagery");
const tc = gibsLayer("viirs-truecolor")!;
ok("true colour tiles from the Web Mercator endpoint, z/y/x", gibsTiles(tc, "2026-11-13") === "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/2026-11-13/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg");
ok("night lights are PNG at level 8", gibsTiles(gibsLayer("night")!, "2026-11-13").endsWith("GoogleMapsCompatible_Level8/{z}/{y}/{x}.png"));
ok("the newest full day is yesterday for true colour", latestDate(tc, now) === "2026-11-13");
ok("fires show today's passes", latestDate(gibsLayer("fires")!, now) === "2026-11-14");
ok("Black Marble has one fixed date", latestDate(gibsLayer("black-marble")!, now) === "2016-01-01" && clampDate(gibsLayer("black-marble")!, "2026-01-01", now) === "2016-01-01");
ok("a date past the newest is pulled back", clampDate(tc, "2026-12-01", now) === "2026-11-13");
ok("a date before VIIRS is pulled forward", clampDate(tc, "2010-01-01", now) === "2012-01-20");
ok("a garbled date becomes the newest", clampDate(tc, "next tuesday", now) === "2026-11-13");
ok("a date within range is kept", clampDate(tc, "2025-07-04", now) === "2025-07-04");
ok("days step across months", shiftDate("2026-11-01", -1) === "2026-10-31" && shiftDate("2026-12-31", 1) === "2027-01-01");
ok("layer ids are unique and each says what it shows and whose it is", new Set(GIBS_LAYERS.map((l) => l.id)).size === GIBS_LAYERS.length && GIBS_LAYERS.every((l) => l.blurb.length > 40 && l.credit.includes("NASA")));
ok("true colour, night lights, fires and nitrogen dioxide are all offered", ["viirs-truecolor", "night", "fires", "no2"].every((id) => !!gibsLayer(id)));
ok("overlays (fires, NO2) sit over the ground; true colour is the ground", gibsLayer("fires")!.overlay && gibsLayer("no2")!.overlay && !tc.overlay);

console.log("markers");
ok("a site is where it sits", JSON.stringify(centreOf({ site: { lon: -103.7, lat: 32.2 } }, [-104, 32, -103, 33])) === JSON.stringify({ lon: -103.7, lat: 32.2 }));
ok("else the middle of its box", JSON.stringify(centreOf({}, [-104, 32, -102, 34])) === JSON.stringify({ lon: -103, lat: 33 }));
ok("a site at 0,0 (no coordinates) falls back to the box", JSON.stringify(centreOf({ site: { lon: 0, lat: 0 } }, [10, 10, 12, 12])) === JSON.stringify({ lon: 11, lat: 11 }));
ok("nowhere, no marker", centreOf({}, null) === null);
ok("the card's thesis is its why", moveWhy("crop_vigour", { thesis: "Crop condition in the Corn Belt sets the size of the crop." }) === "Crop condition in the Corn Belt sets the size of the crop.");
ok("a long thesis is cut at a word", (() => { const w = moveWhy("water_extent", { thesis: "word ".repeat(100) }); return w.length <= 240 && w.endsWith("…") && !w.includes("wor…"); })());
ok("a deal-watch marker leads with its first effect", moveWhy("deal_impact", { effects: ["Spread: it can widen."] }) === "Spread: it can widen.");
ok("a merchant reactor and a regulated one read differently", moveWhy("reactor_outage", { merchant: true }) !== moveWhy("reactor_outage", { merchant: false }));
ok("flaring has its own line", moveWhy("flaring", {}).startsWith("A plant that flares"));
const row = { id: 7, kind: "flaring", title: "Flaring at Plant X", tickers: ["TRGP"], bbox: [-104, 32, -103, 33] as [number, number, number, number], visual: { site: { lon: -103.5, lat: 32.5 }, updatedAt: null }, confidence: 0.8, observedAt: new Date("2026-11-13T12:00:00Z"), detectedAt: new Date("2026-11-14T10:00:00Z") };
const m = markerOf(row, now)!;
ok("a finding as a marker: place, group, tickers, confidence", m.lon === -103.5 && m.group === "flaring" && m.tickers[0] === "TRGP" && m.confidence === 0.8);
ok("found two hours ago: new", m.fresh === "new");
ok("seen is the observation time", m.seen === "2026-11-13T12:00:00.000Z");
ok("every marker kind has a group with a colour and a label", Object.values(GROUP_OF).every((g) => GROUP_COLOR[g] && GROUP_LABEL[g]));
ok("an unknown kind is 'other'", markerOf({ ...row, kind: "something_else" }, now)?.group === "other");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
