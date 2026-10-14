/**
 * The Deal Radar's labels and its monthly panel (E4). A target event is an announced agreement to be
 * acquired or merged, a take-private or a tender offer, dated at its first public filing:
 * - definitive merger proxies and information statements (DEFM14A, DEFM14C) and tender recommendations
 *   (SC 14D9) a single company filed (a joint proxy names two companies and is used only when the deal
 *   database says which is the target);
 * - the deal database's targets (F4) and the graph's acquired links, which carry the announcement date;
 * affiliate roll-ups and internal reorganisations excluded (isDealVehicle, sameGroup, the link relation).
 * A proxy filed by a buyer for its own share issuance is label noise the model card names.
 *
 * The panel is one row per company and month: the features at the month's first day, and whether an event
 * followed within 12 months (null while the window is still open). Coverage this round is energy plus two
 * sectors (software and technology hardware; pharmaceuticals, devices and health services); setting
 * EDGE_ODDS_UNIVERSE=all widens it to every US-listed operating company. Pure.
 */
import { featureRow, type RawCompany, type WaveContext } from "./features";

export type TargetEvent = { cik: string; date: string; sic: string; source: string };

/** The sectors scored this round, by SIC prefix. */
export const SECTORS: Record<string, { label: string; prefixes: string[] }> = {
  energy: { label: "Energy and utilities", prefixes: ["13", "29", "46", "49"] },
  tech: { label: "Software and technology hardware", prefixes: ["737", "357", "367"] },
  health: { label: "Pharmaceuticals, devices and health services", prefixes: ["283", "384", "80"] },
};

/** Which universe is scored: "sectors" (this round's default) or "all". Pure over the environment value. */
export const universeMode = (env = process.env.EDGE_ODDS_UNIVERSE) => (env?.trim().toLowerCase() === "all" ? "all" : "sectors");

/** Whether a SIC is in scope. Operating companies only: blank-check shells (6770) and funds (67xx) never. Pure. */
export function inScope(sic: string, mode: "all" | "sectors" = universeMode()): boolean {
  if (!/^\d{4}$/.test(sic) || sic === "6770" || sic.startsWith("67")) return false;
  if (mode === "all") return true;
  return Object.values(SECTORS).some((s) => s.prefixes.some((p) => sic.startsWith(p)));
}

/** The sector label of a SIC. Pure. */
export const sectorOf = (sic: string) => Object.entries(SECTORS).find(([, s]) => s.prefixes.some((p) => sic.startsWith(p)))?.[0] ?? "other";

type Hit = { _id: string; _source: { ciks?: string[]; form?: string; file_date?: string; sics?: string[]; file_type?: string } };

/** Target events from full-text search hits: single-company proxies, information statements and 14D-9s, one per filing. Pure. */
export function eventsFromHits(hits: Hit[]): TargetEvent[] {
  const seen = new Set<string>();
  const out: TargetEvent[] = [];
  for (const h of hits) {
    const acc = h._id.split(":")[0];
    if (seen.has(acc)) continue;
    const s = h._source;
    const form = (s.form ?? "").toUpperCase();
    if (!/^(DEFM14A|DEFM14C|SC 14D9)$/.test(form)) continue;
    const ciks = (s.ciks ?? []).map((c) => c.replace(/^0+/, ""));
    if (ciks.length !== 1 || !s.file_date) continue;
    seen.add(acc);
    out.push({ cik: ciks[0], date: s.file_date.slice(0, 10), sic: s.sics?.[0] ?? "", source: `${form} ${acc}` });
  }
  return out;
}

/** Events merged by company: one event per company within 270 days (a proxy and a later 14D-9 of one deal), earliest kept. Pure. */
export function dedupeEvents(events: TargetEvent[]): TargetEvent[] {
  const by = new Map<string, TargetEvent[]>();
  for (const e of [...events].sort((a, b) => a.date.localeCompare(b.date))) {
    const list = by.get(e.cik) ?? [];
    const last = list[list.length - 1];
    if (last && Date.parse(e.date) - Date.parse(last.date) < 270 * 86_400_000) continue;
    list.push(e);
    by.set(e.cik, list);
  }
  return [...by.values()].flat();
}

/**
 * The label of a company-month: 1 when an event falls in [t, t + horizon months), 0 when the window has
 * closed without one, null while it is still open (the row is scored, not trained on). Pure.
 */
export function labelAt(eventDates: string[], t: string, horizonMonths: number, today: string): 0 | 1 | null {
  const end = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1 + horizonMonths, 1)).toISOString().slice(0, 10);
  if (eventDates.some((d) => d >= t && d < end)) return 1;
  return end <= today ? 0 : null;
}

/** First days of months from one month to another, inclusive. Pure. */
export function monthsFrom(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const end = to.slice(0, 7);
  for (let i = 0; i < 1000; i++) { const s = `${y}-${String(m).padStart(2, "0")}`; if (s > end) break; out.push(`${s}-01`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

/** The wave context from events: dates by SIC2 and each group's long-run monthly rate over the whole span. Pure. */
export function waveContext(events: TargetEvent[], months: number): WaveContext {
  const eventsBySic2 = new Map<string, string[]>();
  for (const e of events) if (e.sic) { const g = e.sic.slice(0, 2); eventsBySic2.set(g, [...(eventsBySic2.get(g) ?? []), e.date]); }
  return { eventsBySic2, longRunMonthly: new Map([...eventsBySic2.entries()].map(([g, d]) => [g, d.length / Math.max(1, months)])) };
}

export type PanelRow = { cik: string; t: string; sic: string; x: number[]; y: 0 | 1 | null; listed: boolean };

/**
 * The monthly panel: for each company, each month from a year after its first filing (and no earlier than
 * `from`) to the last month it filed anything (a delisted company stops) or today; features as of the
 * month's first day; the label. The 18 months after an event are left out (the company is in a deal, or
 * its deal failed and the next months say little); a company that is still filing after that comes back. Pure.
 */
export function buildPanel(raws: Pick<RawCompany, "cik" | "sic" | "facts" | "filings" | "listed">[], events: TargetEvent[], opts: { from: string; today: string; horizon?: number }): PanelRow[] {
  const horizon = opts.horizon ?? 12;
  const byCik = new Map<string, string[]>();
  for (const e of events) byCik.set(e.cik, [...(byCik.get(e.cik) ?? []), e.date]);
  const ctx = waveContext(events, monthsFrom(opts.from, opts.today).length);
  const rows: PanelRow[] = [];
  for (const r of raws) {
    if (!r.filings.length) continue;
    const firstFiling = r.filings.reduce((m, f) => (f.d < m ? f.d : m), opts.today);
    const lastFiling = r.filings.reduce((m, f) => (f.d > m ? f.d : m), "");
    const start = new Date(Date.parse(firstFiling) + 365 * 86_400_000).toISOString().slice(0, 10);
    const ev = (byCik.get(r.cik) ?? []).sort();
    const stop = r.listed ? opts.today : lastFiling;
    for (const t of monthsFrom(start > opts.from ? start : opts.from, stop)) {
      if (ev.some((d) => d < t && Date.parse(t) - Date.parse(d) < 548 * 86_400_000)) continue;
      rows.push({ cik: r.cik, t, sic: r.sic, x: featureRow(r, t, ctx), y: labelAt(ev, t, horizon, opts.today), listed: r.listed });
    }
  }
  return rows;
}
