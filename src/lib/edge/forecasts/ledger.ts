/**
 * The forecast ledger (F3): every probability Edge states about the future, logged when it is made,
 * resolved automatically when its window closes, and scored in the Track record. Rows are never edited:
 * a new estimate of the same question is a new row that supersedes the last (only when it moved half a
 * point or more, so weekly re-scoring does not fill the table), and only the resolution columns are ever
 * written later. Shared forecasts (public data) have no owner; a person's own (a thesis claim) carry theirs.
 *
 * Interface for other features (Deal Radar now; Call Desk guidance and Thesis Agent claims next):
 *   logForecast({ kind, subject, question, probability, low, high, baseRate, opensAt, closesAt, rule, model, modelVersion, ownerId })
 *   resolveDue(deadline)                       the daily pass's resolver, rule type by rule type
 *   resolveManual(userId, id, outcome, note)   a person settles their own manual question
 *   trackRecord(kind)                          the Track record panel's numbers
 */
import { and, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { ForecastRule } from "@/db/schema";
import { getCompanyFacts, rowsFor } from "@/lib/edgar/facts";
import { logError } from "@/lib/errors";
import { record } from "../provenance";
import { resolveDeal, resolveXbrl, standingAtHorizon, worthLogging, type DealEvent, type ForecastRow } from "./rules";
import { trackSummary, type TrackSummary } from "./track";

export type ForecastIn = {
  kind: string; subject: string; question: string; probability: number; low?: number | null; high?: number | null; baseRate?: number | null;
  opensAt: Date; closesAt: Date; rule: ForecastRule; model: string; modelVersion: string; ownerId?: string | null;
};

const clamp01 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.min(1, Math.max(0, v)));

/** Log a forecast; returns its id, or the standing one's when the estimate has not moved. */
export async function logForecast(f: ForecastIn): Promise<{ id: number; logged: boolean }> {
  const db = requireDb();
  const p = clamp01(f.probability);
  if (p === null) throw new Error("A forecast needs a probability between 0 and 1.");
  const [prev] = await db.select().from(schema.edgeForecasts)
    .where(and(eq(schema.edgeForecasts.kind, f.kind), eq(schema.edgeForecasts.subject, f.subject), eq(schema.edgeForecasts.closesAt, f.closesAt), isNull(schema.edgeForecasts.resolvedAt), f.ownerId ? eq(schema.edgeForecasts.ownerId, f.ownerId) : isNull(schema.edgeForecasts.ownerId)))
    .orderBy(desc(schema.edgeForecasts.id)).limit(1);
  if (prev && !worthLogging(prev, { probability: p, low: f.low, high: f.high })) return { id: prev.id, logged: false };
  const [row] = await db.insert(schema.edgeForecasts).values({
    kind: f.kind, subject: f.subject, question: f.question.slice(0, 400), probability: p, low: clamp01(f.low), high: clamp01(f.high), baseRate: clamp01(f.baseRate),
    opensAt: f.opensAt, closesAt: f.closesAt, rule: f.rule, model: f.model, modelVersion: f.modelVersion, ownerId: f.ownerId ?? null, supersedes: prev?.id ?? null,
  }).returning({ id: schema.edgeForecasts.id });
  return { id: row.id, logged: true };
}

/** Deal events touching these companies since a date: the deal database, merger filings in the graph, the Newsroom. */
async function dealEvents(nodes: number[], since: string): Promise<DealEvent[]> {
  if (!nodes.length) return [];
  const db = requireDb();
  const list = sql.join(nodes.map((n) => sql`${n}`), sql`, `);
  const deals = (await db.execute(sql`select target_node, acquirer_node, announced_at::text as announced, id from edge_deals where owner_id is null and announced_at >= ${since}::date and (target_node in (${list}) or acquirer_node in (${list}))`)).rows as { target_node: number | null; acquirer_node: number | null; announced: string; id: number }[];
  const links = (await db.execute(sql`select src, dst, as_of::text as announced, source_url, coalesce(attrs->>'relation', 'third_party') as relation from edge_links where kind = 'acquired' and as_of >= ${since}::date and (dst in (${list}) or src in (${list}))`)).rows as { src: number; dst: number; announced: string; source_url: string; relation: string }[];
  return [
    ...deals.map((d) => ({ target: d.target_node, acquirer: d.acquirer_node, announced: d.announced, source: `Edge deal database, deal ${d.id}` })),
    ...links.map((l) => ({ target: l.dst, acquirer: l.src, announced: l.announced, source: l.source_url || "merger filings (SEC EDGAR)", relation: l.relation })),
  ];
}

/** The reported value for an XBRL rule's concept and period (the period's end date), from SEC company facts. */
async function reportedValue(rule: Extract<ForecastRule, { type: "xbrl" }>): Promise<{ value: number; url: string } | null> {
  const cf = await getCompanyFacts(rule.cik.padStart(10, "0"));
  const rows = rowsFor(cf, rule.concept.includes(":") ? rule.concept.split(":")[0] : "us-gaap", rule.concept.split(":").pop()!, rule.unit ?? "USD");
  const hit = rows.filter((r) => r.end === rule.period).sort((a, b) => a.filed.localeCompare(b.filed))[0];
  return hit ? { value: hit.val, url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${rule.cik}&type=10-&dateb=&owner=include&count=40` } : null;
}

/**
 * Resolve every forecast whose question can be settled now: deal rules as soon as a qualifying deal is
 * announced (or with 0 once the window closes), XBRL rules when the period is reported, manual rules only by
 * their owner. Runs in the daily pass. Returns how many it settled.
 */
export async function resolveDue(deadline: number, now = new Date()): Promise<{ checked: number; resolved: number }> {
  const db = requireDb();
  const open = await db.select().from(schema.edgeForecasts).where(and(isNull(schema.edgeForecasts.resolvedAt), sql`${schema.edgeForecasts.rule}->>'type' in ('deal', 'xbrl')`, sql`(${schema.edgeForecasts.closesAt} <= ${now} or ${schema.edgeForecasts.rule}->>'type' = 'deal')`)).limit(5000);
  let resolved = 0;
  const deals = open.filter((f) => f.rule.type === "deal");
  const nodes = [...new Set(deals.map((f) => (f.rule as Extract<ForecastRule, { type: "deal" }>).node))];
  const since = deals.reduce((m, f) => (f.opensAt.toISOString() < m ? f.opensAt.toISOString() : m), now.toISOString()).slice(0, 10);
  const events = await dealEvents(nodes, since).catch((e) => { logError(e, { where: "edge-forecast-deals" }); return []; });
  for (const f of open) {
    if (Date.now() > deadline) break;
    try {
      let outcome: number | null = null, source = "";
      if (f.rule.type === "deal") { const r = resolveDeal(f.rule, f.opensAt, f.closesAt, events, now); if (r) { outcome = r.outcome; source = r.source; } }
      else if (f.rule.type === "xbrl") {
        const v = await reportedValue(f.rule);
        outcome = resolveXbrl(f.rule, v?.value ?? null);
        source = v ? `SEC XBRL ${f.rule.concept} for the period ending ${f.rule.period}: ${v.value}` : "";
        // Reported periods arrive within about four months; past that, the question is closed as unresolvable.
        if (outcome === null && now.getTime() > f.closesAt.getTime() + 150 * 86_400_000) { await settle(f.id, null, "not resolvable: the period was never reported in XBRL"); continue; }
      }
      if (outcome === null) continue;
      await settle(f.id, outcome, source);
      resolved++;
    } catch (e) { logError(e, { where: "edge-forecast-resolve" }); }
  }
  return { checked: open.length, resolved };
}

/** Settle one question: this row and every earlier estimate of it (they share the answer). */
async function settle(id: number, outcome: number | null, source: string) {
  const db = requireDb();
  const [f] = await db.select().from(schema.edgeForecasts).where(eq(schema.edgeForecasts.id, id));
  if (!f) return;
  await db.update(schema.edgeForecasts).set({ resolvedAt: new Date(), outcome, resolutionSource: source.slice(0, 400) })
    .where(and(eq(schema.edgeForecasts.kind, f.kind), eq(schema.edgeForecasts.subject, f.subject), eq(schema.edgeForecasts.closesAt, f.closesAt), isNull(schema.edgeForecasts.resolvedAt), f.ownerId ? eq(schema.edgeForecasts.ownerId, f.ownerId) : isNull(schema.edgeForecasts.ownerId)));
  await record(`forecast:${id}`, [{ sourceName: outcome === null ? "Closed without an answer" : `Resolved ${outcome === 1 ? "yes" : outcome === 0 ? "no" : outcome}`, sourceUrl: /^https?:/.test(source) ? source : "", license: "", method: source.slice(0, 300), modelVersion: f.modelVersion, retrievedAt: new Date() }]);
}

/** A person settles their own manual question (scored apart from automatic ones). */
export async function resolveManual(userId: string, id: number, outcome: number, note: string): Promise<boolean> {
  const [f] = await requireDb().select().from(schema.edgeForecasts).where(eq(schema.edgeForecasts.id, id));
  if (!f || f.ownerId !== userId || f.rule.type !== "manual" || f.resolvedAt) return false;
  if (!(outcome >= 0 && outcome <= 1)) throw Object.assign(new Error("An outcome is between 0 (did not happen) and 1 (happened)."), { status: 400 });
  await settle(id, outcome, `settled by its owner: ${note}`.slice(0, 400));
  return true;
}

export type TrackPanel = TrackSummary & { kind: string; model: string; versions: string[]; manual: boolean; pending: number; horizonDays: number; recent: { question: string; probability: number; outcome: number; resolvedAt: string; label: string }[] };

/** How far ahead each kind's record is scored: the estimate standing this many days before the close. */
export const HORIZON_DAYS: Record<string, number> = { deal_target: 330, deal_acquirer: 330, guidance: 30, thesis_claim: 7, evasion_followup: 60, buyer_win: 30, rule_final: 30 };

/**
 * The Track record for one kind of forecast (or every kind): one panel per model, shared forecasts only
 * (a person's own are never shown to others), the recent list anonymised to a sector or kind.
 */
export async function trackRecord(kind?: string, opts: { ownerId?: string } = {}): Promise<TrackPanel[]> {
  const db = requireDb();
  const who = opts.ownerId ? eq(schema.edgeForecasts.ownerId, opts.ownerId) : isNull(schema.edgeForecasts.ownerId);
  const where = and(who, kind ? eq(schema.edgeForecasts.kind, kind) : undefined);
  const [done, pending] = await Promise.all([
    db.select().from(schema.edgeForecasts).where(and(where, isNotNull(schema.edgeForecasts.resolvedAt), isNotNull(schema.edgeForecasts.outcome))).orderBy(desc(schema.edgeForecasts.resolvedAt)).limit(50_000),
    db.select({ kind: schema.edgeForecasts.kind, model: schema.edgeForecasts.model, n: sql<number>`count(distinct (${schema.edgeForecasts.subject}, ${schema.edgeForecasts.closesAt}))::int` })
      .from(schema.edgeForecasts).where(and(where, isNull(schema.edgeForecasts.resolvedAt))).groupBy(schema.edgeForecasts.kind, schema.edgeForecasts.model),
  ]);
  const groups = new Map<string, typeof done>();
  for (const r of done) { const k = `${r.kind}|${r.model}|${r.rule.type === "manual" ? "manual" : "auto"}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  for (const p of pending) if (![...groups.keys()].some((k) => k.startsWith(`${p.kind}|${p.model}|`))) groups.set(`${p.kind}|${p.model}|auto`, []);
  const labels = await sectorLabels(done.slice(0, 200).map((r) => r.subject));
  const out: TrackPanel[] = [];
  for (const [key, rows] of groups) {
    const [k, model, mode] = key.split("|");
    const horizonDays = HORIZON_DAYS[k] ?? 30;
    const standing = standingAtHorizon(rows as unknown as ForecastRow[], horizonDays) as unknown as typeof rows;
    const s = trackSummary(standing.map((r) => ({ probability: r.probability, baseRate: r.baseRate, outcome: r.outcome! })));
    out.push({
      ...s, kind: k, model, manual: mode === "manual", horizonDays, versions: [...new Set(rows.map((r) => r.modelVersion))].slice(0, 6),
      pending: pending.find((p) => p.kind === k && p.model === model)?.n ?? 0,
      recent: standing.slice(0, 20).map((r) => ({ question: anonymise(r.question), probability: r.probability, outcome: r.outcome!, resolvedAt: r.resolvedAt!.toISOString(), label: labels.get(r.subject) ?? k.replace(/_/g, " ") })),
    });
  }
  return out.sort((a, b) => b.n - a.n);
}

/** Questions name the company; the public record shows "a company" instead. Pure. */
export function anonymise(question: string): string {
  return question.replace(/^[^:]{1,120}?(?= (announces|is announced|reports|hits|says)\b)/, "A company").replace(/\(([A-Z][A-Z0-9.\-]{0,9})\)/g, "").replace(/\s{2,}/g, " ").trim();
}

/** "A midstream company": the industry of each node subject, for the anonymised list. */
async function sectorLabels(subjects: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(subjects.map((s) => /^node:(\d+)$/.exec(s)?.[1]).filter((x): x is string => !!x).map(Number))];
  if (!ids.length) return new Map();
  const rows = await requireDb().select({ id: schema.edgeNodes.id, attrs: schema.edgeNodes.attrs }).from(schema.edgeNodes).where(inArray(schema.edgeNodes.id, ids.slice(0, 500)));
  return new Map(rows.map((r) => [`node:${r.id}`, typeof (r.attrs as { industry?: string }).industry === "string" ? `a company in ${(r.attrs as { industry: string }).industry.toLowerCase()}` : "a listed company"]));
}

/** A company's forecasts of a kind over time (its odds history), oldest first. */
export async function forecastHistory(subject: string, kind: string, limit = 200): Promise<{ probability: number; low: number | null; high: number | null; at: string; closesAt: string }[]> {
  const rows = await requireDb().select({ p: schema.edgeForecasts.probability, low: schema.edgeForecasts.low, high: schema.edgeForecasts.high, at: schema.edgeForecasts.createdAt, closes: schema.edgeForecasts.closesAt })
    .from(schema.edgeForecasts).where(and(eq(schema.edgeForecasts.subject, subject), eq(schema.edgeForecasts.kind, kind), isNull(schema.edgeForecasts.ownerId), lte(schema.edgeForecasts.createdAt, new Date())))
    .orderBy(desc(schema.edgeForecasts.createdAt)).limit(limit);
  return rows.reverse().map((r) => ({ probability: r.p, low: r.low, high: r.high, at: r.at.toISOString(), closesAt: r.closes.toISOString() }));
}
