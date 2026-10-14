/**
 * Reading a deal's terms from its merger documents (E1). For each document (the proxy or 14D-9 first, then
 * the merger agreement and its press release):
 *   1. locate the sections that state the terms (deals/sections.ts), so one model call reads one section;
 *   2. the small model (structured output) returns {field, value, quote} for the fields that section states;
 *   3. every field passes the deterministic checks (deals/checks.ts): the quote must be in the section, a
 *      numeric value is re-read from the quote (that reading is stored), units are USD millions;
 *   4. cross-field checks against the target's XBRL figures and prices; a failed check lowers confidence;
 *   5. confidence per field from the checks, calibrated per family (deals/confidence.ts).
 * Then the deal's headline columns, its vector (target business and rationale, for "deals like this one")
 * and its link in the relationship graph are brought up to date, and each document read is recorded in the
 * audit trail. Spend is the small model's tokens (about half a cent a deal) and a few embedding tokens; who
 * pays is whoever's context the call runs in (a person's explicit read counts in their AI allowance; the
 * backfill runs with no person and counts against the platform budget, deals/jobs.ts).
 */
import { z } from "zod";
import { structured } from "@/lib/ai/agent";
import { edgarFetch } from "@/lib/edgar/client";
import { htmlToText } from "@/lib/edgar/filingText";
import { listedByCik } from "../graph/store";
import { history } from "@/lib/market/data";
import { premiumOf } from "@/lib/news/deals";
import { failureMessage, logError } from "@/lib/errors";
import { nameScore } from "../entities/crosswalk";
import { companyNode } from "../entities/resolve";
import { embeddingsReady, embedTexts } from "../docs/embed";
import { partsFromHtml } from "../docs/html";
import { small } from "../models";
import { record } from "../provenance";
import { checkField, crossChecks, type Checked } from "./checks";
import { confidenceOf, rawScore } from "./confidence";
import { FIELD, fieldsFor, type SectionKey } from "./fields";
import { targetFacts } from "./facts";
import { locateSections, SECTIONS_BY_KIND, type DocKind, type Located } from "./sections";
import { activeFields, dealById, dealForTarget, mergeDeals, saveFields, setEmbedding, syncLink, updateDeal, type FieldIn } from "./store";

export const EXTRACT_VERSION = "section-read v1 + number check";
const MAX_DOC_BYTES = 8_000_000;

const Out = z.object({
  fields: z.array(z.object({
    field: z.string().describe("one of the field ids listed"),
    value: z.string().describe("the value as the document states it (with its units), or a list separated by semicolons"),
    quote: z.string().describe("the exact words from the section that state it, under 60 words, copied character for character"),
  })).max(30),
});

const SYSTEM = "You read one section of an SEC merger document and extract deal terms. Only report a field the section states outright, and copy the exact words that state it as the quote, character for character (no paraphrase, no ellipsis unless the words are elsewhere in the same sentence). Never compute or infer a value. Leave a field out rather than guess. Money keeps its units as written ($1.2 billion, $56.50 per share).";

/** The prompt for one section: the fields it may state, then the section. Pure. */
export function sectionPrompt(sec: Located, names: { target: string; acquirer: string }, fields: string[]): string {
  const list = fields.map((f) => `- ${f}: ${FIELD[f].ask}${FIELD[f].options ? ` (one of: ${FIELD[f].options!.join(", ")})` : ""}`).join("\n");
  return `Deal: ${names.target || "the target"}${names.acquirer ? ` acquired by ${names.acquirer}` : ""}\nSection: ${sec.heading || `passages about ${sec.key}`}\n\nFields to look for:\n${list}\n\n---\n${sec.text}`;
}

async function fetchDoc(url: string): Promise<string> {
  const res = await edgarFetch(url, 40_000);
  if (!res.ok) throw Object.assign(new Error(`EDGAR answered ${res.status} for a merger document`), { status: 502 });
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_DOC_BYTES) throw Object.assign(new Error("That document is too large to read here."), { status: 413 });
  const text = await res.text();
  return text.slice(0, MAX_DOC_BYTES);
}

type Best = Checked & { raw: number; via: "heading" | "keywords"; docUrl: string; section: string; sectionText: string };

export type ReadResult = { dealId: number; fields: number; docs: number; sections: number; dropped: number; costNote: string; error?: string };

/**
 * Read a deal's documents and store what they state. `model` overrides the small model (the premium
 * re-read); `replace` retires earlier readings of every field it finds. Stops at the deadline.
 */
export async function readDeal(dealId: number, opts: { deadline: number; model?: string; replace?: boolean; method?: string }): Promise<ReadResult> {
  const out: ReadResult = { dealId, fields: 0, docs: 0, sections: 0, dropped: 0, costNote: "" };
  const d = await dealById(dealId);
  if (!d) throw Object.assign(new Error("That deal does not exist."), { status: 404 });
  const order: Record<string, number> = { proxy: 0, tender: 1, s4: 2, agreement: 3, press: 4 };
  const docs = [...d.deal.sources].sort((a, b) => (order[a.role ?? ""] ?? 9) - (order[b.role ?? ""] ?? 9));
  const best = new Map<string, Best>();
  const names = { target: d.deal.targetName, acquirer: d.deal.acquirerName };
  const override = opts.model ? { model: opts.model, effort: "low" as const } : small();
  const method = opts.method ?? `${override.model} ${EXTRACT_VERSION}`;
  const read: { url: string; form: string; sections: string[] }[] = [];
  for (const src of docs) {
    for (const [url, kind] of [[src.url, src.role as DocKind], ...(src.press ? [[src.press, "press" as DocKind]] : [])] as [string, DocKind][]) {
      if (Date.now() > opts.deadline - 30_000) break;
      if (!SECTIONS_BY_KIND[kind]) continue;
      let parts;
      try {
        const html = await fetchDoc(url);
        parts = /<html|<div|<p[ >]|<table/i.test(html) ? partsFromHtml(html) : htmlToText(html).split(/\n{2,}/).map((t) => ({ kind: "text" as const, text: t }));
      } catch (e) { logError(e, { where: "edge-deals-fetch" }); continue; }
      out.docs++;
      const secs = locateSections(parts, SECTIONS_BY_KIND[kind]);
      const used: string[] = [];
      for (const sec of secs) {
        if (Date.now() > opts.deadline - 20_000) break;
        // Fields already read with a calibrated-looking confidence from a better section are not asked again.
        const wanted = fieldsFor(sec.key as SectionKey).map((f) => f.field).filter((f) => !best.has(f) || best.get(f)!.raw < 0.75);
        if (!wanted.length) continue;
        try {
          const r = await structured(Out, opts.model ? "edge-deals-reread" : "edge-deals-extract", SYSTEM, sectionPrompt(sec, names, wanted), { override, maxTokens: 1800, timeoutMs: 60_000 });
          out.sections++; used.push(sec.heading || sec.key);
          for (const raw of r.data.fields.filter((f) => wanted.includes(f.field))) {
            const c = checkField(raw, sec.text);
            if (c.dropped || c.value === null) { out.dropped++; continue; }
            const score = rawScore(c.checks, sec.via);
            const prev = best.get(c.field);
            if (!prev || score > prev.raw) best.set(c.field, { ...c, raw: score, via: sec.via, docUrl: url, section: sec.heading || `keyword passages (${sec.key})`, sectionText: sec.text });
          }
          if (r.data.fields.some((f) => f.field === "target_name" || f.field === "acquirer_name")) {
            names.target = String(best.get("target_name")?.value ?? names.target);
            names.acquirer = String(best.get("acquirer_name")?.value ?? names.acquirer);
          }
        } catch (e) {
          // A section that fails to read is skipped; the AI caps stop the whole read with a plain reason.
          if ((e as { status?: number }).status === 429) { out.error = failureMessage(e, "edge-deals-extract"); break; }
          logError(e, { where: "edge-deals-extract" });
        }
      }
      read.push({ url, form: src.form, sections: used });
      if (out.error) break;
    }
    if (out.error) break;
  }

  // Who is who, then the target's own figures for the multiples and the cross-field checks.
  const parties = await resolveParties(d.deal, String(best.get("target_name")?.value ?? ""), String(best.get("acquirer_name")?.value ?? ""));
  const announced = String(best.get("sign_date")?.value ?? d.deal.announcedAt ?? "").slice(0, 10) || String(d.deal.announcedAt ?? "");
  const facts = parties.targetCik ? await targetFacts(parties.targetCik, announced).catch(() => null) : null;
  const perShare = typeof best.get("per_share")?.value === "number" ? (best.get("per_share")!.value as number) : null;
  const computedPremium = await premiumFromPrices(parties.targetTicker, perShare, announced).catch(() => null);
  const checked = crossChecks([...best.values()], { netDebtMm: facts?.netDebtMm ?? null, sharesMm: facts?.sharesMm ?? null, computedPremium: computedPremium?.premium ?? null });
  const rows: FieldIn[] = checked.map((c) => {
    const b = best.get(c.field)!;
    const raw = rawScore(c.checks, b.via);
    const conf = confidenceOf(c.field, raw);
    return { field: c.field, value: c.value, quote: c.quote, docUrl: b.docUrl, section: b.section, confidence: conf.p, checks: { list: c.checks, raw, calibrated: conf.calibrated, note: conf.note, via: b.via }, method, modelVersion: override.model };
  });
  out.fields = await saveFields(dealId, rows, { replace: opts.replace });

  // The deal's headline columns from its active fields (a re-read and earlier readings combined).
  const active = new Map((await activeFields(dealId)).map((f) => [f.field, f.value]));
  const num = (f: string) => (typeof active.get(f) === "number" ? (active.get(f) as number) : null);
  const equity = num("equity_value") ?? (perShare && facts?.sharesMm ? Math.round(perShare * facts.sharesMm * 10) / 10 : null);
  const ev = num("enterprise_value") ?? (equity !== null && facts?.netDebtMm !== null && facts?.netDebtMm !== undefined ? Math.round((equity + facts.netDebtMm) * 10) / 10 : null);
  const mult = (den: number | null | undefined) => (ev && den && den > 0 && ev / den < 200 ? Math.round((ev / den) * 100) / 100 : null);
  await updateDeal(dealId, {
    targetName: (parties.targetName || d.deal.targetName).slice(0, 200), acquirerName: (parties.acquirerName || d.deal.acquirerName).slice(0, 200),
    targetCik: parties.targetCik || d.deal.targetCik, acquirerCik: parties.acquirerCik || d.deal.acquirerCik, targetTicker: parties.targetTicker || d.deal.targetTicker,
    targetNode: parties.targetNode ?? d.deal.targetNode, acquirerNode: parties.acquirerNode ?? d.deal.acquirerNode, sic: parties.sic || d.deal.sic,
    buyerType: String(active.get("buyer_type") ?? d.deal.buyerType ?? ""), consideration: String(active.get("consideration") ?? d.deal.consideration ?? ""),
    equityUsdMm: equity, evUsdMm: ev, evEbitda: mult(facts?.ebitdaMm), evRevenue: mult(facts?.revenueMm),
    premiumUnaffected: num("premium_unaffected") ?? computedPremium?.premium ?? null, premium1d: computedPremium?.premium ?? d.deal.premium1d,
    signedAt: typeof active.get("sign_date") === "string" ? String(active.get("sign_date")) : d.deal.signedAt, announcedAt: announced || d.deal.announcedAt,
    extractedAt: new Date(),
  });

  // The same deal found twice (a proxy and an earlier merger agreement) becomes one.
  // The rest goes to the deal that survives the merge.
  let finalId = dealId;
  if (parties.targetCik && announced) {
    const twin = await dealForTarget(parties.targetCik, announced);
    if (twin && twin.id !== dealId) { finalId = Math.min(twin.id, dealId); await mergeDeals(finalId, Math.max(twin.id, dealId)); out.dealId = finalId; }
  }

  // Its vector: the target's business and the stated rationale.
  const bizText = [best.get("target_name")?.sectionText?.slice(0, 2500) ?? "", [...best.values()].find((b) => /reason|recommend/i.test(b.section))?.sectionText?.slice(0, 1500) ?? ""].join("\n").trim();
  if (bizText.length > 200 && embeddingsReady()) {
    try { const [v] = await embedTexts([bizText], "edge-deals-embed"); if (v) await setEmbedding(finalId, v); } catch (e) { logError(e, { where: "edge-deals-embed" }); }
  }
  const fresh = await dealById(finalId);
  if (fresh) await syncLink(fresh.deal).catch((e) => logError(e, { where: "edge-deals-link" }));
  const now = new Date();
  await record(`deal:${finalId}`, [
    ...read.map((r) => ({ sourceName: `SEC EDGAR: ${r.form} for ${parties.targetName || d.deal.targetName || "the target"}`, sourceUrl: r.url, license: "US government work (SEC EDGAR)", method: `sections read: ${r.sections.slice(0, 8).join("; ") || "none located"}`.slice(0, 300), modelVersion: override.model, retrievedAt: now })),
    ...(facts ? [{ sourceName: "SEC XBRL company facts (the target's)", sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${parties.targetCik.padStart(10, "0")}.json`, license: "US government work (SEC EDGAR)", method: facts.source, modelVersion: "", retrievedAt: now }] : []),
    ...(computedPremium ? [{ sourceName: `Prices for ${parties.targetTicker}`, sourceUrl: "", license: "Market data (Nasdaq; FMP as backup)", method: `premium of the offer to the last close before ${announced} (${computedPremium.unaffected})`, modelVersion: "", retrievedAt: now }] : []),
  ]);
  out.costNote = `${out.sections} section${out.sections === 1 ? "" : "s"} read on ${override.model}`;
  return out;
}

type Parties = { targetName: string; acquirerName: string; targetCik: string; acquirerCik: string; targetTicker: string; targetNode: number | null; acquirerNode: number | null; sic: string };

/** The target and buyer as SEC registrants (from the parties the search named, matched by name) and graph nodes. */
async function resolveParties(d: { targetCik: string; acquirerCik: string; targetName: string; acquirerName: string; sources: { url: string }[]; sic: string; targetTicker: string }, targetName: string, acquirerName: string): Promise<Parties> {
  const listed = await listedByCik().catch(() => new Map<string, { ticker: string; name: string }>());
  const byName = (name: string) => {
    if (!name) return null;
    let bestCik = "", bestScore = 0;
    for (const [cik, row] of listed) { const s = nameScore(name, row.name).score; if (s > bestScore) { bestScore = s; bestCik = cik; } if (s >= 0.999) break; }
    return bestScore >= 0.92 ? bestCik : null;
  };
  const targetCik = d.targetCik || byName(targetName) || "";
  const acquirerCik = d.acquirerCik && d.acquirerCik !== targetCik ? d.acquirerCik : byName(acquirerName) || "";
  const tRow = targetCik ? listed.get(targetCik) : undefined, aRow = acquirerCik ? listed.get(acquirerCik) : undefined;
  const targetTicker = tRow?.ticker ?? d.targetTicker ?? "";
  const tNode = targetTicker ? await companyNode(targetTicker).catch(() => null) : null;
  const aNode = aRow?.ticker ? await companyNode(aRow.ticker).catch(() => null) : null;
  return { targetName: targetName || d.targetName, acquirerName: acquirerName || d.acquirerName, targetCik, acquirerCik, targetTicker, targetNode: tNode?.id ?? null, acquirerNode: aNode?.id ?? null, sic: d.sic };
}

/** The offer's premium to the last close before the announcement, when the target still has prices. */
async function premiumFromPrices(ticker: string, perShare: number | null, announced: string): Promise<{ premium: number; unaffected: number } | null> {
  if (!ticker || !perShare || !announced) return null;
  const from = new Date(Date.parse(announced) - 30 * 86_400_000).toISOString().slice(0, 10);
  const bars = await history(ticker, from);
  return premiumOf(perShare, bars.map((b) => ({ date: b.date, close: b.close })), new Date(`${announced}T00:00:00Z`));
}

