/**
 * The places Edge's new satellite analyses look at, each tied to the listed companies whose numbers it
 * plausibly moves and why. The list is curated, not exhaustive; each entry says what the reading can and
 * cannot tell. Coordinates are the centre of the box read, `km` its side.
 */
export type SatAnalysis = "crop_vigour" | "water_extent" | "vessel_traffic";
export type SatSite = {
  id: string; analysis: SatAnalysis; name: string; region: string; lon: number; lat: number; km: number;
  tickers: string[]; companies: string[];
  /** Why a change here may move these stocks: a hypothesis to test, not a forecast. */
  thesis: string;
  /** Months (1 to 12) when the reading means something (crops in the field). */
  season?: number[];
  /** Days between looks. */
  everyDays: number;
};

const CORN_BELT = "Crop condition in the US Corn Belt sets the size of the corn and soybean crop. A weaker crop than usual tends to raise grain prices, which squeezes processors' crush and milling margins less than it lifts merchandising volatility for ADM and Bunge, and tends to support fertilizer demand and prices for Nutrien and Mosaic next season; a strong crop does the opposite. Seed and equipment makers (Corteva, Deere) feel it through farm income a season later.";
const SOUTH_AMERICA = "South America's soybean crop competes with the US crop for export demand. A weak Brazilian or Argentine crop tends to tighten global soybean supply (higher prices, more US export business) and matters for Bunge and ADM's South American origination, and for Mosaic and Nutrien's fertilizer sales in Brazil.";

export const SAT_SITES: SatSite[] = [
  // Crops: Sentinel-2 NDVI against the same weeks of earlier years, only in the growing season.
  { id: "iowa-central", analysis: "crop_vigour", name: "Central Iowa cropland", region: "US Corn Belt", lon: -93.55, lat: 42.05, km: 18, tickers: ["ADM", "BG", "CTVA", "DE", "NTR", "MOS"], companies: ["ADM", "Bunge", "Corteva", "Deere", "Nutrien", "Mosaic"], thesis: CORN_BELT, season: [6, 7, 8, 9], everyDays: 7 },
  { id: "illinois-central", analysis: "crop_vigour", name: "Central Illinois cropland", region: "US Corn Belt", lon: -88.95, lat: 40.35, km: 18, tickers: ["ADM", "BG", "CTVA", "DE", "NTR", "MOS"], companies: ["ADM", "Bunge", "Corteva", "Deere", "Nutrien", "Mosaic"], thesis: CORN_BELT, season: [6, 7, 8, 9], everyDays: 7 },
  { id: "nebraska-platte", analysis: "crop_vigour", name: "Platte valley cropland, Nebraska", region: "US Corn Belt", lon: -98.2, lat: 40.85, km: 18, tickers: ["ADM", "BG", "CTVA", "DE"], companies: ["ADM", "Bunge", "Corteva", "Deere"], thesis: CORN_BELT, season: [6, 7, 8, 9], everyDays: 7 },
  { id: "kansas-wheat", analysis: "crop_vigour", name: "Central Kansas wheat country", region: "US Plains", lon: -98.4, lat: 38.35, km: 18, tickers: ["ADM", "BG", "DE"], companies: ["ADM", "Bunge", "Deere"], thesis: "Hard red winter wheat in Kansas greens up in spring; a poor stand before harvest tends to lift wheat prices, a cost for millers and a volume and volatility question for grain merchants.", season: [4, 5, 6], everyDays: 7 },
  { id: "mato-grosso-sorriso", analysis: "crop_vigour", name: "Sorriso soybean country, Mato Grosso", region: "Brazil", lon: -55.75, lat: -12.45, km: 18, tickers: ["BG", "ADM", "MOS", "NTR", "CTVA"], companies: ["Bunge", "ADM", "Mosaic", "Nutrien", "Corteva"], thesis: SOUTH_AMERICA, season: [12, 1, 2, 3], everyDays: 7 },
  { id: "pampas-pergamino", analysis: "crop_vigour", name: "Pergamino cropland, Buenos Aires", region: "Argentina", lon: -60.6, lat: -33.85, km: 18, tickers: ["BG", "ADM", "CTVA", "DE"], companies: ["Bunge", "ADM", "Corteva", "Deere"], thesis: SOUTH_AMERICA, season: [1, 2, 3], everyDays: 7 },
  { id: "saskatchewan-canola", analysis: "crop_vigour", name: "Canola country near Saskatoon", region: "Canadian Prairies", lon: -106.45, lat: 52.2, km: 18, tickers: ["NTR", "BG", "ADM", "DE"], companies: ["Nutrien", "Bunge", "ADM", "Deere"], thesis: "Saskatchewan grows most of Canada's canola. A poor crop tightens canola and vegetable oil supply (crush margins for Bunge and ADM) and weighs on farm income where Nutrien's retail arm sells.", season: [7, 8], everyDays: 7 },

  // Water: the share of the box that is open water, against the same weeks of earlier years.
  { id: "gatun-lake", analysis: "water_extent", name: "Gatun Lake, Panama Canal", region: "Panama", lon: -79.85, lat: 9.17, km: 16, tickers: ["ZIM", "LNG", "BG"], companies: ["ZIM", "Cheniere", "Bunge"], thesis: "Gatun Lake's water sets how deep and how many ships the Panama Canal can pass. When it ran low in 2023 and 2024 the canal cut transits and drafts, raising freight costs and pushing US LNG and grain to Asia the long way round. A shrinking lake is an early sign of those limits; a full one, of normal transits.", everyDays: 7 },
  { id: "atacama-ponds", analysis: "water_extent", name: "Salar de Atacama evaporation ponds", region: "Chile", lon: -68.33, lat: -23.6, km: 18, tickers: ["SQM", "ALB"], companies: ["SQM", "Albemarle"], thesis: "Lithium is concentrated from brine in evaporation ponds; the area of brine in SQM's and Albemarle's ponds tracks how much they pump. A clear rise or fall can lead reported volumes by months, though pond area also moves with weather and pond maintenance.", everyDays: 7 },
  { id: "hombre-muerto", analysis: "water_extent", name: "Salar del Hombre Muerto ponds", region: "Argentina", lon: -66.95, lat: -25.42, km: 16, tickers: ["RIO"], companies: ["Rio Tinto (Arcadium Lithium)"], thesis: "Arcadium Lithium's Fenix operation, now Rio Tinto's, evaporates brine here; more pond water usually means more brine in process. Small for Rio Tinto as a whole, so a change matters for its lithium story more than its earnings.", everyDays: 7 },
  { id: "furnas", analysis: "water_extent", name: "Furnas reservoir, Minas Gerais", region: "Brazil", lon: -46.0, lat: -20.85, km: 18, tickers: ["EBR"], companies: ["Eletrobras"], thesis: "Furnas is one of the big storage reservoirs behind Brazil's hydro system. Low reservoirs raise Brazil's spot power price and thermal dispatch; Eletrobras, mostly hydro, sells less in a drought but at higher prices, so the effect runs both ways.", everyDays: 7 },
  { id: "oroville", analysis: "water_extent", name: "Lake Oroville, California", region: "California", lon: -121.42, lat: 39.62, km: 14, tickers: ["PCG", "EIX"], companies: ["PG&E", "Edison International"], thesis: "California's big reservoirs set how much hydro power the state has. A low year means more gas-fired generation and higher power costs that California's utilities mostly pass through, and a drier, more fire-prone landscape.", everyDays: 7 },

  // Ships: bright targets on water in Sentinel-1 radar, against earlier passes.
  { id: "sabine-pass", analysis: "vessel_traffic", name: "Sabine Pass LNG and approaches", region: "US Gulf Coast", lon: -93.86, lat: 29.72, km: 8, tickers: ["LNG"], companies: ["Cheniere"], thesis: "Each LNG cargo is a carrier alongside or waiting. More carriers than usual at Sabine Pass suggests strong loadings (or a queue from fog or an outage); fewer suggests a slowdown, maintenance or a trip. Cheniere sells most of its output under long contracts, so the stock effect runs through spot cargoes and guidance.", everyDays: 3 },
  { id: "corpus-christi-lng", analysis: "vessel_traffic", name: "Corpus Christi LNG and the ship channel", region: "US Gulf Coast", lon: -97.3, lat: 27.84, km: 8, tickers: ["LNG"], companies: ["Cheniere"], thesis: "Cheniere's second terminal, expanding with Stage 3 trains; carrier counts track loadings as new trains start up.", everyDays: 3 },
  { id: "calcasieu-pass", analysis: "vessel_traffic", name: "Calcasieu Pass LNG and the channel mouth", region: "US Gulf Coast", lon: -93.34, lat: 29.77, km: 8, tickers: ["VG"], companies: ["Venture Global"], thesis: "Venture Global sold Calcasieu Pass cargoes on the spot market for years before long-term contracts started; carrier counts here and at Plaquemines track how much it ships, and its results lean on volumes and spot prices.", everyDays: 3 },
  { id: "plaquemines", analysis: "vessel_traffic", name: "Plaquemines LNG on the Mississippi", region: "US Gulf Coast", lon: -89.69, lat: 29.43, km: 8, tickers: ["VG"], companies: ["Venture Global"], thesis: "Venture Global's newest terminal, ramping up; more carriers at the berths means the ramp-up is on track.", everyDays: 3 },
  { id: "san-pedro-bay", analysis: "vessel_traffic", name: "San Pedro Bay anchorage (Los Angeles and Long Beach)", region: "US West Coast", lon: -118.18, lat: 33.69, km: 12, tickers: ["ZIM", "MATX"], companies: ["ZIM", "Matson"], thesis: "Ships waiting outside the largest US container port: a growing queue means congestion and tighter transpacific capacity (higher spot rates, good for carriers like ZIM and Matson in the short run); an empty anchorage means slack demand or smooth flow.", everyDays: 3 },
];

export const siteById = (id: string) => SAT_SITES.find((s) => s.id === id) ?? null;
