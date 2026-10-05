/**
 * Checks for the 3D maps and geospatial AI: the sun's position and the light it gives, procedural
 * facility meshes and the glTF writer, lidar octree selection and the point cloud wire format, terrain
 * tiles, OpenStreetMap parsing, the digital twin's merging and flame placement, the scene analyses'
 * cells and shapes, the layer registry and the maps plan features. No network, no database.
 *   pnpm exec tsx scripts/test-maps.ts
 */
import { featureById } from "@/lib/billing/features";
import { MAPS_FEATURES } from "@/lib/billing/features/maps";
import { overlayPng, type ChangeResult } from "@/lib/edge/change";
import { children, decodePoints, encodePoints, fromMercator, nodeBounds, overlapShare, passes, selectNodes, surveyYear, toMercator, type Bounds3, type PointCloudHeader } from "@/lib/edge/geo3d/ept";
import { glbJson, toGlb } from "@/lib/edge/geo3d/glb";
import { bounds, box, deckMesh, flameMesh, merge, placed, stackMesh, tankMesh, tinted, triangles, tube } from "@/lib/edge/geo3d/mesh";
import { atSolarHour, hillshadeFor, lightFor, skyFor, solarHour, sunPosition } from "@/lib/edge/geo3d/sun";
import { fillGaps, heightAt, terrariumHeight, tileXY, type GroundGrid } from "@/lib/edge/geo3d/terrarium";
import { groundMesh, localXY, twinParts } from "@/lib/edge/geo3d/twin-export";
import { aiChangeResult, footprintShapes, heatFromOverlay, landUseCells, maskCells } from "@/lib/edge/scene";
import type { SiteModel } from "@/lib/edge/site3d";
import { metresOf, osmSiteFrom, overpassQuery, ringSize } from "@/lib/edge/sources/osm";
import { flameIntensity, flameSite, mergeModels, ringCentre, tubePaths, type DigitalTwin, type TwinModel } from "@/lib/edge/twin";
import { buildLayers, layerDef, MAP_LAYERS } from "@/components/edge/map3d/layers";
import { cloudColors, cloudOriginZ, cloudRange, flicker, heightRamp, hexRgb, type CloudPass } from "@/components/edge/map3d/scene";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

function main() {
  console.log("sun");
  {
    const eq = sunPosition(Date.UTC(2026, 2, 20, 12, 7), 0, 0);
    check("on the March equinox the sun stands almost overhead at the equator at noon", eq.altitude > 85, eq);
    // Midland, Texas at the June solstice: solar noon is about 18:50 UTC; the sun is 90 - (32 - 23.44) = 81.4 degrees up, due south.
    const mid = sunPosition(Date.UTC(2026, 5, 21, 18, 50), 32.0, -102.1);
    check("Midland at the June solstice's noon: about 81 degrees up, due south", near(mid.altitude, 81.4, 1.2) && near(mid.azimuth, 180, 8), mid);
    const morning = sunPosition(Date.UTC(2026, 2, 20, 13, 0), 32.0, -102.1), evening = sunPosition(Date.UTC(2026, 2, 20, 23, 0), 32.0, -102.1);
    check("the sun rises in the east and sets in the west", morning.azimuth > 80 && morning.azimuth < 130 && evening.azimuth > 230 && evening.azimuth < 290, { morning, evening });
    check("at local midnight the sun is below the horizon", sunPosition(atSolarHour(Date.UTC(2026, 5, 21), -102.1, 0.5), 32, -102.1).altitude < -20);
    const t = atSolarHour(Date.UTC(2026, 9, 5, 15), -102.1, 14.5);
    check("solar hours go there and back", near(solarHour(t, -102.1), 14.5, 1e-6), solarHour(t, -102.1));
    const day = skyFor(45, false), night = skyFor(-20, false), dusk = skyFor(1, false);
    check("the sky is blue by day, dark by night and warm at dusk", day.sky !== night.sky && parseInt(night.sky.slice(1, 3), 16) < 40 && parseInt(dusk.horizon.slice(1, 3), 16) > parseInt(dusk.horizon.slice(5, 7), 16), { day, night, dusk });
    const l = lightFor({ azimuth: 135, altitude: 30 });
    check("light comes from the sun's bearing, its polar angle the sun's distance from overhead", l.position[1] === 135 && near(l.position[2], 60, 0.01) && l.intensity > 0.3, l);
    check("hillshade at night falls back to a soft north-west light", hillshadeFor({ azimuth: 10, altitude: -30 }).direction === 315);
  }

  console.log("meshes and glTF");
  {
    const tank = tankMesh(), b = bounds(tank);
    check("a tank is one unit across and a little over one unit tall", near(b[0], -0.5, 1e-3) && near(b[3], 0.5, 1e-3) && near(b[2], 0, 1e-6) && b[5] > 1 && b[5] < 1.1, b);
    let unit = true;
    for (let i = 0; i < tank.normals.length; i += 3) if (!near(Math.hypot(tank.normals[i], tank.normals[i + 1], tank.normals[i + 2]), 1, 1e-3)) unit = false;
    check("every normal is unit length", unit);
    check("a box has twelve triangles", triangles(box(0, 0, 0, 1, 1, 1)) === 12);
    const t = tube([[0, 0, 0], [10, 0, 0], [10, 10, 0]], 1, 8);
    check("a tube has two triangles per side per segment", triangles(t) === 2 * 8 * 2, triangles(t));
    const tb = bounds(t);
    check("a tube is as thick as asked", near(tb[2], -1, 1e-3) && near(tb[5], 1, 1e-3), tb);
    const p = placed(tank, [20, 20, 12], [100, 50, 3]), pb = bounds(p);
    check("placing scales then moves", near(pb[0], 90, 1e-2) && near(pb[3], 110, 1e-2) && near(pb[2], 3, 1e-3), pb);
    check("merging keeps every triangle", triangles(merge(tank, stackMesh())) === triangles(tank) + triangles(stackMesh()));
    const f = flameMesh();
    let tip = 0;
    for (let i = 0; i < f.positions.length; i += 3) if (f.positions[i + 2] > f.positions[tip + 2]) tip = i;
    check("a flame is white-yellow at its root and orange at its tip", f.colors[0] === 1 && f.colors[1] > 0.9 && f.colors[tip + 1] < 0.5 && near(bounds(f)[5], 1, 1e-6), { root: f.colors[1], tip: f.colors[tip + 1] });
    check("tinting multiplies vertex colours", near(tinted(box(0, 0, 0, 1, 1, 1), [255, 0, 0]).colors[1], 0, 1e-9));
    const dm = deckMesh(tank) as { attributes: { POSITION: { size: number }; COLOR_0: unknown } };
    check("deck.gl gets glTF attribute names", dm.attributes.POSITION.size === 3 && !!dm.attributes.COLOR_0);
    const glb = toGlb([{ name: "tank", mesh: placed(tank, [10, 10, 10], [0, 0, 0]) }, { name: "empty", mesh: merge() }]);
    const json = glbJson(glb) as { meshes: { name: string }[]; accessors: { min?: number[]; max?: number[]; count: number }[]; buffers: { byteLength: number }[] };
    const dv = new DataView(glb.buffer);
    check("the .glb header names its length and the empty part is left out", dv.getUint32(8, true) === glb.length && json.meshes.length === 1 && json.accessors.length === 3, json.meshes);
    check("glTF is y-up: a 10 m tall tank's y runs from 0 to about 10.75", near(json.accessors[0].min![1], 0, 1e-3) && near(json.accessors[0].max![1], 10.75, 0.01), json.accessors[0]);
    check("chunks are padded to four bytes", glb.length % 4 === 0 && json.buffers[0].byteLength % 4 === 0);
  }

  console.log("lidar octree and point cloud format");
  {
    const [x, y] = toMercator(-103.95, 32.25), [lon, lat] = fromMercator(x, y);
    check("Web Mercator goes there and back", near(lon, -103.95, 1e-9) && near(lat, 32.25, 1e-9), { lon, lat });
    const root: Bounds3 = [0, 0, 0, 1000, 1000, 1000];
    check("a node's cube halves with each level", JSON.stringify(nodeBounds(root, "1-1-0-1")) === JSON.stringify([500, 0, 500, 1000, 500, 1000]));
    check("a node has eight children one level down", children("1-1-0-0").length === 8 && children("1-1-0-0").includes("2-3-1-1"));
    check("overlap is the share of the footprint inside the box", near(overlapShare([0, 0, 0, 100, 100, 100], [50, 0, 200, 100]), 0.5, 1e-9));
    const hier: Record<string, number> = { "0-0-0-0": 1000 };
    for (const c of children("0-0-0-0")) hier[c] = 1000;
    for (const c of children("1-0-0-0")) hier[c] = 1000;
    const all = selectNodes(hier, root, [0, 0, 1000, 1000], 1e9);
    check("with room, every level touching the box is read", all.nodes.length === 1 + 8 + 8 && all.depth === 2 && !all.truncated, all);
    const tight = selectNodes(hier, root, [0, 0, 1000, 1000], 5000);
    check("a tight budget stops at the last level that fits and keeps the centre's nodes of the next", tight.truncated && tight.expected <= 5000 && tight.nodes[0].key === "0-0-0-0", tight);
    const corner = selectNodes(hier, root, [0, 0, 400, 400], 1e9);
    check("only nodes touching the box are taken, counted by their share inside it", corner.nodes.every((n) => n.expected <= 1000) && corner.nodes.some((n) => n.key === "1-0-0-0"), corner.nodes);
    const pend = selectNodes({ "0-0-0-0": 10, "1-0-0-0": -1 }, root, [0, 0, 1000, 1000], 1e9);
    check("a node whose hierarchy is in another file is asked for", pend.pending.includes("1-0-0-0"), pend);
    const ps = passes([{ key: "a", depth: 0, expected: 100 }, { key: "b", depth: 1, expected: 150 }, { key: "c", depth: 1, expected: 150 }], 200);
    check("passes split shallow levels first under the per-pass size", ps.length === 3 && ps[0][0].key === "a", ps);
    check("the survey year comes from the dataset's name", surveyYear("NM_SouthEast_B3_2018") === 2018 && surveyYear("USGS_LPC_TX_Pecos_Dallas_B1_2018_LAS_2019") === 2019 && surveyYear("AK_BrooksCamp") === 0);
    const n = 5;
    const header: PointCloudHeader = { n, q: 0.05, origin: { lon: -103.95, lat: 32.25, z: 949 }, groundZ: 948.2, survey: "X_2018", year: 2018, pass: 0, passes: 1, depth: 8, truncated: false, classes: { 2: 5 }, bbox: [0, 0, 1, 1] };
    const xyz = Float32Array.from([0, 0, 0, 10.02, -5.51, 2.26, -799.99, 799.97, -7.5, 1, 2, 3, 4, 5, 6]);
    const dec = decodePoints(encodePoints(header, xyz, Uint8Array.from([2, 2, 6, 1, 9]), Uint8Array.from([10, 20, 30, 40, 50])));
    let worst = 0;
    for (let i = 0; i < xyz.length; i++) worst = Math.max(worst, Math.abs(dec.positions[i] - xyz[i]));
    check("points survive the wire format within half a quantum", worst <= 0.025 + 1e-6 && dec.header.survey === "X_2018" && dec.classes[2] === 6 && dec.intensity[4] === 50, worst);
  }

  console.log("terrain tiles");
  {
    check("Terrarium decodes sea level and Everest", terrariumHeight(128, 0, 0) === 0 && near(terrariumHeight(162, 144, 0), 8848, 1));
    const [tx, ty] = tileXY(0, 0, 1);
    check("tile coordinates put (0, 0) at the corner of the four zoom-1 tiles", near(tx, 1, 1e-9) && near(ty, 1, 1e-9));
    const g: GroundGrid = { bbox: [0, 0, 1, 1], width: 2, height: 2, z: [10, 20, 30, 40], zoom: 14 };
    check("heights interpolate between cell centres", near(heightAt(g, 0.5, 0.5), 25, 1e-9) && near(heightAt(g, 0.25, 0.75), 10, 1e-9), heightAt(g, 0.5, 0.5));
    const gaps = [1, Number.NaN, 3];
    fillGaps(gaps);
    check("a missing height becomes the mean of the rest", gaps[1] === 2);
  }

  console.log("OpenStreetMap");
  {
    check("lengths read in metres or feet", metresOf("20") === 20 && near(metresOf("65 ft")!, 19.81, 0.01) && metresOf("20,5 m") === 20.5 && metresOf("tall") === null);
    const sq = ringSize([[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001]]);
    check("a ring's area and widest span", near(sq.areaM2, 111.3 * 110.6, 30) && near(sq.spanM, Math.hypot(111.3, 110.6), 1), sq);
    check("the Overpass query asks for the site's box in south, west, north, east order", overpassQuery([-104, 32, -103.9, 32.1]).includes("(32.000000,-104.000000,32.100000,-103.900000)"));
    const circle = (lon: number, lat: number, r: number) => Array.from({ length: 16 }, (_, i) => ({ lon: lon + (r / 94_500) * Math.cos((i / 16) * 2 * Math.PI), lat: lat + (r / 110_600) * Math.sin((i / 16) * 2 * Math.PI) }));
    const site = osmSiteFrom({ elements: [
      { type: "way", id: 1, tags: { man_made: "storage_tank", diameter: "30" }, geometry: circle(-103.95, 32.25, 15) },
      { type: "way", id: 2, tags: { man_made: "storage_tank" }, geometry: circle(-103.951, 32.25, 10) },
      { type: "node", id: 3, lat: 32.251, lon: -103.95, tags: { man_made: "flare", height: "40" } },
      { type: "way", id: 4, tags: { man_made: "pipeline", substance: "gas", diameter: "610" }, geometry: [{ lat: 32.24, lon: -103.96 }, { lat: 32.26, lon: -103.94 }] },
      { type: "way", id: 5, tags: { telecom: "data_center", name: "DC1", "building:levels": "3" }, geometry: [{ lat: 32, lon: -104 }, { lat: 32, lon: -103.999 }, { lat: 32.001, lon: -103.999 }, { lat: 32, lon: -104 }] },
      { type: "relation", id: 6, tags: { landuse: "quarry" }, members: [{ role: "outer", geometry: [{ lat: 32, lon: -104 }, { lat: 32, lon: -103.99 }, { lat: 32.01, lon: -103.99 }] }] },
      { type: "node", id: 7, lat: 32, lon: -104, tags: { amenity: "cafe" } },
    ] });
    const tagged = site.points.find((p) => p.id === "way/1"), guessed = site.points.find((p) => p.id === "way/2");
    check("a tank keeps its tagged diameter; an untagged one is sized from its outline and marked estimated", tagged?.diameterM === 30 && !!guessed && near(guessed.diameterM, 20, 1.5) && guessed.estimated, { tagged, guessed });
    check("a flare stack, a pipeline in millimetres, a data centre by floors and a quarry relation", site.points.some((p) => p.kind === "flare" && p.heightM === 40) && site.lines[0]?.diameterMm === 610 && site.lines[0].buried && site.areas.some((a) => a.kind === "datacenter" && a.heightM === 10.5) && site.areas.some((a) => a.kind === "mine"), site);
    check("other features are ignored", site.points.length === 3);
  }

  console.log("digital twin");
  {
    check("a ring's centre leaves out its closing point", JSON.stringify(ringCentre([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]])) === "[1,1]");
    check("flame intensity grows with heat and days, within bounds", flameIntensity(0, 0) === 0.15 && flameIntensity(100, 7) === 1 && flameIntensity(20, 3) > flameIntensity(5, 1));
    const lidarSite = { structures: [
      { kind: "tank", heightM: 12, areaM2: 700, diameterM: 30, volumeM3: 8482, ring: [[-103.95015, 32.25], [-103.94985, 32.25], [-103.94985, 32.2503], [-103.95015, 32.2503], [-103.95015, 32.25]] },
      { kind: "structure", heightM: 6, areaM2: 400, diameterM: null, volumeM3: null, ring: [[0, 0], [0, 0], [0, 0]] },
    ] } as unknown as SiteModel;
    const osm = osmSiteFrom({ elements: [
      { type: "node", id: 9, lat: 32.25015, lon: -103.95, tags: { man_made: "storage_tank", name: "Tank 7" } },
      { type: "node", id: 10, lat: 32.26, lon: -103.94, tags: { man_made: "storage_tank", diameter: "12", height: "9" } },
    ] });
    const models = mergeModels(lidarSite, osm, () => 900);
    check("a mapped tank on a measured one is the same tank: the measurement wins, the name is kept", models.length === 2 && models[0].basis === "lidar" && models[0].name === "Tank 7" && models[1].basis === "osm" && models[1].groundM === 900, models);
    const paths = tubePaths([[[-103.95, 32.25], [-103.95, 32.252]]], () => 900);
    check("pipelines get a point every 25 m and ride above the ground", paths[0].length >= 9 && paths[0].every((p) => near(p[2], 901.5, 0.05)), paths[0].length);
    const m = (kind: TwinModel["kind"], lon: number, heightM: number, basis: TwinModel["basis"] = "osm"): TwinModel => ({ id: kind + lon, kind, lon, lat: 32.25, groundM: 0, heightM, diameterM: 2, name: "", content: "", volumeM3: null, basis });
    check("a flare is lit on a mapped flare stack first", flameSite([m("tower", -103.95, 60, "lidar"), m("flare", -103.951, 35)], { lon: -103.95, lat: 32.25 }).placed === "osm");
    check("else on the tallest measured tower nearby", flameSite([m("tower", -103.95, 20, "lidar"), m("tower", -103.9505, 45, "lidar")], { lon: -103.95, lat: 32.25 }).stackM === 45);
    check("else where the satellites saw the heat", flameSite([m("flare", -103.9, 35)], { lon: -103.95, lat: 32.25 }).placed === "viirs");
  }

  console.log("scene analysis");
  {
    const mask = new Uint8Array(16 * 16);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) mask[y * 16 + x] = 1;
    for (let y = 8; y < 12; y++) for (let x = 8; x < 16; x++) mask[y * 16 + x] = 2;
    const cells = maskCells(mask, 16, 16, [0, 0, 1, 1], 8);
    check("a mask sums into cells: a full cell, a half cell of the other kind, empty cells left out", cells.length === 2 && cells[0].v === 1 && cells[0].k === 1 && cells[1].v === 0.5 && cells[1].k === 2 && near(cells[0].lon, 0.25, 1e-6) && near(cells[0].lat, 0.75, 1e-6), cells);
    const now = new Uint8Array(16).fill(7), before = new Uint8Array(16).fill(11);
    before.fill(7, 0, 8);
    const lu = landUseCells(now, before, 4, 4, [0, 0, 1, 1], 2);
    check("land use: built cells that were rangeland are marked as grown", lu.length === 4 && lu.filter((c) => c.t === 1).length === 2 && lu.every((c) => c.k === 7 && c.v === 1), lu);
    const ring = (n: number, r: number, cx: number, cy: number) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)] as [number, number]);
    const bbox: [number, number, number, number] = [-103.96, 32.24, -103.94, 32.26]; // about 1,880 m across
    const shapes = footprintShapes([{ points: ring(24, 10, 100, 100), score: 0.9 }, { points: [[300, 300], [330, 300], [330, 310], [300, 310]] }, { points: [[500, 500], [900, 500], [900, 900], [500, 900]] }], [1024, 1024], bbox);
    check("footprints sort into a round tank, a building and a large pad", shapes.length === 3 && shapes.some((s) => s.k === 1 && s.heightM > 4) && shapes.some((s) => s.k === 2 && s.heightM === 6) && shapes.some((s) => s.k === 3), shapes.map((s) => [s.k, s.areaM2]));
    const ai = aiChangeResult({ years: [2024, 2025], grid: { width: 2, height: 2, values: [-1, 0.05, 0.2, 0.6] }, stats: { above: { "0.3": 0.12 } } }, [0, 0, 1, 1]);
    check("AI change keeps cells that changed, graded by how much", ai.cells.length === 2 && ai.cells[0].k === 2 && ai.cells[1].k === 3 && ai.summary.includes("12%"), ai.cells);
    const r = { width: 16, height: 16, mask } as unknown as ChangeResult;
    const heat = heatFromOverlay(`data:image/png;base64,${overlayPng(r).toString("base64")}`, [-103.96, 32.24, -103.94, 32.26]);
    check("a finding's own overlay comes back as the same cells", heat.cells.length === 2 && heat.cells[0].k === 1 && heat.cellM > 0, heat.cells);
  }

  console.log("3D layers");
  {
    check("colours parse", JSON.stringify(hexRgb("#46B3C9")) === "[70,179,201]" && JSON.stringify(heightRamp(0)) === "[68,1,84]");
    let lo = 1, hi = 0;
    for (let t = 0; t < 20_000; t += 7) { const f = flicker(t, 3, 0.8); lo = Math.min(lo, f); hi = Math.max(hi, f); }
    check("a flame flickers between about three quarters and its full height", lo >= 0.72 && hi <= 1.0001 && hi - lo > 0.1, { lo, hi });
    const p: CloudPass = { header: { n: 2, q: 0.05, origin: { lon: 0, lat: 0, z: 950 }, groundZ: 948, survey: "", year: 0, pass: 0, passes: 1, depth: 0, truncated: false, classes: {}, bbox: [0, 0, 1, 1] }, positions: Float32Array.from([0, 0, -2, 0, 0, 10]), classes: Uint8Array.from([2, 6]), intensity: Uint8Array.from([0, 100]) };
    const cc = cloudColors(p, "class", [0, 1]);
    check("points are coloured by class: ground brown, buildings orange", cc[0] === 168 && cc[4] === 238 && cc.length === 8);
    const range = cloudRange([p]);
    check("the height range spans the cloud", near(range[0], 948, 0.01) && near(range[1], 960, 0.01), range);
    check("a cloud's ground meets the map's: terrain at 900 m puts the origin 2 m above it", cloudOriginZ(p.header, 900, 1) === 902 && cloudOriginZ(p.header, 900, 2) === 1802);
    check("without a ground return the cloud keeps its own heights", cloudOriginZ({ ...p.header, groundZ: null }, 900, 1) === 950);
    const ids = MAP_LAYERS.map((d) => d.id);
    check("registry ids are unique", new Set(ids).size === ids.length, ids);
    check("deck.gl layer ids lead back to their registry entry", layerDef("twin-models:tanks")?.id === "twin-models" && layerDef("lidar-cloud:3")?.id === "lidar-cloud" && !layerDef("nope"));
    check("an empty scene builds no layers (and needs no deck.gl)", buildLayers({ mods: null as never, scene: {}, time: 0, zoom: 10, relief: 1, ground: () => 0, groundKey: 0, lite: false }).length === 0);
    const tank: TwinModel = { id: "t", kind: "tank", lon: 0, lat: 0, groundM: 0, heightM: 12, diameterM: 30, name: "", content: "crude", volumeM3: 8482, basis: "lidar" };
    const words = layerDef("twin-models")!.describe!(tank, {});
    check("a clicked tank says its size, where that came from and its barrels", words?.includes("30 m across") === true && words.includes("lidar") && words.includes("53,350 barrels") && words.includes("crude"), words);
    check("premium layers name a maps feature", MAP_LAYERS.filter((d) => d.premium).every((d) => featureById(d.premium!)?.area === "maps"));
  }

  console.log("twin export");
  {
    const g: GroundGrid = { bbox: [-0.01, -0.01, 0.01, 0.01], width: 4, height: 4, z: Array.from({ length: 16 }, (_, i) => 100 + i), zoom: 14 };
    const gm = groundMesh(g, { lon: 0, lat: 0 }, 100);
    let up = true;
    for (let i = 2; i < gm.normals.length; i += 3) if (gm.normals[i] <= 0) up = false;
    check("the ground mesh has two triangles per cell, all facing up", triangles(gm) === 18 && up);
    check("local metres are east and north of the centre", near(localXY({ lon: 0, lat: 0 }, 0.001, 0)[0], 111.32, 0.01) && near(localXY({ lon: 0, lat: 0 }, 0, 0.001)[1], 110.574, 0.01));
    const twin = { center: { lon: 0, lat: 0 }, ground: g, models: [{ id: "t", kind: "tank", lon: 0, lat: 0, groundM: 105, heightM: 12, diameterM: 30, name: "", content: "", volumeM3: 1, basis: "lidar" }], tubes: [{ id: "p", name: "", substance: "gas", path: [[-0.005, 0, 106], [0.005, 0, 106]], buried: true, source: "eia" }] } as unknown as DigitalTwin;
    const parts = twinParts(twin);
    const json = glbJson(toGlb(parts)) as { meshes: { name: string }[] };
    check("a twin exports ground, tanks and pipelines (no stacks here)", json.meshes.map((m) => m.name).join("|") === "Ground (AWS Terrain Tiles)|Storage tanks|Pipelines (route approximate)", json.meshes);
  }

  console.log("plan features");
  {
    const ids = MAPS_FEATURES.map((f) => f.id);
    check("every maps feature is in the maps area with a unique maps.* id", new Set(ids).size === ids.length && MAPS_FEATURES.every((f) => f.area === "maps" && f.id.startsWith("maps.")));
    check("metered features name a cost; perks cost nothing per use", MAPS_FEATURES.every((f) => (f.metered ? (f.costPerUseUsd ?? 0) > 0 : (f.costPerUseUsd ?? 0) === 0)));
    check("the shared registry finds them", !!featureById("maps.lidar") && featureById("maps.planet-drape")?.minPlan === "team");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main();
