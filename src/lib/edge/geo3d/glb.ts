/**
 * A digital twin as a binary glTF (.glb) file, for Blender, a CAD viewer or a slide: one node per part
 * (the ground, each group of models), vertex-coloured, in metres around the site's centre. glTF is
 * y-up and right-handed, so east stays x, up becomes y and north becomes -z. Written by hand (the format
 * is a JSON chunk and a binary chunk) so the export needs no library and no server. Pure.
 */
import type { MeshData } from "./mesh";

export type GlbPart = { name: string; mesh: MeshData };

const pad4 = (n: number) => (n + 3) & ~3;

/** The parts as a .glb file. Parts with no triangles are left out. */
export function toGlb(parts: GlbPart[], meta: { generator?: string; copyright?: string } = {}): Uint8Array {
  const used = parts.filter((p) => p.mesh.positions.length >= 9);
  const views: { byteOffset: number; byteLength: number; target: number }[] = [];
  const accessors: Record<string, unknown>[] = [];
  const chunks: Float32Array[] = [];
  let offset = 0;
  const addAccessor = (data: Float32Array, withBounds: boolean) => {
    views.push({ byteOffset: offset, byteLength: data.byteLength, target: 34962 });
    chunks.push(data);
    offset += pad4(data.byteLength);
    const acc: Record<string, unknown> = { bufferView: views.length - 1, componentType: 5126, count: data.length / 3, type: "VEC3" };
    if (withBounds) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < data.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], data[i + k]); max[k] = Math.max(max[k], data[i + k]); }
      acc.min = min; acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  // East-north-up to glTF's y-up: (x, y, z) -> (x, z, -y), for positions and normals alike.
  const yUp = (a: Float32Array) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i += 3) { o[i] = a[i]; o[i + 1] = a[i + 2]; o[i + 2] = -a[i + 1]; } return o; };
  const meshes = used.map((p) => ({
    name: p.name,
    primitives: [{ attributes: { POSITION: addAccessor(yUp(p.mesh.positions), true), NORMAL: addAccessor(yUp(p.mesh.normals), false), COLOR_0: addAccessor(p.mesh.colors, false) }, material: 0, mode: 4 }],
  }));
  const json = {
    asset: { version: "2.0", generator: meta.generator ?? "YouBank Edge", ...(meta.copyright ? { copyright: meta.copyright } : {}) },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, i) => i) }],
    nodes: meshes.map((m, i) => ({ name: m.name, mesh: i })),
    meshes,
    materials: [{ name: "vertex colour", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 }, doubleSided: true }],
    accessors,
    bufferViews: views.map((v) => ({ buffer: 0, ...v })),
    buffers: [{ byteLength: offset }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.length);
  const total = 12 + 8 + jsonLen + 8 + offset;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen);
  const bin = 20 + jsonLen;
  dv.setUint32(bin, offset, true);
  dv.setUint32(bin + 4, 0x004e4942, true); // "BIN\0"
  let o = bin + 8;
  for (const c of chunks) { out.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), o); o += pad4(c.byteLength); }
  return out;
}

/** Read back a .glb's JSON chunk (for tests and sanity checks). Pure. */
export function glbJson(glb: Uint8Array): Record<string, unknown> {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("Not a glTF binary");
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len)).trim()) as Record<string, unknown>;
}
