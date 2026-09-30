/**
 * Public asset maps from the U.S. Energy Information Administration, through ArcGIS feature services:
 * natural gas pipelines (interstate, intrastate and gathering, via DOT's National Transportation Atlas)
 * and natural gas processing plants (the EIA-757 survey). Both are U.S. Government works in the public
 * domain. Geometry comes back simplified to about 50 m, which is plenty for a map and keeps rows small.
 */
export type Geometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "MultiLineString"; coordinates: [number, number][][] }
  | { type: "Polygon"; coordinates: [number, number][][] }
  | { type: "MultiPolygon"; coordinates: [number, number][][][] };

export type Bbox = [number, number, number, number];

export type AssetInput = { source: string; sourceId: string; kind: string; name: string; operator: string; status: string; attrs: Record<string, unknown>; geometry: Geometry };

export type SourceInfo = { key: string; name: string; url: string; license: string; vintage: string };

export const EIA_PIPELINES: SourceInfo = {
  key: "eia-gas-pipelines",
  name: "EIA natural gas interstate and intrastate pipelines (DOT National Transportation Atlas)",
  url: "https://geo.dot.gov/server/rest/services/Hosted/Natural_Gas_Pipelines_US_EIA/FeatureServer/0",
  license: "Public domain (U.S. Government work)",
  vintage: "routes 2020, attributes through 2024",
};

export const EIA_PLANTS: SourceInfo = {
  key: "eia-processing-plants",
  name: "EIA natural gas processing plants (EIA-757 survey)",
  url: "https://services.arcgis.com/jDGuO8tYggdCCnUJ/arcgis/rest/services/Natural_Gas_Processing_Plants/FeatureServer/0",
  license: "Public domain (U.S. Government work)",
  vintage: "as of 31 December 2017",
};

type Feature = { id?: number | string; properties: Record<string, unknown>; geometry: Geometry | null };

/** Every feature in a box from an ArcGIS feature service, a page at a time, simplified to `simplify` degrees. */
export async function query(source: SourceInfo, bbox: Bbox, outFields: string, pageSize = 1000, maxPages = 20, simplify = 0.0005): Promise<Feature[]> {
  const out: Feature[] = [];
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({
      where: "1=1", geometry: bbox.join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
      outFields, outSR: "4326", f: "geojson", resultOffset: String(page * pageSize), resultRecordCount: String(pageSize),
      maxAllowableOffset: String(simplify), geometryPrecision: "5",
    });
    const res = await fetch(`${source.url}/query?${qs}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`${source.name} answered ${res.status}`);
    const j = (await res.json()) as { features?: Feature[]; error?: { message?: string } };
    if (j.error) throw new Error(`${source.name}: ${j.error.message ?? "query failed"}`);
    const features = j.features ?? [];
    out.push(...features);
    if (features.length < pageSize) break;
  }
  return out;
}

export const str = (v: unknown) => (typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function gasPipelines(bbox: Bbox): Promise<AssetInput[]> {
  const features = await query(EIA_PIPELINES, bbox, "objectid,typepipe,operator,status");
  return features.filter((f) => f.geometry).map((f) => ({
    source: EIA_PIPELINES.key, sourceId: str(f.properties.objectid ?? f.id), kind: "pipeline",
    name: str(f.properties.operator), operator: str(f.properties.operator), status: str(f.properties.status),
    attrs: { pipeType: str(f.properties.typepipe) }, geometry: f.geometry!,
  }));
}

export async function processingPlants(bbox: Bbox): Promise<AssetInput[]> {
  const features = await query(EIA_PLANTS, bbox, "FID,Plant_Name,Owner,Operator,State,County,City,Cap_MMcfd,Plant_Flow");
  return features.filter((f) => f.geometry).map((f) => ({
    source: EIA_PLANTS.key, sourceId: str(f.properties.FID ?? f.id), kind: "processing_plant",
    name: str(f.properties.Plant_Name), operator: str(f.properties.Operator) || str(f.properties.Owner), status: "operating",
    attrs: { owner: str(f.properties.Owner), state: str(f.properties.State), county: str(f.properties.County), city: str(f.properties.City), capacityMMcfd: num(f.properties.Cap_MMcfd), flowMMcfd: num(f.properties.Plant_Flow) },
    geometry: f.geometry!,
  }));
}

/** Named regions people can watch without drawing one. */
export const PLACES: Record<string, { name: string; bbox: Bbox }> = {
  permian: { name: "Permian Basin", bbox: [-104.6, 30.4, -100.4, 33.9] },
  delaware: { name: "Delaware Basin", bbox: [-104.6, 30.9, -102.9, 32.9] },
  midland: { name: "Midland Basin", bbox: [-102.7, 30.9, -100.9, 33.4] },
  waha: { name: "Waha hub", bbox: [-103.35, 30.95, -102.85, 31.4] },
};
