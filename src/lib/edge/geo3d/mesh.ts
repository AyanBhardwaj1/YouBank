/**
 * Facility models built from code, not downloaded: storage tanks, stacks, flames, towers, pipelines as
 * tubes, data halls and their rooftop plant. Each is a small triangle mesh in metres (x east, y north,
 * z up, the base at z = 0), sized at one unit so a single mesh serves every instance and deck.gl scales
 * it to each tank's measured diameter and height. No textures, no hosts to hotlink, a few kilobytes
 * each, and the same meshes write straight into a glTF file for export (./glb.ts). Pure.
 */

/** Flat arrays, three numbers per vertex, three vertices per triangle (no index buffer: the meshes are small). */
export type MeshData = { positions: Float32Array; normals: Float32Array; colors: Float32Array };

type V3 = [number, number, number];

/** Collects triangles with a colour per vertex. */
class Builder {
  p: number[] = []; n: number[] = []; c: number[] = [];
  tri(a: V3, b: V3, c: V3, ca: V3, cb: V3 = ca, cc: V3 = ca, na?: V3, nb?: V3, nc?: V3) {
    const flat = faceNormal(a, b, c);
    this.p.push(...a, ...b, ...c);
    this.n.push(...(na ?? flat), ...(nb ?? flat), ...(nc ?? flat));
    this.c.push(...ca, ...cb, ...cc);
  }
  quad(a: V3, b: V3, c: V3, d: V3, col: V3, cTop?: V3) {
    this.tri(a, b, c, col, col, cTop ?? col);
    this.tri(a, c, d, col, cTop ?? col, cTop ?? col);
  }
  done(): MeshData { return { positions: Float32Array.from(this.p), normals: Float32Array.from(this.n), colors: Float32Array.from(this.c) }; }
}

function faceNormal(a: V3, b: V3, c: V3): V3 {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

const GREY = (v: number): V3 => [v, v, v];

/**
 * A surface of revolution about the z axis from a profile of [radius, z] points (bottom to top),
 * smooth-shaded, with a colour per profile point; closed at the ends where the radius is above zero.
 */
export function lathe(profile: [number, number][], segments: number, colorAt: (k: number) => V3 = () => GREY(1), opts: { capBottom?: boolean; capTop?: boolean } = {}): MeshData {
  const b = new Builder();
  const ring = (r: number, z: number, i: number): V3 => { const a = (i / segments) * Math.PI * 2; return [r * Math.cos(a), r * Math.sin(a), z]; };
  for (let k = 0; k + 1 < profile.length; k++) {
    const [r0, z0] = profile[k], [r1, z1] = profile[k + 1];
    // The profile's slope gives the normal's tilt (smooth around, faceted along the height).
    const dr = r1 - r0, dz = z1 - z0, len = Math.hypot(dr, dz) || 1;
    const tilt = { out: dz / len, up: -dr / len };
    const nrm = (i: number): V3 => { const a = (i / segments) * Math.PI * 2; return [tilt.out * Math.cos(a), tilt.out * Math.sin(a), tilt.up]; };
    const c0 = colorAt(k), c1 = colorAt(k + 1);
    for (let i = 0; i < segments; i++) {
      const a = ring(r0, z0, i), bb = ring(r0, z0, i + 1), c = ring(r1, z1, i + 1), d = ring(r1, z1, i);
      if (r0 > 1e-6) b.tri(a, bb, c, c0, c0, c1, nrm(i), nrm(i + 1), nrm(i + 1));
      if (r1 > 1e-6) b.tri(a, c, d, c0, c1, c1, nrm(i), nrm(i + 1), nrm(i));
    }
  }
  const cap = (r: number, z: number, up: boolean, col: V3) => {
    if (r <= 1e-6) return;
    for (let i = 0; i < segments; i++) {
      const a = ring(r, z, i), c = ring(r, z, i + 1), m: V3 = [0, 0, z];
      if (up) b.tri(m, a, c, col); else b.tri(m, c, a, col);
    }
  };
  if (opts.capBottom ?? true) cap(profile[0][0], profile[0][1], false, colorAt(0));
  if (opts.capTop ?? true) cap(profile[profile.length - 1][0], profile[profile.length - 1][1], true, colorAt(profile.length - 1));
  return b.done();
}

/** An axis-aligned box from (x0, y0, z0) to (x1, y1, z1). */
export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: V3 = GREY(1)): MeshData {
  const b = new Builder();
  const P = (x: number, y: number, z: number): V3 => [x, y, z];
  b.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), col); // top
  b.quad(P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0), col); // bottom
  b.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), col); // south
  b.quad(P(x1, y1, z0), P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), col); // north
  b.quad(P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), col); // west
  b.quad(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1), col); // east
  return b.done();
}

/** Several meshes as one. */
export function merge(...meshes: MeshData[]): MeshData {
  const cat = (k: keyof MeshData) => { const out = new Float32Array(meshes.reduce((s, m) => s + m[k].length, 0)); let o = 0; for (const m of meshes) { out.set(m[k], o); o += m[k].length; } return out; };
  return { positions: cat("positions"), normals: cat("normals"), colors: cat("colors") };
}

/** Number of triangles in a mesh. */
export const triangles = (m: MeshData) => m.positions.length / 9;

/* ---------------- The facility library (one unit across, one unit tall) ---------------- */

/** A storage tank: a cylinder one unit across and one tall with a low cone roof and a darker footing ring. */
export function tankMesh(segments = 28): MeshData {
  return lathe([[0.5, 0], [0.5, 0.04], [0.5, 1], [0.49, 1.005], [0.06, 1.07], [0, 1.075]], segments, (k) => (k <= 0 ? GREY(0.62) : k <= 2 ? GREY(1) : GREY(0.8)));
}

/** A slender stack (flare stack, chimney, column): a tapering cylinder with a lip at the top. */
export function stackMesh(segments = 14): MeshData {
  return lathe([[0.5, 0], [0.42, 0.9], [0.42, 0.97], [0.6, 0.97], [0.6, 1], [0.0, 1]], segments, (k) => (k >= 2 ? GREY(0.55) : GREY(0.92)));
}

/** A flame one unit tall: a bulb that narrows to a tip, white-yellow at the root to deep orange at the top. */
export function flameMesh(segments = 16, steps = 10): MeshData {
  const profile: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const z = i / steps;
    profile.push([i === steps ? 0 : 0.5 * Math.sin(Math.PI * Math.pow(z, 0.62)) * Math.pow(1 - z, 0.18) + (i === 0 ? 0.08 : 0), z]);
  }
  const at = (k: number): V3 => { const t = k / steps; return [1, 0.95 - 0.55 * t, Math.max(0, 0.7 - 1.4 * t)]; };
  return lathe(profile, segments, at, { capBottom: true, capTop: false });
}

/** A lattice tower stood in for by a tapered square shaft (towers, masts, rigs). */
export function towerMesh(): MeshData {
  return lathe([[0.7, 0], [0.18, 1], [0, 1]], 4, () => GREY(0.85));
}

/** A data hall one unit square and tall, with rows of rooftop chillers. */
export function hallMesh(): MeshData {
  const parts: MeshData[] = [box(-0.5, -0.5, 0, 0.5, 0.5, 1, GREY(0.95))];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) parts.push(box(-0.38 + i * 0.2, -0.32 + j * 0.25, 1, -0.24 + i * 0.2, -0.16 + j * 0.25, 1.08, GREY(0.6)));
  return merge(...parts);
}

/**
 * A tube along a path of points in metres (a pipeline), `radius` metres thick with `sides` faces,
 * smooth-shaded. Consecutive points closer than a centimetre are dropped.
 */
export function tube(path: V3[], radius: number, sides = 8, col: V3 = GREY(1)): MeshData {
  const pts = path.filter((p, i) => i === 0 || Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1], p[2] - path[i - 1][2]) > 0.01);
  const b = new Builder();
  if (pts.length < 2) return b.done();
  // A frame at each point: the tangent, and two perpendiculars kept level (a pipe does not roll).
  const frames = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
    let t: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const tl = Math.hypot(...t) || 1; t = [t[0] / tl, t[1] / tl, t[2] / tl];
    let side: V3 = [-t[1], t[0], 0];
    const sl = Math.hypot(...side);
    side = sl < 1e-6 ? [1, 0, 0] : [side[0] / sl, side[1] / sl, 0];
    const up: V3 = [t[1] * side[2] - t[2] * side[1], t[2] * side[0] - t[0] * side[2], t[0] * side[1] - t[1] * side[0]];
    return { p, side, up };
  });
  const at = (f: (typeof frames)[number], k: number): { v: V3; n: V3 } => {
    const a = (k / sides) * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
    const n: V3 = [f.side[0] * cs + f.up[0] * sn, f.side[1] * cs + f.up[1] * sn, f.side[2] * cs + f.up[2] * sn];
    return { v: [f.p[0] + n[0] * radius, f.p[1] + n[1] * radius, f.p[2] + n[2] * radius], n };
  };
  for (let i = 0; i + 1 < frames.length; i++) {
    for (let k = 0; k < sides; k++) {
      const a = at(frames[i], k), bb = at(frames[i], k + 1), c = at(frames[i + 1], k + 1), d = at(frames[i + 1], k);
      b.tri(a.v, bb.v, c.v, col, col, col, a.n, bb.n, c.n);
      b.tri(a.v, c.v, d.v, col, col, col, a.n, c.n, d.n);
    }
  }
  return b.done();
}

/** A mesh in the shape deck.gl's SimpleMeshLayer takes (glTF attribute names). */
export function deckMesh(m: MeshData) {
  return { attributes: { POSITION: { value: m.positions, size: 3 }, NORMAL: { value: m.normals, size: 3 }, COLOR_0: { value: m.colors, size: 3 } } };
}

/** A mesh moved and scaled (scale first, then move), normals corrected for uneven scaling. */
export function placed(m: MeshData, scale: V3, at: V3): MeshData {
  const positions = new Float32Array(m.positions.length), normals = new Float32Array(m.normals.length);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = m.positions[i] * scale[0] + at[0];
    positions[i + 1] = m.positions[i + 1] * scale[1] + at[1];
    positions[i + 2] = m.positions[i + 2] * scale[2] + at[2];
    const nx = m.normals[i] / (scale[0] || 1), ny = m.normals[i + 1] / (scale[1] || 1), nz = m.normals[i + 2] / (scale[2] || 1);
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[i] = nx / l; normals[i + 1] = ny / l; normals[i + 2] = nz / l;
  }
  return { positions, normals, colors: m.colors };
}

/** A mesh with every vertex colour multiplied by an RGB colour (0 to 255). */
export function tinted(m: MeshData, rgb: [number, number, number]): MeshData {
  const colors = new Float32Array(m.colors.length);
  for (let i = 0; i < colors.length; i += 3) { colors[i] = m.colors[i] * rgb[0] / 255; colors[i + 1] = m.colors[i + 1] * rgb[1] / 255; colors[i + 2] = m.colors[i + 2] * rgb[2] / 255; }
  return { ...m, colors };
}

/** The bounding box of a mesh: [minX, minY, minZ, maxX, maxY, maxZ]. */
export function bounds(m: MeshData): [number, number, number, number, number, number] {
  const b: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], m.positions[i + k]); b[k + 3] = Math.max(b[k + 3], m.positions[i + k]); }
  return b;
}
