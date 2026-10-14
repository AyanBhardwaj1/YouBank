/**
 * The deal database in Postgres (F4): deals, their extracted fields, search, "deals like this one", and the
 * one acquired link per deal kept in the relationship graph. Public deals have no owner; every reader may
 * see them. A field's own row is its audit trail (document URL, section, method, model version, checks,
 * time); each document read is also recorded in edge_provenance under `deal:<id>`.
 *
 * Interface for other features (the Deal Radar's labels, the LBO Stress Lab's exit multiples, Management
 * Track Record, the Buyer Simulator, Deal Aftermath):
 *   searchDeals(filters)                     deals with their headline terms, newest first
 *   dealById(id)                             one deal with its active fields and sources
 *   similarDeals(query, filters, k)          ranked precedents with why each matched, and the multiple range
 *   targetEvents(since)                      announced target events (target node, date), for labels
 *   exitMultiples({ sic, buyerType, years }) EV/EBITDA of completed deals, for exit assumptions
 */
import { and, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { DealSource } from "@/db/schema";
import { vectorLiteral } from "../docs/embed";
import { upsertLinks } from "../graph/store";
import { kernel, similarity, whyChips, type DealLite } from "./similar";
import { conformalBand, trimmedStats, type ConformalBand } from "./range";
import type { FoundDoc } from "./discover";

export type DealRow = typeof schema.edgeDeals.$inferSelect;
export type FieldRow = typeof schema.edgeDealFields.$inferSelect;
export type DealFilters = { q?: string; sic?: string; from?: string; to?: string; buyer?: string; consideration?: string; min?: number; max?: number; read?: boolean };

const DAY = 86_400_000;

/** A deal's columns without its vector (which is large and never sent to a browser). */
const COLS = {
  id: schema.edgeDeals.id, key: schema.edgeDeals.key, kind: schema.edgeDeals.kind, status: schema.edgeDeals.status, announcedAt: schema.edgeDeals.announcedAt, signedAt: schema.edgeDeals.signedAt, closedAt: schema.edgeDeals.closedAt,
  acquirerNode: schema.edgeDeals.acquirerNode, targetNode: schema.edgeDeals.targetNode, acquirerName: schema.edgeDeals.acquirerName, targetName: schema.edgeDeals.targetName,
  acquirerCik: schema.edgeDeals.acquirerCik, targetCik: schema.edgeDeals.targetCik, targetTicker: schema.edgeDeals.targetTicker, buyerType: schema.edgeDeals.buyerType, sic: schema.edgeDeals.sic,
  naics: schema.edgeDeals.naics, country: schema.edgeDeals.country, equityUsdMm: schema.edgeDeals.equityUsdMm, evUsdMm: schema.edgeDeals.evUsdMm, evRevenue: schema.edgeDeals.evRevenue, evEbitda: schema.edgeDeals.evEbitda,
  premium1d: schema.edgeDeals.premium1d, premiumUnaffected: schema.edgeDeals.premiumUnaffected, consideration: schema.edgeDeals.consideration, outcome: schema.edgeDeals.outcome,
  newsClusterId: schema.edgeDeals.newsClusterId, sources: schema.edgeDeals.sources, extractedAt: schema.edgeDeals.extractedAt, updatedAt: schema.edgeDeals.updatedAt,
};
export type DealView = Omit<DealRow, "embedding" | "ownerId" | "teamId" | "createdAt">;

/** The deal a document belongs to: the same target within nine months, else none. */
export async function dealForTarget(targetCik: string, date: string): Promise<DealView | null> {
  if (!targetCik) return null;
  const lo = new Date(Date.parse(date) - 270 * DAY).toISOString().slice(0, 10), hi = new Date(Date.parse(date) + 270 * DAY).toISOString().slice(0, 10);
  const [row] = await requireDb().select(COLS).from(schema.edgeDeals)
    .where(and(eq(schema.edgeDeals.targetCik, targetCik), isNull(schema.edgeDeals.ownerId), gte(schema.edgeDeals.announcedAt, lo), lte(schema.edgeDeals.announcedAt, hi))).orderBy(schema.edgeDeals.announcedAt).limit(1);
  return row ?? null;
}

const sourceOf = (d: FoundDoc): DealSource => ({ form: d.form, url: d.url, filed: d.filed, role: d.kind, ...(d.press ? { press: d.press } : {}) });

/**
 * Store a found document: it joins its deal (same target within nine months) or starts a stub. A document
 * already recorded changes nothing. Returns the deal's id and whether it is new.
 */
export async function upsertFromDoc(d: FoundDoc): Promise<{ id: number; created: boolean; added: boolean }> {
  const db = requireDb();
  const target = d.filerIsTarget && d.parties.length === 1 ? d.parties[0] : null;
  const existing = target ? await dealForTarget(target.cik, d.filed) : (await db.select(COLS).from(schema.edgeDeals).where(eq(schema.edgeDeals.key, `doc:${d.accession}`)).limit(1))[0] ?? null;
  if (existing) {
    if (existing.sources.some((s) => s.url === d.url)) return { id: existing.id, created: false, added: false };
    await db.update(schema.edgeDeals).set({ sources: [...existing.sources, sourceOf(d)], updatedAt: new Date() }).where(eq(schema.edgeDeals.id, existing.id));
    return { id: existing.id, created: false, added: true };
  }
  const key = target ? `t:${target.cik}:${d.filed.slice(0, 7)}` : `doc:${d.accession}`;
  const other = d.parties.find((p) => p.cik !== target?.cik);
  const [row] = await db.insert(schema.edgeDeals).values({
    key, kind: d.kind === "tender" ? "tender" : "merger", status: "announced", announcedAt: d.filed,
    targetCik: target?.cik ?? "", targetName: target?.name ?? "", acquirerCik: target && other ? other.cik : "", acquirerName: target && other ? other.name : "",
    sic: target ? d.sic : "", sources: [sourceOf(d)], outcome: "pending",
  }).onConflictDoNothing().returning({ id: schema.edgeDeals.id });
  if (row) return { id: row.id, created: true, added: true };
  const [again] = await db.select({ id: schema.edgeDeals.id }).from(schema.edgeDeals).where(eq(schema.edgeDeals.key, key)).limit(1);
  return { id: again?.id ?? 0, created: false, added: false };
}

/** Move another deal's documents and fields into this one (the same deal found twice), then remove it. */
export async function mergeDeals(into: number, from: number): Promise<void> {
  if (into === from) return;
  const db = requireDb();
  const [a] = await db.select(COLS).from(schema.edgeDeals).where(eq(schema.edgeDeals.id, into));
  const [b] = await db.select(COLS).from(schema.edgeDeals).where(eq(schema.edgeDeals.id, from));
  if (!a || !b) return;
  const urls = new Set(a.sources.map((s) => s.url));
  await db.update(schema.edgeDeals).set({ sources: [...a.sources, ...b.sources.filter((s) => !urls.has(s.url))], updatedAt: new Date() }).where(eq(schema.edgeDeals.id, into));
  await db.update(schema.edgeDealFields).set({ dealId: into }).where(eq(schema.edgeDealFields.dealId, from));
  await db.delete(schema.edgeDeals).where(eq(schema.edgeDeals.id, from));
}

/** A deal's active fields, by field. */
export async function activeFields(dealId: number): Promise<FieldRow[]> {
  return requireDb().select().from(schema.edgeDealFields).where(and(eq(schema.edgeDealFields.dealId, dealId), eq(schema.edgeDealFields.active, true))).orderBy(schema.edgeDealFields.field);
}

export type FieldIn = { field: string; value: unknown; quote: string; docUrl: string; section: string; confidence: number; checks: Record<string, unknown>; method: string; modelVersion: string };

/**
 * Store fields read from a document. A new reading of a field retires the active one only when it is at
 * least as confident (a re-read with the stronger model always does: `replace`); the retired row stays for
 * the audit trail.
 */
export async function saveFields(dealId: number, fields: FieldIn[], opts: { replace?: boolean } = {}): Promise<number> {
  if (!fields.length) return 0;
  const db = requireDb();
  const current = new Map((await activeFields(dealId)).map((f) => [f.field, f]));
  const keep = fields.filter((f) => opts.replace || !current.has(f.field) || current.get(f.field)!.confidence <= f.confidence);
  const retire = keep.map((f) => current.get(f.field)?.id).filter((x): x is number => !!x);
  if (retire.length) await db.update(schema.edgeDealFields).set({ active: false }).where(inArray(schema.edgeDealFields.id, retire));
  if (keep.length) await db.insert(schema.edgeDealFields).values(keep.map((f) => ({ dealId, field: f.field, value: f.value as never, quote: f.quote.slice(0, 1200), docUrl: f.docUrl.slice(0, 500), section: f.section.slice(0, 120), confidence: f.confidence, checks: f.checks, method: f.method.slice(0, 200), modelVersion: f.modelVersion.slice(0, 80) })));
  return keep.length;
}

export async function updateDeal(id: number, set: Partial<typeof schema.edgeDeals.$inferInsert>): Promise<void> {
  await requireDb().update(schema.edgeDeals).set({ ...set, updatedAt: new Date() }).where(eq(schema.edgeDeals.id, id));
}

export async function setEmbedding(id: number, v: number[]): Promise<void> {
  await requireDb().execute(sql`update edge_deals set embedding = ${vectorLiteral(v)}::halfvec where id = ${id}`);
}

/** The deal's one acquired link in the graph, from buyer to target, dated at announcement. */
export async function syncLink(d: Pick<DealRow, "id" | "acquirerNode" | "targetNode" | "announcedAt" | "status" | "sources">): Promise<void> {
  if (!d.acquirerNode || !d.targetNode || d.acquirerNode === d.targetNode) return;
  const src = d.sources.find((s) => s.role === "proxy" || s.role === "tender") ?? d.sources[0];
  await upsertLinks([{ src: d.acquirerNode, dst: d.targetNode, kind: "acquired", asOf: d.announcedAt ?? null, sourceName: `${src?.form ?? "Merger filing"} (SEC EDGAR)`, sourceUrl: src?.url ?? "", attrs: { via: "deal database", dealId: d.id, status: d.status, relation: "third_party" } }]);
}

function where(f: DealFilters): SQL {
  const c: SQL[] = [sql`${schema.edgeDeals.ownerId} is null`];
  if (f.q?.trim()) { const q = `%${f.q.trim().slice(0, 80)}%`; c.push(sql`(${schema.edgeDeals.targetName} ilike ${q} or ${schema.edgeDeals.acquirerName} ilike ${q} or ${schema.edgeDeals.targetTicker} ilike ${q})`); }
  if (f.sic && /^\d{1,4}$/.test(f.sic)) c.push(sql`${schema.edgeDeals.sic} like ${`${f.sic}%`}`);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) c.push(gte(schema.edgeDeals.announcedAt, f.from));
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) c.push(lte(schema.edgeDeals.announcedAt, f.to));
  if (f.buyer && /^(strategic|sponsor|sponsor_backed)$/.test(f.buyer)) c.push(eq(schema.edgeDeals.buyerType, f.buyer));
  if (f.consideration && /^(cash|stock|mixed)$/.test(f.consideration)) c.push(eq(schema.edgeDeals.consideration, f.consideration));
  if (f.min !== undefined && Number.isFinite(f.min)) c.push(sql`coalesce(${schema.edgeDeals.evUsdMm}, ${schema.edgeDeals.equityUsdMm}) >= ${f.min}`);
  if (f.max !== undefined && Number.isFinite(f.max)) c.push(sql`coalesce(${schema.edgeDeals.evUsdMm}, ${schema.edgeDeals.equityUsdMm}) <= ${f.max}`);
  if (f.read) c.push(sql`${schema.edgeDeals.extractedAt} is not null`);
  return and(...c)!;
}

/** Headline terms per deal (termination fee as a share of equity, go-shop days, bidders) for the results table. */
export async function headlineTerms(ids: number[]): Promise<Map<number, Record<string, unknown>>> {
  const out = new Map<number, Record<string, unknown>>();
  if (!ids.length) return out;
  const rows = await requireDb().select({ dealId: schema.edgeDealFields.dealId, field: schema.edgeDealFields.field, value: schema.edgeDealFields.value, confidence: schema.edgeDealFields.confidence })
    .from(schema.edgeDealFields).where(and(inArray(schema.edgeDealFields.dealId, ids), eq(schema.edgeDealFields.active, true), inArray(schema.edgeDealFields.field, ["termination_fee", "go_shop_days", "parties_contacted", "final_bids", "per_share", "advisers_target"])));
  for (const r of rows) { const m = out.get(r.dealId) ?? {}; m[r.field] = r.value; out.set(r.dealId, m); }
  return out;
}

/** Deals matching the filters, newest first, with a count. */
export async function searchDeals(f: DealFilters, limit = 50, offset = 0): Promise<{ rows: DealView[]; total: number }> {
  const db = requireDb();
  const w = where(f);
  const [rows, [n]] = await Promise.all([
    db.select(COLS).from(schema.edgeDeals).where(w).orderBy(desc(schema.edgeDeals.announcedAt), desc(schema.edgeDeals.id)).limit(Math.max(1, Math.min(500, limit))).offset(Math.max(0, offset)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.edgeDeals).where(w),
  ]);
  return { rows, total: Number(n?.n ?? 0) };
}

export async function dealById(id: number): Promise<{ deal: DealView; fields: FieldRow[]; hasVector: boolean } | null> {
  const db = requireDb();
  const [deal] = await db.select({ ...COLS, hasVector: sql<boolean>`${schema.edgeDeals.embedding} is not null` }).from(schema.edgeDeals).where(and(eq(schema.edgeDeals.id, id), isNull(schema.edgeDeals.ownerId)));
  if (!deal) return null;
  const { hasVector, ...rest } = deal;
  return { deal: rest, fields: await activeFields(id), hasVector };
}

/** How much the database holds: deals, read deals, with a multiple, by year. */
export async function coverage(): Promise<{ deals: number; read: number; withMultiple: number; from: string | null; to: string | null }> {
  const [r] = (await requireDb().execute(sql`select count(*)::int as deals, count(extracted_at)::int as read, count(ev_ebitda)::int as with_multiple, min(announced_at)::text as "from", max(announced_at)::text as "to" from edge_deals where owner_id is null`)).rows as { deals: number; read: number; with_multiple: number; from: string | null; to: string | null }[];
  return { deals: Number(r?.deals ?? 0), read: Number(r?.read ?? 0), withMultiple: Number(r?.with_multiple ?? 0), from: r?.from ?? null, to: r?.to ?? null };
}

type Candidate = DealLite & { view: DealView };

const liteOf = (d: DealView, embedding?: number[] | null): DealLite => ({
  id: d.id, sic: d.sic, evUsdMm: d.evUsdMm, equityUsdMm: d.equityUsdMm, buyerType: d.buyerType, year: d.announcedAt ? Number(String(d.announcedAt).slice(0, 4)) : null,
  country: d.country, consideration: d.consideration, embedding: embedding ?? null,
});

const parseVec = (s: unknown): number[] | null => (typeof s === "string" && s.startsWith("[") ? s.slice(1, -1).split(",").map(Number) : null);

export type SimilarQuery = { deal?: DealLite & { name: string }; vector?: number[] | null; exclude?: number[] };
export type SimilarResult = {
  query: { name: string; sic: string; sizeUsdMm: number | null; buyerType: string; method: string };
  results: (DealView & { score: number; cosine: number; kernel: number; why: string[] })[];
  range: { evEbitda: ReturnType<typeof trimmedStats>; evRevenue: ReturnType<typeof trimmedStats>; band: ConformalBand | null };
};

/**
 * "Deals like this one": the nearest deals by meaning (pgvector over the deal vectors) widened with the same
 * SIC group, re-ranked by 0.6 cosine + 0.4 kernel, each with why it matched; then the multiple range over the
 * top k (trimmed median and IQR) and the split-conformal band calibrated on deals held out by year.
 */
export async function similarDeals(q: SimilarQuery, f: DealFilters = {}, k = 20): Promise<SimilarResult> {
  const db = requireDb();
  const w = where(f);
  const byVec = q.vector?.length
    ? ((await db.execute(sql`select id, embedding::text as v from edge_deals where ${w} and embedding is not null order by embedding <=> ${vectorLiteral(q.vector)}::halfvec limit 200`)).rows as { id: number; v: string }[])
    : [];
  const sicPrefix = q.deal?.sic?.slice(0, 2);
  const bySic = sicPrefix ? ((await db.execute(sql`select id, embedding::text as v from edge_deals where ${w} and sic like ${`${sicPrefix}%`} order by announced_at desc nulls last limit 300`)).rows as { id: number; v: string | null }[]) : [];
  const ids = [...new Set([...byVec, ...bySic].map((r) => Number(r.id)))].filter((id) => !(q.exclude ?? []).includes(id));
  const vecs = new Map([...byVec, ...bySic].map((r) => [Number(r.id), parseVec(r.v)]));
  const views = ids.length ? await db.select(COLS).from(schema.edgeDeals).where(inArray(schema.edgeDeals.id, ids.slice(0, 500))) : [];
  const query: DealLite = q.deal ? { ...q.deal, embedding: q.vector ?? null } : { id: -1, sic: "", evUsdMm: null, equityUsdMm: null, buyerType: "", year: null, country: "US", consideration: "", embedding: q.vector ?? null };
  const cands: Candidate[] = views.map((v) => ({ ...liteOf(v, vecs.get(v.id) ?? null), view: v }));
  const scored = cands.map((c) => {
    const cos = query.embedding?.length && c.embedding?.length ? Math.max(0, cosineSafe(query.embedding, c.embedding)) : 0;
    return { c, score: similarity(query, c), cos, ker: kernel(query, c).score };
  }).sort((a, b) => b.score - a.score);
  const top = scored.slice(0, k);
  const results = top.map((s) => ({ ...s.c.view, score: Math.round(s.score * 1000) / 1000, cosine: Math.round(s.cos * 1000) / 1000, kernel: Math.round(s.ker * 1000) / 1000, why: whyChips(query, s.c) }));
  // The conformal band: every candidate with a multiple is the pool; the score between two deals is the same blend.
  const pool = scored.map((s) => s.c).filter((c) => c.view.evEbitda && c.view.evEbitda > 0 && c.year);
  const byId = new Map(pool.map((c) => [c.id, c]));
  const band = conformalBand(
    top.filter((s) => s.c.view.evEbitda && s.c.view.evEbitda > 0).map((s) => ({ score: s.score, multiple: s.c.view.evEbitda! })),
    pool.map((c) => ({ id: c.id, year: c.year!, multiple: c.view.evEbitda! })),
    (a, b) => { const x = byId.get(a), y = byId.get(b); return x && y ? similarity(x, y) : 0; },
  );
  return {
    query: { name: q.deal?.name ?? "your description", sic: query.sic, sizeUsdMm: query.evUsdMm ?? query.equityUsdMm, buyerType: query.buyerType, method: query.embedding?.length ? "0.6 x meaning (512-dimension embeddings) + 0.4 x structure (size, SIC, buyer, year, geography, consideration)" : "structure only (size, SIC, buyer, year, geography, consideration): no text to compare by meaning" },
    results,
    range: { evEbitda: trimmedStats(results.map((r) => r.evEbitda ?? NaN)), evRevenue: trimmedStats(results.map((r) => r.evRevenue ?? NaN)), band },
  };
}

function cosineSafe(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na > 0 && nb > 0 ? d / Math.sqrt(na * nb) : 0;
}

/** A deal as the query of a similarity search (its own vector included). */
export async function dealQuery(id: number): Promise<SimilarQuery | null> {
  const [r] = (await requireDb().execute(sql`select id, embedding::text as v from edge_deals where id = ${id}`)).rows as { id: number; v: string | null }[];
  const d = await dealById(id);
  if (!r || !d) return null;
  return { deal: { ...liteOf(d.deal), name: `${d.deal.targetName || "the target"}${d.deal.acquirerName ? ` / ${d.deal.acquirerName}` : ""}` }, vector: parseVec(r.v), exclude: [id] };
}

/** Announced target events since a date: the Deal Radar's labels and the forecast resolver's evidence. */
export async function targetEvents(since: string): Promise<{ targetNode: number | null; targetCik: string; announced: string; dealId: number; acquirerName: string }[]> {
  const rows = await requireDb().select({ targetNode: schema.edgeDeals.targetNode, targetCik: schema.edgeDeals.targetCik, announced: schema.edgeDeals.announcedAt, dealId: schema.edgeDeals.id, acquirerName: schema.edgeDeals.acquirerName })
    .from(schema.edgeDeals).where(and(isNull(schema.edgeDeals.ownerId), gte(schema.edgeDeals.announcedAt, since), sql`${schema.edgeDeals.targetCik} <> ''`));
  return rows.map((r) => ({ ...r, announced: String(r.announced ?? "") }));
}

/** EV/EBITDA of completed or announced deals for exit assumptions (the LBO Stress Lab): by SIC prefix, buyer type and years. */
export async function exitMultiples(opts: { sic?: string; buyerType?: string; years?: number } = {}): Promise<{ n: number; multiples: number[]; stats: ReturnType<typeof trimmedStats> }> {
  const since = new Date(Date.now() - (opts.years ?? 10) * 365 * DAY).toISOString().slice(0, 10);
  const rows = await requireDb().select({ m: schema.edgeDeals.evEbitda }).from(schema.edgeDeals)
    .where(and(isNull(schema.edgeDeals.ownerId), gte(schema.edgeDeals.announcedAt, since), sql`${schema.edgeDeals.evEbitda} is not null`, opts.sic ? sql`${schema.edgeDeals.sic} like ${`${opts.sic}%`}` : undefined, opts.buyerType ? eq(schema.edgeDeals.buyerType, opts.buyerType) : undefined)).limit(5000);
  const multiples = rows.map((r) => r.m!).filter((m) => m > 0 && m < 100);
  return { n: multiples.length, multiples, stats: trimmedStats(multiples) };
}
