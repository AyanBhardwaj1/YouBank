/**
 * Refreshing one company's Alt-Data Pulse (E3): every free source the crosswalk links it to, read now,
 * stored as weekly or monthly points in the signal store (F2) with their provenance, the raw pulls kept in
 * R2 for re-audit, and the findings its series and events support written to the feed. All sources are
 * free and public; nothing here opens a premium scope, so background refreshes and a person's "refresh now"
 * do the same free work.
 *
 * Interface for other features (the Deal Radar's alternative-data features, Management Track Record):
 *   refreshCompany(nodeId, deadline)   read every source, store points, write findings; returns coverage
 *   pulseOf(nodeId)                    the stored series, tells, events and coverage, for panels and tools
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheGet, cacheJson, cacheSet } from "@/lib/cache";
import { logError } from "@/lib/errors";
import { PULSE_STATE_CONCURRENCY } from "@/lib/market/budgets";
import { mapLimit } from "@/lib/market/chain";
import { boardMoved } from "../entities/crosswalk";
import { idsOf, resolveEntity } from "../entities/resolve";
import { boardsFromSite } from "../entities/sources/careers";
import { getJson, putJson, r2Ready } from "../infra/r2";
import { record } from "../provenance";
import { monthStart, weekOf } from "../series/change";
import { archiveRaw, noteSeriesSource, putPoints, readSeries, type Point } from "../series/store";
import { evaluate, type Candidate, type Coverage, type PulseKind } from "./findings";
import { byMetro, foldRead, type PostingState, type WeekRead } from "./postings";
import { boardUrls, readBoard, type Board, type Posting } from "./sources/ats";
import { readPatents, patentsviewReady } from "./sources/patentsview";
import { monthlyAwards, readAwards, type Award } from "./sources/usaspending";
import { matchNotices, readWarn, WARN_SOURCES, type WarnNotice } from "./sources/warn";
import { readViews } from "./sources/wikimedia";

const DAY = 86_400_000;
const STATE_KEY = (nodeId: number) => `pulse/postings/${nodeId}.json`;

async function loadState(nodeId: number): Promise<PostingState | null> {
  if (r2Ready()) return getJson<PostingState>(STATE_KEY(nodeId)).catch(() => null);
  const s = await cacheGet(`edge:${STATE_KEY(nodeId)}`);
  return s ? (JSON.parse(s) as PostingState) : null;
}
async function saveState(nodeId: number, state: PostingState): Promise<void> {
  if (r2Ready()) { await putJson(STATE_KEY(nodeId), state); return; }
  await cacheSet(`edge:${STATE_KEY(nodeId)}`, JSON.stringify(state), 400 * DAY);
}

/* ---------------- WARN: statewide files, read once a day and matched to companies ---------------- */

export type WarnStatus = Record<string, { lastGood?: string; lastTried?: string; rows?: number; error?: string }>;

/** Every state's recent notices (last 13 months), read at most once a day, and each state's status. */
export async function loadWarn(): Promise<WarnNotice[]> {
  return cacheJson(`edge:pulse:warn:v1:${new Date().toISOString().slice(0, 10)}`, DAY, async () => {
    const db = requireDb();
    const [row] = await db.select().from(schema.edgeJobState).where(eq(schema.edgeJobState.name, "pulse.warn"));
    const status = (row?.state ?? {}) as WarnStatus;
    const since = new Date(Date.now() - 395 * DAY).toISOString().slice(0, 10);
    const all: WarnNotice[] = [];
    // States at once, a few at a time (market/budgets): six 30-second files in sequence outlasted the route.
    const read = await mapLimit(WARN_SOURCES, PULSE_STATE_CONCURRENCY, async (src) => {
      const now = new Date().toISOString();
      try {
        const rows = (await readWarn(src)).filter((n) => n.date >= since);
        status[src.state] = { ...status[src.state], lastTried: now, rows: rows.length, ...(rows.length ? { lastGood: now, error: undefined } : { error: "no rows: the format may have changed" }) };
        return rows;
      } catch (e) { status[src.state] = { ...status[src.state], lastTried: now, error: (e as Error).message.slice(0, 160) }; return []; }
    });
    for (const rows of read) all.push(...rows);
    await db.insert(schema.edgeJobState).values({ name: "pulse.warn", state: status }).onConflictDoUpdate({ target: schema.edgeJobState.name, set: { state: status, updatedAt: new Date() } });
    return all;
  });
}

/** Each WARN parser's status, with the stale ones (no good read for three weeks) flagged. */
export async function warnStatus(): Promise<{ state: string; name: string; lastGood: string | null; stale: boolean; error: string | null; rows: number }[]> {
  const [row] = await requireDb().select().from(schema.edgeJobState).where(eq(schema.edgeJobState.name, "pulse.warn"));
  const st = (row?.state ?? {}) as WarnStatus;
  return WARN_SOURCES.map((s) => ({ state: s.state, name: s.name, lastGood: st[s.state]?.lastGood ?? null, stale: !st[s.state]?.lastGood || Date.now() - Date.parse(st[s.state]!.lastGood!) > 21 * DAY, error: st[s.state]?.error ?? null, rows: st[s.state]?.rows ?? 0 }));
}

/* ---------------- The placebo false-alarm rates per family ---------------- */

/** False alarms per company-year by metric family, measured weekly on stored histories (pulse/jobs.ts). */
export async function falseAlarms(): Promise<Record<string, number>> {
  const [row] = await requireDb().select().from(schema.edgeJobState).where(eq(schema.edgeJobState.name, "pulse.placebo"));
  const st = (row?.state ?? {}) as Record<string, { perYear: number }>;
  return Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v.perYear]));
}

/* ---------------- One company ---------------- */

export type RefreshResult = { nodeId: number; coverage: Coverage; points: number; created: number[]; sources: string[]; errors: string[]; read?: WeekRead };

/** The company's node, with what the Pulse needs to know about it. */
async function nodeOf(nodeId: number) {
  const [n] = await requireDb().select().from(schema.edgeNodes).where(eq(schema.edgeNodes.id, nodeId));
  return n ?? null;
}

/** A matching Newsroom story in the last 14 days (for an attention spike's cause). */
async function newsFor(name: string): Promise<{ headline: string; url: string } | null> {
  const word = name.split(/\s+/)[0];
  if (!word || word.length < 3) return null;
  const rows = (await requireDb().execute(sql`select headline, id from news_clusters where first_seen_at > now() - interval '14 days' and headline ilike ${`%${name.replace(/\s+(inc|corp|corporation|co|ltd|plc|llc|holdings|group)\.?$/i, "")}%`} order by first_seen_at desc limit 1`).catch(() => ({ rows: [] }))).rows as { headline: string; id: number }[];
  return rows[0] ? { headline: rows[0].headline, url: `/app/news?story=${rows[0].id}` } : null;
}

/**
 * Read every source the crosswalk links the company to, store the points, and write the findings they
 * support. Looks up the company's ids first when the crosswalk has not seen it for 90 days. `notices` is
 * the day's WARN read (shared across a batch).
 */
export async function refreshCompany(nodeId: number, deadline: number, opts: { notices?: WarnNotice[] } = {}): Promise<RefreshResult> {
  const node = await nodeOf(nodeId);
  if (!node) throw Object.assign(new Error("That company is not in Edge's graph."), { status: 404 });
  const attrs = node.attrs as { crosswalkAt?: string; private?: boolean; atsExcluded?: string[] };
  if (!attrs.crosswalkAt || Date.now() - Date.parse(attrs.crosswalkAt) > 90 * DAY) await resolveEntity(nodeId, Math.min(deadline - 30_000, Date.now() + 60_000)).catch((e) => logError(e, { where: "edge-pulse-resolve" }));
  const ids = await idsOf(nodeId);
  const now = new Date(), nowIso = now.toISOString(), week = weekOf(now);
  const points: Point[] = [];
  const sources: string[] = [], errors: string[] = [];
  const coverage: Coverage = { boards: 0, boardsKnown: 0, excluded: attrs.atsExcluded ?? [], wikipedia: false, awards: false, patents: false, warnStates: [] };
  const step = async (label: string, fn: () => Promise<void>) => {
    if (Date.now() > deadline) return;
    try { await fn(); sources.push(label); } catch (e) { errors.push(label); logError(e, { where: `edge-pulse-${label}` }); }
  };

  // Job boards.
  const boards = (["greenhouse", "lever", "ashby"] as Board[]).flatMap((b) => (ids[b] ?? []).map((token) => ({ board: b, token })));
  coverage.boardsKnown = boards.length;
  let read: WeekRead | undefined, moved: { scheme: string; value: string; evidence: string } | null = null;
  if (boards.length) await step("jobs", async () => {
    const all: Posting[] = [];
    for (const b of boards) {
      const r = await readBoard(b.board, b.token).catch((e) => { errors.push(`${b.board}:${b.token}`); logError(e, { where: "edge-pulse-board" }); return undefined; });
      if (r === undefined) continue;
      if (r === null) {
        // Gone: does the careers page now link elsewhere? Then the board moved; the crosswalk looks again.
        const domain = ids.domain?.[0];
        if (domain) { const site = await boardsFromSite(domain, Math.min(deadline, Date.now() + 25_000)).catch(() => ({ hits: [] })); const m = boardMoved({ scheme: b.board, value: b.token }, 1, 0, site.hits); if (m) moved = { scheme: b.board, value: b.token, evidence: m.evidence }; }
        continue;
      }
      coverage.boards++;
      all.push(...r.postings);
      await archiveRaw(`${b.board}`, nodeId, { token: b.token, at: nowIso, postings: r.postings });
      await noteSeriesSource(nodeId, "jobs.open", b.board, boardUrls(b.board, b.token).page, `open postings on the ${b.board} board "${b.token}", counted weekly`);
    }
    if (!coverage.boards) return;
    const prev = await loadState(nodeId);
    const folded = foldRead(prev, all, nowIso, { privateCompany: !!attrs.private || !node.ticker });
    await saveState(nodeId, folded.state);
    read = folded.read;
    for (const p of folded.read.points) points.push({ nodeId, metric: p.metric, period: week, value: p.value, source: "ats" });
  });

  // Wikipedia attention (two years of weekly views at once).
  const title = ids.wikipedia?.[0];
  if (title) await step("wikipedia", async () => {
    const v = await readViews(title);
    for (const p of v.points) points.push({ nodeId, metric: "wiki.views", period: p.period, value: p.value, source: "wikimedia" });
    coverage.wikipedia = v.points.length > 0;
    await noteSeriesSource(nodeId, "wiki.views", "wikimedia", v.url, `daily views of en.wikipedia "${title}" (user agents), summed by week`);
  });

  // Federal awards by UEI.
  let awards: Award[] = [];
  const ueis = ids.uei ?? [];
  if (ueis.length) await step("usaspending", async () => {
    for (const uei of ueis.slice(0, 3)) awards.push(...await readAwards(uei));
    awards = [...new Map(awards.map((a) => [a.id, a])).values()];
    const m = monthlyAwards(awards);
    for (const p of m.obligated) points.push({ nodeId, metric: "usasp.obligated", period: p.period, value: p.value, source: "usaspending" });
    for (const p of m.count) points.push({ nodeId, metric: "usasp.awards", period: p.period, value: p.value, source: "usaspending" });
    coverage.awards = true;
    await archiveRaw("usaspending", nodeId, awards.slice(0, 500));
    await noteSeriesSource(nodeId, "usasp.obligated", "usaspending", `https://www.usaspending.gov/search/?hash=&recipient=${encodeURIComponent(ueis[0])}`, "contract awards (types A to D) to the recipient UEI, by the award's start month");
  });

  // Patents by assignee (a free key).
  const assignee = ids.patentsview?.[0];
  if (assignee && patentsviewReady()) await step("patents", async () => {
    const p = await readPatents(assignee);
    if (!p) return;
    for (const x of p.grants) points.push({ nodeId, metric: "patents.grants", period: x.period, value: x.value, source: "patentsview" });
    for (const x of p.apps) points.push({ nodeId, metric: "patents.apps", period: x.period, value: x.value, source: "patentsview" });
    coverage.patents = true;
    await noteSeriesSource(nodeId, "patents.grants", "patentsview", p.url, "grants and pre-grant publications by the disambiguated assignee, by month");
  });

  // WARN notices matched by name.
  const notices = (opts.notices ? matchNotices(opts.notices, [{ nodeId, name: node.name }]).get(nodeId) : undefined) ?? [];
  coverage.warnStates = WARN_SOURCES.map((s) => s.state);
  if (notices.length) {
    const byMonth = new Map<string, number>();
    for (const n of notices) byMonth.set(monthStart(n.date), (byMonth.get(monthStart(n.date)) ?? 0) + n.employees);
    for (const [period, value] of byMonth) points.push({ nodeId, metric: "warn.employees", period, value, source: "warn" });
    await noteSeriesSource(nodeId, "warn.employees", "warn", "", `WARN notices in ${[...new Set(notices.map((n) => n.state))].join(", ")} matched to the company by name`);
  }

  const stored = await putPoints(points).catch((e) => { errors.push("store"); logError(e, { where: "edge-pulse-store" }); return 0; });
  const series = await readSeries(nodeId, { since: new Date(Date.now() - 3 * 365 * DAY).toISOString().slice(0, 10) });
  const cands = evaluate({ nodeId, name: node.name, ticker: node.ticker }, series, { awards, notices, recentTells: read?.recentTells, coverage, falseAlarms: await falseAlarms().catch(() => ({})), boardMoved: moved, news: series["wiki.views"]?.length ? await newsFor(node.name).catch(() => null) : null }, now);
  const created = await storeFindings(node.ticker, cands);
  await requireDb().update(schema.edgeNodes).set({ attrs: sql`${schema.edgeNodes.attrs} || ${JSON.stringify({ pulseAt: nowIso, pulseCoverage: coverage })}::jsonb` }).where(eq(schema.edgeNodes.id, nodeId)).catch(() => undefined);
  return { nodeId, coverage, points: stored, created, sources, errors, read };
}

const SOURCE_OF: Record<PulseKind, { name: string; license: string }> = {
  hiring_shift: { name: "Public job boards (Greenhouse, Lever, Ashby)", license: "Public job-board APIs; counts and titles only, linked back" },
  hiring_tell: { name: "Public job boards (Greenhouse, Lever, Ashby)", license: "Public job-board APIs; counts and titles only, linked back" },
  attention_spike: { name: "Wikimedia pageviews API", license: "CC0 (Wikimedia analytics data)" },
  contract_award: { name: "USAspending.gov", license: "Public domain (US government data)" },
  layoff_notice: { name: "State WARN notices", license: "Public records (state labour departments)" },
  patent_shift: { name: "USPTO PatentsView", license: "CC BY 4.0 (USPTO PatentsView)" },
};

/** Write findings to the feed (each once, by key), with provenance. Returns the new ids. */
export async function storeFindings(ticker: string, cands: Candidate[]): Promise<number[]> {
  const db = requireDb();
  const out: number[] = [];
  for (const c of cands) {
    const [row] = await db.insert(schema.edgeDetections).values({
      key: c.key.slice(0, 200), kind: c.kind, module: "signals", title: c.title.slice(0, 200), summary: c.summary.slice(0, 1200), why: c.why.slice(0, 1200),
      confidence: Math.max(0, Math.min(1, c.confidence)), magnitude: Math.max(0, Math.min(1, c.magnitude)), tickers: ticker ? [ticker] : [], bbox: null, visual: c.visual, observedAt: new Date(`${c.observedAt.slice(0, 10)}T00:00:00Z`),
    }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
    if (!row) continue;
    const s = SOURCE_OF[c.kind];
    await record(`detection:${row.id}`, [{ sourceName: s.name, sourceUrl: String((c.visual.award as { url?: string } | undefined)?.url ?? ""), license: s.license, method: c.why.slice(0, 300), modelVersion: "pulse change library v1 (robust z, seasonal check, BOCPD, placebo rate)", retrievedAt: new Date() }]);
    out.push(row.id);
  }
  return out;
}

/* ---------------- Reading a company's Pulse ---------------- */

export type PulseView = {
  nodeId: number; name: string; ticker: string; refreshedAt: string | null; coverage: Coverage | null;
  series: Record<string, { period: string; value: number }[]>;
  tells: { tell: string; title: string; location: string; firstSeen: string; url: string }[];
  metros: { metro: string; open: number }[];
  events: { date: string; label: string; kind: string; url?: string }[];
  findings: { id: number; kind: string; title: string; summary: string; observedAt: string | null; confidence: number }[];
  historySince: string | null;
};

/** The stored Pulse of one company: series, tells, where they hire, dated events and recent findings. */
export async function pulseOf(nodeId: number): Promise<PulseView | null> {
  const node = await nodeOf(nodeId);
  if (!node) return null;
  const attrs = node.attrs as { pulseAt?: string; pulseCoverage?: Coverage };
  const since = new Date(Date.now() - 2 * 365 * DAY).toISOString().slice(0, 10);
  const [series, state, findings] = await Promise.all([
    readSeries(nodeId, { since }),
    loadState(nodeId),
    requireDb().select({ id: schema.edgeDetections.id, kind: schema.edgeDetections.kind, title: schema.edgeDetections.title, summary: schema.edgeDetections.summary, observedAt: schema.edgeDetections.observedAt, confidence: schema.edgeDetections.confidence, visual: schema.edgeDetections.visual })
      .from(schema.edgeDetections).where(and(eq(schema.edgeDetections.module, "signals"), sql`${schema.edgeDetections.tickers} ? ${node.ticker || "~"}`, gte(schema.edgeDetections.detectedAt, new Date(Date.now() - 365 * DAY)))).orderBy(desc(schema.edgeDetections.detectedAt)).limit(30),
  ]);
  const tells = state ? Object.values(state.postings).filter((k) => k.s === state.lastRead && k.tells.length).flatMap((k) => k.tells.map((tell) => ({ tell, title: k.t, location: k.m, firstSeen: k.f, url: k.u }))).sort((a, b) => b.firstSeen.localeCompare(a.firstSeen)).slice(0, 30) : [];
  const events = findings.filter((f) => f.kind === "contract_award" || f.kind === "layoff_notice").map((f) => ({ date: f.observedAt?.toISOString().slice(0, 10) ?? "", label: f.title, kind: f.kind, url: String((f.visual as { award?: { url?: string } }).award?.url ?? "") || undefined }));
  return {
    nodeId, name: node.name, ticker: node.ticker, refreshedAt: attrs.pulseAt ?? null, coverage: attrs.pulseCoverage ?? null, series, tells, metros: state ? byMetro(state) : [], events,
    findings: findings.filter((f) => f.kind !== "deal_odds").map((f) => ({ id: f.id, kind: f.kind, title: f.title, summary: f.summary, observedAt: f.observedAt?.toISOString() ?? null, confidence: f.confidence })), historySince: state?.firstRead ?? null,
  };
}
