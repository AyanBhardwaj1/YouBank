/**
 * A digital twin as glTF parts, ready for ./glb.ts: the ground as a terrain mesh from the twin's height
 * grid, the tanks, stacks and towers at their sizes, and the pipelines as tubes, all in metres east,
 * north and up from the site's centre and its lowest ground (so the file opens at a sensible origin in
 * Blender or a CAD viewer). Flames are left out (they are a reading of a week, not a structure). Pure.
 */
import type { DigitalTwin } from "../twin";
import { heightAt, type GroundGrid } from "./heights";
import { merge, placed, stackMesh, tankMesh, tinted, towerMesh, tube, type MeshData } from "./mesh";
import type { GlbPart } from "./glb";

/** Metres east and north of a centre for a lon/lat (flat, fine over a few kilometres). Pure. */
export function localXY(center: { lon: number; lat: number }, lon: number, lat: number): [number, number] {
  return [(lon - center.lon) * 111_320 * Math.cos((center.lat * Math.PI) / 180), (lat - center.lat) * 110_574];
}

/** The ground grid as a vertex-coloured terrain mesh (cells to two triangles each), heights less `base`. Pure. */
export function groundMesh(g: GroundGrid, center: { lon: number; lat: number }, base: number): MeshData {
  const { width: w, height: h } = g;
  const pts: [number, number, number][] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const lon = g.bbox[0] + ((i + 0.5) / w) * (g.bbox[2] - g.bbox[0]), lat = g.bbox[3] - ((j + 0.5) / h) * (g.bbox[3] - g.bbox[1]);
    const [x, y] = localXY(center, lon, lat);
    pts.push([x, y, g.z[j * w + i] - base]);
  }
  const zs = pts.map((p) => p[2]), lo = Math.min(...zs), hi = Math.max(...zs), span = Math.max(1, hi - lo);
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  const colour = (z: number) => { const t = (z - lo) / span; return [0.55 + 0.25 * t, 0.5 + 0.2 * t, 0.4 + 0.15 * t]; };
  const tri = (a: number[], b: number[], c: number[]) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const p of [a, b, c]) { positions.push(p[0], p[1], p[2]); normals.push(n[0] / l, n[1] / l, n[2] / l); colors.push(...colour(p[2])); }
  };
  for (let j = 0; j + 1 < h; j++) for (let i = 0; i + 1 < w; i++) {
    const a = pts[j * w + i], b = pts[j * w + i + 1], c = pts[(j + 1) * w + i + 1], d = pts[(j + 1) * w + i];
    // Rows run north to south, so (a, d, c) and (a, c, b) face up.
    tri(a, d, c); tri(a, c, b);
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), colors: Float32Array.from(colors) };
}

/** The twin's parts for a .glb file. Pure. */
export function twinParts(twin: DigitalTwin): GlbPart[] {
  const base = Math.min(...twin.ground.z);
  const at = (lon: number, lat: number): [number, number, number] => { const [x, y] = localXY(twin.center, lon, lat); return [x, y, heightAt(twin.ground, lon, lat) - base - 0.3]; };
  const tank = tankMesh(), stack = stackMesh(), tower = towerMesh();
  const tanks = twin.models.filter((m) => m.kind === "tank").map((m) => tinted(placed(tank, [m.diameterM, m.diameterM, m.heightM], at(m.lon, m.lat)), m.basis === "lidar" ? [242, 169, 59] : [246, 196, 120]));
  const stacks = twin.models.filter((m) => m.kind !== "tank").map((m) => placed(m.kind === "tower" || m.kind === "shaft" ? tower : stack, [Math.max(1, m.diameterM), Math.max(1, m.diameterM), m.heightM], at(m.lon, m.lat)));
  const pipes = twin.tubes.map((t) => tube(t.path.map(([lon, lat, z]) => { const [x, y] = localXY(twin.center, lon, lat); return [x, y, z - base] as [number, number, number]; }), 1.2, 8));
  return [
    { name: "Ground (AWS Terrain Tiles)", mesh: groundMesh(twin.ground, twin.center, base) },
    { name: "Storage tanks", mesh: merge(...tanks) },
    { name: "Stacks and towers", mesh: merge(...stacks) },
    { name: "Pipelines (route approximate)", mesh: tinted(merge(...pipes), [255, 214, 90]) },
  ];
}
