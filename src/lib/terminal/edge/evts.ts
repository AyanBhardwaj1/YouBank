/**
 * EVTS: the live tape of Edge findings, newest first, like Bloomberg's TOP and FIRST for alternative
 * data: every new card across kinds (flaring, satellites and radar, methane, permits, public records,
 * deal watch, alt data, filings, the network, quant) with its group, severity, tickers and time; counts
 * per group for the filter strip; filtered by group, ticker or severity. Public findings and the person's
 * own; the last 30 days. Server only.
 */
import { sql, type SQL } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { flareFreshness, passState, RECORDS_PASS, lastOk } from "@/lib/edge/passes";
import { EVENT_GROUPS, groupOf, severityOf, type Severity } from "../edge-signals";
import { attempt, newest, stateOf, type SourceState } from "./common";

export type TapeEvent = { id: number; kind: string; group: string; severity: Severity; title: string; tickers: string[]; at: string; detectedAt: string; magnitude: number; confidence: number; site: string | null };
export type EvtsView = { events: TapeEvent[]; groups: Record<string, number>; total: number; filter: { group: string | null; ticker: string | null; severity: Severity | null }; sources: SourceState[]; asOf: string };

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const SEV_ORDER: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

export async function evtsView(userId: string, filter: { group?: string | null; ticker?: string | null; severity?: Severity | null } = {}, now = Date.now()): Promise<EvtsView> {
  const db = requireDb();
  const group = filter.group && EVENT_GROUPS.some((g) => g.id === filter.group) ? filter.group : null;
  const ticker = filter.ticker && TICKER.test(filter.ticker) ? filter.ticker : null;
  const severity = filter.severity ?? null;
  const base: SQL[] = [sql`${schema.edgeDetections.detectedAt} > now() - interval '30 days'`, sql`(${schema.edgeDetections.ownerId} is null or ${schema.edgeDetections.ownerId} = ${userId})`];
  if (ticker) base.push(sql`${schema.edgeDetections.tickers} ? ${ticker}`);
  const where = (extra: SQL[] = []) => sql.join([...base, ...extra], sql` and `);
  const kinds = group ? EVENT_GROUPS.find((g) => g.id === group)!.kinds : null;
  const [rows, counts, flares, records] = await Promise.all([
    attempt("evts-rows", [] as { id: number; kind: string; title: string; tickers: string[]; magnitude: number; confidence: number; severity: string | null; site: string | null; observedAt: Date | null; detectedAt: Date }[], () => db.select({
      id: schema.edgeDetections.id, kind: schema.edgeDetections.kind, title: schema.edgeDetections.title, tickers: schema.edgeDetections.tickers, magnitude: schema.edgeDetections.magnitude, confidence: schema.edgeDetections.confidence,
      severity: sql<string | null>`${schema.edgeDetections.visual}->>'severity'`, site: sql<string | null>`coalesce(${schema.edgeDetections.visual}->'site'->>'name', ${schema.edgeDetections.visual}->>'plant')`,
      observedAt: schema.edgeDetections.observedAt, detectedAt: schema.edgeDetections.detectedAt,
    }).from(schema.edgeDetections).where(where(kinds ? [sql`${schema.edgeDetections.kind} in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})`] : [])).orderBy(sql`${schema.edgeDetections.detectedAt} desc, ${schema.edgeDetections.id} desc`).limit(300)),
    attempt("evts-counts", [] as { kind: string; n: number }[], async () => (await db.execute(sql`select kind, count(*)::int as n from edge_detections where ${where()} group by kind`)).rows as { kind: string; n: number }[]),
    attempt("evts-flares", null as Awaited<ReturnType<typeof flareFreshness>> | null, () => flareFreshness()),
    attempt("evts-records", null as Awaited<ReturnType<typeof passState>>, () => passState(RECORDS_PASS)),
  ]);
  const events: TapeEvent[] = rows.value.map((r) => ({
    id: r.id, kind: r.kind, group: groupOf(r.kind), title: r.title, tickers: r.tickers, magnitude: r.magnitude, confidence: r.confidence, site: r.site,
    severity: severityOf({ kind: r.kind, magnitude: r.magnitude, confidence: r.confidence, visual: r.severity ? { severity: r.severity } : {} }),
    at: (r.observedAt ?? r.detectedAt).toISOString(), detectedAt: r.detectedAt.toISOString(),
  })).filter((e) => !severity || SEV_ORDER[e.severity] >= SEV_ORDER[severity]);
  const groups: Record<string, number> = {};
  for (const c of counts.value) { const g = groupOf(c.kind); groups[g] = (groups[g] ?? 0) + Number(c.n); }
  const recordsAt = lastOk(records.value);
  const sources: SourceState[] = [
    stateOf("findings", "Edge findings (edge_detections)", rows.ok, events.length, newest(events.map((e) => e.detectedAt))),
    // A pass that has never run is not a source that is down: it says so instead.
    flares.value?.checkedAt || (flares.value && !flares.value.ok)
      ? stateOf("flares", "Hourly flare pass (NASA FIRMS)", flares.ok && (flares.value?.ok ?? false), 1, flares.value?.checkedAt ?? null, { staleAfterMs: 3 * 3_600_000, now, note: flares.value && !flares.value.ok ? "the last pass did not complete" : undefined })
      : stateOf("flares", "Hourly flare pass (NASA FIRMS)", flares.ok, 0, null, { note: "no pass has run yet" }),
    records.value
      ? stateOf("records", "Hourly records pass (NRC, openFDA, NHTSA)", records.ok && records.value.ok, recordsAt ? 1 : 0, recordsAt, { staleAfterMs: 3 * 3_600_000, now, note: records.value.ok ? undefined : "the last pass did not complete" })
      : stateOf("records", "Hourly records pass (NRC, openFDA, NHTSA)", records.ok, 0, null, { note: "no pass has run yet" }),
  ];
  return { events, groups, total: Object.values(groups).reduce((s, n) => s + n, 0), filter: { group, ticker, severity }, sources, asOf: new Date(now).toISOString() };
}
