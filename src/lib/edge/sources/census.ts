/**
 * County boundaries from the U.S. Census Bureau (TIGERweb), public domain. Edge uses them for the
 * county view of a deal: where both companies operate, which counties touch, and each county's
 * processing concentration before and after. Simplified to about 500 m, plenty at county scale.
 */
import { query, str, type AssetInput, type Bbox, type SourceInfo } from "./eia";

export const CENSUS_COUNTIES: SourceInfo = {
  key: "census-counties",
  name: "U.S. Census Bureau TIGERweb counties",
  url: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1",
  license: "Public domain (U.S. Government work)",
  vintage: "current TIGER/Line boundaries",
};

const STATES: Record<string, string> = { "35": "NM", "48": "TX", "40": "OK", "08": "CO", "22": "LA", "05": "AR" };

export async function counties(bbox: Bbox): Promise<AssetInput[]> {
  const features = await query(CENSUS_COUNTIES, bbox, "GEOID,NAME,BASENAME,STATE", 500, 4, 0.005);
  return features.filter((f) => f.geometry).map((f) => {
    const state = str(f.properties.STATE);
    return {
      source: CENSUS_COUNTIES.key, sourceId: str(f.properties.GEOID), kind: "county",
      name: `${str(f.properties.BASENAME) || str(f.properties.NAME)}${STATES[state] ? `, ${STATES[state]}` : ""}`, operator: "", status: "",
      attrs: { geoid: str(f.properties.GEOID), state }, geometry: f.geometry!,
    };
  });
}
