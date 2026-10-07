/** The small part of GeoJSON (RFC 7946) the crypto map layer uses. Pure types. */
export type Point = { type: "Point"; coordinates: [number, number] };
export type Feature<G, P> = { type: "Feature"; id?: string | number; geometry: G; properties: P };
export type FeatureCollection<G, P> = { type: "FeatureCollection"; features: Feature<G, P>[] };
