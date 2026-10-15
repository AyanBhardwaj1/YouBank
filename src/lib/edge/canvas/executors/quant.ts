/**
 * Quant Edge's canvas blocks: Factor Lab (Q1), portfolio risk (Q2), the backtest integrity grade (Q3), event
 * base rates (QF5) and insider and activist events (Q7). Portfolios travel as companies (equal weights) or as a
 * table with symbol and weight columns; results go out as tables and memos with their disclosures. Free-tier
 * limits (30 holdings, three years); the Quant terms must have been accepted in /app/quant.
 */
import { hasQuantConsent } from "@/lib/quant/access";
import { CATALOG, baseRateFor, signalBaseRate } from "@/lib/quant/events/rates";
import { factorLab } from "@/lib/quant/factors/lab";
import { board } from "@/lib/quant/insiders/store";
import { checkUpload } from "@/lib/quant/integrity/check";
import { parseReturnsCsv } from "@/lib/quant/integrity/upload";
import { riskView } from "@/lib/quant/risk/run";
import { DISCLOSURES } from "@/lib/quant/words";
import { register, type ExecContext } from "../engine";
import type { Companies, Findings, Memo, Table } from "../values";

const pct = (v: number | null | undefined, dp = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : `${(v * 100).toFixed(dp)}%`);

async function consent(ctx: ExecContext) {
  if (!(await hasQuantConsent(ctx.userId))) throw Object.assign(new Error("Accept the Quant terms once in Quant (/app/quant) before running Quant blocks."), { status: 428 });
}

/** Holdings from the wired values: companies get equal weights; a table needs symbol (or ticker) and weight columns. Pure. */
export function holdingsFromValues(values: unknown[] | undefined): { symbol: string; weight: number }[] {
  const out = new Map<string, number>();
  for (const v of values ?? []) {
    const c = v as Companies;
    const t = v as Table;
    if (Array.isArray(c.items)) for (const x of c.items) if (x.ticker) out.set(x.ticker.toUpperCase(), (out.get(x.ticker.toUpperCase()) ?? 0) + 1);
    if (Array.isArray(t.columns) && Array.isArray(t.rows)) {
      const names = t.columns.map((col) => col.name.toLowerCase());
      const si = names.findIndex((n) => n === "symbol" || n === "ticker"), wi = names.findIndex((n) => n === "weight" || n === "value" || n === "market_value");
      if (si < 0) continue;
      for (const r of t.rows) { const s = String(r[si] ?? "").toUpperCase().trim(); const w = wi >= 0 ? Number(r[wi]) : 1; if (s && Number.isFinite(w) && w > 0) out.set(s, (out.get(s) ?? 0) + w); }
    }
  }
  const total = [...out.values()].reduce((s, w) => s + w, 0);
  return total > 0 ? [...out].map(([symbol, w]) => ({ symbol, weight: w / total })).slice(0, 30) : [];
}

const tickersOf = (values: unknown[] | undefined) => holdingsFromValues(values).map((h) => h.symbol);
const memoOf = (title: string, lines: string[], disclosures: readonly string[], sources: { label: string; url?: string }[]): Memo => ({ title, markdown: [...lines, "", ...disclosures.map((d) => `_${d}_`)].join("\n"), sources: sources.map((s, i) => ({ n: i + 1, ...s })) });

register("quant.factors", {
  async start(ctx) {
    await consent(ctx);
    const holdings = holdingsFromValues(ctx.inputs.portfolio);
    if (!holdings.length) throw Object.assign(new Error("Wire in companies, or a table with symbol and weight columns."), { status: 400 });
    await ctx.progress("fit", `Regressing ${holdings.length} holdings on the factors`);
    const l = await factorLab(holdings, { years: Math.min(3, Math.max(1, Number(ctx.config.years) || 3)), maxHoldings: 30 });
    const w = l.windows.y3 ?? l.windows.y1;
    const table: Table = { title: "Factor exposures", columns: [{ name: "factor", type: "cat" }, { name: "beta", type: "num" }, { name: "low_95", type: "num" }, { name: "high_95", type: "num" }, { name: "t", type: "num" }], rows: (w?.betas ?? []).map((b) => [b.label, +b.beta.toFixed(3), +b.low.toFixed(3), +b.high.toFixed(3), +b.t.toFixed(2)]) };
    const memo = memoOf("Factor exposures", [l.summary, w ? `Alpha ${pct(w.alphaAnnual)} a year (t = ${w.alphaT.toFixed(2)}); R² ${pct(w.r2, 0)} over ${w.n} days, ${w.from} to ${w.to}. ${w.luck}` : "", ...l.crowding.map((c) => c.sentence)].filter(Boolean), l.disclosures, l.sources.map((label) => ({ label })));
    return { outputs: { table, memo }, summary: l.summary.slice(0, 300), preview: { kind: "stats", items: (w?.betas ?? []).slice(0, 6).map((b) => ({ label: b.label, value: b.beta.toFixed(2) })) } };
  },
});

register("quant.risk", {
  async start(ctx) {
    await consent(ctx);
    const holdings = holdingsFromValues(ctx.inputs.portfolio);
    if (!holdings.length) throw Object.assign(new Error("Wire in companies, or a table with symbol and weight columns."), { status: 400 });
    const shocks = typeof ctx.config.shock === "string" && ctx.config.shock.trim() ? [ctx.config.shock.trim()] : [];
    await ctx.progress("model", "Covariance, value at risk and replays");
    const v = await riskView({ holdings, pro: false, shocks });
    const table: Table = { title: "Stress tests", columns: [{ name: "scenario", type: "text" }, { name: "loss", type: "num" }, { name: "low", type: "num" }, { name: "high", type: "num" }], rows: [...v.stress.map((s) => [s.label, +s.mid.toFixed(4), +s.low.toFixed(4), +s.high.toFixed(4)]), ...v.shocks.map((s) => [s.text, +s.mid.toFixed(4), +s.low.toFixed(4), +s.high.toFixed(4)])] };
    const memo = memoOf("Portfolio risk", [v.summary, v.varSentence, `Largest risk shares: ${v.decomposition.holdings.slice(0, 5).map((h) => `${h.symbol} ${pct(h.share, 0)}`).join(", ")}.`], v.disclosures, v.sources.map((label) => ({ label })));
    return { outputs: { table, memo }, summary: v.summary.slice(0, 300), preview: { kind: "stats", items: [{ label: "Volatility", value: pct(v.decomposition.volAnnual) }, ...v.stress.slice(0, 4).map((s) => ({ label: s.label, value: `-${pct(s.mid)}` }))] } };
  },
});

register("quant.integrity", {
  async start(ctx) {
    await consent(ctx);
    const t = (ctx.inputs.returns ?? [])[0] as Table | undefined;
    if (!t?.rows?.length) throw Object.assign(new Error("Wire in a table of returns: a date column and a return column."), { status: 400 });
    const parsed = parseReturnsCsv([t.columns.map((c) => c.name).join(","), ...t.rows.map((r) => r.map((x) => (x === null ? "" : String(x))).join(","))].join("\n"));
    if (parsed.returns.length < 30) throw Object.assign(new Error("At least 30 returns are needed."), { status: 400 });
    const ppy = [12, 52, 252].includes(Number(ctx.config.periodsPerYear)) ? Number(ctx.config.periodsPerYear) : 252;
    const a = checkUpload({ returns: parsed.returns, dates: parsed.dates, periodsPerYear: ppy, declaredTrials: Number(ctx.config.trials) || undefined, hygiene: {}, pro: false, loggedSharpes: [] });
    const table: Table = { title: "Integrity checks", columns: [{ name: "check", type: "text" }, { name: "status", type: "cat" }, { name: "detail", type: "text" }], rows: a.checks.map((c) => [c.label, c.status, c.detail]) };
    const memo = memoOf(`Backtest integrity: grade ${a.report.grade}`, [a.rule, ...a.whatWouldChange.map((w) => `- ${w}`)], a.disclosures, [{ label: "Bailey and Lopez de Prado, The Deflated Sharpe Ratio (2014)", url: "https://doi.org/10.3905/jpm.2014.40.5.094" }]);
    return { outputs: { table, memo }, summary: `Grade ${a.report.grade}: ${a.rule}`.slice(0, 300), preview: { kind: "stats", items: [{ label: "Grade", value: a.report.grade }, { label: "Sharpe", value: a.report.sharpe.toFixed(2) }, { label: "Deflated Sharpe", value: a.report.dsr === null ? "n/a" : a.report.dsr.toFixed(2) }] } };
  },
});

register("quant.events", {
  async start(ctx) {
    const types = Array.isArray(ctx.config.types) && ctx.config.types.length ? (ctx.config.types as string[]).filter((x) => CATALOG[x]) : Object.keys(CATALOG);
    await ctx.progress("rates", "Reading stored base rates");
    const rows: Table["rows"] = [];
    for (const type of types) {
      const b = signalBaseRate(await baseRateFor(type).catch(() => null), 1);
      rows.push([CATALOG[type].label, b?.n ?? 0, b ? +b.car.toFixed(4) : null, b ? +b.low.toFixed(4) : null, b ? +b.high.toFixed(4) : null, b ? +b.hitRate.toFixed(3) : null, b ? +b.unconditionalHitRate.toFixed(3) : null, b?.window ?? "", b?.era ?? ""]);
    }
    const table: Table = { title: "Event base rates", columns: [{ name: "event", type: "cat" }, { name: "n", type: "num" }, { name: "car", type: "num" }, { name: "car_low", type: "num" }, { name: "car_high", type: "num" }, { name: "hit_rate", type: "num" }, { name: "unconditional_hit_rate", type: "num" }, { name: "window", type: "text" }, { name: "era", type: "text" }], rows };
    const memo = memoOf("Event base rates", rows.filter((r) => Number(r[1]) > 0).map((r) => `- ${r[0]}: ${pct(r[2] as number)} versus the market over sessions ${r[7]} (95% ${pct(r[3] as number)} to ${pct(r[4] as number)}), n = ${r[1]}.`), [DISCLOSURES.base_rate, DISCLOSURES.survivorship], [{ label: "SEC EDGAR filings; YouBank event study (market model, sessions -250 to -30)" }]);
    return { outputs: { table, memo }, summary: `${rows.filter((r) => Number(r[1]) > 0).length} of ${rows.length} event types have base rates`, preview: { kind: "list", items: rows.slice(0, 6).map((r) => ({ label: String(r[0]), detail: Number(r[1]) > 0 ? `${pct(r[2] as number)} (n ${r[1]})` : "not computed yet" })) } };
  },
});

register("quant.insiders", {
  async start(ctx) {
    const symbols = tickersOf(ctx.inputs.companies);
    await ctx.progress("board", symbols.length ? `Events for ${symbols.length} companies` : "The market-wide board");
    const rows = await board({ symbols: symbols.length ? symbols : undefined, limit: 100, days: Math.min(365, Math.max(7, Number(ctx.config.days) || 90)) });
    const table: Table = { title: "Insider and activist events", columns: [{ name: "accepted", type: "text" }, { name: "symbol", type: "cat" }, { name: "event", type: "cat" }, { name: "insiders", type: "num" }, { name: "total_usd", type: "num" }, { name: "explain", type: "text" }, { name: "filing", type: "text" }], rows: rows.map((r) => [r.acceptedAt.slice(0, 10), r.symbol, r.label, r.insiders, r.totalUsd, r.explain, r.url ?? ""]) };
    const findings: Findings = { items: rows.slice(0, 50).map((r, i) => ({ id: -(i + 1), title: `${r.symbol}: ${r.label}`, kind: r.type.startsWith("activist") ? "quant.activist" : "quant.insider_cluster", confidence: 0.8, tickers: [r.symbol], observedAt: r.acceptedAt, summary: r.explain, sources: r.url ? [r.url] : [] })), note: DISCLOSURES.base_rate };
    return { outputs: { table, findings }, summary: `${rows.length} events`, preview: { kind: "list", items: rows.slice(0, 6).map((r) => ({ label: `${r.symbol} · ${r.label}`, detail: r.acceptedAt.slice(0, 10) })) } };
  },
});
