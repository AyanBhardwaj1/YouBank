/**
 * Bitcoin mining sites and crypto data centres, for the map. Pure data, safe on the client.
 *
 * Compiled from the listed miners' own public disclosures (10-K, 20-F, 40-F and investor updates,
 * through mid-2025) and press releases they filed; each site links to the operator's filings on SEC
 * EDGAR so the figure can be checked. Locations are to the town or county, not the fence line, and are
 * marked approximate. Capacity is the operator's stated power capacity in megawatts where it gave one
 * clearly for that site; where a figure covered several sites, or the site is changing, it is left
 * blank and the note says why. Several sites are being converted from mining to AI and
 * high-performance computing, which the status says.
 *
 * Power use: EIA estimated in February 2024 that U.S. crypto mining used 0.6% to 2.3% of the
 * country's electricity in 2023 (about 25 to 91 TWh). A site's annual use here is an estimate:
 * capacity x 8,760 hours x an 85% load factor, labelled as such.
 */
import type { FeatureCollection, Point } from "./geo";

export type SiteKind = "bitcoin_mining" | "hpc_conversion" | "hosting";
export type Site = {
  id: string; name: string; operator: string; ticker: string; kind: SiteKind; status: string;
  city: string; region: string; country: string; lat: number; lon: number;
  capacityMw: number | null; power: string; note: string;
};

export const LOAD_FACTOR = 0.85;
export const EIA_ESTIMATE = { low: 0.006, high: 0.023, year: 2023, url: "https://www.eia.gov/todayinenergy/detail.php?id=61364", text: "EIA estimates U.S. crypto mining used 0.6% to 2.3% of U.S. electricity in 2023." };

const S = (id: string, operator: string, ticker: string, name: string, kind: SiteKind, status: string, city: string, region: string, country: string, lat: number, lon: number, capacityMw: number | null, power: string, note = ""): Site =>
  ({ id, name, operator, ticker, kind, status, city, region, country, lat, lon, capacityMw, power, note });

export const SITES: Site[] = [
  S("riot-rockdale", "Riot Platforms", "RIOT", "Rockdale Facility", "bitcoin_mining", "operating", "Rockdale", "TX", "US", 30.656, -97.001, 700, "ERCOT grid, with demand response"),
  S("riot-corsicana", "Riot Platforms", "RIOT", "Corsicana Facility", "bitcoin_mining", "operating (first phase); rest under evaluation for AI/HPC", "Corsicana", "TX", "US", 32.095, -96.469, 1000, "ERCOT grid", "1 GW of approved power; the first 400 MW were built for mining."),
  S("mara-granbury", "MARA Holdings", "MARA", "Granbury", "bitcoin_mining", "operating", "Granbury", "TX", "US", 32.442, -97.794, null, "ERCOT grid", "Acquired with Kearney in a 390 MW two-site purchase (2023)."),
  S("mara-kearney", "MARA Holdings", "MARA", "Kearney", "bitcoin_mining", "operating", "Kearney", "NE", "US", 40.699, -99.083, null, "SPP grid", "Acquired with Granbury in a 390 MW two-site purchase (2023)."),
  S("mara-garden-city", "MARA Holdings", "MARA", "Garden City", "bitcoin_mining", "operating", "Garden City", "TX", "US", 31.864, -101.481, 200, "ERCOT grid", "Bought from Applied Digital in 2024."),
  S("mara-hansford", "MARA Holdings", "MARA", "Hansford County wind farm", "bitcoin_mining", "operating", "Spearman", "TX", "US", 36.198, -101.192, 114, "Wind farm with co-located mining", "Capacity is the wind farm's."),
  S("apld-jamestown", "Applied Digital", "APLD", "Jamestown", "hosting", "operating (hosting)", "Jamestown", "ND", "US", 46.911, -98.708, 106, "MISO grid"),
  S("apld-ellendale", "Applied Digital", "APLD", "Ellendale (Polaris Forge)", "hpc_conversion", "hosting operating; AI campus under construction", "Ellendale", "ND", "US", 46.003, -98.527, 180, "MISO grid", "Capacity is the hosting facility; the AI campus beside it is being built for CoreWeave."),
  S("cors-denton", "Core Scientific", "CORZ", "Denton", "hpc_conversion", "converting to AI/HPC (CoreWeave)", "Denton", "TX", "US", 33.215, -97.133, null, "ERCOT grid"),
  S("cors-calvert", "Core Scientific", "CORZ", "Calvert City", "bitcoin_mining", "operating", "Calvert City", "KY", "US", 37.033, -88.350, null, "TVA region"),
  S("cors-marble", "Core Scientific", "CORZ", "Marble", "bitcoin_mining", "operating", "Marble", "NC", "US", 35.175, -83.926, null, "Duke Energy / TVA region"),
  S("cors-dalton", "Core Scientific", "CORZ", "Dalton", "bitcoin_mining", "operating", "Dalton", "GA", "US", 34.770, -84.970, null, "Georgia grid"),
  S("cors-pecos", "Core Scientific", "CORZ", "Pecos", "bitcoin_mining", "operating", "Pecos", "TX", "US", 31.423, -103.493, null, "ERCOT grid"),
  S("cors-muskogee", "Core Scientific", "CORZ", "Muskogee", "hpc_conversion", "converting to AI/HPC", "Muskogee", "OK", "US", 35.748, -95.370, null, "SPP grid"),
  S("cors-grandforks", "Core Scientific", "CORZ", "Grand Forks", "bitcoin_mining", "operating", "Grand Forks", "ND", "US", 47.925, -97.033, null, "MISO grid"),
  S("cifr-odessa", "Cipher Mining", "CIFR", "Odessa", "bitcoin_mining", "operating", "Odessa", "TX", "US", 31.846, -102.368, 207, "ERCOT, power purchase agreement"),
  S("cifr-bear-chief", "Cipher Mining", "CIFR", "Bear and Chief (joint ventures)", "bitcoin_mining", "operating", "Andrews County", "TX", "US", 32.319, -102.546, null, "ERCOT, behind-the-meter wind", "Joint ventures with WindHQ."),
  S("cifr-barber-lake", "Cipher Mining", "CIFR", "Barber Lake", "hpc_conversion", "leased for AI/HPC", "Colorado City", "TX", "US", 32.388, -100.864, null, "ERCOT grid"),
  S("wulf-lake-mariner", "TeraWulf", "WULF", "Lake Mariner", "hpc_conversion", "mining, with AI/HPC buildings added", "Barker", "NY", "US", 43.346, -78.553, null, "NYISO grid (largely hydro and nuclear)"),
  S("btdr-rockdale", "Bitdeer Technologies", "BTDR", "Rockdale", "bitcoin_mining", "operating", "Rockdale", "TX", "US", 30.649, -97.020, 563, "ERCOT grid"),
  S("btdr-clarington", "Bitdeer Technologies", "BTDR", "Clarington", "bitcoin_mining", "under construction", "Clarington", "OH", "US", 39.773, -80.869, 570, "PJM grid"),
  S("btdr-tydal", "Bitdeer Technologies", "BTDR", "Tydal", "bitcoin_mining", "operating", "Tydal", "Trøndelag", "NO", 63.045, 11.651, 175, "Norwegian grid (hydro)"),
  S("btdr-gedu", "Bitdeer Technologies", "BTDR", "Gedu", "bitcoin_mining", "operating", "Gedu", "Chukha", "BT", 26.920, 89.520, null, "Hydropower"),
  S("iren-childress", "IREN", "IREN", "Childress", "bitcoin_mining", "operating; AI buildings added", "Childress", "TX", "US", 34.427, -100.204, 750, "ERCOT grid"),
  S("iren-sweetwater", "IREN", "IREN", "Sweetwater", "hpc_conversion", "under development (AI/HPC)", "Sweetwater", "TX", "US", 32.471, -100.406, null, "ERCOT grid", "About 2 GW of grid connections across two sites."),
  S("iren-mackenzie", "IREN", "IREN", "Mackenzie", "bitcoin_mining", "operating", "Mackenzie", "BC", "CA", 55.338, -123.094, 80, "BC Hydro (hydro)"),
  S("iren-prince-george", "IREN", "IREN", "Prince George", "bitcoin_mining", "operating; AI buildings added", "Prince George", "BC", "CA", 53.917, -122.750, 50, "BC Hydro (hydro)"),
  S("iren-canal-flats", "IREN", "IREN", "Canal Flats", "bitcoin_mining", "operating", "Canal Flats", "BC", "CA", 50.156, -115.814, 30, "BC Hydro (hydro)"),
  S("hut-medicine-hat", "Hut 8", "HUT", "Medicine Hat", "bitcoin_mining", "operating", "Medicine Hat", "AB", "CA", 50.041, -110.677, null, "Natural gas (city utility)"),
  S("hut-king-mountain", "Hut 8", "HUT", "King Mountain (joint venture)", "bitcoin_mining", "operating", "McCamey", "TX", "US", 31.230, -102.240, 280, "ERCOT, near wind"),
  S("hut-vega", "Hut 8", "HUT", "Vega", "bitcoin_mining", "operating", "Vega", "TX", "US", 35.243, -102.428, 205, "SPP grid"),
  S("glxy-helios", "Galaxy Digital", "GLXY", "Helios", "hpc_conversion", "converting to AI/HPC (CoreWeave)", "Dickens County", "TX", "US", 33.622, -100.838, 800, "ERCOT, approved load", "800 MW of approved power; mining is being replaced by AI data halls."),
  S("gree-dresden", "Greenidge Generation", "GREE", "Greenidge Station", "bitcoin_mining", "operating", "Dresden", "NY", "US", 42.683, -76.956, 106, "Own natural gas plant"),
  S("bitf-scrubgrass", "Bitfarms (Stronghold)", "BITF", "Scrubgrass", "bitcoin_mining", "operating", "Kennerdell", "PA", "US", 41.271, -79.823, 85, "Own waste-coal plant", "Stronghold Digital Mining, acquired by Bitfarms in 2025."),
  S("bitf-panther-creek", "Bitfarms (Stronghold)", "BITF", "Panther Creek", "bitcoin_mining", "operating", "Nesquehoning", "PA", "US", 40.863, -75.811, 80, "Own waste-coal plant", "Stronghold Digital Mining, acquired by Bitfarms in 2025."),
  S("bitf-sharon", "Bitfarms", "BITF", "Sharon", "bitcoin_mining", "operating", "Sharon", "PA", "US", 41.233, -80.493, null, "PJM grid"),
  S("bitf-yguazu", "Bitfarms", "BITF", "Yguazú", "bitcoin_mining", "operating", "Yguazú", "Alto Paraná", "PY", -25.450, -55.000, 200, "Itaipú-region hydro"),
  S("bitf-quebec", "Bitfarms", "BITF", "Québec sites", "bitcoin_mining", "operating", "Sherbrooke", "QC", "CA", 45.404, -71.893, null, "Hydro-Québec (hydro)", "Several small sites in the region, shown at one point."),
  S("clsk-dalton", "CleanSpark", "CLSK", "Dalton campuses", "bitcoin_mining", "operating", "Dalton", "GA", "US", 34.780, -84.990, null, "Georgia grid", "Several campuses in and around Dalton."),
  S("clsk-sandersville", "CleanSpark", "CLSK", "Sandersville", "bitcoin_mining", "operating", "Sandersville", "GA", "US", 32.982, -82.810, null, "Georgia grid"),
  S("clsk-washington", "CleanSpark", "CLSK", "Washington", "bitcoin_mining", "operating", "Washington", "GA", "US", 33.737, -82.739, null, "Georgia grid"),
  S("clsk-college-park", "CleanSpark", "CLSK", "College Park", "bitcoin_mining", "operating", "College Park", "GA", "US", 33.653, -84.449, null, "Georgia grid"),
  S("clsk-norcross", "CleanSpark", "CLSK", "Norcross", "bitcoin_mining", "operating", "Norcross", "GA", "US", 33.941, -84.214, null, "Georgia grid"),
  S("clsk-tennessee", "CleanSpark", "CLSK", "Tennessee sites (from GRIID)", "bitcoin_mining", "operating", "LaFollette", "TN", "US", 36.383, -84.120, null, "TVA region", "Several sites acquired with GRIID in 2024, shown at one point."),
  S("clsk-cheyenne", "CleanSpark", "CLSK", "Cheyenne", "bitcoin_mining", "operating", "Cheyenne", "WY", "US", 41.140, -104.820, null, "Black Hills Energy"),
];

/** Estimated annual electricity use at a load factor, GWh. Pure. */
export const estimatedGwh = (mw: number | null, loadFactor = LOAD_FACTOR) => (mw === null ? null : (mw * 8760 * loadFactor) / 1000);

/** The operator's filings on EDGAR, for checking a site's figures. */
export const filingsUrl = (operator: string) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(operator.replace(/\s*\(.*\)$/, ""))}&owner=exclude`;

export type SiteProps = Omit<Site, "lat" | "lon"> & { estGwh: number | null; source: string; approximate: true };

/** The sites as GeoJSON points, optionally filtered by kind. Pure, for tests and the API route. */
export function sitesGeoJson(kinds?: SiteKind[]): FeatureCollection<Point, SiteProps> {
  const list = kinds?.length ? SITES.filter((s) => kinds.includes(s.kind)) : SITES;
  return {
    type: "FeatureCollection",
    features: list.map(({ lat, lon, ...p }) => ({ type: "Feature", id: p.id, geometry: { type: "Point", coordinates: [lon, lat] }, properties: { ...p, estGwh: estimatedGwh(p.capacityMw), source: filingsUrl(p.operator), approximate: true } })),
  };
}

/** Totals for the legend: sites, megawatts with a stated figure, and the estimated energy they use. */
export function siteTotals(list: Site[] = SITES) {
  const mw = list.reduce((s, x) => s + (x.capacityMw ?? 0), 0);
  return { sites: list.length, withCapacity: list.filter((x) => x.capacityMw !== null).length, mw, estTwh: (estimatedGwh(mw) ?? 0) / 1000 };
}

/* ---------------- Map styling, shared by the layer and its legend ---------------- */

/** Okabe-Ito colours (colour-blind safe): mining orange, hosting sky blue, AI/HPC conversion purple. */
export const SITE_COLORS: Record<string, string> = { bitcoin_mining: "#E69F00", hosting: "#56B4E9", hpc_conversion: "#CC79A7" };
export const SITE_LABELS: Record<string, string> = { bitcoin_mining: "Bitcoin mining", hosting: "Mining hosting", hpc_conversion: "Converting to AI/HPC" };

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type SitePopup = { name: string; operator: string; ticker: string; kind: string; status: string; city: string; region: string; country: string; capacityMw: number | null; estGwh: number | null; power: string; note: string; source: string };

/** The popup for one site, as HTML (every value escaped). Pure, for tests. */
export function sitePopupHtml(p: SitePopup): string {
  const cap = typeof p.capacityMw === "number" && p.capacityMw > 0 ? `${Math.round(p.capacityMw).toLocaleString("en-US")} MW stated capacity` : "Capacity not stated for this site";
  const use = typeof p.estGwh === "number" && p.estGwh > 0 ? `<br><span style="opacity:.75">About ${Math.round(p.estGwh).toLocaleString("en-US")} GWh a year if run at 85% load (estimate)</span>` : "";
  const source = /^https:\/\//.test(p.source) ? `<a href="${esc(p.source)}" target="_blank" rel="noreferrer" style="color:inherit;text-decoration:underline">Operator's SEC filings</a>` : "";
  return `<div style="font:12px/1.4 var(--font-sans);max-width:250px"><b>${esc(p.name)}</b><br>${esc(p.operator)}${p.ticker ? ` (${esc(p.ticker)})` : ""}<br>${esc(SITE_LABELS[p.kind] ?? p.kind)}: ${esc(p.status)}<br>${esc(cap)}${use}<br><span style="opacity:.75">${esc(p.power)}</span>${p.note ? `<br><span style="opacity:.75">${esc(p.note)}</span>` : ""}<br><span style="opacity:.6">Location approximate (${esc([p.city, p.region, p.country].filter(Boolean).join(", "))}). Source: the operator's filings and releases through mid-2025.</span> ${source}</div>`;
}

