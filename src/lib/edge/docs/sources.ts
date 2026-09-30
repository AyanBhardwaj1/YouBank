/**
 * Where documents come from, beyond uploads: a company's SEC filings (10-K, 10-Q, 8-K with its press
 * release exhibits, proxies, S-4s) and the Newsroom archive, both shared with everyone; and a person's
 * own workspace (email threads, CRM notes, Studio models and decks, tool runs, saved stories), private
 * to them. Each is indexed once and refreshed only when it changed.
 */
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheGet, cacheSet } from "@/lib/cache";
import { edgarFetch } from "@/lib/edgar/client";
import { htmlToText } from "@/lib/edgar/filingText";
import { getSubmissions, listFilings } from "@/lib/edgar/submissions";
import { resolveTicker } from "@/lib/edgar/tickers";
import { logError } from "@/lib/errors";
import { putObject, r2Ready } from "../infra/r2";
import { passagesFromFiling, passagesFromPages } from "./chunk";
import { indexPassages, setDoc, upsertDoc } from "./store";

const DAY = 86_400_000;
const PER_FORM: Record<string, number> = { "10-K": 2, "10-Q": 3, "8-K": 4, "DEF 14A": 1, "S-4": 1 };

async function filingText(url: string, index: string, form: string): Promise<string> {
  const res = await edgarFetch(url);
  if (!res.ok) throw new Error(`SEC answered ${res.status} for ${url}`);
  let text = htmlToText(await res.text());
  if (form.startsWith("8-K")) {
    // The substance of an 8-K is usually in its exhibits (the press release is EX-99.1).
    try {
      const idx = await edgarFetch(`${index}index.json`);
      const files = ((await idx.json()) as { directory?: { item?: { name: string }[] } }).directory?.item ?? [];
      for (const f of files.filter((x) => /ex-?99/i.test(x.name) && /\.(htm|html|txt)$/i.test(x.name)).slice(0, 2)) {
        const r = await edgarFetch(`${index}${f.name}`);
        if (r.ok) text += `\n\nExhibit 99\n\n${htmlToText(await r.text())}`;
      }
    } catch { /* the form itself is still indexed */ }
  }
  return text;
}

const NARRATIVE = ["Risk factors", "MD&A", "Business", "Market risk", "8-K item", "Exhibit 99", "Controls"];

/** At most `max` passages, the narrative sections first (the financial statements' tables are in XBRL facts anyway). Pure. */
export function keepNarrative<T extends { ord: number; section: string }>(passages: T[], max: number): T[] {
  if (passages.length <= max) return passages;
  const rank = (p: T) => { const i = NARRATIVE.indexOf(p.section); return i === -1 ? NARRATIVE.length : i; };
  return [...passages].sort((a, b) => rank(a) - rank(b) || a.ord - b.ord).slice(0, max).sort((a, b) => a.ord - b.ord);
}

/** Index a company's recent filings of the given forms. Returns the documents now ready. */
export async function indexFilings(ticker: string, forms: string[], months: number, deadline: number): Promise<{ docIds: number[]; indexed: number; name: string }> {
  const t = await resolveTicker(ticker);
  if (!t) throw Object.assign(new Error(`No SEC filer for ${ticker}`), { status: 404 });
  const cik = String(t.cik);
  const subs = await getSubmissions(cik);
  const since = new Date(Date.now() - months * 30 * DAY).toISOString().slice(0, 10);
  const want = forms.length ? forms : ["10-K", "10-Q", "8-K"];
  const picked: ReturnType<typeof listFilings> = [];
  for (const form of want) picked.push(...listFilings(subs, [form], 30).filter((f) => f.filed >= since && (form !== "10-K" || f.form === "10-K") && (form !== "10-Q" || f.form === "10-Q")).slice(0, PER_FORM[form] ?? 2));
  const docIds: number[] = [];
  let indexed = 0;
  for (const f of picked) {
    const doc = await upsertDoc({ ownerId: "", source: "sec", externalId: f.accession, title: `${t.name} ${f.form} (${f.filed})`, url: f.url, mime: "text/html", meta: { ticker: ticker.toUpperCase(), cik, form: f.form, filed: f.filed, period: f.period, items: f.items } });
    if (doc.status === "ready") { docIds.push(doc.id); continue; }
    if (Date.now() > deadline) continue;
    try {
      await setDoc(doc.id, { status: "indexing" });
      const text = await filingText(f.url, f.index, f.form);
      if (r2Ready()) await putObject(`docs/sec/${f.accession}.txt`, text, "text/plain; charset=utf-8").catch(() => undefined);
      await indexPassages(doc.id, keepNarrative(passagesFromFiling(text), 1500));
      await setDoc(doc.id, { lang: "en", meta: { ...doc.meta, textKey: r2Ready() ? `docs/sec/${f.accession}.txt` : "" } });
      docIds.push(doc.id); indexed++;
    } catch (e) {
      logError(e, { where: "edge-index-filing" });
      await setDoc(doc.id, { status: "failed", error: String((e as Error).message ?? e).slice(0, 300) });
    }
  }
  return { docIds, indexed, name: t.name };
}

/** Index Newsroom stories about some companies from the last `days`. */
export async function indexNewsroom(tickers: string[], days: number, deadline: number): Promise<number[]> {
  if (!tickers.length) return [];
  const rows = await requireDb().select().from(schema.newsClusters)
    .where(and(gte(schema.newsClusters.firstSeenAt, new Date(Date.now() - days * DAY)), sql`${schema.newsClusters.tickers} ?| array[${sql.join(tickers.map((t) => sql`${t}`), sql`, `)}]::text[]`))
    .orderBy(desc(schema.newsClusters.importance)).limit(60);
  const ids: number[] = [];
  for (const c of rows) {
    const doc = await upsertDoc({ ownerId: "", source: "newsroom", externalId: `cluster:${c.id}`, title: c.headline, url: `/app/news/story/${c.id}`, mime: "text/plain", meta: { tickers: c.tickers, ticker: c.tickers[0] ?? "", date: c.firstSeenAt.toISOString().slice(0, 10) } });
    if (doc.status !== "ready" && Date.now() < deadline) {
      const s = c.summary;
      const text = [c.headline, ...(s?.bullets ?? []), s?.why ?? "", ...(s?.numbers ?? []).map((n) => `${n.label}: ${n.value}`)].filter(Boolean).join("\n\n");
      await indexPassages(doc.id, passagesFromPages([{ n: 0, text }])).catch((e) => logError(e, { where: "edge-index-news" }));
    }
    ids.push(doc.id);
  }
  return ids;
}

type Cell = { v?: unknown; cv?: unknown };
type Workbook = { order?: string[]; sheets?: Record<string, { name?: string; cells?: Record<string, Cell> }> };
type Deck = { order?: string[]; slides?: Record<string, { title?: string; subtitle?: string; elements?: { type: string; text?: string; rows?: string[][]; label?: string; value?: string; title?: string }[] }> };

/** A Studio model or deck as readable text: sheet labels and values, slide titles, text and tables. Pure. */
export function studioText(title: string, wb: Workbook, deck: Deck): string {
  const parts: string[] = [title];
  for (const id of wb.order ?? Object.keys(wb.sheets ?? {})) {
    const sh = wb.sheets?.[id];
    if (!sh) continue;
    const cells = Object.entries(sh.cells ?? {}).slice(0, 1500).map(([a, c]) => `${a}: ${String(c.v ?? c.cv ?? "")}`).filter((l) => !l.endsWith(": "));
    if (cells.length) parts.push(`Sheet ${sh.name ?? id}\n${cells.join("\n")}`);
  }
  for (const id of deck.order ?? Object.keys(deck.slides ?? {})) {
    const s = deck.slides?.[id];
    if (!s) continue;
    const els = (s.elements ?? []).map((e) => e.type === "text" ? e.text : e.type === "table" ? (e.rows ?? []).map((r) => r.join(" | ")).join("\n") : e.type === "metric" ? `${e.label}: ${e.value ?? ""}` : e.type === "chart" ? e.title : "").filter(Boolean);
    parts.push(`Slide: ${s.title ?? ""}${s.subtitle ? ` (${s.subtitle})` : ""}\n${els.join("\n")}`);
  }
  return parts.join("\n\n");
}

/** Index a person's workspace (private to them). Items unchanged since their last indexing are skipped. */
export async function indexWorkspace(userId: string, deadline: number): Promise<{ docIds: number[]; indexed: number }> {
  const db = requireDb();
  const docIds: number[] = [];
  let indexed = 0;
  const add = async (externalId: string, title: string, url: string, text: string, changed: Date, meta: Record<string, unknown> = {}) => {
    if (!text.trim()) return;
    const doc = await upsertDoc({ ownerId: userId, source: "workspace", externalId, title, url, mime: "text/plain", meta });
    docIds.push(doc.id);
    if (doc.status === "ready" && doc.indexedAt && doc.indexedAt >= changed) return;
    if (Date.now() > deadline) return;
    try { await indexPassages(doc.id, passagesFromPages([{ n: 0, text: text.slice(0, 200_000) }])); indexed++; }
    catch (e) { logError(e, { where: "edge-index-workspace" }); }
  };
  const threads = await db.select().from(schema.crmThreads).where(eq(schema.crmThreads.userId, userId)).orderBy(desc(schema.crmThreads.id)).limit(120);
  for (const t of threads) {
    if (Date.now() > deadline) break;
    const msgs = await db.select({ from: schema.crmMessages.fromName, addr: schema.crmMessages.fromAddress, body: schema.crmMessages.body, at: schema.crmMessages.sentAt }).from(schema.crmMessages).where(eq(schema.crmMessages.threadId, t.id)).orderBy(desc(schema.crmMessages.id)).limit(20);
    const latest = msgs[0]?.at ?? new Date(0);
    await add(`crm:thread:${t.id}`, `Email: ${t.subject || "(no subject)"}`, `/app/crm?tab=inbox&thread=${t.id}`, [t.summary, ...msgs.reverse().map((m) => `${m.from || m.addr} (${m.at?.toISOString().slice(0, 10) ?? ""}):\n${m.body.slice(0, 6000)}`)].filter(Boolean).join("\n\n"), latest);
  }
  const notes = await db.select({ name: schema.crmContacts.name, company: schema.crmContacts.company, title: schema.crmContacts.title, notes: schema.crmContacts.notes }).from(schema.crmContacts).where(and(eq(schema.crmContacts.userId, userId), sql`${schema.crmContacts.notes} <> ''`)).limit(400);
  if (notes.length) await add("crm:notes", "CRM contact notes", "/app/crm?tab=contacts", notes.map((n) => `${n.name}${n.title ? `, ${n.title}` : ""}${n.company ? ` at ${n.company}` : ""}: ${n.notes}`).join("\n\n"), new Date());
  const docs = await db.select({ id: schema.studioDocs.id, title: schema.studioDocs.title, workbook: schema.studioDocs.workbook, deck: schema.studioDocs.deck, updatedAt: schema.studioDocs.updatedAt, ticker: schema.studioDocs.ticker }).from(schema.studioDocs).where(eq(schema.studioDocs.ownerId, userId)).orderBy(desc(schema.studioDocs.updatedAt)).limit(30);
  for (const d of docs) await add(`studio:${d.id}`, `Studio: ${d.title}`, `/app/studio/${d.id}`, studioText(d.title, d.workbook as Workbook, d.deck as Deck), d.updatedAt, { ticker: d.ticker });
  const runs = await db.select().from(schema.workflowRuns).where(and(eq(schema.workflowRuns.userId, userId), eq(schema.workflowRuns.status, "done"))).orderBy(desc(schema.workflowRuns.createdAt)).limit(60);
  for (const r of runs) await add(`run:${r.id}`, `Tool run: ${r.title || r.toolId}`, `/app/tools?run=${r.id}`, `${r.title}\nInputs: ${JSON.stringify(r.inputs).slice(0, 3000)}\n\n${typeof r.output === "string" ? r.output : JSON.stringify(r.output ?? "").slice(0, 20000)}`, r.createdAt);
  const saved = await db.select({ id: schema.newsClusters.id, headline: schema.newsClusters.headline, summary: schema.newsClusters.summary, at: schema.newsUserItems.savedAt })
    .from(schema.newsUserItems).innerJoin(schema.newsClusters, eq(schema.newsClusters.id, schema.newsUserItems.clusterId))
    .where(and(eq(schema.newsUserItems.userId, userId), isNotNull(schema.newsUserItems.savedAt))).limit(80);
  for (const s of saved) await add(`saved:${s.id}`, `Saved story: ${s.headline}`, `/app/news/story/${s.id}`, [s.headline, ...(s.summary?.bullets ?? []), s.summary?.why ?? ""].join("\n\n"), s.at ?? new Date());
  return { docIds, indexed };
}

/** Index the workspace at most every six hours (it is read on every question that includes it). */
export async function workspaceDocs(userId: string, deadline: number): Promise<number[]> {
  const key = `edge:ws-indexed:${userId}`;
  if (await cacheGet(key)) {
    const rows = await requireDb().select({ id: schema.edgeDocs.id }).from(schema.edgeDocs).where(and(eq(schema.edgeDocs.ownerId, userId), eq(schema.edgeDocs.source, "workspace"), eq(schema.edgeDocs.status, "ready")));
    return rows.map((r) => r.id);
  }
  const r = await indexWorkspace(userId, deadline);
  await cacheSet(key, "1", 6 * 3_600_000);
  return r.docIds;
}
