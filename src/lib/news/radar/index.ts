/**
 * A radar for every sector: the early signals before they are news. Technology keeps the tech radar
 * (papers, repositories, models, launches; see ../sources/radar.ts). Every other sector reads what
 * moves it: energy projects through FERC, DOE and NRC; new trials and FDA approvals; bank deals
 * before the Fed; trade cases and export controls; recalls; the rules in motion; and the research
 * behind all of it. Each sector's lanes are built from public sources (./sources.ts), cached for a
 * day, and kept fresh by the Newsroom pass, so opening a radar never waits on a government server.
 */
import { cacheGet, cacheSet } from "@/lib/cache";
import type { SectorKey } from "../desks";
import * as S from "./sources";
import type { RadarEntry } from "./sources";

export type { RadarEntry };
export type RadarLane = { id: string; title: string; blurb: string; icon: string; sources: string; entries: RadarEntry[]; status: "ok" | "unavailable" };
type LaneDef = Omit<RadarLane, "entries" | "status"> & { load: () => Promise<RadarEntry[] | null>; limit?: number };
export type SectorRadarId = Exclude<SectorKey, "tech">;
export type RadarDef = { title: string; blurb: string; region: "world" | "us"; lanes: LaneDef[] };

const trade: LaneDef = {
  id: "trade", title: "Trade cases and export controls", icon: "Globe", sources: "Federal Register: USITC, Commerce (BIS), USTR", load: S.tradeActions,
  blurb: "New anti-dumping and countervailing cases, five-year reviews and patent import cases at the ITC, Entity List changes, and USTR tariff actions, with the countries involved.",
};

export const RADARS: Record<SectorRadarId, RadarDef> = {
  energy: {
    title: "Energy radar", region: "world",
    blurb: "Projects moving through regulators before they are built, the research behind the next ones, the sector's deals, and where it is all happening.",
    lanes: [
      { id: "projects", title: "Pipelines and projects", icon: "Fuel", sources: "Federal Register: FERC, DOE, NRC", load: S.energyProjects, limit: 16,
        blurb: "Gas pipelines, LNG terminals and export applications, hydro and nuclear projects, at each step: application, environmental review, approval." },
      { id: "research", title: "Research and analysis", icon: "FlaskConical", sources: "EIA, DOE (OSTI)", load: S.research.energy,
        blurb: "EIA's analysis of markets and supply, and DOE-funded research on storage, hydrogen, the grid, carbon capture, geothermal and fusion." },
    ],
  },
  healthcare: {
    title: "Healthcare radar", region: "world",
    blurb: "What is entering the clinic, what the FDA just approved, which results just landed, the sector's deals, and where trials enroll.",
    lanes: [
      { id: "trials", title: "New trials", icon: "Stethoscope", sources: "ClinicalTrials.gov", load: S.newTrials, limit: 16,
        blurb: "Phase 2 and 3 trials that companies registered in the last three weeks, with enrollment and the countries where they recruit." },
      { id: "approvals", title: "FDA approvals", icon: "CheckSquare", sources: "openFDA", load: S.fdaApprovals,
        blurb: "Original new-drug and biologic approvals from the last ten weeks; new molecular entities and priority reviews are marked." },
      { id: "results", title: "Trial results", icon: "BookOpen", sources: "PubMed", load: S.trialResults,
        blurb: "Phase 2 and 3 results published in NEJM, The Lancet, JAMA, Nature Medicine and the Journal of Clinical Oncology." },
    ],
  },
  financials: {
    title: "Financials radar", region: "us",
    blurb: "Bank deals before they close, failures, the research regulators read, the sector's deals, and where it is happening.",
    lanes: [
      { id: "banks", title: "Bank deals filed with the Fed", icon: "Landmark", sources: "Federal Register: Federal Reserve", load: S.bankDeals, limit: 16,
        blurb: "Holding-company mergers, acquisitions and changes in control awaiting Federal Reserve approval, with the comment deadline." },
      { id: "failures", title: "Bank failures", icon: "AlertTriangle", sources: "FDIC", load: S.bankFailures, limit: 8,
        blurb: "Banks that failed in the last year, with their assets and the estimated cost to the deposit insurance fund." },
      { id: "research", title: "Research", icon: "BookOpen", sources: "Federal Reserve, NBER, arXiv", load: S.research.financials,
        blurb: "Fed working papers and notes, NBER papers on banking and markets, and new quantitative finance preprints." },
    ],
  },
  industrials: {
    title: "Industrials radar", region: "world",
    blurb: "Trade cases and export controls that reshape supply chains, the rules in motion, automation research, the sector's deals, and where it is happening.",
    lanes: [
      trade,
      { id: "rules", title: "Rules in motion", icon: "Scale", sources: "Federal Register: EPA, DOT, OSHA",
        load: () => S.rules([{ slug: "environmental-protection-agency", short: "EPA" }, { slug: "transportation-department", short: "DOT" }, { slug: "occupational-safety-and-health-administration", short: "OSHA" }]),
        blurb: "Final and proposed rules from the EPA, the Transportation Department and OSHA." },
      { id: "research", title: "Automation and robotics research", icon: "Cpu", sources: "arXiv", load: S.research.industrials,
        blurb: "New preprints in robotics and automation." },
    ],
  },
  consumer: {
    title: "Consumer radar", region: "world",
    blurb: "Recalls, the trade actions that move prices on shelves, rules in motion, the sector's deals, and where products are made.",
    lanes: [
      { id: "recalls", title: "Product recalls", icon: "AlertTriangle", sources: "CPSC", load: S.recalls, limit: 16,
        blurb: "Consumer products recalled in the last 30 days, with how many units, where they were sold and where they were made." },
      { ...trade, title: "Trade and tariffs" },
      { id: "rules", title: "Rules in motion", icon: "Scale", sources: "Federal Register: FTC, CPSC",
        load: () => S.rules([{ slug: "federal-trade-commission", short: "FTC" }, { slug: "consumer-product-safety-commission", short: "CPSC" }]),
        blurb: "Final and proposed rules from the FTC and the Consumer Product Safety Commission." },
    ],
  },
  media: {
    title: "Media & telecom radar", region: "world",
    blurb: "FCC rules on spectrum, broadband and broadcasting, networking research, the sector's deals, and where it is happening.",
    lanes: [
      { id: "rules", title: "FCC rules in motion", icon: "Radio", sources: "Federal Register: FCC",
        load: () => S.rules([{ slug: "federal-communications-commission", short: "FCC" }]),
        blurb: "Final and proposed rules from the FCC: spectrum, broadband, broadcasting and ownership." },
      { id: "research", title: "Networking research", icon: "Server", sources: "arXiv", load: S.research.media,
        blurb: "New preprints on networks, the internet and streaming." },
    ],
  },
  realestate: {
    title: "Real estate radar", region: "us",
    blurb: "Housing rules in motion, the research on housing and property, the sector's deals, and where it is happening.",
    lanes: [
      { id: "rules", title: "Housing rules in motion", icon: "Building2", sources: "Federal Register: HUD, FHFA",
        load: () => S.rules([{ slug: "housing-and-urban-development-department", short: "HUD" }, { slug: "federal-housing-finance-agency", short: "FHFA" }]),
        blurb: "Final and proposed rules from HUD and the Federal Housing Finance Agency." },
      { id: "research", title: "Housing and property research", icon: "BookOpen", sources: "Federal Reserve, NBER", load: S.research.realestate,
        blurb: "Fed and NBER research on housing, mortgages, rents and commercial property." },
    ],
  },
};

export const isSectorRadar = (s: string): s is SectorRadarId => s in RADARS;

export type RadarBuild = { builtAt: string; lanes: RadarLane[] };
const KEY = (s: SectorRadarId) => `news:radar:v1:${s}`;
const DAY = 86_400_000;

/** Weight first, freshness second: a week-old approval still outranks yesterday's minor notice. Pure, for tests. */
export function rankEntries(xs: RadarEntry[], now = Date.now()): RadarEntry[] {
  const score = (e: RadarEntry) => e.weight + 0.3 * Math.exp(-Math.max(0, now - Date.parse(e.at)) / (10 * DAY));
  return [...xs].sort((a, b) => score(b) - score(a));
}

export async function buildRadar(sector: SectorRadarId): Promise<RadarBuild> {
  const def = RADARS[sector];
  // A source that does not answer this time keeps its last good lane rather than going blank.
  const prev = await cacheGet(KEY(sector)).then((h) => (h ? (JSON.parse(h) as RadarBuild) : null)).catch(() => null);
  const lanes = await Promise.all(def.lanes.map(async ({ load, limit, ...lane }): Promise<RadarLane> => {
    const entries = await Promise.race([load().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 40_000))]);
    if (entries) return { ...lane, entries: rankEntries(entries).slice(0, limit ?? 12), status: "ok" };
    const last = prev?.lanes.find((l) => l.id === lane.id && l.status === "ok");
    return { ...lane, entries: last?.entries ?? [], status: last ? "ok" : "unavailable" };
  }));
  const build = { builtAt: new Date().toISOString(), lanes };
  if (lanes.some((l) => l.status === "ok")) await cacheSet(KEY(sector), JSON.stringify(build), 2 * DAY).catch(() => undefined);
  return build;
}

/** A sector's lanes, from the cache when there, built now when not. */
export async function radarLanes(sector: SectorRadarId): Promise<RadarBuild> {
  const hit = await cacheGet(KEY(sector)).catch(() => null);
  if (hit) { try { return JSON.parse(hit) as RadarBuild; } catch { /* rebuild */ } }
  return buildRadar(sector);
}

/** Rebuild the radars older than three hours, a couple per pass. Returns how many were rebuilt. */
export async function warmRadars(deadline: number, max = 2): Promise<number> {
  let n = 0;
  for (const s of Object.keys(RADARS) as SectorRadarId[]) {
    if (n >= max || Date.now() > deadline - 20_000) break;
    const hit = await cacheGet(KEY(s)).catch(() => null);
    let age = Infinity;
    if (hit) { try { age = Date.now() - Date.parse((JSON.parse(hit) as RadarBuild).builtAt); } catch { /* stale */ } }
    if (age < 3 * 3_600_000) continue;
    await buildRadar(s).catch(() => null);
    n++;
  }
  return n;
}
