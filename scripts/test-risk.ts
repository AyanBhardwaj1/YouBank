/** The Book's risk (src/lib/book/risk.ts): pnpm exec tsx scripts/test-risk.ts */
import { bookRisk, closeOn, netByTicker, replay, returnsOn, riskLine, whatIf, whatIfLine, type Close } from "@/lib/book/risk";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const near = (label: string, got: number | null, want: number, tol: number) => ok(`${label} (${got} ≈ ${want})`, got !== null && Math.abs(got - want) <= tol, true);

// A deterministic year of business days and market returns.
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const days: string[] = [];
for (let t = Date.parse("2025-10-01T00:00:00Z"); days.length < 260; t += 86_400_000) {
  const d = new Date(t);
  if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.toISOString().slice(0, 10));
}
const mkt = days.map(() => rnd() * 0.03);
const noise = days.map(() => rnd() * 0.004);
const noise2 = days.map(() => rnd() * 0.004);
const noise3 = days.map(() => rnd() * 0.03);
const series = (rets: number[], start = 100): Close[] => { let p = start; return days.map((date, i) => ({ date, close: (p *= 1 + (i ? rets[i] : 0)) })); };
const prices: Record<string, Close[]> = {
  SPY: series(mkt),
  HI: series(mkt.map((m, i) => 1.5 * m + noise[i])), // beta 1.5
  TWIN: series(mkt.map((m, i) => 1.5 * m + noise2[i])), // moves with HI
  LOW: series(mkt.map((m, i) => 0.5 * m + noise3[i])), // loosely tied to the market
  NEW: series(mkt).slice(-40), // a recent listing
};

console.log("building blocks");
ok("the last close on or before a date", [closeOn(prices.SPY, days[10])?.date, closeOn(prices.SPY, "2020-01-01"), closeOn(prices.SPY, "2099-01-01")?.date], [days[10], null, days[259]]);
ok("returns on the benchmark's calendar, null where a day is missing", returnsOn(["a", "b", "c", "d"], [{ date: "a", close: 100 }, { date: "b", close: 110 }, { date: "d", close: 121 }]).map((x) => (x === null ? null : Math.round(x * 1000) / 1000)), [0.1, null, null]);

console.log("the book");
const book = [
  { ticker: "HI", direction: "long" as const, weight: 5 },
  { ticker: "TWIN", direction: "long" as const, weight: 4 },
  { ticker: "LOW", direction: "short" as const, weight: 3 },
  { ticker: "NEW", direction: "long" as const, weight: 2 },
  { ticker: "NOWT", direction: "long" as const, weight: null },
];
const r = bookRisk(book, prices, new Date("2026-11-06T12:00:00Z"));
const pos = Object.fromEntries(r.positions.map((p) => [p.ticker, p]));
near("HI's beta is about 1.5", pos.HI.beta, 1.5, 0.05);
near("LOW's beta is about 0.5", pos.LOW.beta, 0.5, 0.1);
near("beta-adjusted net: 5×1.5 + 4×1.5 − 3×0.5 ≈ 12", r.betaNet, 12, 0.6);
ok("a market move costs beta-net × move", r.shocks.find((s) => s.move === -10)?.pnl, Math.round((r.betaNet! * -10) / 100 * 100) / 100);
ok("a recent listing and an unweighted name are left out, with the reason", r.excluded, [{ ticker: "NOWT", reason: "no weight" }, { ticker: "NEW", reason: "39 trading days of prices in the last year" }]);
ok("VaR and expected shortfall are positive, ES at least VaR", [r.var95! > 0, r.es95! >= r.var95!, r.vol! > 0], [true, true, true]);
near("risk shares add to 100%", r.positions.reduce((a, p) => a + (p.riskShare ?? 0), 0), 100, 0.1);
ok("two longs that move together are one stacked bet", r.pairs.map((p) => [p.a, p.b, p.kind, p.weight]), [["HI", "TWIN", "stacked", 9]]);
const hedged = bookRisk([{ ticker: "HI", direction: "long", weight: 5 }, { ticker: "TWIN", direction: "short", weight: 5 }], prices);
ok("a long and a short that move together hedge each other, and beta nets out", [hedged.pairs[0]?.kind, Math.abs(hedged.betaNet!) < 0.2], ["hedge", true]);
ok("the window is the last year of the benchmark", [r.window?.days, r.window?.to], [252, days[259]]);
ok("too little benchmark history: no figures, no crash", bookRisk(book, { SPY: prices.SPY.slice(0, 50), HI: prices.HI }).betaNet, null);
ok("no benchmark at all is reported", bookRisk(book, { HI: prices.HI }).excluded.some((e) => e.ticker === "SPY"), true);

console.log("replays");
const ep = { id: "x", label: "Test", from: days[100], to: days[120] };
const rep = replay(book, prices, ep);
const expect = (t: string, w: number, s: number) => s * w * (closeOn(prices[t], ep.to)!.close / closeOn(prices[t], ep.from)!.close - 1);
near("replay P&L is each name's own return over the window", rep.pnl, expect("HI", 5, 1) + expect("TWIN", 4, 1) + expect("LOW", 3, -1), 0.01);
ok("a name that had not listed by then is left out, not counted flat", [rep.missing, rep.covered], [["NEW"], 12]);
ok("an episode before any prices: no figure", replay(book, prices, { id: "y", label: "Old", from: "2020-02-19", to: "2020-03-23" }).pnl, null);
ok("the worst names are the losers, worst first", rep.worst.every((w, i, a) => w.pnl < 0 && (i === 0 || a[i - 1].pnl <= w.pnl)), true);
ok("one line for a person", /^Beta-adjusted net \+\d+(\.\d+)?% of NAV; one-day 95% VaR [\d.]+% of NAV/.test(riskLine(r)), true);

console.log("the same name twice");
ok("two lines in one name add up; a long against a short nets; a flat name has no risk", netByTicker([{ ticker: "A", direction: "long", weight: 3 }, { ticker: "A", direction: "long", weight: 2 }, { ticker: "B", direction: "long", weight: 4 }, { ticker: "B", direction: "short", weight: 1 }, { ticker: "C", direction: "long", weight: 2 }, { ticker: "C", direction: "short", weight: 2 }]), { lines: [{ ticker: "A", direction: "long", weight: 5 }, { ticker: "B", direction: "long", weight: 3 }], flat: ["C"] });
const dup = bookRisk([{ ticker: "HI", direction: "long", weight: 3 }, { ticker: "HI", direction: "long", weight: 2 }, { ticker: "TWIN", direction: "long", weight: 4 }], prices);
ok("no name is paired with itself and each shows once", [dup.positions.map((p) => p.ticker).sort(), dup.pairs.every((p) => p.a !== p.b), dup.positions.find((p) => p.ticker === "HI")?.weight], [["HI", "TWIN"], true, 5]);
const halted = { ...prices, HALT: prices.HI.slice(0, 105) };
ok("a name that stopped trading mid-episode is left out of the replay, not priced at a stale close", replay([{ ticker: "HALT", direction: "long", weight: 5 }], halted, ep).missing, ["HALT"]);

console.log("before a trade");
const base = [{ ticker: "HI", direction: "long" as const, weight: 5 }, { ticker: "LOW", direction: "short" as const, weight: 3 }];
const wi = whatIf(base, { ticker: "TWIN", direction: "long", weight: 4 }, prices);
near("adding a beta-1.5 long at 4% raises beta-net by about 6 points", wi.after.betaNet! - wi.before.betaNet!, 6, 0.4);
ok("the new name's beta, and the holding it doubles up on, named as more of the same bet", [Math.abs((wi.beta ?? 0) - 1.5) < 0.1, wi.movesWith[0]?.ticker, wi.movesWith[0]?.kind], [true, "HI", "stacked"]);
const hedgeWi = whatIf(base, { ticker: "TWIN", direction: "short", weight: 4 }, prices);
ok("shorting it instead is a hedge against HI and lowers beta-net", [hedgeWi.movesWith[0]?.kind, hedgeWi.after.betaNet! < hedgeWi.before.betaNet!], ["hedge", true]);
ok("a name without enough history: no answer, and why", [whatIf(base, { ticker: "NEW", direction: "long", weight: 2 }, prices).note, whatIf(base, { ticker: "NOPE", direction: "long", weight: 2 }, prices).note], ["NEW has 39 trading days of prices in the last year; at least 120 are needed.", "No prices for NOPE."]);
ok("the worst replay is compared on the same episode before and after", wi.after.worst ? [wi.before.worst === null || wi.before.worst.label === wi.after.worst.label] : [true], [true]);
ok("one line for a person", /^Adding long TWIN at 4% of NAV: beta-adjusted net [\d.]+% → [\d.]+%, one-day VaR [\d.]+% → [\d.]+%\. It moves with HI \(correlation 0\.\d+\): more of the same bet\.$/.test(whatIfLine(wi)), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
