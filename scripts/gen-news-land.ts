/**
 * The Newsroom globe's land: the radar's world outline (public/radar/world-land.svg, Natural Earth via
 * world-atlas, public domain, drawn equirectangular 1000 by 500) turned into GeoJSON the globe can draw
 * in the theme's own colours, with no map tiles to fetch. Rings inside another ring become its holes
 * (the Caspian, the Great Lakes). Run once when the outline changes:
 *   pnpm exec tsx scripts/gen-news-land.ts
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const svg = readFileSync("public/radar/world-land.svg", "utf8");
const d = svg.match(/ d="([^"]+)"/)?.[1];
if (!d) throw new Error("no path in world-land.svg");

type Ring = [number, number][];
const rings: Ring[] = d.split("Z").map((part) => [...part.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)]
  .map((m) => [Math.round(((Number(m[1]) / 1000) * 360 - 180) * 100) / 100, Math.round((90 - (Number(m[2]) / 500) * 180) * 100) / 100] as [number, number]))
  .filter((r) => r.length >= 4)
  .map((r) => (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]]));

const area = (r: Ring) => r.reduce((s, [x1, y1], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x1 * y2 - x2 * y1; }, 0) / 2;
const inside = ([x, y]: [number, number], r: Ring) => {
  let hit = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

// Largest first, so each ring's container is found before it.
const sorted = [...rings].sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
const polys: Ring[][] = [];
for (const r of sorted) {
  const host = polys.find((p) => inside(r[0], p[0]) && !p.slice(1).some((h) => inside(r[0], h)));
  if (host) host.push(r);
  else polys.push([r]);
}
// GeoJSON winding: outer rings counter-clockwise, holes clockwise.
const wind = (r: Ring, ccw: boolean) => ((area(r) > 0) === ccw ? r : [...r].reverse());
const geo = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: polys.map((p) => p.map((r, i) => wind(r, i === 0))) } }] };
mkdirSync("public/news", { recursive: true });
writeFileSync("public/news/land.json", JSON.stringify(geo));
console.log(`${rings.length} rings, ${polys.length} polygons, ${polys.reduce((n, p) => n + p.length - 1, 0)} holes`);
