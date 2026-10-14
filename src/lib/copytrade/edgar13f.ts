/**
 * 13F filings from SEC EDGAR: finding them, reading them, storing them. Server only. Free: SEC's
 * public data, within its fair-access limit through lib/edgar/client (a descriptive User-Agent, eight
 * requests a second shared by every instance, and a minute's back-off when SEC asks).
 *
 * Three ways in, fastest first:
 * - EDGAR's latest-filings feed for 13F-HR (and 13F-HR/A), polled by the cron: minutes after a filing;
 * - each day's form index (daily-index/form.YYYYMMDD.idx), read the next morning, which catches anything
 *   the feed's last hundred entries missed;
 * - a filer's submissions record (data.sec.gov), read when someone opens a fund, for its full history.
 * The quarterly full index (full-index/YYYY/QTRn/form.idx) fills the directory of every 13F filer for
 * search; it is sorted by form, so it is streamed only as far as the 13F section.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { DAY, edgarFetch, edgarJson, edgarText, HOUR } from "@/lib/edgar/client";
import { currentFeedUrl, parseCurrentFeed } from "@/lib/news/sources/edgar";
import { curatedByCik, nameFits, padCik } from "./funds";
import { aggregate, is13fHoldingsForm, parseInfoTable, parsePrimaryDoc, type FilingRecord, type Holding } from "./thirteenf";

type Columns = { accessionNumber: string[]; filingDate: string[]; reportDate: string[]; form: string[]; primaryDocument: string[] };
type SubmissionsDoc = { cik: string; name: string; filings: { recent: Columns; files?: { name: string; filingFrom: string; filingTo: string }[] } };

export type FilingRef = { accession: string; form: string; filedOn: string; period: string };

const folder = (cik: string, accession: string) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}`;
export const filingIndexUrl = (cik: string, accession: string) => `${folder(cik, accession)}/${accession}-index.htm`;

function refsOf(c: Columns): FilingRef[] {
  const out: FilingRef[] = [];
  for (let i = 0; i < c.form.length; i++) if (is13fHoldingsForm(c.form[i])) out.push({ accession: c.accessionNumber[i], form: c.form[i], filedOn: c.filingDate[i], period: c.reportDate[i] ?? "" });
  return out;
}

/** A filer's name and its 13F-HR and 13F-HR/A filings, newest first, reaching back `years`. */
export async function list13f(cik: string, years = 6): Promise<{ name: string; refs: FilingRef[] }> {
  const c = padCik(cik);
  if (!c) throw Object.assign(new Error("That is not a CIK."), { status: 400 });
  const doc = await edgarJson<SubmissionsDoc>(`https://data.sec.gov/submissions/CIK${c}.json`, `submissions-${c}.json`, 2 * HOUR).catch((e) => {
    if (/EDGAR 404/.test(String((e as Error).message))) throw Object.assign(new Error("SEC has no filer with that CIK."), { status: 404 });
    throw e;
  });
  const floor = new Date(Date.now() - years * 365.25 * DAY).toISOString().slice(0, 10);
  const refs = refsOf(doc.filings.recent);
  // Busy filers push older 13Fs out of the recent list into numbered files.
  for (const f of doc.filings.files ?? []) {
    if (f.filingTo < floor) continue;
    const more = await edgarJson<Columns>(`https://data.sec.gov/submissions/${f.name}`, `submissions-${f.name}`, 7 * DAY).catch(() => null);
    if (more) refs.push(...refsOf(more));
  }
  const seen = new Set<string>();
  return { name: doc.name, refs: refs.filter((r) => r.filedOn >= floor && !seen.has(r.accession) && seen.add(r.accession)).sort((a, b) => (a.filedOn < b.filedOn ? 1 : -1)) };
}

type IndexJson = { directory?: { item?: { name: string; type?: string; size?: string | number }[] } };

/** Read one filing: its primary document and information table. Filings never change, so they are cached for long. */
export async function readFiling(cik: string, ref: FilingRef): Promise<{ record: FilingRecord; meta: ReturnType<typeof parsePrimaryDoc>; unitCorrected: boolean; lines: number; docUrl: string; tableUrl: string }> {
  const base = folder(cik, ref.accession);
  const idx = await edgarJson<IndexJson>(`${base}/index.json`, `13f-index-${ref.accession}.json`, 365 * DAY);
  const items = idx.directory?.item ?? [];
  const xmls = items.filter((i) => /\.xml$/i.test(i.name));
  const primary = xmls.find((i) => /^primary_doc\.xml$/i.test(i.name)) ?? xmls.find((i) => /primary/i.test(i.name));
  const table = xmls.filter((i) => i !== primary).sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0) || (/info|table/i.test(a.name) ? -1 : 1))[0];
  if (!primary) throw new Error(`13F ${ref.accession} has no primary document`);
  const docUrl = `${base}/${primary.name}`;
  const meta = parsePrimaryDoc(await edgarText(docUrl, `13f-doc-${ref.accession}`, 365 * DAY));
  let holdings: Holding[] = [], unitCorrected = false, lines = 0, tableUrl = "";
  if (table && meta.reportType !== "NOTICE") {
    tableUrl = `${base}/${table.name}`;
    const parsed = parseInfoTable(await edgarText(tableUrl, `13f-table-${ref.accession}`, 365 * DAY), ref.filedOn);
    holdings = aggregate(parsed.lines);
    unitCorrected = parsed.unitCorrected;
    lines = parsed.lines.length;
  }
  return {
    record: { accession: ref.accession, form: ref.form, filedOn: ref.filedOn, period: meta.period || ref.period, amendmentType: meta.amendmentType, reportType: meta.reportType, confidentialOmitted: meta.confidentialOmitted, holdings },
    meta, unitCorrected, lines, docUrl, tableUrl,
  };
}

/** Stored filings of a fund, oldest first. */
export async function storedFilings(cik: string): Promise<(FilingRecord & { docUrl: string; tableUrl: string; unitCorrected: boolean; lines: number; valueTotal: number | null })[]> {
  const rows = await requireDb().select().from(schema.copyFilings).where(and(eq(schema.copyFilings.cik, padCik(cik)), eq(schema.copyFilings.status, "ok"))).orderBy(schema.copyFilings.filedOn, schema.copyFilings.accession);
  return rows.map((r) => ({
    accession: r.accession, form: r.form, filedOn: r.filedOn, period: r.period, amendmentType: (r.amendmentType as FilingRecord["amendmentType"]) ?? null, reportType: r.reportType as FilingRecord["reportType"],
    confidentialOmitted: r.confidentialOmitted, holdings: r.holdings, docUrl: r.docUrl, tableUrl: r.tableUrl, unitCorrected: r.unitCorrected, lines: r.lines, valueTotal: r.valueTotal,
  }));
}

/**
 * Bring a fund's stored filings up to date: list its 13Fs and read the ones not yet stored, newest first,
 * at most `max` per call (the rest arrive on the next view or cron pass). Refuses a curated entry whose
 * EDGAR name does not fit, rather than showing the wrong filer. Returns the accessions read.
 */
export async function syncFund(cik: string, opts: { max?: number; years?: number; deadline?: number } = {}): Promise<{ name: string; added: string[]; pending: number }> {
  const c = padCik(cik);
  const { name, refs } = await list13f(c, opts.years ?? 6);
  const cur = curatedByCik(c);
  if (cur && !nameFits(cur, name)) throw new Error(`Curated fund ${cur.name} points at CIK ${c}, which EDGAR names "${name}"`);
  const db = requireDb();
  const have = new Set(refs.length ? (await db.select({ a: schema.copyFilings.accession }).from(schema.copyFilings).where(inArray(schema.copyFilings.accession, refs.map((r) => r.accession)))).map((r) => r.a) : []);
  const todo = refs.filter((r) => !have.has(r.accession));
  const added: string[] = [];
  for (const ref of todo.slice(0, opts.max ?? 8)) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    try {
      const f = await readFiling(c, ref);
      await db.insert(schema.copyFilings).values({
        accession: ref.accession, cik: c, form: ref.form, filedOn: ref.filedOn, period: f.record.period || ref.period, reportType: f.record.reportType, amendmentType: f.record.amendmentType,
        confidentialOmitted: f.record.confidentialOmitted, unitCorrected: f.unitCorrected, entryTotal: f.meta.entryTotal, valueTotal: f.meta.valueTotal, holdings: f.record.holdings, lines: f.lines, docUrl: f.docUrl, tableUrl: f.tableUrl,
      }).onConflictDoNothing();
      added.push(ref.accession);
    } catch (e) {
      // A filing we cannot read is remembered as such (and retried after a week by clearing the row), not re-fetched every pass.
      if ((e as { status?: number }).status === 503) break; // SEC asked us to slow down
      await db.insert(schema.copyFilings).values({ accession: ref.accession, cik: c, form: ref.form, filedOn: ref.filedOn, period: ref.period || ref.filedOn, status: "error" }).onConflictDoNothing();
    }
  }
  const latest = refs[0];
  await db.insert(schema.copyFilers).values({ cik: c, name, latestFiled: latest?.filedOn ?? null, latestPeriod: latest?.period || null, curated: !!cur, checkedAt: new Date() })
    .onConflictDoUpdate({ target: schema.copyFilers.cik, set: { name, latestFiled: latest?.filedOn ?? null, latestPeriod: latest?.period || null, curated: !!cur, checkedAt: new Date(), updatedAt: new Date() } });
  return { name, added, pending: Math.max(0, todo.length - added.length) };
}

/** Forget unreadable filings older than a week, so they are tried again. */
export async function retryFailedFilings(): Promise<void> {
  await requireDb().delete(schema.copyFilings).where(and(eq(schema.copyFilings.status, "error"), sql`${schema.copyFilings.createdAt} < now() - interval '7 days'`));
}

export type SeenFiling = { cik: string; name: string; form: string; filedOn: string; accession: string };

/** The newest 13F-HR and 13F-HR/A filings from EDGAR's latest-filings feed. */
export async function feed13f(): Promise<SeenFiling[]> {
  const out: SeenFiling[] = [];
  for (const form of ["13F-HR", "13F-HR/A"]) {
    const res = await edgarFetch(currentFeedUrl(form, 100));
    if (!res.ok) continue;
    for (const f of parseCurrentFeed(await res.text())) {
      if (!is13fHoldingsForm(f.form)) continue;
      out.push({ cik: f.cik.padStart(10, "0"), name: f.company, form: f.form, filedOn: f.filedAt.toISOString().slice(0, 10), accession: f.accession });
    }
  }
  return out;
}

/** 13F lines of an EDGAR form index (daily or quarterly). Pure, for tests. */
export function parseFormIndex(text: string): SeenFiling[] {
  const out: SeenFiling[] = [];
  for (const line of text.split("\n")) {
    if (!/^13F-HR(\/A)?\s{2,}/.test(line)) continue;
    const parts = line.trim().split(/\s{2,}/);
    const path = parts[parts.length - 1];
    const m = /edgar\/data\/(\d+)\/(\d{10}-\d{2}-\d{6})\.txt/.exec(path);
    const date = parts[parts.length - 2] ?? "";
    if (!m) continue;
    out.push({ form: parts[0], name: parts.slice(1, parts.length - 3).join(" ").trim(), cik: m[1].padStart(10, "0"), filedOn: /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : date, accession: m[2] });
  }
  return out;
}

/** One day's 13Fs from the daily form index (none on weekends and holidays). */
export async function dailyIndex13f(date: Date): Promise<SeenFiling[]> {
  const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1, d = date.getUTCDate();
  const ymd = `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
  try {
    return parseFormIndex(await edgarText(`https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${Math.ceil(m / 3)}/form.${ymd}.idx`, `formidx-${ymd}.json`, 30 * DAY));
  } catch { return []; }
}

/**
 * Every 13F filer of a quarter from the full form index, streamed and stopped once past the 13F
 * section (the file is sorted by form type and runs to tens of megabytes).
 */
export async function quarter13fFilers(year: number, q: number, deadline: number): Promise<SeenFiling[]> {
  const res = await edgarFetch(`https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${q}/form.idx`, 120_000);
  if (!res.ok || !res.body) return [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", seen13f = false;
  const out: SeenFiling[] = [];
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      const got = parseFormIndex(lines.join("\n"));
      if (got.length) { seen13f = true; out.push(...got); }
      else if (seen13f && lines.some((l) => /^[0-9A-Z]/.test(l) && l.slice(0, 6) > "13F-HR")) break;
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return out;
}

/** Record filers seen in an index or the feed, for search; returns how many rows were written. */
export async function noteFilers(seen: SeenFiling[]): Promise<number> {
  const latest = new Map<string, SeenFiling>();
  for (const s of seen) { const x = latest.get(s.cik); if (!x || s.filedOn > x.filedOn) latest.set(s.cik, s); }
  const rows = [...latest.values()];
  const db = requireDb();
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    await db.insert(schema.copyFilers).values(chunk.map((r) => ({ cik: r.cik, name: r.name, latestFiled: r.filedOn, curated: !!curatedByCik(r.cik) })))
      .onConflictDoUpdate({ target: schema.copyFilers.cik, set: { name: sql`excluded.name`, latestFiled: sql`greatest(${schema.copyFilers.latestFiled}, excluded.latest_filed)`, updatedAt: new Date() } });
  }
  return rows.length;
}

/** Search every 13F filer we know of by name, or one by CIK (read from EDGAR when not yet known). */
export async function searchFilers(q: string, limit = 20): Promise<{ cik: string; name: string; latestFiled: string | null; curated: boolean }[]> {
  const db = requireDb();
  const cik = padCik(q);
  if (cik) {
    const [row] = await db.select().from(schema.copyFilers).where(eq(schema.copyFilers.cik, cik));
    if (row) return [{ cik: row.cik, name: row.name, latestFiled: row.latestFiled, curated: row.curated }];
    const found = await list13f(cik, 2).catch(() => null);
    return found && found.refs.length ? [{ cik, name: found.name, latestFiled: found.refs[0].filedOn, curated: !!curatedByCik(cik) }] : [];
  }
  const words = q.trim().toLowerCase().split(/\s+/).filter((w) => w.length >= 2).slice(0, 5);
  if (!words.length) return [];
  const rows = await db.select().from(schema.copyFilers)
    .where(and(...words.map((w) => sql`lower(${schema.copyFilers.name}) like ${`%${w.replace(/[%_\\]/g, "")}%`}`)))
    .orderBy(desc(schema.copyFilers.curated), desc(schema.copyFilers.latestFiled)).limit(limit);
  return rows.map((r) => ({ cik: r.cik, name: r.name, latestFiled: r.latestFiled, curated: r.curated }));
}
