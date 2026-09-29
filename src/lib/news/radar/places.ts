/**
 * Where things happen, for the radar map: countries, US states, and the places a sector names on its
 * own (oil basins, shipping chokepoints, LNG terminals, financial centres). Free text is read for
 * names; structured sources (trial site countries, a bank's state) map straight to ids. Coordinates
 * are approximate centres, on an equirectangular projection 1000 wide and 500 high.
 */
import type { SectorKey } from "../desks";

export type PlaceKind = "country" | "state" | "region";
export type Place = { id: string; name: string; lat: number; lon: number; kind: PlaceKind; sectors?: SectorKey[] };

/** [id, display name, lat, lon, names and adjectives found in text] */
type Row = [string, string, number, number, string[]];

const COUNTRIES: Row[] = [
  ["c:CA", "Canada", 56, -106, ["Canada", "Canadian", "Toronto", "Ottawa", "Alberta", "Calgary"]],
  ["c:MX", "Mexico", 23.6, -102.5, ["Mexico", "Mexican", "Mexico City"]],
  ["c:BR", "Brazil", -12, -50, ["Brazil", "Brazilian", "Sao Paulo", "São Paulo", "Petrobras"]],
  ["c:AR", "Argentina", -36, -64, ["Argentina", "Argentine", "Argentinian", "Buenos Aires"]],
  ["c:CL", "Chile", -33, -71, ["Chile", "Chilean", "Santiago"]],
  ["c:CO", "Colombia", 4.6, -74.3, ["Colombia", "Colombian", "Bogota", "Bogotá"]],
  ["c:PE", "Peru", -9.2, -75, ["Peru", "Peruvian"]],
  ["c:VE", "Venezuela", 7, -66, ["Venezuela", "Venezuelan"]],
  ["c:GY", "Guyana", 5, -59, ["Guyana", "Guyanese"]],
  ["c:GB", "United Kingdom", 53, -2, ["United Kingdom", "U.K.", "UK", "Britain", "British", "England", "Scotland", "London", "City of London"]],
  ["c:IE", "Ireland", 53.3, -8, ["Ireland", "Irish", "Dublin"]],
  ["c:FR", "France", 46.5, 2.5, ["France", "French", "Paris"]],
  ["c:DE", "Germany", 51, 10.4, ["Germany", "German", "Berlin", "Frankfurt", "Munich"]],
  ["c:NL", "Netherlands", 52.2, 5.3, ["Netherlands", "Dutch", "Amsterdam", "Rotterdam"]],
  ["c:BE", "Belgium", 50.6, 4.5, ["Belgium", "Belgian"]],
  ["c:CH", "Switzerland", 46.8, 8.2, ["Switzerland", "Swiss", "Zurich", "Zürich", "Geneva", "Basel"]],
  ["c:IT", "Italy", 42.5, 12.5, ["Italy", "Italian", "Milan", "Rome"]],
  ["c:ES", "Spain", 40.3, -3.7, ["Spain", "Spanish", "Madrid"]],
  ["c:PT", "Portugal", 39.5, -8.2, ["Portugal", "Portuguese", "Lisbon"]],
  ["c:NO", "Norway", 61, 9, ["Norway", "Norwegian", "Oslo", "Equinor"]],
  ["c:SE", "Sweden", 61, 16, ["Sweden", "Swedish", "Stockholm"]],
  ["c:DK", "Denmark", 56, 9.5, ["Denmark", "Danish", "Copenhagen"]],
  ["c:FI", "Finland", 62, 26, ["Finland", "Finnish", "Helsinki"]],
  ["c:PL", "Poland", 52, 19.1, ["Poland", "Polish", "Warsaw"]],
  ["c:AT", "Austria", 47.5, 14.6, ["Austria", "Austrian", "Vienna"]],
  ["c:CZ", "Czechia", 49.8, 15.5, ["Czechia", "Czech Republic", "Czech", "Prague"]],
  ["c:HU", "Hungary", 47.2, 19.5, ["Hungary", "Hungarian", "Budapest"]],
  ["c:RO", "Romania", 45.9, 25, ["Romania", "Romanian"]],
  ["c:GR", "Greece", 39.1, 21.8, ["Greece", "Greek", "Athens"]],
  ["c:UA", "Ukraine", 49, 31.2, ["Ukraine", "Ukrainian", "Kyiv", "Kiev"]],
  ["c:RU", "Russia", 58, 56, ["Russia", "Russian", "Moscow", "Kremlin", "Russian Federation"]],
  ["c:GE", "Georgia (country)", 42, 43.4, ["Tbilisi"]],
  ["c:TR", "Türkiye", 39, 35, ["Turkey", "Türkiye", "Turkish", "Istanbul", "Ankara"]],
  ["c:IL", "Israel", 31.2, 34.9, ["Israel", "Israeli", "Tel Aviv", "Gaza"]],
  ["c:EG", "Egypt", 26.8, 30.8, ["Egypt", "Egyptian", "Cairo"]],
  ["c:SA", "Saudi Arabia", 24, 45, ["Saudi Arabia", "Saudi", "Riyadh", "Aramco"]],
  ["c:AE", "United Arab Emirates", 24, 54, ["United Arab Emirates", "UAE", "U.A.E.", "Emirati", "Abu Dhabi", "Dubai", "ADNOC"]],
  ["c:QA", "Qatar", 25.3, 51.2, ["Qatar", "Qatari", "Doha"]],
  ["c:KW", "Kuwait", 29.3, 47.5, ["Kuwait", "Kuwaiti"]],
  ["c:OM", "Oman", 21, 57, ["Oman", "Omani"]],
  ["c:IR", "Iran", 32.4, 53.7, ["Iran", "Iranian", "Tehran"]],
  ["c:IQ", "Iraq", 33.2, 43.7, ["Iraq", "Iraqi", "Baghdad", "Kurdistan"]],
  ["c:KZ", "Kazakhstan", 48, 67, ["Kazakhstan", "Kazakh"]],
  ["c:AZ", "Azerbaijan", 40.1, 47.6, ["Azerbaijan", "Azerbaijani", "Baku"]],
  ["c:NG", "Nigeria", 9.1, 8.7, ["Nigeria", "Nigerian", "Lagos"]],
  ["c:AO", "Angola", -12, 17.9, ["Angola", "Angolan"]],
  ["c:ZA", "South Africa", -30.6, 23, ["South Africa", "South African", "Johannesburg"]],
  ["c:LY", "Libya", 27, 17, ["Libya", "Libyan"]],
  ["c:DZ", "Algeria", 28, 2, ["Algeria", "Algerian"]],
  ["c:MA", "Morocco", 31.8, -7.1, ["Morocco", "Moroccan"]],
  ["c:KE", "Kenya", 0.2, 37.9, ["Kenya", "Kenyan", "Nairobi"]],
  ["c:MZ", "Mozambique", -18.7, 35.5, ["Mozambique"]],
  ["c:IN", "India", 21, 79, ["India", "Indian", "Mumbai", "New Delhi", "Delhi", "Bengaluru", "Bangalore", "Hyderabad"]],
  ["c:PK", "Pakistan", 30.4, 69.3, ["Pakistan", "Pakistani"]],
  ["c:CN", "China", 33, 106, ["China", "Chinese", "Beijing", "Shanghai", "Shenzhen", "Guangzhou", "PRC", "People's Republic of China"]],
  ["c:HK", "Hong Kong", 22.3, 114.2, ["Hong Kong"]],
  ["c:TW", "Taiwan", 23.7, 121, ["Taiwan", "Taiwanese", "Taipei", "TSMC"]],
  ["c:JP", "Japan", 36.5, 138.5, ["Japan", "Japanese", "Tokyo", "Osaka"]],
  ["c:KR", "South Korea", 36, 127.8, ["South Korea", "Korea", "Korean", "Seoul", "Republic of Korea"]],
  ["c:KP", "North Korea", 40.3, 127.5, ["North Korea", "North Korean", "Pyongyang"]],
  ["c:SG", "Singapore", 1.35, 103.8, ["Singapore", "Singaporean"]],
  ["c:MY", "Malaysia", 4.2, 102, ["Malaysia", "Malaysian", "Kuala Lumpur"]],
  ["c:ID", "Indonesia", -2, 114, ["Indonesia", "Indonesian", "Jakarta"]],
  ["c:VN", "Vietnam", 15, 107.5, ["Vietnam", "Vietnamese", "Viet Nam", "Hanoi"]],
  ["c:TH", "Thailand", 15.5, 101, ["Thailand", "Thai", "Bangkok"]],
  ["c:PH", "Philippines", 12.9, 121.8, ["Philippines", "Philippine", "Manila"]],
  ["c:AU", "Australia", -25.3, 134, ["Australia", "Australian", "Sydney", "Melbourne", "Perth"]],
  ["c:NZ", "New Zealand", -41, 174.9, ["New Zealand"]],
  ["eu", "European Union", 50.8, 4.4, ["European Union", "EU", "E.U.", "Brussels", "European Commission", "Eurozone", "euro zone"]],
];

const STATES: Row[] = [
  ["us:AL", "Alabama", 32.8, -86.8, ["Alabama"]], ["us:AK", "Alaska", 64.7, -152.5, ["Alaska", "Cook Inlet", "North Slope", "Prudhoe Bay", "Alaska LNG"]],
  ["us:AZ", "Arizona", 34.3, -111.7, ["Arizona"]], ["us:AR", "Arkansas", 34.9, -92.4, ["Arkansas"]],
  ["us:CA", "California", 37.2, -119.5, ["California", "Californian", "Silicon Valley", "San Francisco", "Bay Area", "Los Angeles", "San Diego", "San Jose"]],
  ["us:CO", "Colorado", 39, -105.5, ["Colorado", "Denver", "DJ Basin", "Denver-Julesburg"]], ["us:CT", "Connecticut", 41.6, -72.7, ["Connecticut", "Stamford", "Greenwich"]],
  ["us:DE", "Delaware", 39, -75.5, ["Delaware"]], ["us:DC", "Washington, D.C.", 38.9, -77, ["Washington, D.C.", "District of Columbia"]],
  ["us:FL", "Florida", 28.6, -82.4, ["Florida", "Miami", "Tampa", "Orlando"]], ["us:GA", "Georgia", 32.7, -83.4, ["Georgia", "Atlanta", "Elba Island"]],
  ["us:HI", "Hawaii", 20.8, -156.3, ["Hawaii"]], ["us:ID", "Idaho", 44.4, -114.6, ["Idaho"]],
  ["us:IL", "Illinois", 40, -89.2, ["Illinois", "Chicago"]], ["us:IN", "Indiana", 39.9, -86.3, ["Indiana", "Indianapolis"]],
  ["us:IA", "Iowa", 42.1, -93.5, ["Iowa"]], ["us:KS", "Kansas", 38.5, -98.4, ["Kansas"]], ["us:KY", "Kentucky", 37.5, -85.3, ["Kentucky"]],
  ["us:LA", "Louisiana", 31.1, -92, ["Louisiana", "New Orleans", "Haynesville", "Lake Charles", "Calcasieu Pass", "CP2 LNG", "Plaquemines", "Cameron LNG", "Sabine Pass", "Driftwood LNG"]],
  ["us:ME", "Maine", 45.4, -69.2, ["Maine"]], ["us:MD", "Maryland", 39, -76.8, ["Maryland", "Baltimore", "Cove Point"]],
  ["us:MA", "Massachusetts", 42.3, -71.8, ["Massachusetts", "Boston"]], ["us:MI", "Michigan", 44.3, -85.4, ["Michigan", "Detroit"]],
  ["us:MN", "Minnesota", 46.3, -94.3, ["Minnesota", "Minneapolis"]], ["us:MS", "Mississippi", 32.7, -89.7, ["Mississippi"]],
  ["us:MO", "Missouri", 38.4, -92.5, ["Missouri", "St. Louis", "Kansas City"]], ["us:MT", "Montana", 47, -109.6, ["Montana"]],
  ["us:NE", "Nebraska", 41.5, -99.8, ["Nebraska", "Omaha"]], ["us:NV", "Nevada", 39.3, -116.6, ["Nevada", "Las Vegas"]],
  ["us:NH", "New Hampshire", 43.7, -71.6, ["New Hampshire"]], ["us:NJ", "New Jersey", 40.2, -74.7, ["New Jersey", "Newark"]],
  ["us:NM", "New Mexico", 34.4, -106.1, ["New Mexico"]], ["us:NY", "New York", 40.9, -74.4, ["New York", "Manhattan", "Wall Street", "Brooklyn"]],
  ["us:NC", "North Carolina", 35.6, -79.4, ["North Carolina", "Charlotte", "Research Triangle", "Raleigh"]], ["us:ND", "North Dakota", 47.5, -100.5, ["North Dakota", "Bakken"]],
  ["us:OH", "Ohio", 40.3, -82.8, ["Ohio", "Cleveland", "Columbus", "Cincinnati", "Utica Shale"]], ["us:OK", "Oklahoma", 35.6, -97.5, ["Oklahoma", "Tulsa", "Cushing", "Anadarko Basin"]],
  ["us:OR", "Oregon", 43.9, -120.6, ["Oregon", "Portland, Oregon"]], ["us:PA", "Pennsylvania", 40.9, -77.8, ["Pennsylvania", "Pittsburgh", "Philadelphia", "Marcellus", "Appalachian Basin", "Appalachia"]],
  ["us:RI", "Rhode Island", 41.7, -71.5, ["Rhode Island"]], ["us:SC", "South Carolina", 33.9, -80.9, ["South Carolina"]],
  ["us:SD", "South Dakota", 44.4, -100.2, ["South Dakota"]], ["us:TN", "Tennessee", 35.9, -86.4, ["Tennessee", "Nashville", "Memphis"]],
  ["us:TX", "Texas", 31.3, -99.3, ["Texas", "Houston", "Dallas", "San Antonio", "Fort Worth", "Corpus Christi", "Rio Grande LNG", "Freeport LNG", "Golden Pass", "Port Arthur", "Eagle Ford", "ERCOT"]],
  ["us:UT", "Utah", 39.3, -111.7, ["Utah", "Salt Lake City"]], ["us:VT", "Vermont", 44.1, -72.7, ["Vermont"]],
  ["us:VA", "Virginia", 37.5, -78.9, ["Virginia", "Richmond, Virginia"]], ["us:WA", "Washington", 47.4, -120.5, ["Washington State", "Washington state", "Seattle"]],
  ["us:WV", "West Virginia", 38.6, -80.6, ["West Virginia"]], ["us:WI", "Wisconsin", 44.6, -89.9, ["Wisconsin", "Milwaukee"]], ["us:WY", "Wyoming", 43, -107.6, ["Wyoming"]],
];

/** Places a sector names that are neither a country nor a state. */
const REGIONS: Row[] = [
  ["r:permian", "Permian Basin", 31.8, -102.4, ["Permian Basin", "Permian", "Midland Basin", "Delaware Basin"]],
  ["r:gulf", "Gulf of Mexico", 26.5, -90.5, ["Gulf of Mexico", "Gulf of America", "Gulf Coast", "Gulf coast"]],
  ["r:northsea", "North Sea", 56.5, 3, ["North Sea"]],
  ["r:vacamuerta", "Vaca Muerta", -38.5, -69, ["Vaca Muerta"]],
  ["r:oilsands", "Oil sands", 57, -111.4, ["oil sands", "Athabasca"]],
  ["r:hormuz", "Strait of Hormuz", 26.6, 56.3, ["Strait of Hormuz", "Hormuz"]],
  ["r:redsea", "Red Sea", 18, 40, ["Red Sea", "Bab el-Mandeb", "Houthis", "Houthi"]],
  ["r:suez", "Suez Canal", 30.6, 32.3, ["Suez Canal", "Suez"]],
  ["r:panama", "Panama Canal", 9.1, -79.7, ["Panama Canal", "Panama"]],
  ["r:blacksea", "Black Sea", 43.4, 34, ["Black Sea"]],
  ["r:malacca", "Strait of Malacca", 2.5, 101.4, ["Strait of Malacca", "Malacca"]],
  ["r:opec", "OPEC", 26, 50.5, ["OPEC", "OPEC+"]],
];

const place = (r: Row, kind: PlaceKind): Place => ({ id: r[0], name: r[1], lat: r[2], lon: r[3], kind });
export const PLACES: Place[] = [...COUNTRIES.map((r) => place(r, "country")), ...STATES.map((r) => place(r, "state")), ...REGIONS.map((r) => place(r, "region"))];
export const PLACE_BY_ID = new Map(PLACES.map((p) => [p.id, p]));

/** Every name, longest first, so "New Mexico" is read before "Mexico" and "West Virginia" before "Virginia". */
/** Phrases that contain a place name but are not about that place; they are read and set aside. */
const NOT_PLACES = ["British thermal unit", "British thermal units", "Indian Ocean", "New England", "Native American", "American Indian", "Indian tribe", "French fries", "Dutch Bros", "Swiss cheese", "Turkey Hill", "Mexican restaurant", "Chinese wall"];
const NAMES: { name: string; id: string; exact: boolean }[] = [...COUNTRIES, ...STATES, ...REGIONS, ...NOT_PLACES.map((n): Row => ["", "", 0, 0, [n]])]
  .flatMap((r) => r[4].map((name) => ({ name, id: r[0], exact: name.length <= 4 || /[A-Z]{2,}/.test(name) })))
  .sort((a, b) => b.name.length - a.name.length);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERNS = NAMES.map((n) => ({ ...n, re: new RegExp(`(?<![\\p{L}\\p{N}])${esc(n.name)}(?![\\p{L}\\p{N}])`, n.exact ? "gu" : "giu") }));

/**
 * The places named in a piece of text, each once, in order of first mention. Short names and
 * acronyms (UK, EU, UAE, OPEC) must match case exactly; others ignore case. Matched spans are used
 * up, so "New Mexico" never also counts as Mexico. The United States itself is left out: nearly
 * every story is about it, which says nothing about where.
 */
export function placesIn(text: string): string[] {
  if (!text) return [];
  const taken: [number, number][] = [];
  const hits: { id: string; at: number }[] = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    for (let m = p.re.exec(text); m; m = p.re.exec(text)) {
      const s = m.index, e = s + m[0].length;
      if (taken.some(([a, b]) => s < b && e > a)) continue;
      taken.push([s, e]);
      if (p.id) hits.push({ id: p.id, at: s });
    }
  }
  return [...new Set(hits.sort((a, b) => a.at - b.at).map((h) => h.id))];
}

/** ClinicalTrials.gov and trade-case country names to place ids ("Korea, Republic of" is South Korea; "Georgia" here is the country). */
const COUNTRY_ALIAS: Record<string, string> = {
  "united states": "c:US", "korea, republic of": "c:KR", "republic of korea": "c:KR", "south korea": "c:KR", "korea": "c:KR", "russian federation": "c:RU",
  "iran, islamic republic of": "c:IR", "viet nam": "c:VN", "türkiye": "c:TR", "turkey": "c:TR", "czechia": "c:CZ", "czech republic": "c:CZ",
  "taiwan": "c:TW", "hong kong": "c:HK", "georgia": "c:GE", "united kingdom": "c:GB", "china": "c:CN", "the netherlands": "c:NL",
};
const COUNTRY_BY_NAME = new Map(COUNTRIES.flatMap((r) => [[r[1].toLowerCase(), r[0]] as const, ...r[4].filter((n) => /^[A-Z][a-z]/.test(n) && !/ian$|ish$|ese$|ch$|i$/.test(n)).map((n) => [n.toLowerCase(), r[0]] as const)]));

export function countryId(name: string): string | null {
  const k = name.trim().toLowerCase();
  if (k === "united states" || k === "usa" || k === "u.s.") return "c:US";
  return COUNTRY_ALIAS[k] ?? COUNTRY_BY_NAME.get(k) ?? null;
}

const STATE_CODE: Record<string, string> = Object.fromEntries(STATES.map((r) => [r[0].slice(3), r[0]]));
const STATE_BY_NAME = new Map(STATES.map((r) => [r[1].toLowerCase(), r[0]]));

/** A US state by name ("Illinois") or postal code ("IL"). */
export function stateId(nameOrCode: string): string | null {
  const s = nameOrCode.trim();
  return STATE_CODE[s.toUpperCase()] && s.length === 2 ? STATE_CODE[s.toUpperCase()] : STATE_BY_NAME.get(s.toLowerCase()) ?? null;
}

/** The United States itself, for structured data (a trial's sites, a trade case's destination). */
export const US: Place = { id: "c:US", name: "United States", lat: 39.5, lon: -98.5, kind: "country" };
PLACE_BY_ID.set(US.id, US);

/** Map coordinates: equirectangular, 1000 wide by 500 high. */
export const project = (lat: number, lon: number) => ({ x: ((lon + 180) / 360) * 1000, y: ((90 - lat) / 180) * 500 });
