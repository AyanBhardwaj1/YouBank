/**
 * Practice and demo data: fully fictional companies. Names and tickers are checked against every
 * listed company so none is real. Five years of financials come from the joint distribution of real
 * energy companies' ratios (a Gaussian copula over SEC XBRL frames, so the numbers look like the
 * industry without being any company's), three years of daily prices from a factor model driven by
 * resampled real market days, and a short overview and earnings-call excerpt written for each company,
 * added to the person's library as practice documents. Everything says "fictional".
 */
import ExcelJS from "exceljs";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { tickerByName, tickerMap } from "@/lib/edgar/tickers";
import { logError } from "@/lib/errors";
import { frameAny, lastFullYear } from "@/lib/market/frames";
import { passagesFromPages } from "../docs/chunk";
import { indexPassages, upsertDoc } from "../docs/store";
import { putObject, r2Ready } from "../infra/r2";
import { energyUniverse } from "../graph/universe";
import { small } from "../models";
import { factorHistory } from "./data";
import { normals, rng } from "./stats";
import { copulaSynth, type TableIn } from "./tables";

export type Sector = "midstream" | "upstream" | "refining" | "mixed";
export type PracticeSpec = { count: number; sector: Sector; seed: number; docs: boolean };
export type PracticeCompany = { name: string; ticker: string; sector: string; hq: string; description: string; segments: string[] };
export type PracticeKit = {
  kind: "practice"; synthetic: true; fictional: true; title: string; seed: number; recipe: string;
  companies: PracticeCompany[]; financials: TableIn; prices: TableIn; docs: { id: number; title: string }[]; fileId: number | null; basis: number;
};

const SECTOR_SICS: Record<Sector, string[]> = { midstream: ["4610", "4922", "4923", "5171"], upstream: ["1311", "1381", "1382", "1389"], refining: ["2911", "5172"], mixed: [] };
const ENERGY_BETA: Record<Sector, [number, number]> = { midstream: [0.5, 0.9], upstream: [0.9, 1.4], refining: [0.7, 1.1], mixed: [0.5, 1.4] };

/** Real ratios of listed energy companies for the last full year: the distribution fictional ones are drawn from. */
async function realRatios(sector: Sector): Promise<{ rows: number[][]; n: number }> {
  const y = lastFullYear();
  const [rev, op, net, assets, liab] = await Promise.all([
    frameAny(["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"], `CY${y}`),
    frameAny(["OperatingIncomeLoss"], `CY${y}`), frameAny(["NetIncomeLoss"], `CY${y}`),
    frameAny(["Assets"], `CY${y}Q4I`), frameAny(["Liabilities"], `CY${y}Q4I`),
  ]);
  const universe = await energyUniverse().catch(() => []);
  const want = SECTOR_SICS[sector];
  const ciks = universe.filter((m) => !want.length || want.includes(m.sic)).map((m) => m.cik);
  const rowsFor = (list: string[]) => list.flatMap((c) => {
    const r = rev.values[c], a = assets.values[c], o = op.values[c], nI = net.values[c], l = liab.values[c];
    if (!(r > 5e7) || !(a > 0) || o === undefined || nI === undefined || l === undefined) return [];
    return [[Math.log10(r), Math.max(-0.5, Math.min(0.6, o / r)), Math.max(-0.6, Math.min(0.5, nI / r)), Math.max(0.1, Math.min(1.2, l / a)), Math.max(0.05, Math.min(3, r / a))]];
  });
  let rows = rowsFor(ciks);
  if (rows.length < 15) rows = rowsFor(universe.map((m) => m.cik));
  return { rows, n: rows.length };
}

const Profiles = z.object({
  companies: z.array(z.object({
    name: z.string().describe("an invented company name that no real company uses"), ticker: z.string().describe("an invented 3 or 4 letter ticker"),
    hq: z.string().describe("a real U.S. city and state"), description: z.string().describe("two sentences on what it does"), segments: z.array(z.string()).max(3),
  })),
});
const Docs = z.object({ overview: z.string().describe("about 200 words: a company overview"), call: z.string().describe("about 250 words: an excerpt of the latest earnings call, with invented executives and analysts") });

export async function practiceKit(userId: string, spec: PracticeSpec): Promise<PracticeKit> {
  const count = Math.max(3, Math.min(12, spec.count));
  const sectorWord = spec.sector === "mixed" ? "energy" : spec.sector;
  // 1. Fictional profiles, checked against every listed company.
  const r = await structured(Profiles, "edge-scen-practice", `You invent fictional ${sectorWord} companies for practice data. Every name and ticker must be made up; never use or echo a real company's name.`,
    `Invent ${count + 3} distinct ${sectorWord} companies (U.S.).`, { override: small(), maxTokens: 1800, timeoutMs: 60_000 });
  const map = await tickerMap();
  const companies: PracticeCompany[] = [];
  for (const c of r.data.companies) {
    if (companies.length >= count) break;
    const tk = c.ticker.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    if (!tk || map.has(tk) || companies.some((x) => x.ticker === tk)) continue;
    if (await tickerByName(c.name).catch(() => null)) continue;
    companies.push({ name: c.name, ticker: tk, sector: sectorWord, hq: c.hq, description: c.description, segments: c.segments });
  }
  if (!companies.length) throw Object.assign(new Error("Could not invent names that no real company uses; try again."), { status: 502 });
  // 2. Financials from the real distribution of ratios.
  const real = await realRatios(spec.sector);
  const basis: TableIn = { columns: ["logRevenue", "operatingMargin", "netMargin", "leverage", "turnover"].map((name) => ({ name, type: "num" as const })), rows: real.rows };
  const draw = copulaSynth(basis, companies.length, spec.seed).rows as number[][];
  const u = rng(spec.seed + 11), n = normals(u);
  const thisYear = new Date().getUTCFullYear();
  const fin: (string | number)[][] = [];
  companies.forEach((c, i) => {
    const [lr, om, nm, lev, turn] = draw[i];
    let revenue = 10 ** lr;
    for (let y = 5; y >= 1; y--) {
      const year = thisYear - y;
      const g = 0.04 + 0.12 * n();
      if (y < 5) revenue *= 1 + g;
      const opM = om + 0.02 * n(), netM = Math.min(opM, nm + 0.02 * n());
      const assets = revenue / turn, liabilities = assets * Math.max(0.1, Math.min(1.1, lev + 0.03 * n()));
      fin.push([c.name, c.ticker, year, Math.round(revenue / 1e6), Math.round((revenue * opM) / 1e6), Math.round((revenue * netM) / 1e6), Math.round(assets / 1e6), Math.round(liabilities / 1e6), Math.round((assets - liabilities) / 1e6)]);
    }
  });
  const financials: TableIn = { title: "Fictional financials ($ millions)", columns: [{ name: "Company", type: "text" }, { name: "Ticker", type: "cat" }, { name: "Year", type: "num" }, { name: "Revenue", type: "num" }, { name: "Operating income", type: "num" }, { name: "Net income", type: "num" }, { name: "Total assets", type: "num" }, { name: "Total liabilities", type: "num" }, { name: "Equity", type: "num" }], rows: fin, synthetic: { recipe: `FICTIONAL. Ratios drawn by a Gaussian copula from ${real.n} listed ${sectorWord} companies' FY${lastFullYear()} XBRL data (revenue size, margins, leverage, asset turnover); revenue then grows about 4% a year with 12% volatility.`, seed: spec.seed } };
  // 3. Prices: the market and oil and gas stocks' real days, resampled, through each company's betas.
  const factors = (await factorHistory()).slice(-1500);
  const [bLo, bHi] = ENERGY_BETA[spec.sector];
  const days = 756;
  const priceRows: (string | number)[][] = [], daily: (string | number)[][] = [];
  companies.forEach((c) => {
    const bm = 0.3 + 0.4 * u(), be = bLo + (bHi - bLo) * u(), idio = 0.012 + 0.01 * u();
    let price = 15 + 70 * u();
    const start = Date.UTC(thisYear - 3, 0, 2);
    for (let d = 0; d < days; d++) {
      const f = factors[Math.floor(u() * factors.length)];
      price *= Math.exp(bm * f.market + be * f.energy + idio * n());
      const date = new Date(start + Math.floor((d * 7) / 5) * 86_400_000).toISOString().slice(0, 10);
      daily.push([c.ticker, date, Math.round(price * 100) / 100]);
      if (d % 21 === 20) priceRows.push([c.ticker, date.slice(0, 7), Math.round(price * 100) / 100]);
    }
  });
  const prices: TableIn = { title: "Fictional month-end prices", columns: [{ name: "Ticker", type: "cat" }, { name: "Month", type: "cat" }, { name: "Close", type: "num" }], rows: priceRows, synthetic: { recipe: `FICTIONAL. Daily prices from resampled real days of the U.S. market and oil and gas stocks (Kenneth French's CRSP data) through invented betas, plus idiosyncratic noise.`, seed: spec.seed } };
  // 4. Practice documents, labeled and searchable.
  const docs: { id: number; title: string }[] = [];
  if (spec.docs) {
    for (const c of companies.slice(0, 6)) {
      try {
        const last = fin.filter((x) => x[1] === c.ticker).slice(-1)[0];
        const d = await structured(Docs, "edge-scen-practice-docs", "You write practice documents for a fictional company. Everything is invented: people, numbers and events. Use the figures given.",
          `${c.name} (${c.ticker}), ${c.hq}: ${c.description} Segments: ${c.segments.join(", ")}. Last year: revenue $${last[3]}M, operating income $${last[4]}M, net income $${last[5]}M.`, { override: small(), maxTokens: 1200, timeoutMs: 60_000 });
        for (const [kind, text] of [["overview", d.data.overview], ["earnings call", d.data.call]] as const) {
          const title = `[Fictional] ${c.name}: ${kind}`;
          const doc = await upsertDoc({ ownerId: userId, source: "upload", externalId: `practice:${spec.seed}:${c.ticker}:${kind}`, title, mime: "text/plain", meta: { practice: true, fictional: true, ticker: c.ticker } });
          await indexPassages(doc.id, passagesFromPages([{ n: 1, text: `FICTIONAL PRACTICE DOCUMENT. ${text}` }]));
          docs.push({ id: doc.id, title });
        }
      } catch (e) { logError(e, { where: "edge-scen-practice-docs" }); }
    }
  }
  // 5. A workbook to download.
  let fileId: number | null = null;
  if (r2Ready()) {
    const wb = new ExcelJS.Workbook();
    const note = wb.addWorksheet("README");
    note.addRow(["FICTIONAL PRACTICE DATA. None of these companies, people or numbers are real."]);
    note.addRow([financials.synthetic!.recipe]); note.addRow([prices.synthetic!.recipe]); note.addRow([`Seed ${spec.seed}`]);
    const add = (name: string, cols: string[], rows: (string | number)[][]) => { const ws = wb.addWorksheet(name); ws.addRow(cols).font = { bold: true }; for (const row of rows) ws.addRow(row); };
    add("Companies", ["Company", "Ticker", "Sector", "Headquarters", "Description", "Segments"], companies.map((c) => [c.name, c.ticker, c.sector, c.hq, c.description, c.segments.join("; ")]));
    add("Financials", financials.columns.map((c) => c.name), fin);
    add("Daily prices", ["Ticker", "Date", "Close"], daily);
    const body = new Uint8Array(await wb.xlsx.writeBuffer());
    const key = `exports/practice/${userId.slice(0, 12)}-${spec.seed}-${Date.now()}.xlsx`;
    await putObject(key, body, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const [row] = await requireDb().insert(schema.edgeFiles).values({ ownerId: userId, kind: "export", name: `fictional-${sectorWord}-practice-data.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: body.byteLength, r2Key: key, status: "ready", meta: { fictional: true, seed: spec.seed } }).returning({ id: schema.edgeFiles.id });
    fileId = row.id;
  }
  return {
    kind: "practice", synthetic: true, fictional: true, title: `${companies.length} fictional ${sectorWord} companies`, seed: spec.seed,
    recipe: `FICTIONAL practice data: invented names checked against every listed company; financials drawn from ${real.n} real companies' ratios; prices from resampled real market days; ${docs.length} practice documents.`,
    companies, financials, prices, docs, fileId, basis: real.n,
  };
}
