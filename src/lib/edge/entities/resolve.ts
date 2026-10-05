/**
 * The entity crosswalk (F1): which ids, in every scheme Edge reads, belong to one company (an `edge_nodes`
 * row). Links are made from the most to the least certain source, and each keeps its method and evidence:
 *   1. the SEC registry: CIK and ticker (confidence 1);
 *   2. Wikidata by CIK: official website (domain), LEI, English Wikipedia article, item id (0.97);
 *   3. the company's own careers page: Greenhouse, Lever, Ashby or SmartRecruiters boards it links (0.95);
 *   4. name matches: a Greenhouse board whose own name matches, a USAspending recipient (UEI), a
 *      PatentsView assignee, scored by crosswalk.nameScore. Below 0.9 a match waits in the review queue
 *      (status 'review') and nothing uses it.
 * A person can confirm, reject or correct a link; a person's decision (verified_by) is never overwritten by
 * an automatic one, and each decision is kept in the audit trail (subject `entity:<node>`).
 *
 * Interface for other features:
 *   companyNode(ticker)                       the company's node, created from the SEC list when missing
 *   idsOf(nodeId)                             { scheme: [values] }, active links only, people's first
 *   resolveEntity(nodeId, deadline)           find and store links (idempotent; safe to re-run)
 *   nodeFor(scheme, value)                    the company a source's id belongs to
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { getSubmissions } from "@/lib/edgar/submissions";
import { resolveTicker } from "@/lib/edgar/tickers";
import { logError } from "@/lib/errors";
import { titleCase } from "../graph/parse";
import { nodeKey, setNodeAttrs, upsertNodes } from "../graph/store";
import { record } from "../provenance";
import { domainOf, isScheme, nameScore, statusFor, tokenGuess, type Scheme } from "./crosswalk";
import { fetchJson } from "./http";
import { boardsFromSite } from "./sources/careers";
import { assigneesNamed, recipientsNamed, type Candidate } from "./sources/registries";
import { wikidataByCik } from "./sources/wikidata";

export type EntityLink = typeof schema.edgeEntityIds.$inferSelect;
export type LinkIn = { nodeId: number; scheme: Scheme; value: string; confidence: number; method: string; evidenceUrl?: string };

/** Values are compared case-blind (tokens, domains, ids), except Wikipedia titles. Pure. */
export const cleanValue = (scheme: string, v: string) => (scheme === "wikipedia" ? v.trim().replace(/ /g, "_") : v.trim().toLowerCase()).slice(0, 200);

/**
 * Store a link. An automatic link never replaces a person's decision or a link a person rejected, and only
 * moves a value to another company when it is more certain than the link it replaces.
 */
export async function upsertLink(l: LinkIn): Promise<"active" | "review" | "kept"> {
  const value = cleanValue(l.scheme, l.value);
  if (!value || !(l.nodeId > 0)) return "kept";
  const status = statusFor(l.confidence);
  const res = await requireDb().execute(sql`
    insert into edge_entity_ids (node_id, scheme, value, confidence, method, evidence_url, status)
    values (${l.nodeId}, ${l.scheme}, ${value}, ${l.confidence}, ${l.method.slice(0, 200)}, ${(l.evidenceUrl ?? "").slice(0, 500)}, ${status})
    on conflict (scheme, value) do update set node_id = excluded.node_id, confidence = excluded.confidence, method = excluded.method,
      evidence_url = excluded.evidence_url, status = excluded.status, updated_at = now()
    where edge_entity_ids.verified_by = '' and edge_entity_ids.status <> 'rejected'
      and (edge_entity_ids.node_id = excluded.node_id or excluded.confidence > edge_entity_ids.confidence)
    returning status`);
  return ((res.rows[0] as { status?: string } | undefined)?.status as "active" | "review" | undefined) ?? "kept";
}

/** Every link of a company (review ones too, when asked), people's decisions and the most certain first. */
export async function entityIds(nodeId: number, opts: { includeReview?: boolean } = {}): Promise<EntityLink[]> {
  const statuses = opts.includeReview ? ["active", "review"] : ["active"];
  return requireDb().select().from(schema.edgeEntityIds)
    .where(and(eq(schema.edgeEntityIds.nodeId, nodeId), inArray(schema.edgeEntityIds.status, statuses)))
    .orderBy(sql`(${schema.edgeEntityIds.verifiedBy} <> '') desc`, desc(schema.edgeEntityIds.confidence));
}

/** A company's active ids by scheme. */
export async function idsOf(nodeId: number): Promise<Partial<Record<Scheme, string[]>>> {
  const out: Partial<Record<Scheme, string[]>> = {};
  for (const l of await entityIds(nodeId)) if (isScheme(l.scheme)) (out[l.scheme] ??= []).push(l.value);
  return out;
}

/** The company a source's id belongs to (active links only). */
export async function nodeFor(scheme: Scheme, value: string): Promise<number | null> {
  const [r] = await requireDb().select({ nodeId: schema.edgeEntityIds.nodeId }).from(schema.edgeEntityIds)
    .where(and(eq(schema.edgeEntityIds.scheme, scheme), eq(schema.edgeEntityIds.value, cleanValue(scheme, value)), eq(schema.edgeEntityIds.status, "active"))).limit(1);
  return r?.nodeId ?? null;
}

export type CompanyNode = { id: number; name: string; ticker: string; cik: string };

/** A listed company's node, created from SEC's ticker list when the graph has not met it yet. */
export async function companyNode(ticker: string): Promise<CompanyNode | null> {
  const t = ticker.toUpperCase();
  const [have] = await requireDb().select({ id: schema.edgeNodes.id, name: schema.edgeNodes.name, ticker: schema.edgeNodes.ticker, cik: schema.edgeNodes.cik })
    .from(schema.edgeNodes).where(and(eq(schema.edgeNodes.kind, "company"), eq(schema.edgeNodes.ticker, t))).limit(1);
  if (have) return have;
  const listed = await resolveTicker(t);
  if (!listed) return null;
  const n = { kind: "company" as const, name: titleCase(listed.name), cik: listed.cik.replace(/^0+/, ""), ticker: t };
  const id = (await upsertNodes([n])).get(nodeKey(n));
  return id ? { id, name: n.name, ticker: t, cik: n.cik } : null;
}

/** A private company's node (a startup with no CIK), keyed by its name, with its website's domain linked. */
export async function privateNode(name: string, website: string): Promise<CompanyNode | null> {
  const n = { kind: "company" as const, name: name.trim().slice(0, 200), attrs: { private: true } };
  const id = (await upsertNodes([n])).get(nodeKey(n));
  if (!id) return null;
  const domain = domainOf(website);
  if (domain) await upsertLink({ nodeId: id, scheme: "domain", value: domain, confidence: 1, method: "startup profile website", evidenceUrl: website });
  return { id, name: n.name, ticker: "", cik: "" };
}

const best = (name: string, cands: Candidate[]) => cands.map((c) => ({ c, s: nameScore(name, c.name) })).sort((a, b) => b.s.score - a.s.score)[0] ?? null;

export type ResolveResult = { nodeId: number; added: number; review: number; steps: string[]; excluded: string[] };

/**
 * Find and store a company's ids, most certain sources first, within the deadline. Safe to run again: links
 * are upserts, and a person's decisions are never overwritten.
 */
export async function resolveEntity(nodeId: number, deadline: number): Promise<ResolveResult> {
  const out: ResolveResult = { nodeId, added: 0, review: 0, steps: [], excluded: [] };
  const [node] = await requireDb().select().from(schema.edgeNodes).where(eq(schema.edgeNodes.id, nodeId));
  if (!node) return out;
  const put = async (l: Omit<LinkIn, "nodeId">) => { const s = await upsertLink({ ...l, nodeId }); if (s === "active") out.added++; else if (s === "review") out.review++; };
  const step = async (label: string, fn: () => Promise<void>) => {
    if (Date.now() > deadline) return;
    try { await fn(); out.steps.push(label); } catch (e) { logError(e, { where: `edge-entities-${label}` }); }
  };
  const cik = node.cik.replace(/^0+/, "");
  await step("sec", async () => {
    if (cik) await put({ scheme: "cik", value: cik, confidence: 1, method: "sec registry", evidenceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}` });
    if (node.ticker) await put({ scheme: "ticker", value: node.ticker, confidence: 1, method: "sec registry (company_tickers.json)", evidenceUrl: "https://www.sec.gov/files/company_tickers.json" });
    if (cik) {
      const sub = (await getSubmissions(cik.padStart(10, "0"))) as unknown as { website?: string };
      const d = sub.website ? domainOf(sub.website) : null;
      if (d) await put({ scheme: "domain", value: d, confidence: 1, method: "sec submissions website", evidenceUrl: `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json` });
    }
  });
  if (cik) await step("wikidata", async () => {
    const w = await wikidataByCik(cik);
    if (!w) return;
    await put({ scheme: "wikidata", value: w.qid, confidence: 0.97, method: "wikidata P5531 (CIK)", evidenceUrl: w.url });
    for (const s of w.sites.slice(0, 3)) { const d = domainOf(s); if (d) await put({ scheme: "domain", value: d, confidence: 0.97, method: "wikidata P856 (official website)", evidenceUrl: w.url }); }
    if (w.lei) await put({ scheme: "lei", value: w.lei, confidence: 0.97, method: "wikidata P1278 (LEI)", evidenceUrl: w.url });
    if (w.wikipedia) await put({ scheme: "wikipedia", value: w.wikipedia, confidence: 0.97, method: "wikidata sitelink (enwiki)", evidenceUrl: w.url });
  });
  const ids = await idsOf(nodeId);
  let boards = (ids.greenhouse?.length ?? 0) + (ids.lever?.length ?? 0) + (ids.ashby?.length ?? 0);
  for (const domain of (ids.domain ?? []).slice(0, 2)) {
    if (boards) break;
    await step(`careers:${domain}`, async () => {
      const { hits } = await boardsFromSite(domain, deadline - 10_000);
      for (const h of hits) {
        if (h.scheme === "workday" || h.scheme === "successfactors") { out.excluded.push(h.scheme); continue; }
        await put({ scheme: h.scheme, value: h.value, confidence: 0.95, method: "careers-page link", evidenceUrl: h.evidence });
        boards++;
      }
    });
  }
  if (out.excluded.length) await setNodeAttrs(nodeId, { atsExcluded: [...new Set(out.excluded)] }).catch(() => undefined);
  // No board on the site: try the company's name as a Greenhouse token, kept only when the board's own name matches.
  if (!boards && !out.excluded.length) await step("board-guess", async () => {
    const token = tokenGuess(node.name);
    if (token.length < 3) return;
    const b = await fetchJson<{ name?: string }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}`, { timeoutMs: 10_000 }).catch(() => null);
    if (b?.name) { const s = nameScore(node.name, b.name); await put({ scheme: "greenhouse", value: token, confidence: s.score, method: `board name ${s.method}`, evidenceUrl: `https://boards.greenhouse.io/${token}` }); }
  });
  await step("usaspending", async () => {
    const m = best(node.name, await recipientsNamed(node.name));
    if (m && m.s.score >= 0.75) await put({ scheme: "uei", value: m.c.value, confidence: m.s.score, method: `USAspending recipient ${m.s.method}`, evidenceUrl: m.c.url });
  });
  await step("patentsview", async () => {
    const m = best(node.name, await assigneesNamed(node.name));
    if (m && m.s.score >= 0.75) await put({ scheme: "patentsview", value: m.c.value, confidence: m.s.score, method: `PatentsView assignee ${m.s.method}`, evidenceUrl: m.c.url });
  });
  await setNodeAttrs(nodeId, { crosswalkAt: new Date().toISOString() }).catch(() => undefined);
  return out;
}

/** A person confirms or rejects a link. Logged in the audit trail. */
export async function decideLink(userId: string, id: number, ok: boolean, note = ""): Promise<EntityLink | null> {
  const [row] = await requireDb().update(schema.edgeEntityIds).set({ status: ok ? "active" : "rejected", verifiedBy: userId, confidence: ok ? 1 : 0, updatedAt: new Date() })
    .where(eq(schema.edgeEntityIds.id, id)).returning();
  if (row) await record(`entity:${row.nodeId}`, [{ sourceName: `${ok ? "Confirmed" : "Rejected"} by a person: ${row.scheme} ${row.value}`, sourceUrl: row.evidenceUrl, license: "", method: note.slice(0, 200) || (ok ? "confirmed" : "rejected"), modelVersion: "", retrievedAt: new Date() }]);
  return row ?? null;
}

/**
 * A person corrects a company's id in one scheme ("this is the right jobs board"): the new value is linked
 * at confidence 1 with their id, and the company's other automatic values in that scheme are retired.
 */
export async function correctLink(userId: string, nodeId: number, scheme: Scheme, value: string, evidenceUrl = ""): Promise<EntityLink> {
  const v = cleanValue(scheme, value);
  const db = requireDb();
  await db.execute(sql`update edge_entity_ids set status = 'rejected', updated_at = now() where node_id = ${nodeId} and scheme = ${scheme} and value <> ${v} and verified_by = ''`);
  const [row] = await db.insert(schema.edgeEntityIds).values({ nodeId, scheme, value: v, confidence: 1, method: "corrected by a person", evidenceUrl: evidenceUrl.slice(0, 500), status: "active", verifiedBy: userId })
    .onConflictDoUpdate({ target: [schema.edgeEntityIds.scheme, schema.edgeEntityIds.value], set: { nodeId, confidence: 1, method: "corrected by a person", evidenceUrl: evidenceUrl.slice(0, 500), status: "active", verifiedBy: userId, updatedAt: new Date() } })
    .returning();
  await record(`entity:${nodeId}`, [{ sourceName: `Corrected by a person: ${scheme} ${v}`, sourceUrl: evidenceUrl, license: "", method: "a person's correction wins over automatic links", modelVersion: "", retrievedAt: new Date() }]);
  return row;
}

/** Matches waiting for a person, newest first, with their companies' names. */
export async function reviewQueue(limit = 50): Promise<(EntityLink & { name: string; ticker: string })[]> {
  const rows = await requireDb().select({ link: schema.edgeEntityIds, name: schema.edgeNodes.name, ticker: schema.edgeNodes.ticker }).from(schema.edgeEntityIds)
    .innerJoin(schema.edgeNodes, eq(schema.edgeNodes.id, schema.edgeEntityIds.nodeId))
    .where(eq(schema.edgeEntityIds.status, "review")).orderBy(desc(schema.edgeEntityIds.updatedAt)).limit(Math.max(1, Math.min(200, limit)));
  return rows.map((r) => ({ ...r.link, name: r.name, ticker: r.ticker }));
}
