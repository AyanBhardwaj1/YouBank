/**
 * New Studio documents and template sheets, filled with SEC and market data. Server only: it fetches
 * company data. Key outputs are stored as workbook names (DCF_ev, COMPS_table...) so the agent and
 * the deck builders can find them after rows move.
 */
import { getCompanies, getCompanyData } from "@/lib/company";
import { derive } from "@/lib/metrics";
import { PEER_GROUPS } from "@/lib/static-data";
import type { CompanyData } from "@/lib/types";
import { buildLboDeck, buildValuationDeck } from "./deck";
import { uniqueSheetName } from "./ops";
import {
  ILLUSTRATIVE, blankSheet, buildCapTable, buildComps, buildDcf, buildLbo, buildMerger, buildSummary, finFrom, workbookOf,
  type Anchors, type CompRow, type Fin, type TemplateId,
} from "./templates";
import { emptyDeck, type Deck, type SheetData, type StudioDocData, type Workbook } from "./types";
import { buildCryptoComps, buildStakingYield, buildTokenDcf, buildTokenMultiples, isCryptoTemplate } from "./crypto-templates";
import { cryptoPeersFor, tokenFinFor } from "@/lib/crypto/studio-data";

export async function finFor(ticker?: string | null): Promise<Fin> {
  if (!ticker) return ILLUSTRATIVE;
  const c = await getCompanyData(ticker.toUpperCase());
  if (!c) throw new Error(`No SEC data found for ${ticker.toUpperCase()}. Check the ticker.`);
  return finFrom(c);
}

function compRow(c: CompanyData): CompRow {
  const d = derive(c);
  return { ticker: c.ticker, name: c.name, price: c.price?.last ?? null, marketCap: d.marketCap, netDebt: d.netDebt, revenue: c.ltm.revenue, ebitda: c.ltm.ebitda, growth: d.revenueGrowth };
}

/** Peers for a target: the ones given, or the saved peer group it belongs to. */
export async function peerRows(target: string, peers?: string[]): Promise<{ target: CompRow & { shares: number | null }; peers: CompRow[]; asOf: string; errors: string[] }> {
  const t = target.toUpperCase();
  const group = PEER_GROUPS.find((g) => g.members.some((m) => m.ticker === t));
  const list = (peers?.length ? peers.map((p) => p.toUpperCase()) : (group?.members.map((m) => m.ticker) ?? [])).filter((x) => x !== t).slice(0, 14);
  const res = await getCompanies([t, ...list]);
  const tc = res[t];
  if (!tc || "error" in tc) throw new Error(`No SEC data found for ${t}.`);
  const rows = list.map((x) => res[x]).filter((v): v is CompanyData => !!v && !("error" in v)).map(compRow);
  const errors = list.filter((x) => !res[x] || "error" in (res[x] as object)).map((x) => `${x}: no data`);
  return { target: { ...compRow(tc), shares: tc.balance.sharesOut }, peers: rows, asOf: tc.price?.asOf.slice(0, 10) ?? "", errors };
}

const namesFrom = (prefix: string, a: Anchors) => Object.fromEntries(Object.entries(a).map(([k, v]) => [`${prefix}_${k}`, v]));

/** Anchors of a template already in the workbook, read back from its names. */
export function anchorsFromNames(wb: Workbook, prefix: string): Anchors | undefined {
  const out: Anchors = {};
  for (const [k, v] of Object.entries(wb.names ?? {})) if (k.startsWith(`${prefix}_`)) out[k.slice(prefix.length + 1)] = v;
  return Object.keys(out).length ? out : undefined;
}

export type Built = { sheets: SheetData[]; names: Record<string, string>; deck: Deck | null; notes: string[]; title: string; fin: Fin };

/**
 * Build a template's sheets (and, for packs, a linked deck), naming sheets so they do not collide
 * with what `existing` already has.
 */
export async function buildTemplate(template: TemplateId, opts: { ticker?: string | null; peers?: string[]; acquirer?: string | null }, existing?: StudioDocData): Promise<Built> {
  const doc: StudioDocData = existing ?? { title: "", workbook: { order: [], sheets: {} }, deck: emptyDeck(), comments: [] };
  const name = (base: string) => uniqueSheetName(doc, base);
  // Crypto templates take a token, not a company: they never touch SEC data.
  if (isCryptoTemplate(template)) {
    const t = await tokenFinFor(opts.ticker);
    const label = t.illustrative ? "Illustrative token" : `${t.name} (${t.symbol})`;
    const b = template === "token_multiples" ? buildTokenMultiples(t, name("Token multiples"))
      : template === "token_dcf" ? buildTokenDcf(t, name("Token DCF"))
      : template === "staking_yield" ? buildStakingYield(t, name("Staking yield"))
      : buildCryptoComps(t, await cryptoPeersFor(t, opts.peers), name("Crypto comps"));
    const prefix = { token_multiples: "TOKMULT", token_dcf: "TOKDCF", staking_yield: "STAKE", crypto_comps: "CCOMPS" }[template];
    const what = { token_multiples: "token multiples", token_dcf: "token DCF", staking_yield: "staking yield", crypto_comps: "crypto comps" }[template];
    return { sheets: b.sheets, names: namesFrom(prefix, b.anchors), deck: null, notes: b.notes, title: `${label}: ${what}`, fin: ILLUSTRATIVE };
  }
  const fin = await finFor(opts.ticker);
  const label = fin.illustrative ? "Illustrative" : `${fin.name} (${fin.ticker})`;
  const notes: string[] = [];
  switch (template) {
    case "dcf": {
      const b = buildDcf(fin, name("DCF"));
      return { sheets: b.sheets, names: namesFrom("DCF", b.anchors), deck: null, notes: b.notes, title: `${label}: DCF`, fin };
    }
    case "comps": {
      if (!opts.ticker) throw new Error("Trading comps need a ticker.");
      const p = await peerRows(opts.ticker, opts.peers);
      if (p.errors.length) notes.push(`Skipped peers without data: ${p.errors.join(", ")}.`);
      const b = buildComps(p.target, p.peers, name("Comps"), p.asOf);
      return { sheets: b.sheets, names: namesFrom("COMPS", b.anchors), deck: null, notes, title: `${label}: trading comps`, fin };
    }
    case "valuation": {
      const dcf = buildDcf(fin, name("DCF"));
      let comps: ReturnType<typeof buildComps> | null = null;
      if (opts.ticker) {
        const p = await peerRows(opts.ticker, opts.peers);
        if (p.errors.length) notes.push(`Skipped peers without data: ${p.errors.join(", ")}.`);
        const tmp: StudioDocData = { ...doc, workbook: { ...doc.workbook, order: [...doc.workbook.order, dcf.sheets[0].id], sheets: { ...doc.workbook.sheets, [dcf.sheets[0].id]: dcf.sheets[0] } } };
        comps = buildComps(p.target, p.peers, uniqueSheetName(tmp, "Comps"), p.asOf);
      }
      const summaryName = uniqueSheetName({ ...doc, workbook: { order: [...doc.workbook.order, ...dcf.sheets.map((s) => s.id), ...(comps?.sheets.map((s) => s.id) ?? [])], sheets: { ...doc.workbook.sheets, ...Object.fromEntries([...dcf.sheets, ...(comps?.sheets ?? [])].map((s) => [s.id, s])) } } }, "Summary");
      const sum = buildSummary(fin, dcf.anchors, comps?.anchors ?? null, summaryName);
      const sheets = [...sum.sheets, ...dcf.sheets, ...(comps?.sheets ?? [])];
      const wb = workbookOf([...doc.workbook.order.map((id) => doc.workbook.sheets[id]), ...sheets]);
      const deck = buildValuationDeck(fin, wb, { dcf: dcf.anchors, comps: comps?.anchors, summary: sum.anchors });
      return { sheets, names: { ...namesFrom("DCF", dcf.anchors), ...(comps ? namesFrom("COMPS", comps.anchors) : {}), ...namesFrom("SUMMARY", sum.anchors) }, deck, notes: [...notes, ...dcf.notes], title: `${label}: valuation`, fin };
    }
    case "lbo": {
      const b = buildLbo(fin, name("LBO"));
      const wb = workbookOf([...doc.workbook.order.map((id) => doc.workbook.sheets[id]), ...b.sheets]);
      return { sheets: b.sheets, names: namesFrom("LBO", b.anchors), deck: buildLboDeck(fin, wb, b.anchors), notes: b.notes, title: `${label}: LBO`, fin };
    }
    case "merger": {
      const acq = await finFor(opts.acquirer ?? null);
      const b = buildMerger(opts.acquirer ? acq : { ...ILLUSTRATIVE, ticker: "ACQ", name: "Acquirer Co.", price: 60, shares: 400, netIncome: 1200 }, fin, name("Merger"));
      return { sheets: b.sheets, names: namesFrom("MERGER", b.anchors), deck: null, notes: b.notes, title: `${opts.acquirer ? acq.ticker : "Acquirer"} / ${fin.ticker}: merger model`, fin };
    }
    case "cap_table": {
      const b = buildCapTable(name("Cap table"));
      return { sheets: b.sheets, names: namesFrom("CAP", b.anchors), deck: null, notes: [], title: "Financing round and cap table", fin };
    }
    case "blank":
    default:
      return { sheets: [blankSheet(name("Sheet1"))], names: {}, deck: null, notes: [], title: "Untitled model", fin };
  }
}

/** A whole new document from a template. */
export async function newDocument(template: TemplateId, opts: { ticker?: string | null; peers?: string[]; acquirer?: string | null; title?: string }): Promise<StudioDocData & { notes: string[] }> {
  const b = await buildTemplate(template, opts);
  const workbook = workbookOf(b.sheets, Object.keys(b.names).length ? b.names : undefined);
  return { title: opts.title || b.title, workbook, deck: b.deck ?? emptyDeck(), comments: [], notes: b.notes };
}
