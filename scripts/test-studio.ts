/**
 * Studio engine tests: the formula language, the function library against Excel's documented
 * results, number formats, the dependency graph, what-if tables, templates, the audit, the deck and
 * the file round trips.   pnpm exec tsx scripts/test-studio.ts
 */
import { Engine } from "@/lib/studio/engine";
import { parse, renameSheetInFormula, shiftFormula, translateFormula } from "@/lib/studio/formula";
import { formatValue } from "@/lib/studio/format";
import { isErr, type Prim } from "@/lib/studio/values";
import type { CellData, Workbook } from "@/lib/studio/types";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};
const near = (a: Prim, b: number, tol = 1e-6) => typeof a === "number" && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

function book(cells: Record<string, string | number | boolean | null>, extra: Record<string, Record<string, string | number>> = {}): Engine {
  const toCell = (v: string | number | boolean | null): CellData => (typeof v === "string" && v.startsWith("=") ? { f: v.slice(1) } : { v });
  const wb: Workbook = { order: ["s1"], sheets: { s1: { id: "s1", name: "Model", cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, toCell(v)])) } } };
  let i = 2;
  for (const [name, cs] of Object.entries(extra)) {
    const id = `s${i++}`;
    wb.order.push(id);
    wb.sheets[id] = { id, name, cells: Object.fromEntries(Object.entries(cs).map(([k, v]) => [k, toCell(v)])) };
  }
  return new Engine(wb);
}
const ev = (f: string, cells: Record<string, string | number | boolean | null> = {}) => book(cells).evaluate(f, "s1", "Z100");

/* ---------------- Parsing and precedence ---------------- */
check("-2^2 is 4 (negation binds tighter)", ev("-2^2") === 4);
check("2^3^2 is 64 (left-associative)", ev("2^3^2") === 64);
check("1+2*3", ev("1+2*3") === 7);
check("(1+2)*3", ev("(1+2)*3") === 9);
check("5% is 0.05", near(ev("5%"), 0.05));
check("text join", ev("\"a\"&\"b\"&1") === "ab1");
check("comparison", ev("1<2") === true && ev("\"a\"=\"A\"") === true);
check("divide by zero", isErr(ev("1/0")) && (ev("1/0") as { code: string }).code === "#DIV/0!");
check("LOG10 is a function, not a cell", near(ev("LOG10(1000)"), 3));
check("sheet-qualified refs parse", (() => { const n = parse("'My Sheet'!A1+Other!$B$2"); return n.k === "bin"; })());
check("syntax error", isErr(ev("1+")));

/* ---------------- Maths and aggregation ---------------- */
check("SUM skips text in ranges, coerces direct text", ev("SUM(A1:A3)", { A1: 1, A2: "x", A3: 2 }) === 3 && ev("SUM(\"5\",1)") === 6);
check("AVERAGE", ev("AVERAGE(A1:A4)", { A1: 1, A2: 2, A3: 3, A4: 6 }) === 3);
check("ROUND half away from zero", ev("ROUND(2.5,0)") === 3 && ev("ROUND(-2.5,0)") === -3 && ev("ROUND(1.005,2)") === 1.01);
check("ROUNDUP/ROUNDDOWN", ev("ROUNDUP(3.2,0)") === 4 && ev("ROUNDDOWN(-3.7,0)") === -3);
check("MOD takes the divisor's sign", ev("MOD(-3,2)") === 1);
check("SUMPRODUCT with a condition", ev("SUMPRODUCT((A1:A3>1)*B1:B3)", { A1: 1, A2: 2, A3: 3, B1: 10, B2: 20, B3: 30 }) === 50);
check("SUMIFS", ev("SUMIFS(B1:B4,A1:A4,\"x\",C1:C4,\">1\")", { A1: "x", A2: "x", A3: "y", A4: "x", B1: 1, B2: 2, B3: 4, B4: 8, C1: 1, C2: 2, C3: 3, C4: 3 }) === 10);
check("COUNTIF wildcard", ev("COUNTIF(A1:A3,\"Sa*\")", { A1: "SaaS", A2: "Salt", A3: "Fin" }) === 2);
check("COUNTIF numeric criterion", ev("COUNTIF(A1:A4,\">=2\")", { A1: 1, A2: 2, A3: 3, A4: "x" }) === 2);
check("MEDIAN, QUARTILE", ev("MEDIAN(A1:A4)", { A1: 1, A2: 9, A3: 3, A4: 5 }) === 4 && near(ev("QUARTILE(A1:A4,1)", { A1: 1, A2: 9, A3: 3, A4: 5 }), 2.5));
check("STDEV.S", near(ev("STDEV.S(A1:A4)", { A1: 2, A2: 4, A3: 4, A4: 6 }), 1.632993161855452));
check("RANK.EQ", ev("RANK.EQ(5,A1:A4)", { A1: 1, A2: 9, A3: 3, A4: 5 }) === 2);

/* ---------------- Logic ---------------- */
check("IF", ev("IF(1>2,\"a\",\"b\")") === "b");
check("IFERROR", ev("IFERROR(1/0,\"n/a\")") === "n/a");
check("AND/OR over ranges", ev("AND(A1:A2)", { A1: true, A2: 1 }) === true && ev("OR(A1:A2)", { A1: false, A2: 0 }) === false);
check("IFS and SWITCH", ev("IFS(1>2,\"a\",2>1,\"b\")") === "b" && ev("SWITCH(2,1,\"one\",2,\"two\")") === "two");

/* ---------------- Lookup ---------------- */
const table = { A1: "Apple", B1: 10, A2: "Banana", B2: 20, A3: "Cherry", B3: 30, D1: 1, D2: 5, D3: 10, E1: "low", E2: "mid", E3: "high" };
check("VLOOKUP exact", ev("VLOOKUP(\"banana\",A1:B3,2,FALSE)", table) === 20);
check("VLOOKUP approximate", ev("VLOOKUP(7,D1:E3,2)", table) === "mid");
check("INDEX/MATCH", ev("INDEX(B1:B3,MATCH(\"Cherry\",A1:A3,0))", table) === 30);
check("XLOOKUP with not-found", ev("XLOOKUP(\"Kiwi\",A1:A3,B1:B3,\"none\")", table) === "none" && ev("XLOOKUP(\"Apple\",A1:A3,B1:B3)", table) === 10);
check("XLOOKUP next smaller", ev("XLOOKUP(7,D1:D3,E1:E3,,-1)", table) === "mid");
check("MATCH not found is #N/A", isErr(ev("MATCH(\"Kiwi\",A1:A3,0)", table)));
check("OFFSET", ev("SUM(OFFSET(B1,1,0,2,1))", table) === 50);
check("INDIRECT", ev("INDIRECT(\"B\"&2)", table) === 20);

/* ---------------- Finance (Excel's documented examples) ---------------- */
check("NPV", near(ev("NPV(10%,-10000,3000,4200,6800)"), 1188.4434123352207, 1e-9));
check("IRR", near(ev("IRR(A1:A6)", { A1: -70000, A2: 12000, A3: 15000, A4: 18000, A5: 21000, A6: 26000 }), 0.0866309480365, 1e-8));
const xflows = { A1: -10000, A2: 2750, A3: 4250, A4: 3250, A5: 2750, B1: "=DATE(2008,1,1)", B2: "=DATE(2008,3,1)", B3: "=DATE(2008,10,30)", B4: "=DATE(2009,2,15)", B5: "=DATE(2009,4,1)" };
check("XNPV", near(ev("XNPV(0.09,A1:A5,B1:B5)", xflows), 2086.647602, 1e-7));
check("XIRR", near(ev("XIRR(A1:A5,B1:B5)", xflows), 0.373362535, 1e-7));
check("MIRR", near(ev("MIRR(A1:A6,10%,12%)", { A1: -120000, A2: 39000, A3: 30000, A4: 21000, A5: 37000, A6: 46000 }), 0.126094, 1e-5));
check("PMT", near(ev("PMT(8%/12,10,10000)"), -1037.0320893591606, 1e-9));
check("FV", near(ev("FV(6%/12,10,-200,-500,1)"), 2581.4033740601, 1e-9));
check("PV", near(ev("PV(8%/12,12*20,500)"), -59777.14585118638, 1e-9));
check("IPMT", near(ev("IPMT(10%/12,1,36,8000)"), -66.66666666666667, 1e-9));
check("PPMT", near(ev("PPMT(10%/12,1,24,2000)"), -75.62318600836664, 1e-9));
check("NPER", near(ev("NPER(12%/12,-100,-1000,10000,1)"), 59.6738656742946, 1e-8));
check("RATE", near(ev("RATE(4*12,-200,8000)"), 0.00770147248820165, 1e-7));
check("EFFECT", near(ev("EFFECT(5.25%,4)"), 0.0535426673707584, 1e-9));
check("RRI (CAGR)", near(ev("RRI(5,100,200)"), Math.pow(2, 0.2) - 1));

/* ---------------- Dates and text ---------------- */
check("DATE serial", ev("DATE(2026,9,30)") === 46295);
check("EOMONTH and EDATE clamp to month end", ev("EOMONTH(DATE(2026,1,31),1)") === 46081 && ev("EDATE(DATE(2026,1,31),1)") === 46081);
check("YEAR/MONTH/DAY", ev("YEAR(46295)") === 2026 && ev("MONTH(46295)") === 9 && ev("DAY(46295)") === 30);
check("YEARFRAC 30/360", near(ev("YEARFRAC(DATE(2026,1,1),DATE(2026,7,1))"), 0.5));
check("TEXT formats", ev("TEXT(0.1234,\"0.0%\")") === "12.3%" && ev("TEXT(1234.5,\"#,##0.0\")") === "1,234.5" && ev("TEXT(8.456,\"0.0\"\"x\"\"\")") === "8.5x");
check("LEFT/MID/SUBSTITUTE/SEARCH", ev("LEFT(\"Ledgerline\",6)") === "Ledger" && ev("MID(\"abcdef\",2,3)") === "bcd" && ev("SUBSTITUTE(\"a-b-c\",\"-\",\"+\")") === "a+b+c" && ev("SEARCH(\"LINE\",\"Ledgerline\")") === 7);
check("TEXTJOIN", ev("TEXTJOIN(\", \",TRUE,A1:A3)", { A1: "a", A2: null, A3: "c" }) === "a, c");

/* ---------------- Number formats ---------------- */
const fmt = (v: Prim, nf: string) => formatValue(v, nf).text;
check("accounting negative in parentheses", fmt(-1234.5, "#,##0.0_);(#,##0.0)") === "(1,234.5)" && fmt(1234.5, "#,##0.0_);(#,##0.0)") === "1,234.5 ");
check("scaling commas (millions)", fmt(12345678, "#,##0.0,,") === "12.3");
check("currency and rounding", fmt(1234.5, "$#,##0") === "$1,235");
check("multiples", fmt(8.456, "0.0x") === "8.5x");
check("percent", fmt(0.1234, "0.0%") === "12.3%");
check("dates", fmt(46295, "yyyy-mm-dd") === "2026-09-30" && fmt(46295, "mmm-yy") === "Sep-26");
check("General", fmt(1 / 3, "General") === "0.333333333" && fmt(1234567, "General") === "1234567");
check("red negatives", formatValue(-5, "0;[Red]-0").color === "#C00000");

/* ---------------- The graph ---------------- */
{
  const e = book({ A1: "=B1", B1: "=A1" });
  check("a pure cycle settles at zero under iterative calculation", e.get("s1", "A1") === 0 && e.isCyclic("s1", "A1"));
  const cells: Record<string, string | number> = { A1: 1 };
  for (let i = 2; i <= 6000; i++) cells[`A${i}`] = `=A${i - 1}+1`;
  const deep = book(cells);
  check("a 6,000-deep chain evaluates without exhausting the stack", deep.get("s1", "A6000") === 6000);
  deep.setCell("s1", "A1", { v: 10 });
  check("an edit at the top flows to the bottom", deep.get("s1", "A6000") === 6009);
  const x = book({ A1: 2, A2: 3, A3: "=SUM(A1:A2)", B1: "=A3*2" }, { Other: { A1: "=Model!B1+1" } });
  check("cross-sheet reference", x.get("s2", "A1") === 11);
  x.setCell("s1", "A1", { v: 5 });
  check("incremental recalculation through a range and a sheet", x.get("s2", "A1") === 17);
  check("implicit intersection", book({ A1: 1, A2: 2, A3: 3, C3: "=A:A" }).get("s1", "C3") === 3);
  check("whole-column SUM", book({ A1: 1, A2: 2, A7: 4, B1: "=SUM(A:A)" }).get("s1", "B1") === 7);
  const t = book({ A1: 2, B1: 3, C1: "=A1*B1" });
  const grid = t.table("s1", "C1", "A1", "B1", [1, 2], [10, 20]);
  check("two-way data table", JSON.stringify(grid) === JSON.stringify([[10, 20], [20, 40]]) && t.get("s1", "C1") === 6);
  const g = book({ A1: 1, B1: "=A1^2" }).goalSeek("s1", "B1", 2, "A1");
  check("goal seek", !!g && Math.abs(g.value - Math.SQRT2) < 1e-6);
  const imported = new Engine({ order: ["s1"], sheets: { s1: { id: "s1", name: "M", cells: { A1: { f: "FORECAST.ETS(1,2,3)", cv: 42 } } } } });
  check("an unsupported function shows the file's cached value", imported.get("s1", "A1") === 42);
}

/* ---------------- Formula rewriting ---------------- */
check("fill right and down", translateFormula("A1+$B$1+B$2+$C3", 1, 1) === "B2+$B$1+C$2+$C4");
check("insert rows shifts references below", shiftFormula("SUM(A1:A10)+A12", "Model", "Model", "r", 5, 2) === "SUM(A1:A12)+A14");
check("delete rows that held a reference gives #REF!", shiftFormula("A5+A9", "Model", "Model", "r", 5, -1) === "#REF!+A8");
check("other sheets are untouched", shiftFormula("Other!A9+A9", "Model", "Model", "r", 5, 1) === "Other!A9+A10");
check("rename a sheet in formulas", renameSheetInFormula("DCF!C5+'DCF'!D6+Other!A1", "DCF", "Valuation") === "Valuation!C5+Valuation!D6+Other!A1");

/* ---------------- Iterative calculation ---------------- */
{
  const circ = book({ A1: "=100+0.1*B1", B1: "=A1" });
  check("a circular reference converges iteratively", near(circ.get("s1", "A1"), 111.1111, 1e-4) && !!circ.cycleInfo("s1", "A1")?.converged);
  const off = new Engine({ order: ["s1"], sheets: { s1: { id: "s1", name: "M", cells: { A1: { f: "100+0.1*B1" }, B1: { f: "A1" } } } }, calc: { iterative: false } });
  check("with iterative calculation off it is #CYCLE!", (off.get("s1", "A1") as { code?: string })?.code === "#CYCLE!");
  circ.setCell("s1", "A1", { f: "200+0.1*B1" });
  check("editing a circular model re-solves it", near(circ.get("s1", "A1"), 222.2222, 1e-4));
}

/* ---------------- Templates ---------------- */
import { ILLUSTRATIVE, buildCapTable, buildComps, buildDcf, buildLbo, buildMerger, buildSummary, workbookOf, type Fin } from "@/lib/studio/templates";
import { auditWorkbook, bankerFormat } from "@/lib/studio/audit";
import { applyPatch, fillRange, refreshSensitivities, renameSheet, shiftCells, writeRange, deleteSheet, type Patch } from "@/lib/studio/ops";
import { buildLboDeck, buildValuationDeck, el, resolveChart, resolveTable, tieOut } from "@/lib/studio/deck";
import { emptyDeck, type StudioDocData } from "@/lib/studio/types";

const docOf = (sheets: ReturnType<typeof buildDcf>["sheets"]): StudioDocData => ({ title: "t", workbook: workbookOf(sheets), deck: emptyDeck(), comments: [] });
const sheetId = (d: StudioDocData, name: string) => d.workbook.order.find((x) => d.workbook.sheets[x].name === name)!;
const errorsOf = (e: Engine) => auditWorkbook(e).filter((i) => i.severity === "error");

{
  const dcf = buildDcf(ILLUSTRATIVE);
  const doc = docOf(dcf.sheets);
  const e = new Engine(doc.workbook);
  const id = sheetId(doc, "DCF");
  const px = e.get(id, "C53"), wacc = e.get(id, "C39"), tv = e.get(id, "C55");
  check("DCF: implied price is a positive number", typeof px === "number" && px > 0, px);
  check("DCF: WACC is sensible", typeof wacc === "number" && wacc > 0.05 && wacc < 0.15, wacc);
  check("DCF: terminal value share of EV is between 0 and 1", typeof tv === "number" && tv > 0 && tv < 1, tv);
  check("DCF: the sensitivity centre equals the implied price", near(e.get(id, "E63"), px as number, 1e-9), [e.get(id, "E63"), px]);
  const audit = auditWorkbook(e);
  check("DCF: the audit finds no errors or typed-in numbers", !audit.some((i) => i.severity === "error" || i.kind === "hardcoded_number" || i.kind === "inconsistent_formula"), audit.slice(0, 5));
  const g = e.goalSeek(id, "C53", ILLUSTRATIVE.price, "C30");
  check("goal seek: the beta that makes the DCF price equal the market price", !!g && near(e.withOverrides({ [`${id}!C30`]: g!.value }, () => e.get(id, "C53")), ILLUSTRATIVE.price, 1e-6), g);
  const neg: Fin = { ...ILLUSTRATIVE, ebitda: -40, revenue: 800, priorRevenue: 600 };
  const dn = docOf(buildDcf(neg).sheets);
  const en = new Engine(dn.workbook);
  check("DCF: a loss-making company still values without errors", typeof en.get(sheetId(dn, "DCF"), "C53") === "number" && errorsOf(en).length === 0, errorsOf(en).slice(0, 3));
}

{
  const peers = [
    { ticker: "AAA", name: "Alpha", price: 50, marketCap: 5000, netDebt: 500, revenue: 1000, ebitda: 200, growth: 0.1 },
    { ticker: "BBB", name: "Beta", price: 20, marketCap: 2000, netDebt: -100, revenue: 400, ebitda: -10, growth: 0.3 },
    { ticker: "CCC", name: "Gamma", price: 80, marketCap: 9000, netDebt: 1000, revenue: 1500, ebitda: 450, growth: 0.05 },
    { ticker: "DDD", name: "Delta", price: 10, marketCap: 1200, netDebt: 0, revenue: 300, ebitda: 60, growth: 0.15 },
  ];
  const target = { ticker: "TGT", name: "Target Co.", price: 25, marketCap: 2500, netDebt: 150, revenue: 1000, ebitda: 180, growth: 0.15, shares: 100 };
  const comps = buildComps(target, peers);
  const dcf = buildDcf(ILLUSTRATIVE);
  const sum = buildSummary(ILLUSTRATIVE, dcf.anchors, comps.anchors);
  const doc = docOf([...dcf.sheets, ...comps.sheets, ...sum.sheets]);
  const e = new Engine(doc.workbook);
  const cid = sheetId(doc, "Comps");
  const medRev = e.evaluate("MEDIAN(K5:K8)", cid);
  check("comps: EV / revenue median", near(medRev, [5.5, 4.75, 6.6667, 4.0].sort((a, b) => a - b).slice(1, 3).reduce((a, b) => a + b) / 2, 1e-3), medRev);
  check("comps: a negative EBITDA multiple is NM", e.get(cid, "L6") === "NM");
  const lo = e.evaluate(comps.anchors.revPriceLow, cid), mid = e.evaluate(comps.anchors.revPriceLow.replace(/I(\d+)$/, "J$1"), cid), hi = e.evaluate(comps.anchors.revPriceHigh, cid);
  check("comps: implied price low ≤ mid ≤ high", typeof lo === "number" && typeof mid === "number" && typeof hi === "number" && lo <= mid && mid <= hi, [lo, mid, hi]);
  const sid = sheetId(doc, "Summary");
  check("summary: every football-field range resolves", e.read(sid, "B5:C8").flat().every((v) => typeof v === "number"), e.read(sid, "B5:C8"));
  check("comps + DCF + summary: no errors", errorsOf(e).length === 0, errorsOf(e).slice(0, 3));

  const deck = buildValuationDeck(ILLUSTRATIVE, doc.workbook, { dcf: dcf.anchors, comps: comps.anchors, summary: sum.anchors });
  doc.deck = deck;
  check("deck: six slides", deck.order.length === 6, deck.order.length);
  const compsSlide = deck.slides[deck.order[2]];
  const table = compsSlide.elements[0].type === "table" ? resolveTable(compsSlide.elements[0].link!, e) : null;
  check("deck: the comps table resolves from the model", !!table && table.length >= 8 && table[1][0].text === "Alpha", table?.[1]?.[0]);
  const ffSlide = deck.slides[deck.order[4]];
  const ff = ffSlide.elements[0].type === "chart" ? resolveChart(ffSlide.elements[0], e) : null;
  check("deck: the football field reads low and high from the summary", !!ff && ff.series.length === 2 && ff.labels.length === 4, ff);
  check("deck: tie-out is clean for a fully linked deck", tieOut(deck, e).filter((i) => i.severity === "error").length === 0, tieOut(deck, e).slice(0, 3));
  const priceText = e.display(sheetId(doc, "DCF"), "C53").text.trim();
  compsSlide.elements.push(el({ type: "text", x: 1, y: 1, w: 4, h: 1, text: `Implied price of ${priceText}, a premium of 999.9% and EV of $123,456.7mm` }));
  const ties = tieOut(deck, e);
  check("tie-out: a number that is not in the model is flagged", ties.some((i) => i.message.includes("999.9%")) && ties.some((i) => i.message.includes("123,456.7")), ties);
  check("tie-out: a number that is in the model is not flagged", !ties.some((i) => i.message.includes(priceText)), priceText);
  const dcfId = sheetId(doc, "DCF");
  e.setCell(dcfId, "C42", { v: 0.035, s: doc.workbook.sheets[dcfId].cells.C42.s });
  const table2 = resolveTable(deck.slides[deck.order[5]].elements[0].type === "table" ? (deck.slides[deck.order[5]].elements[0] as { link: { sheet: string; range: string } }).link : { sheet: "", range: "" }, e);
  check("deck: a changed assumption flows to the linked sensitivity table", !!table2 && table2[0].some((c) => c.text === "3.5%"), table2?.[0]);
}

{
  const lbo = buildLbo(ILLUSTRATIVE);
  const doc = docOf(lbo.sheets);
  const e = new Engine(doc.workbook);
  const id = sheetId(doc, "LBO");
  const irr = e.get(id, "C70"), moic = e.get(id, "C69");
  check("LBO: IRR and MOIC are sensible", typeof irr === "number" && irr > -0.5 && irr < 1 && typeof moic === "number" && moic > 0, [irr, moic]);
  check("LBO: sources equal uses", near(e.get(id, "C22"), e.get(id, "C26") as number, 1e-9));
  check("LBO: the average-balance circularity converges", !!e.cycleInfo(id, "D36")?.converged, e.cycleInfo(id, "D36"));
  const lboErrors = errorsOf(e);
  check("LBO: the audit finds no errors", lboErrors.length === 0, lboErrors.slice(0, 3));
  check("LBO: the audit reports the solved circularity once, as information", auditWorkbook(e).filter((i) => i.kind === "circular").length === 1 && auditWorkbook(e).find((i) => i.kind === "circular")?.severity === "info");
  const irrOn = e.get(id, "C70");
  e.setCell(id, "C17", { v: 0 });
  const irrOff = e.get(id, "C70");
  check("LBO: with the circuit breaker off the loop settles at once and IRR moves slightly", typeof irrOff === "number" && (e.cycleInfo(id, "D36")?.iterations ?? 99) <= 3 && irrOff !== irrOn && Math.abs(irrOff - (irrOn as number)) < 0.02, [irrOn, irrOff, e.cycleInfo(id, "D36")]);
  e.setCell(id, "C17", { v: 1 });
  for (const p of refreshSensitivities(doc, e)) applyPatch(doc, p, e);
  const centre = e.get(id, "E78");
  check("LBO: the IRR data table centre equals the model IRR", near(centre, e.get(id, "C70") as number, 1e-6), [centre, e.get(id, "C70")]);
  const deck = buildLboDeck(ILLUSTRATIVE, doc.workbook, lbo.anchors);
  check("LBO deck: tie-out clean", tieOut(deck, e).filter((i) => i.severity === "error").length === 0, tieOut(deck, e));
}

{
  const m = buildMerger({ ...ILLUSTRATIVE, ticker: "ACQ", name: "Acquirer", price: 60, shares: 400, netIncome: 1200 }, ILLUSTRATIVE);
  const doc = docOf(m.sheets);
  const e = new Engine(doc.workbook);
  const id = sheetId(doc, "Merger");
  check("merger: the sensitivity cell at 30% premium and 50% stock equals the model", near(e.get(id, "E37"), e.get(id, "C30") as number, 1e-9), [e.get(id, "E37"), e.get(id, "C30")]);
  check("merger: no errors", errorsOf(e).length === 0, errorsOf(e));
  const cap = buildCapTable();
  const d2 = docOf(cap.sheets);
  const e2 = new Engine(d2.workbook);
  const cid = sheetId(d2, "Cap table");
  check("cap table: post-round ownership sums to 100%", near(e2.get(cid, "F19"), 1, 1e-12));
  check("cap table: the pool tops up to exactly its target", near(e2.get(cid, "F16"), 0.1, 1e-9), e2.get(cid, "F16"));
}

/* ---------------- Audit, formatting and edits ---------------- */
{
  const doc = docOf(buildDcf(ILLUSTRATIVE).sheets);
  const e = new Engine(doc.workbook);
  const id = sheetId(doc, "DCF");
  e.setCell(id, "E5", { v: 1234 });
  e.setCell(id, "F7", { f: "F5*0.27" });
  e.setCell(id, "G13", { f: "G11+G12+Z99" });
  e.setCell(id, "B20", { f: "1/0" });
  const issues = auditWorkbook(e);
  const has = (kind: string, cell: string) => issues.some((i) => i.kind === kind && i.cell === cell);
  check("audit: a typed number in a row of formulas", has("hardcode_in_formula_row", "E5"), issues.slice(0, 6));
  check("audit: a number typed into a formula", has("hardcoded_number", "F7"));
  check("audit: a reference to an empty cell", has("empty_reference", "G13"));
  check("audit: an error value", has("error_value", "B20"));
  check("audit: a formula that breaks its row's pattern", has("inconsistent_formula", "F7"));

  const wb = workbookOf([{ id: "a", name: "In", cells: { A1: { v: "Revenue growth" }, B1: { v: 0.1 }, A2: { v: "Revenue" }, B2: { f: "B1*100" } } }, { id: "b", name: "Out", cells: { A1: { v: "Link" }, B1: { f: "In!B2" } } }]);
  const patches = bankerFormat(wb);
  const cellOf = (s: string, a: string) => patches.find((p) => p.sheet === s)?.cells[a];
  check("banker format: inputs blue, formulas black, links green", cellOf("a", "B1")?.s?.color === "#0000FF" && cellOf("a", "B2")?.s?.color === "#000000" && cellOf("b", "B1")?.s?.color === "#008000");
  check("banker format: a growth row is a percentage", cellOf("a", "B1")?.s?.nf?.includes("%") === true);
}

{
  const dcf = buildDcf(ILLUSTRATIVE);
  const doc = docOf([...dcf.sheets, ...buildSummary(ILLUSTRATIVE, dcf.anchors, null).sheets]);
  const e = new Engine(doc.workbook);
  const id = sheetId(doc, "DCF"), sid = sheetId(doc, "Summary");
  const before = e.get(id, "C53"), summaryBefore = e.get(sid, "B6");
  const apply = (ps: Patch | Patch[]) => { for (const p of Array.isArray(ps) ? ps : [ps]) applyPatch(doc, p, e); };
  apply(shiftCells(doc, "DCF", "r", 10, 2));
  check("insert rows: the model still values the same", near(e.get(id, "C55"), before as number, 1e-9), [e.get(id, "C55"), before]);
  check("insert rows: another sheet's links follow", near(e.get(sid, "B6"), summaryBefore as number, 1e-9), [e.get(sid, "B6"), summaryBefore]);
  apply(shiftCells(doc, "DCF", "r", 10, -2));
  check("delete the same rows: back to the original", near(e.get(id, "C53"), before as number, 1e-9));
  apply(renameSheet(doc, "DCF", "Valuation"));
  check("rename: formulas on other sheets follow the new name", doc.workbook.sheets[sid].cells.B6.f?.includes("Valuation!") === true && near(e.get(sid, "B6"), summaryBefore as number, 1e-9));
  apply(writeRange(doc, "Valuation", "J1", [[1, 2, "=J1+K1"], ["5%", "=SUM(J1:L1)", "text"]]));
  check("write a range: values, percentages, formulas and text", e.get(id, "L1") === 3 && near(e.get(id, "J2"), 0.05) && e.get(id, "K2") === 6 && e.get(id, "L2") === "text");
  apply(fillRange(doc, "Valuation", "L1", "L1:L3"));
  check("fill down adjusts relative references", doc.workbook.sheets[id].cells.L3.f === "J3+K3");
  apply(deleteSheet(doc, "Valuation"));
  check("delete a sheet: links to it become #REF!", (e.get(sid, "B6") as { code?: string })?.code === "#REF!", e.get(sid, "B6"));
}

/* ---------------- Files ---------------- */
import { exportXlsx, importXlsx, importCsv, excelFormula } from "@/lib/studio/xlsx";
import { exportPptx } from "@/lib/studio/pptx";
import JSZip from "jszip";

async function files() {
  const dcf = buildDcf(ILLUSTRATIVE), lbo = buildLbo(ILLUSTRATIVE);
  const doc = docOf([...dcf.sheets, ...lbo.sheets]);
  const e = new Engine(doc.workbook);
  for (const p of refreshSensitivities(doc, e)) applyPatch(doc, p, e);
  const buf = await exportXlsx(doc, e);
  const back = await importXlsx(buf, "roundtrip.xlsx");
  const e2 = new Engine(back.workbook);
  const id2 = back.workbook.order.find((x) => back.workbook.sheets[x].name === "DCF")!;
  const id1 = sheetId(doc, "DCF");
  check("xlsx round trip: same implied price", near(e2.get(id2, "C53"), e.get(id1, "C53") as number, 1e-9), [e2.get(id2, "C53"), e.get(id1, "C53")]);
  check("xlsx round trip: formulas, formats and colours survive", back.workbook.sheets[id2].cells.C5.f === "B5*(1+C6)" && back.workbook.sheets[id2].cells.C6.s?.nf === NF_PCT && back.workbook.sheets[id2].cells.C6.s?.color === "#0000FF" && back.workbook.sheets[id2].cells.A4.s?.fill === "#DCE6F1");
  const lboId = back.workbook.order.find((x) => back.workbook.sheets[x].name === "LBO")!;
  check("xlsx round trip: the circular LBO still solves", typeof new Engine(back.workbook).get(lboId, "C70") === "number");
  check("xlsx round trip: nothing unsupported", back.intake.unsupported.length === 0 && back.intake.externalLinks === 0, back.intake);
  check("xlsx: newer functions get Excel's _xlfn prefix", excelFormula("XLOOKUP(A1,B:B,C:C)+SUM(A1)") === "_xlfn.XLOOKUP(A1,B:B,C:C)+SUM(A1)");
  const csv = importCsv("Company,Revenue\n\"Acme, Inc.\",1200\nBeta,12%\n", "peers.csv");
  const cs = csv.workbook.sheets[csv.workbook.order[0]];
  check("csv import: quoted commas and numbers", cs.cells.A2.v === "Acme, Inc." && cs.cells.B2.v === 1200 && near(cs.cells.B3.v as number, 0.12));

  const comps = buildComps({ ticker: "TGT", name: "Target Co.", price: 25, marketCap: 2500, netDebt: 150, revenue: 1000, ebitda: 180, growth: 0.15, shares: 100 }, [{ ticker: "AAA", name: "Alpha", price: 50, marketCap: 5000, netDebt: 500, revenue: 1000, ebitda: 200, growth: 0.1 }]);
  const sum = buildSummary(ILLUSTRATIVE, dcf.anchors, comps.anchors);
  const d2 = docOf([...buildDcf(ILLUSTRATIVE).sheets]);
  d2.workbook = workbookOf([...dcf.sheets, ...comps.sheets, ...sum.sheets]);
  const e3 = new Engine(d2.workbook);
  d2.deck = buildValuationDeck(ILLUSTRATIVE, d2.workbook, { dcf: dcf.anchors, comps: comps.anchors, summary: sum.anchors });
  const pptx = await exportPptx(d2, e3);
  const zip = await JSZip.loadAsync(pptx);
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  check("pptx: a valid PowerPoint package with one file per slide", slides.length === d2.deck.order.length, slides.length);
  const s5 = await zip.file("ppt/slides/slide5.xml")!.async("string");
  const px = e3.display(sheetId(d2, "DCF"), "C52").text.trim();
  check("pptx: the football field carries the current price from the model", s5.includes(px.replace("$", "")), px);
  const charts = Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f));
  check("pptx: the free cash flow chart is a native PowerPoint chart", charts.length >= 1, charts);
}
const NF_PCT = "0.0%_);(0.0%)";

export { check, pass, fail };

if (process.argv[1]?.endsWith("test-studio.ts")) {
  files().then(() => {
    console.log(`${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
