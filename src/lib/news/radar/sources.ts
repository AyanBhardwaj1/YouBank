/**
 * What each sector's radar reads, all public and free, no keys:
 * - Federal Register (public domain): FERC, DOE and NRC project notices; Federal Reserve bank-merger
 *   applications; ITC trade cases, Commerce export controls and USTR actions; FCC, HUD and FHFA rules.
 * - ClinicalTrials.gov (new industry trials), openFDA (drug approvals), PubMed (Phase 3 results).
 * - FDIC BankFind (bank failures), CPSC (product recalls).
 * - Research: EIA's Today in Energy, DOE's OSTI, the Fed's working papers and notes, NBER, arXiv (category
 *   listings only: arXiv answers those at once and rate-limits searches of abstracts).
 * Parsers are pure (for tests); fetchers return null when a source does not answer, never throw.
 */
import { decodeEntities, stripHtml } from "../normalize";
import { parseFeed } from "../sources/rss";
import { NEWS_UA } from "../types";
import { countryId, placesIn, stateId, US } from "./places";

export type RadarEntry = {
  id: string; title: string; snippet: string; url: string; source: string;
  /** ISO date. */
  at: string;
  /** Short labels: "Phase 3", "LNG", "Priority review". */
  tags: string[];
  /** One figure worth reading first: "450 patients", "$73M in assets". */
  metric?: string;
  /** Place ids for the map. */
  places: string[];
  /** Movement between places: exporters to the US in a trade case, one state's bank buying another's. */
  flow?: { from: string[]; to: string };
  weight: number;
};

const TIMEOUT = 15_000;
async function get(url: string, init: RequestInit = {}): Promise<Response | null> {
  const res = await fetch(url, { ...init, headers: { "User-Agent": NEWS_UA, Accept: "application/json, application/xml;q=0.9, */*;q=0.8", ...(init.headers ?? {}) }, cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null);
  return res?.ok ? res : null;
}
const json = async <T,>(url: string): Promise<T | null> => { const r = await get(url); return r ? ((await r.json().catch(() => null)) as T | null) : null; };
const text = async (url: string): Promise<string | null> => { const r = await get(url); return r ? r.text().catch(() => null) : null; };

const day = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number, now = new Date()) => new Date(now.getTime() - n * 86_400_000);
const clean = (s: string) => decodeEntities(s.replace(/\s+/g, " ").trim());
const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Llc|Lp|Plc|Usa|Us|Ag|Sa|Nv|Fs|La|Na)\b/g, (m) => m.toUpperCase());
const idOf = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

/* ---------------- Federal Register ---------------- */

export type FrDoc = { title: string; abstract: string | null; html_url: string; publication_date: string; type: string; raw_text_url?: string; agencies?: { slug?: string; name?: string }[] };

export function frUrl(o: { agencies: string[]; types?: string[]; term?: string; perPage?: number; since?: string }): string {
  const q = new URLSearchParams({ order: "newest", per_page: String(o.perPage ?? 40) });
  for (const a of o.agencies) q.append("conditions[agencies][]", a);
  for (const t of o.types ?? []) q.append("conditions[type][]", t);
  if (o.term) q.append("conditions[term]", o.term);
  if (o.since) q.append("conditions[publication_date][gte]", o.since);
  for (const f of ["title", "abstract", "html_url", "publication_date", "type", "raw_text_url", "agencies"]) q.append("fields[]", f);
  return `https://www.federalregister.gov/api/v1/documents.json?${q}`;
}

async function fr(o: Parameters<typeof frUrl>[0]): Promise<FrDoc[] | null> {
  const j = await json<{ results?: FrDoc[] }>(frUrl(o));
  return j ? j.results ?? [] : null;
}

/* ---------------- Energy: projects through FERC, DOE and NRC ---------------- */

const NOISE = /Information Collection|Temporary Variance|Surrender|Sunshine Act|Combined Notice|Paperwork|Meeting|Biweekly Notice|Technical Conference|Errata|Correction|Records Governing|Staff Participation|Settlement|Tariff Filing|Market-Based Rate|Self-Certification|Blanket Authorization|Reclamation|Decommissioning|Emergency Planning|Exemption/i;

const STAGES: [RegExp, string, number][] = [
  [/Long-Term Authorization To Export Liquefied Natural Gas/i, "LNG export application", 0.72],
  [/Availability of the Final Environmental Impact Statement/i, "Final impact statement", 0.7],
  [/Availability of the Draft Environmental Impact Statement/i, "Draft impact statement", 0.62],
  [/Intent to Prepare an Environmental Impact Statement/i, "Impact study begins", 0.6],
  [/Availability of the Environmental Assessment|Finding of No Significant Impact/i, "Environmental review done", 0.62],
  [/Intent to Prepare an Environmental Assessment|Schedule for (?:the Preparation of )?an Environmental/i, "Environmental review", 0.52],
  [/Scoping/i, "Scoping", 0.48],
  [/Notice of Application|Application Accepted for Filing|Notice of Filing of Application|Abbreviated Application/i, "Application filed", 0.58],
  [/Preliminary Permit Application/i, "Preliminary permit", 0.38],
  [/Subsequent License Renewal|License Renewal|Combined License|Construction Permit|Operating License|License Application|License Amendment/i, "Licensing", 0.5],
  [/Order (?:Granting|Issuing)|Certificate/i, "Approved", 0.66],
];

const COMMODITY: [RegExp, string][] = [
  [/Liquefied Natural Gas|\bLNG\b|Liquefaction/i, "LNG"],
  [/Nuclear|Clean Energy Center|Generating Station|Nuclear Plant|Reactor|Small Modular/i, "Nuclear"],
  [/Carbon Dioxide|\bCO2\b|Sequestration|Carbon Capture/i, "Carbon capture"],
  [/Pipe ?Line|Pipeline|Gas Transmission|Gas Storage|Natural Gas|Midstream|Transco\b|Transcontinental|Gas Company/i, "Gas pipeline"],
  [/Hydro|Pumped Storage|Water Power|Power Project|\bDam\b|River/i, "Hydro"],
  [/Offshore Wind|Wind|Solar|Geothermal/i, "Renewables"],
  [/Transmission|Interconnection|Electric/i, "Power"],
];

/** A FERC, DOE or NRC notice as a project milestone, or null when it is paperwork. Pure, for tests. */
export function energyNotice(d: FrDoc, agency: string): RadarEntry | null {
  const t = clean(d.title);
  if (!t || NOISE.test(t)) return null;
  const stage = STAGES.find(([re]) => re.test(t));
  if (!stage) return null;
  const parts = t.split(/;\s*/);
  // "Rio Grande LNG, LLC, Rio Grande LNG Train 4, LLC; ..." is Rio Grande LNG.
  const company = parts[0].split(/,\s*(?:LLC|L\.L\.C\.|Inc\.?|L\.P\.|LP|Company|Co\.|Corporation)(?=,|$)/)[0].replace(/,\s*$/, "").replace(/\s+(?:LLC|L\.L\.C\.|Inc\.?|L\.P\.|LP)$/, "").trim();
  // NRC names the plant in the middle: "Constellation Energy Generation, LLC; Christopher M. Crane Clean Energy Center; ...".
  const facility = parts.length >= 3 && !/Notice|Application|Environmental|Order|\b(?:LLC|L\.L\.C|Inc|Company|L\.P|LP|Corporation|Partners)\b/i.test(parts[1]) ? parts[1] : undefined;
  const project = (facility ?? t.match(/(?:for|of) the ((?:[A-Z0-9][\w&.'-]*\s){0,8}(?:Project|Expansion|Terminal|Facility|Upgrade|Pipeline|Replacement|Extension))\b/)?.[1])?.replace(/^(?:Proposed|Planned)\s+/i, "");
  const kind = COMMODITY.find(([re]) => re.test(t))?.[1] ?? "Energy";
  const all = `${t} ${d.abstract ?? ""}`;
  return {
    id: idOf(d.html_url), title: project && !company.includes(project) ? `${company}: ${project}` : company, snippet: `${stage[1]} · ${agency}`,
    url: d.html_url, source: agency, at: `${d.publication_date}T12:00:00Z`, tags: [kind, stage[1]], places: placesIn(all),
    weight: stage[2] + (kind === "LNG" || kind === "Nuclear" ? 0.12 : kind === "Gas pipeline" ? 0.08 : 0),
  };
}

export async function energyProjects(now = new Date()): Promise<RadarEntry[] | null> {
  const since = day(daysAgo(45, now));
  const [ferc, doe, nrc] = await Promise.all([
    fr({ agencies: ["federal-energy-regulatory-commission"], types: ["NOTICE"], since, perPage: 100 }),
    fr({ agencies: ["energy-department"], types: ["NOTICE"], term: "\"liquefied natural gas\"", since, perPage: 30 }),
    fr({ agencies: ["nuclear-regulatory-commission"], types: ["NOTICE"], term: "license", since, perPage: 40 }),
  ]);
  if (!ferc && !doe && !nrc) return null;
  const out = [
    ...(ferc ?? []).map((d) => energyNotice(d, "FERC")), ...(doe ?? []).map((d) => energyNotice(d, "DOE")),
    ...(nrc ?? []).map((d) => energyNotice(d, "NRC")).filter((e) => e && e.tags[0] === "Nuclear"),
  ].filter((e): e is RadarEntry => !!e);
  return dedupe(out);
}

/* ---------------- Financials: bank deals before the Fed, failures at the FDIC ---------------- */

const ACTIONS: [RegExp, string, number][] = [
  [/^merge with/i, "Merger", 0.62], [/^become a (?:bank|savings and loan) holding company/i, "New holding company", 0.36],
  [/^acquire (?:additional )?(?:up to [\d.]+ percent of the )?voting shares/i, "Stake", 0.42], [/^acquire/i, "Acquisition", 0.58], [/^retain/i, "Retains stake", 0.3],
];
const US_STATE = "(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|Puerto Rico)";

/**
 * The applications in a Federal Reserve notice ("1. 1870 Holdings, Inc., Monmouth, Illinois; to merge
 * with Rushville Bancshares, Inc., ... both of Rushville, Illinois."). Pure, for tests.
 */
export function bankApplications(raw: string, url: string, date: string): RadarEntry[] {
  const body = decodeEntities(raw.replace(/<[^>]+>/g, " ")).replace(/\s*\(``[^)]*''\)/g, "").replace(/``|''/g, "\"").replace(/\s+/g, " ");
  const due = body.match(/not later than ([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1];
  // Items are numbered; district headers ("A. Federal Reserve Bank of Chicago") and the signature end them.
  const marks = [...body.matchAll(/(?:^|\s)(?:(\d{1,2})\.\s+(?=[A-Z0-9"])|([A-Z])\.\s+(?=Federal Reserve Bank of)|(?=Board of Governors of the Federal Reserve System))/g)];
  const out: RadarEntry[] = [];
  let district = "";
  for (let i = 0; i < marks.length; i++) {
    const mk = marks[i];
    const seg = body.slice((mk.index ?? 0) + mk[0].length, i + 1 < marks.length ? marks[i + 1].index : body.length).trim();
    if (mk[2]) { district = seg.match(/^Federal Reserve Bank of ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/)?.[1] ?? district; continue; }
    if (!mk[1]) continue;
    // "Applicant, City, State; to merge with ..." or "Applicant, City, State; a newly-formed Maryland corporation, to become ..."
    const m = seg.match(/^(.+?);\s*(?:[^;]{0,120}?,\s*)?to\s+(.+)$/);
    if (!m) continue;
    const who = m[1].trim(), what = m[2].trim();
    const whoState = who.match(new RegExp(`,\\s*${US_STATE}$`))?.[1];
    if (!whoState || who.length > 240) continue;
    const action = ACTIONS.find(([r]) => r.test(what)) ?? ([/./, "Application", 0.4] as [RegExp, string, number]);
    const cityPart = who.slice(0, who.length - whoState.length).replace(/,\s*$/, "").split(/,\s*/).pop() ?? "";
    const whoCity = cityPart.replace(/^(?:all|both) of\s+/i, "");
    const cut = who.lastIndexOf(`, ${cityPart}`);
    const name = (cut > 0 ? who.slice(0, cut) : who).replace(/,?\s*(?:all|both) of$/i, "").trim();
    const rest = what.replace(/^(?:merge with|acquire(?: additional)?(?: voting shares,)?(?: up to [\d.]+ percent(?:,)? of(?: the)?)?(?: voting shares of)?|become a (?:bank|savings and loan) holding company by acquiring(?: (?:all|up to [\d.]+ percent) of the voting shares of)?|retain (?:voting shares of)?)\s*/i, "");
    const target = (rest.match(new RegExp(`^(.+?),\\s*[A-Z][\\w.'-]*(?: [A-Z][\\w.'-]*)*,\\s*${US_STATE}\\b`))?.[1] ?? rest.split(/,? and thereby|,? (?:both|all) of |;\s|,\s(?:in connection|and )/)[0])
      .replace(/,?\s+also of .+$/i, "").replace(/(?<!\b(?:Inc|Co|Corp|Ltd|N\.A|L\.L\.C))\.$/, "").trim();
    if (!name || !target) continue;
    const whatState = [...what.slice(0, 400).matchAll(new RegExp(US_STATE, "g"))][0]?.[1];
    const from = stateId(whoState), to = whatState ? stateId(whatState) : from;
    const verb = action[1] === "Merger" ? "to merge with" : action[1] === "New holding company" ? "to form a holding company for" : action[1] === "Stake" ? "to buy shares of" : "to acquire";
    out.push({
      id: idOf(`${url}#${name}#${target}`), title: `${name} ${verb} ${target}`.replace(/\s+/g, " ").slice(0, 200),
      snippet: [whoCity ? `${whoCity}, ${whoState}` : whoState, whatState && whatState !== whoState ? `target in ${whatState}` : "", district ? `Federal Reserve Bank of ${district}` : ""].filter(Boolean).join(" · "),
      url, source: "Federal Reserve", at: `${date}T12:00:00Z`, tags: [action[1], ...(due ? [`Comments by ${due.replace(/, \d{4}$/, "")}`] : [])],
      places: [...new Set([from, to].filter((x): x is string => !!x))], ...(from && to && from !== to ? { flow: { from: [from], to } } : {}), weight: action[2],
    });
  }
  return out;
}

export async function bankDeals(now = new Date()): Promise<RadarEntry[] | null> {
  const since = day(daysAgo(40, now));
  const [mergers, control] = await Promise.all([
    fr({ agencies: ["federal-reserve-system"], types: ["NOTICE"], term: "Mergers of Bank Holding Companies", since, perPage: 10 }),
    fr({ agencies: ["federal-reserve-system"], types: ["NOTICE"], term: "Change in Bank Control", since, perPage: 6 }),
  ]);
  if (!mergers && !control) return null;
  const docs = [...(mergers ?? []), ...(control ?? [])];
  const relevant = docs.filter((d) => /Mergers of Bank Holding Companies|Change in Bank Control/i.test(d.title) && d.raw_text_url).slice(0, 8);
  const texts = await Promise.all(relevant.map((d) => text(d.raw_text_url!)));
  return dedupe(relevant.flatMap((d, i) => (texts[i] ? bankApplications(texts[i]!, d.html_url, d.publication_date) : [])));
}

type FdicFailure = { data: { NAME: string; CITYST: string; FAILDATE: string; QBFASSET?: number; COST?: number | null } };

/** Bank failures from the FDIC (assets and cost in thousands of dollars). Pure, for tests. */
export function failureEntries(rows: FdicFailure[]): RadarEntry[] {
  return rows.map(({ data: f }) => {
    const [m, d, y] = f.FAILDATE.split("/").map(Number);
    const st = f.CITYST.split(",").pop()?.trim() ?? "";
    const assets = f.QBFASSET ? f.QBFASSET * 1000 : null;
    return {
      id: idOf(`${f.NAME}${f.FAILDATE}`), title: `${titleCase(f.NAME)} failed`, snippet: `${titleCase(f.CITYST.split(",")[0])}, ${st}${f.COST ? ` · estimated cost to the deposit insurance fund $${(f.COST / 1000).toFixed(1)}M` : ""}`,
      url: "https://www.fdic.gov/bank-failures/failed-bank-list", source: "FDIC", at: new Date(Date.UTC(y, m - 1, d, 12)).toISOString(),
      tags: ["Failure"], metric: assets ? `$${assets >= 1e9 ? `${(assets / 1e9).toFixed(1)}B` : `${Math.round(assets / 1e6)}M`} in assets` : undefined,
      places: [stateId(st)].filter((x): x is string => !!x), weight: 0.5 + Math.min(0.3, (f.QBFASSET ?? 0) / 5e6),
    };
  });
}

export async function bankFailures(): Promise<RadarEntry[] | null> {
  const j = await json<{ data?: FdicFailure[] }>("https://api.fdic.gov/banks/failures?sort_by=FAILDATE&sort_order=DESC&limit=10&fields=NAME,CITYST,FAILDATE,QBFASSET,COST");
  return j ? failureEntries(j.data ?? []).filter((e) => Date.parse(e.at) > daysAgo(400).getTime()) : null;
}

/* ---------------- Trade: ITC cases, export controls, USTR ---------------- */

/** An ITC case ("Wooden Fence Pickets From China; Institution of Antidumping ... Investigations"). Pure, for tests. */
export function tradeCase(d: FrDoc): RadarEntry | null {
  const t = clean(d.title);
  if (/Information Collection|Sunshine|Meeting|Schedul(?:e|ing) (?:for|of) the|Termination|Rescission|Correction/i.test(t) && !/Institution/i.test(t)) return null;
  const from = t.match(/^(.+?) From (.+?);\s*(.+)$/);
  const certain = t.match(/^Certain (.+?);\s*(.+)$/);
  let stage = "", weight = 0.45, product = "", origins: string[] = [];
  if (from) {
    product = from[1];
    origins = from[2].split(/,\s*(?:and\s+)?|\s+and\s+/).map((c) => c.replace(/^the\s+/i, "").trim()).filter(Boolean);
    const s = from[3];
    stage = /Institution of (?:Antidumping|Countervailing)/i.test(s) ? "New trade case" : /Five-Year Review|Expedited Review/i.test(s) ? "Five-year review" : /Final Phase/i.test(s) ? "Final phase" : /Determination/i.test(s) ? "Determination" : "";
    weight = stage === "New trade case" ? 0.66 : stage === "Final phase" ? 0.56 : stage === "Determination" ? 0.52 : 0.4;
  } else if (certain) {
    product = `Certain ${certain[1]}`;
    stage = /Institution of Investigation/i.test(certain[2]) ? "Patent import case (Section 337)" : "";
    weight = 0.5;
  }
  if (!stage) return null;
  const places = [...new Set(origins.map((c) => countryId(c)).filter((x): x is string => !!x))];
  return {
    id: idOf(d.html_url), title: from ? `${product} from ${origins.join(", ").replace(/, ([^,]+)$/, " and $1")}` : product.slice(0, 160), snippet: `${stage} · US International Trade Commission`,
    url: d.html_url, source: "USITC", at: `${d.publication_date}T12:00:00Z`, tags: [stage.replace(" (Section 337)", "")], places: places.length ? [...places, US.id] : [],
    ...(places.length ? { flow: { from: places, to: US.id } } : {}), weight,
  };
}

export function tradePolicy(d: FrDoc, agency: "BIS" | "USTR"): RadarEntry | null {
  const t = clean(d.title);
  if (/Information Collection|Meeting|Sunshine|Correction|Delegation/i.test(t)) return null;
  const label = agency === "BIS" ? (/Entity List/i.test(t) ? "Entity List" : "Export controls") : /Tariff|Duty|Section 301|Exclusion/i.test(t) ? "Tariffs" : "Trade policy";
  if (agency === "USTR" && label === "Trade policy" && !/China|Russia|Mexico|Canada|Japan|European|Vietnam|India|Korea/i.test(t)) return null;
  const places = placesIn(`${t} ${d.abstract ?? ""}`).filter((p) => p.startsWith("c:") || p === "eu");
  return {
    id: idOf(d.html_url), title: t.slice(0, 200), snippet: stripHtml(d.abstract ?? "", 220) || (agency === "BIS" ? "Commerce Department, Bureau of Industry and Security" : "Office of the US Trade Representative"),
    url: d.html_url, source: agency, at: `${d.publication_date}T12:00:00Z`, tags: [label], places, weight: label === "Entity List" || label === "Tariffs" ? 0.6 : 0.45,
  };
}

export async function tradeActions(now = new Date()): Promise<RadarEntry[] | null> {
  const since = day(daysAgo(45, now));
  const [itc, bis, ustr] = await Promise.all([
    fr({ agencies: ["international-trade-commission"], types: ["NOTICE"], since, perPage: 80 }),
    fr({ agencies: ["industry-and-security-bureau"], types: ["RULE", "PRORULE"], since, perPage: 20 }),
    fr({ agencies: ["trade-representative-office-of-united-states"], types: ["NOTICE"], since, perPage: 20 }),
  ]);
  if (!itc && !bis && !ustr) return null;
  return dedupe([...(itc ?? []).map(tradeCase), ...(bis ?? []).map((d) => tradePolicy(d, "BIS")), ...(ustr ?? []).map((d) => tradePolicy(d, "USTR"))].filter((e): e is RadarEntry => !!e));
}

/* ---------------- Rules in motion (FCC, HUD and FHFA, EPA and DOT, FTC and CPSC) ---------------- */

export function ruleEntry(d: FrDoc, short: string): RadarEntry | null {
  const t = clean(d.title);
  if (/Correction|Correcting Amendment|Technical Amendment|Information Collection|Delegation|Organization|Regulatory Fees|Civil Monetary Penalty Inflation/i.test(t)) return null;
  // Routine items that dwarf the rules that matter: aircraft directives, airspace, waterway zones, state air plans, pesticide tolerances, FM allotments.
  if (/Airworthiness Directives?|Special Local Regulations?|Safety Zones?|Security Zones?|Drawbridge|Anchorage|(?:Establishment|Amendment|Modification|Revocation) of (?:Class|Restricted|Jet|VOR)|Restricted Areas?|IFR Altitudes|RNAV|Standard Instrument Approach|Table of FM Allotments|(?:Radio|Television) Broadcasting Services|Rules of Practice|Petition for Rulemaking|Air Plan Approval|Approval and Promulgation of|Implementation Plans?|Significant New Use Rules?|Pesticide Tolerances?|Tolerance Exemption|Hazardous Waste Management System; Identification|Regattas|Marine Events/i.test(t)) return null;
  const proposed = d.type === "Proposed Rule";
  return {
    id: idOf(d.html_url), title: t.slice(0, 200), snippet: stripHtml(d.abstract ?? "", 240), url: d.html_url, source: short, at: `${d.publication_date}T12:00:00Z`,
    tags: [proposed ? "Proposed rule" : "Final rule"], places: placesIn(t), weight: proposed ? 0.5 : 0.56,
  };
}

export async function rules(agencies: { slug: string; short: string }[], now = new Date()): Promise<RadarEntry[] | null> {
  const docs = await fr({ agencies: agencies.map((a) => a.slug), types: ["RULE", "PRORULE"], since: day(daysAgo(60, now)), perPage: 40 });
  if (!docs) return null;
  return dedupe(docs.map((d) => ruleEntry(d, agencies.find((a) => d.agencies?.some((x) => x.slug === a.slug))?.short ?? agencies[0].short)).filter((e): e is RadarEntry => !!e));
}

/* ---------------- Healthcare: trials, approvals, results ---------------- */

type Study = { protocolSection: {
  identificationModule: { nctId: string; briefTitle: string };
  sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
  designModule?: { phases?: string[]; enrollmentInfo?: { count?: number } };
  statusModule?: { studyFirstPostDateStruct?: { date?: string } };
  conditionsModule?: { conditions?: string[] };
  armsInterventionsModule?: { interventions?: { name?: string; type?: string }[] };
  contactsLocationsModule?: { locations?: { country?: string }[] };
} };

const phaseLabel = (p: string[] = []) => (p.includes("PHASE2") && p.includes("PHASE3") ? "Phase 2/3" : p.includes("PHASE3") ? "Phase 3" : p.includes("PHASE1") && p.includes("PHASE2") ? "Phase 1/2" : p.includes("PHASE2") ? "Phase 2" : p.includes("PHASE4") ? "Phase 4" : "Phase 1");

/** New industry trials from ClinicalTrials.gov. Pure, for tests. */
export function trialEntries(studies: Study[]): RadarEntry[] {
  return studies.map(({ protocolSection: p }) => {
    const nct = p.identificationModule.nctId;
    const sponsor = p.sponsorCollaboratorsModule?.leadSponsor?.name?.replace(/,? (?:Inc|Ltd|LLC|Co|Corp)\.?$/i, "") ?? "Sponsor";
    const drug = p.armsInterventionsModule?.interventions?.find((i) => (i.type === "DRUG" || i.type === "BIOLOGICAL") && !/placebo|standard of care|vehicle/i.test(i.name ?? ""))?.name;
    const condition = p.conditionsModule?.conditions?.[0];
    const phase = phaseLabel(p.designModule?.phases);
    const n = p.designModule?.enrollmentInfo?.count ?? 0;
    const countries = [...new Set((p.contactsLocationsModule?.locations ?? []).map((l) => l.country).filter((c): c is string => !!c))];
    const places = countries.length ? [...new Set(countries.map(countryId).filter((x): x is string => !!x))] : placesIn(p.sponsorCollaboratorsModule?.leadSponsor?.name ?? "");
    return {
      id: nct, title: `${sponsor}: ${drug && drug.length < 40 ? `${drug} in ` : ""}${condition ? condition.replace(/\s*\(.*?\)\s*/g, " ").trim() : p.identificationModule.briefTitle}`.slice(0, 180),
      snippet: p.identificationModule.briefTitle.slice(0, 220), url: `https://clinicaltrials.gov/study/${nct}`, source: "ClinicalTrials.gov",
      at: `${p.statusModule?.studyFirstPostDateStruct?.date ?? day(new Date())}T12:00:00Z`, tags: [phase, ...(countries.length > 1 ? [`${countries.length} countries`] : [])],
      metric: n ? `${n.toLocaleString("en-US")} patients` : undefined, places,
      weight: (phase === "Phase 3" ? 0.7 : phase === "Phase 2/3" ? 0.62 : phase === "Phase 2" ? 0.5 : 0.35) + Math.min(0.2, Math.log10(1 + n) / 20),
    };
  });
}

export async function newTrials(now = new Date()): Promise<RadarEntry[] | null> {
  const q = new URLSearchParams({
    pageSize: "80", sort: "StudyFirstPostDate:desc",
    "filter.advanced": `AREA[LeadSponsorClass]INDUSTRY AND (AREA[Phase]PHASE3 OR AREA[Phase]PHASE2) AND AREA[StudyFirstPostDate]RANGE[${day(daysAgo(21, now))},MAX]`,
    fields: "NCTId,BriefTitle,LeadSponsorName,Phase,Condition,StudyFirstPostDate,LocationCountry,EnrollmentCount,InterventionName,InterventionType",
  });
  const j = await json<{ studies?: Study[] }>(`https://clinicaltrials.gov/api/v2/studies?${q}`);
  return j ? trialEntries(j.studies ?? []) : null;
}

type FdaApp = { application_number: string; sponsor_name: string; products?: { brand_name?: string; active_ingredients?: { name?: string }[] }[]; submissions?: { submission_type?: string; submission_status?: string; submission_status_date?: string; review_priority?: string; submission_class_code_description?: string }[]; openfda?: { pharm_class_epc?: string[] } };

/** Original NDA and BLA approvals from openFDA, within a window. Pure, for tests. */
export function approvalEntries(apps: FdaApp[], from: string, to: string): RadarEntry[] {
  const out: RadarEntry[] = [];
  for (const a of apps) {
    if (!/^(NDA|BLA)/.test(a.application_number)) continue;
    const s = (a.submissions ?? []).find((x) => x.submission_type === "ORIG" && x.submission_status === "AP" && (x.submission_status_date ?? "") >= from && (x.submission_status_date ?? "") <= to);
    if (!s) continue;
    const brand = [...new Set((a.products ?? []).map((p) => p.brand_name).filter(Boolean))][0] ?? a.application_number;
    const ingredient = (a.products ?? [])[0]?.active_ingredients?.map((i) => i.name).filter(Boolean).join(", ");
    const nme = /New Molecular Entity/i.test(s.submission_class_code_description ?? "");
    const priority = s.review_priority === "PRIORITY";
    const d = s.submission_status_date!;
    out.push({
      id: a.application_number, title: `${titleCase(brand)} (${titleCase(a.sponsor_name)})`, snippet: [ingredient ? titleCase(ingredient) : "", a.openfda?.pharm_class_epc?.[0]?.replace(/ \[EPC\]$/, "") ?? ""].filter(Boolean).join(" · "),
      url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${a.application_number.replace(/\D/g, "")}`, source: "FDA",
      at: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T12:00:00Z`, tags: [a.application_number.startsWith("BLA") ? "Biologic" : "New drug", ...(nme ? ["New molecular entity"] : []), ...(priority ? ["Priority review"] : [])],
      places: [US.id], weight: 0.55 + (nme ? 0.15 : 0) + (priority ? 0.1 : 0),
    });
  }
  return out;
}

export async function fdaApprovals(now = new Date()): Promise<RadarEntry[] | null> {
  const from = day(daysAgo(75, now)).replace(/-/g, ""), to = day(now).replace(/-/g, "");
  const j = await json<{ results?: FdaApp[] }>(`https://api.fda.gov/drug/drugsfda.json?search=(application_number:NDA*+OR+application_number:BLA*)+AND+submissions.submission_type:ORIG+AND+submissions.submission_status_date:%5B${from}+TO+${to}%5D&limit=100`);
  return j ? approvalEntries(j.results ?? [], from, to) : null;
}

export async function trialResults(now = new Date()): Promise<RadarEntry[] | null> {
  const journals = ["N Engl J Med", "Lancet", "JAMA", "Nat Med", "Lancet Oncol", "J Clin Oncol", "JAMA Oncol"].map((j) => `"${j}"[ta]`).join(" OR ");
  const term = `(${journals}) AND ("clinical trial, phase iii"[pt] OR "clinical trial, phase ii"[pt]) AND ("${day(daysAgo(45, now)).replace(/-/g, "/")}"[edat] : "3000"[edat])`;
  const ids = await json<{ esearchresult?: { idlist?: string[] } }>(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=25&sort=pub_date&term=${encodeURIComponent(term)}`);
  const list = ids?.esearchresult?.idlist ?? [];
  if (!ids) return null;
  if (!list.length) return [];
  const sum = await json<{ result?: Record<string, { title?: string; source?: string; pubdate?: string; epubdate?: string; pubtype?: string[] }> }>(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${list.join(",")}`);
  if (!sum?.result) return null;
  return list.flatMap((id) => {
    const r = sum.result![id];
    if (!r?.title) return [];
    const phase3 = (r.pubtype ?? []).some((p) => /Phase III/i.test(p));
    const date = Date.parse(r.epubdate || r.pubdate || "");
    return [{
      id: `pm${id}`, title: clean(r.title).replace(/\.$/, ""), snippet: r.source ?? "", url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`, source: r.source ?? "PubMed",
      at: new Date(Number.isNaN(date) ? now : date).toISOString(), tags: [phase3 ? "Phase 3 result" : "Phase 2 result"], places: placesIn(r.title), weight: phase3 ? 0.6 : 0.45,
    }];
  });
}

/* ---------------- Consumer: recalls ---------------- */

type Recall = { RecallID: number; RecallDate: string; Title: string; URL?: string; Description?: string; Products?: { NumberOfUnits?: string }[]; SoldAtLabel?: string; Retailers?: { Name?: string }[]; ManufacturerCountries?: { Country?: string }[]; Hazards?: { Name?: string }[] };

/** CPSC product recalls. Pure, for tests. */
export function recallEntries(rows: Recall[]): RadarEntry[] {
  return rows.map((r) => {
    const units = (r.Products ?? []).reduce((n, p) => n + (Number((p.NumberOfUnits ?? "").replace(/\(.*?\)/g, "").replace(/[^\d]/g, "")) || 0), 0);
    const sold = (r.Retailers ?? []).map((x) => clean(x.Name ?? "")).find((x) => /^Sold (?:Online )?(?:At|Exclusively)/i.test(x))?.replace(/^Sold (?:Online )?(?:Exclusively )?At:?\s*/i, "").split(/ (?:in|from) [A-Z][a-z]+ \d{4}/)[0];
    const made = [...new Set((r.ManufacturerCountries ?? []).map((c) => c.Country).filter((c): c is string => !!c))];
    const madeIds = made.map(countryId).filter((x): x is string => !!x && x !== US.id);
    const title = clean(r.Title).replace(/\s+Due to .+$/i, "");
    return {
      id: `cpsc${r.RecallID}`, title, snippet: [sold ? `Sold at ${sold}` : "", clean(r.Title).match(/Due to (.+)$/i)?.[1] ?? clean(r.Hazards?.[0]?.Name ?? "")].filter(Boolean).join(" · ").slice(0, 220),
      url: r.URL ?? "https://www.cpsc.gov/Recalls", source: "CPSC", at: new Date(r.RecallDate).toISOString(), tags: ["Recall", ...(made.length ? [`Made in ${made.slice(0, 2).join(", ")}`] : [])],
      metric: units ? `${units.toLocaleString("en-US")} units` : undefined, places: [...madeIds, US.id], ...(madeIds.length ? { flow: { from: madeIds, to: US.id } } : {}),
      weight: 0.4 + Math.min(0.35, Math.log10(1 + units) / 18),
    };
  });
}

export async function recalls(now = new Date()): Promise<RadarEntry[] | null> {
  const rows = await json<Recall[]>(`https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=${day(daysAgo(30, now))}`);
  return rows ? recallEntries(rows) : null;
}

/* ---------------- Research: feeds, arXiv, OSTI ---------------- */

/** Research from a publisher's feed, optionally only what matches a topic. */
export function feedEntries(xml: string, source: string, opts: { match?: RegExp; tag?: string; weight?: number } = {}): RadarEntry[] {
  return parseFeed(xml).flatMap((e) => {
    const title = clean(e.title).replace(/^FEDS (?:Paper|Notes?):\s*/i, ""), summary = stripHtml(e.summary, 240);
    if (!title || !e.link || (opts.match && !opts.match.test(`${title} ${summary} ${e.categories.join(" ")}`))) return [];
    const at = Date.parse(String(e.date ?? ""));
    return [{ id: idOf(e.link), title, snippet: summary, url: e.link, source, at: new Date(Number.isNaN(at) ? Date.now() : at).toISOString(), tags: [opts.tag ?? "Research"], places: placesIn(`${title} ${summary}`), weight: opts.weight ?? 0.45 }];
  });
}

async function feed(url: string, source: string, opts: Parameters<typeof feedEntries>[2] = {}): Promise<RadarEntry[] | null> {
  const xml = await text(url);
  return xml ? feedEntries(xml, source, opts) : null;
}

// arXiv asks for one request every three seconds; every radar shares this queue.
let arxivQueue: Promise<unknown> = Promise.resolve();
export function arxiv(query: string, tag: string, max = 15): Promise<RadarEntry[] | null> {
  const run = async () => {
    const xml = await text(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&sortBy=submittedDate&sortOrder=descending&max_results=${max}`);
    return xml ? feedEntries(xml, "arXiv", { tag, weight: 0.4 }).map((e) => ({ ...e, snippet: e.snippet.replace(/^arXiv:\S+\s+Announce Type:\s*\w+\s*Abstract:\s*/i, "") })) : null;
  };
  const next = arxivQueue.then(run, run);
  arxivQueue = next.then(() => new Promise((r) => setTimeout(r, 3100)), () => new Promise((r) => setTimeout(r, 3100)));
  return next;
}

type Osti = { osti_id: string; title: string; publication_date?: string; entry_date?: string; description?: string; product_type?: string; research_orgs?: string[]; links?: { rel: string; href: string }[] };

/** OSTI wants US dates. */
const usDate = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;

/**
 * DOE-funded research added to OSTI in the last month. OSTI's search matches loosely ("storage" finds a
 * particle accelerator's storage ring), so titles must also match `topic`.
 */
export async function osti(query: string, topic: RegExp, now = new Date()): Promise<RadarEntry[] | null> {
  const rows = await json<Osti[]>(`https://www.osti.gov/api/v1/records?q=${encodeURIComponent(query)}&sort=entry_date%20desc&rows=80&entry_date_start=${encodeURIComponent(usDate(daysAgo(30, now)))}`);
  if (!rows) return null;
  return rows.filter((r) => r.title && topic.test(r.title) && (r.product_type === "Journal Article" || r.product_type === "Technical Report")).map((r) => ({
    id: `osti${r.osti_id}`, title: clean(r.title), snippet: [r.research_orgs?.[0] ?? "", r.description && !/Abstract not provided/i.test(r.description) ? stripHtml(r.description, 180) : ""].filter(Boolean).join(" · "),
    url: r.links?.find((l) => l.rel === "citation")?.href ?? `https://www.osti.gov/biblio/${r.osti_id}`, source: "DOE (OSTI)",
    at: new Date(Date.parse(r.entry_date ?? "") || now.getTime()).toISOString(), tags: [r.product_type === "Technical Report" ? "DOE report" : "DOE-funded paper"], places: placesIn(r.title), weight: 0.44,
  }));
}

/* ---------------- Helpers ---------------- */

export function dedupe(xs: RadarEntry[]): RadarEntry[] {
  const seen = new Set<string>();
  return xs.filter((x) => { const k = x.title.toLowerCase().slice(0, 90); if (seen.has(x.id) || seen.has(k)) return false; seen.add(x.id); seen.add(k); return true; });
}

/** Several sources for one lane: whatever answers, newest and weightiest first. Null only when none answered. */
export async function merged(parts: Promise<RadarEntry[] | null>[]): Promise<RadarEntry[] | null> {
  const rs = await Promise.all(parts.map((p) => p.catch(() => null)));
  if (rs.every((r) => r === null)) return null;
  return dedupe(rs.flatMap((r) => r ?? []));
}

export const research = {
  energy: () => merged([
    feed("https://www.eia.gov/rss/todayinenergy.xml", "EIA", { tag: "EIA analysis", weight: 0.55 }),
    osti("\"energy storage\" OR battery OR hydrogen OR \"carbon capture\" OR geothermal OR nuclear OR fusion OR grid OR solar OR wind OR \"natural gas\"",
      /\b(?:batter(?:y|ies)|energy storage|hydrogen|electroly[sz]ers?|fuel cells?|photovoltaics?|solar|wind (?:turbines?|energy|power|farms?)|geothermal|nuclear|reactors?|fusion (?:energy|power|plasmas?|reactors?|devices?)|(?:inertial|magnetic) fusion|tokamaks?|power grids?|grid|transmission lines?|carbon capture|CO2 (?:capture|storage)|sequestration|natural gas|LNG|pipelines?|shale|biofuels?|hydropower|microgrids?|power plants?)\b/i),
  ]),
  financials: () => merged([
    feed("https://www.federalreserve.gov/feeds/feds.xml", "Federal Reserve", { tag: "Fed working paper", weight: 0.5 }),
    feed("https://www.federalreserve.gov/feeds/feds_notes.xml", "Federal Reserve", { tag: "FEDS Note", weight: 0.52 }),
    feed("https://www.nber.org/rss/new.xml", "NBER", { tag: "NBER paper", match: /\b(?:bank\w*|credit|financ\w*|monetary|interest rates?|liquidity|asset pric\w*|lend\w*|deposit\w*|insur\w*|funds?|markets?)\b/i, weight: 0.47 }),
    arxiv("cat:q-fin.RM OR cat:q-fin.PM OR cat:q-fin.TR OR cat:q-fin.GN", "Preprint", 10),
  ]),
  industrials: () => arxiv("cat:cs.RO", "Preprint", 15),
  media: () => arxiv("cat:cs.NI", "Preprint", 15),
  realestate: () => merged([
    feed("https://www.federalreserve.gov/feeds/feds.xml", "Federal Reserve", { tag: "Fed working paper", match: /\b(?:hous\w*|mortgages?|real estate|rents?|rental|renters?|home prices?|commercial (?:property|real estate)|office (?:space|market)s?|construction|zoning|homeowners?)\b/i, weight: 0.5 }),
    feed("https://www.federalreserve.gov/feeds/feds_notes.xml", "Federal Reserve", { tag: "FEDS Note", match: /\b(?:hous\w*|mortgages?|real estate|rents?|rental|renters?|home prices?|commercial (?:property|real estate)|office (?:space|market)s?|construction|zoning|homeowners?)\b/i, weight: 0.52 }),
    feed("https://www.nber.org/rss/new.xml", "NBER", { tag: "NBER paper", match: /\b(?:hous\w*|mortgages?|real estate|rents?|rental|renters?|home prices?|commercial (?:property|real estate)|office (?:space|market)s?|construction|zoning|homeowners?)\b/i, weight: 0.47 }),
  ]),
};
