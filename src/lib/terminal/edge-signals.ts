/**
 * Edge cards as the Terminal's monitors read them, pure and safe in the browser (tested in
 * scripts/test-edge-terminal.ts). SAT: one row per signal at a company's site, with a z-score against
 * that site's own history where the card carries one, the history as a sparkline series and the picture.
 * FLR: one row per mapped plant from the hourly flare record. EVTS: each finding's group on the tape and
 * how much it matters, and the tape's filter words.
 */
import type { FlareDay, FlareWeek } from "@/lib/edge/flares";
import { poissonZ, vsAverage, zScore } from "./edge-math";

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/* ---------------- SAT: site signals ---------------- */

export type CardLike = { id: number; kind: string; title: string; observedAt: string | null; detectedAt: string; magnitude: number; confidence: number; visual: Record<string, unknown> };
export type SiteSignal = {
  id: number; kind: string; title: string; site: string; lon: number; lat: number; at: string;
  /** The reading the signal is about: heat (MW), NDVI, water share, ships, permits, kg/h, m² or ha. */
  value: number | null; unit: string;
  /** Against this site's own history (null where the card has no baseline: radar, ground change). */
  z: number | null;
  /** The history, oldest first, the current reading last. */
  history: number[];
  /** A picture of the site: a satellite image address (pass it through edgeImageSrc) or a data URI. */
  thumb: string | null;
};

export const SITE_KINDS = ["flaring", "crop_vigour", "water_extent", "vessel_traffic", "radar_change", "ground_change", "permits", "methane_plume"] as const;
const SAT_UNIT: Record<string, string> = { ndvi: "NDVI", share: "water", ships: "ships" };

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const rec = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** One card as a site signal, or null when it is not about a mapped site. Pure. */
export function siteSignal(c: CardLike): SiteSignal | null {
  const v = c.visual ?? {};
  const site = rec(v.site);
  if (!fin(site.lon) || !fin(site.lat)) return null;
  const base = { id: c.id, kind: c.kind, title: c.title, site: str(site.name) ?? "Site", lon: site.lon, lat: site.lat, at: c.observedAt ?? c.detectedAt };
  switch (c.kind) {
    case "flaring": {
      const hist = (Array.isArray(v.history) ? v.history : []).map((h) => rec(h).frp).filter(fin);
      const value = fin(rec(v.stats).frpTotal) ? (rec(v.stats).frpTotal as number) : null;
      return { ...base, value, unit: "MW", z: value === null ? null : zScore(hist.slice(0, -1), value), history: hist, thumb: str(rec(v.heat).url) };
    }
    case "crop_vigour": case "water_extent": case "vessel_traffic": {
      const m = rec(v.metric);
      const baseline = (Array.isArray(m.baseline) ? m.baseline : []).map((b) => rec(b).value).filter(fin);
      const current = fin(m.current) ? m.current : null;
      return { ...base, value: current, unit: SAT_UNIT[String(m.unit)] ?? String(m.unit ?? ""), z: fin(m.z) ? m.z : null, history: current === null ? baseline : [...baseline, current], thumb: str(rec(v.image).url) };
    }
    case "permits": {
      const last30 = fin(v.last30) ? v.last30 : null, prior90 = fin(v.prior90) ? v.prior90 : 0;
      return { ...base, value: last30, unit: "permits", z: last30 === null ? null : poissonZ(last30, prior90 / 3), history: (Array.isArray(v.windows) ? v.windows : []).filter(fin), thumb: null };
    }
    case "methane_plume": {
      const earlier = (Array.isArray(v.earlier) ? v.earlier : []).map(rec).filter((e) => fin(e.rateKgH)).sort((a, b) => String(a.date).localeCompare(String(b.date))).map((e) => e.rateKgH as number);
      const rate = fin(v.rateKgH) ? v.rateKgH : null;
      return { ...base, value: rate, unit: "kg/h", z: rate === null ? null : zScore(earlier, rate), history: rate === null ? earlier : [...earlier, rate], thumb: str(v.image) };
    }
    case "radar_change":
      return { ...base, value: fin(rec(v.stats).newAreaM2) ? (rec(v.stats).newAreaM2 as number) : null, unit: "m²", z: null, history: [], thumb: str(rec(v.after).url) };
    case "ground_change":
      return { ...base, value: fin(c.magnitude) ? c.magnitude : null, unit: "ha", z: null, history: [], thumb: str(rec(v.after).url) };
    default:
      return null;
  }
}

/* ---------------- FLR: a plant's flaring row ---------------- */

export type PlantLike = { id: number; name: string; company: string; ticker: string; lon: number; lat: number; cap: number };
export type FlareRow = PlantLike & {
  /** Radiant heat (MW) each of the last seven days, oldest first. */
  daily: number[];
  daysFlaring: number; frp7: number;
  /** Heat each week on the record, up to twelve, this week last. */
  weekly: number[];
  /** The last seven days' heat against the average week before this one; null without a record of heat. */
  vsAvg: number | null;
};

/** A plant's row: the week's days and heat, its weekly record (to twelve weeks) and the change against the weeks before. Pure. */
export function flareRow(p: PlantLike, days: FlareDay[], weeks: FlareWeek[], thisWeek: string): FlareRow {
  const daily = days.map((d) => d.frp);
  const frp7 = Math.round(daily.reduce((s, x) => s + x, 0) * 10) / 10;
  const record = [...weeks].sort((a, b) => a.week.localeCompare(b.week)).filter((w) => w.week <= thisWeek).slice(-12);
  const before = record.filter((w) => w.week < thisWeek).map((w) => w.frp);
  return { ...p, daily, daysFlaring: days.filter((d) => d.n > 0).length, frp7, weekly: record.map((w) => w.frp), vsAvg: before.length ? vsAverage(frp7, before) : null };
}

/* ---------------- EVTS: the tape ---------------- */

export type EventGroup = { id: string; label: string; kinds: string[] };
export const EVENT_GROUPS: EventGroup[] = [
  { id: "FLR", label: "Flaring", kinds: ["flaring"] },
  { id: "SAT", label: "Satellite and radar", kinds: ["ground_change", "radar_change", "crop_vigour", "water_extent", "vessel_traffic"] },
  { id: "CH4", label: "Methane", kinds: ["methane_plume"] },
  { id: "PMT", label: "Drilling permits", kinds: ["permits"] },
  { id: "REC", label: "Public records", kinds: ["reactor_outage", "fda_recall", "vehicle_recall"] },
  { id: "DEAL", label: "Deals", kinds: ["deal_impact", "deal_proforma", "deal_odds"] },
  { id: "ALT", label: "Alt data", kinds: ["hiring_shift", "hiring_tell", "attention_spike", "contract_award", "layoff_notice", "patent_shift"] },
  { id: "DOC", label: "Filings and calls", kinds: ["filing_change", "call_evasion", "commitment_due", "guidance_result"] },
  { id: "NET", label: "Network", kinds: ["graph_flag", "graph_prediction"] },
  { id: "QNT", label: "Quant", kinds: ["quant.insider_cluster", "quant.activist"] },
];

/** A finding's group on the tape; "OTHER" for a kind not listed. Pure. */
export const groupOf = (kind: string): string => EVENT_GROUPS.find((g) => g.kinds.includes(kind))?.id ?? (kind.startsWith("quant.") ? "QNT" : "OTHER");

export type Severity = "high" | "medium" | "low";

/**
 * How much a finding matters on the tape: a deal-watch card's own judgement, otherwise its size (hectares of
 * ground scaled as the feed does, feed.ts sizeOf) weighed with Edge's confidence. Pure.
 */
export function severityOf(c: { kind: string; magnitude: number; confidence: number; visual: Record<string, unknown> }): Severity {
  const own = c.visual?.severity;
  if (own === "high" || own === "medium" || own === "low") return own;
  const size = c.kind === "ground_change" ? Math.min(1, c.magnitude / 5) : Math.max(0, Math.min(1, c.magnitude));
  const s = 0.6 * size + 0.4 * Math.max(0, Math.min(1, c.confidence));
  return s >= 0.65 ? "high" : s >= 0.4 ? "medium" : "low";
}

const SEV: Record<string, Severity> = { high: "high", hi: "high", medium: "medium", med: "medium", low: "low", lo: "low" };
const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** The tape's words, in any order: a group (FLR, SAT, DEAL…), a ticker and a severity. Pure. */
export function parseTape(text: string): { group: string | null; ticker: string | null; severity: Severity | null } {
  const out: { group: string | null; ticker: string | null; severity: Severity | null } = { group: null, ticker: null, severity: null };
  for (const raw of text.trim().split(/\s+/).filter(Boolean)) {
    const w = raw.toUpperCase();
    if (!out.group && EVENT_GROUPS.some((g) => g.id === w)) out.group = w;
    else if (!out.severity && SEV[raw.toLowerCase()]) out.severity = SEV[raw.toLowerCase()];
    else if (!out.ticker && TICKER.test(w)) out.ticker = w;
  }
  return out;
}
