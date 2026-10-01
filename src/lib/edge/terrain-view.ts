/** Pure helpers the terrain and 3D views share (kept apart from the map library, so tests can load them). */

/** A hexagon of `radiusM` metres around a point, as a closed ring (a plant's column in 3D). Pure. */
export function hexagon(lon: number, lat: number, radiusM: number): [number, number][] {
  const dLat = radiusM / 110_574, dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const ring = Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i + Math.PI / 6; return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)] as [number, number]; });
  return [...ring, ring[0]];
}

/** Where a footprint sits against the ground around it, in words (share = how much of that ground is lower). Pure. */
export function positionWords(share: number): string {
  if (share <= 0.2) return `low-lying: lower than ${Math.round((1 - share) * 100)}% of the ground around it, where water collects`;
  if (share >= 0.8) return `on high ground: higher than ${Math.round(share * 100)}% of the ground around it`;
  return `mid-slope: higher than ${Math.round(share * 100)}% of the ground around it`;
}
