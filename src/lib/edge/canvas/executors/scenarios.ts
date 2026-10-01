/**
 * Scenarios · Synthetic data blocks. "Scenarios" runs a market scenario for the wired-in companies (or
 * the companies in wired-in findings or a deal): a history replay, a written shock, a scenario proposed
 * from live events, an AI-imagined tail risk, or the base case. "Synthetic data" makes a labeled
 * synthetic copy of a wired-in table. Both are saved, so they can be refined and reopened.
 */
import { eventProposals, parseShock, tailRisks } from "../../scen/drivers";
import { runMarket, type Driver, type Method } from "../../scen/market";
import { withShock } from "../../scen/run";
import { saveScenario } from "../../scen/store";
import { cartSynth, copulaSynth, ctganSynth, tableRealism, tableTooWide, type TableIn } from "../../scen/tables";
import { register } from "../engine";
import { marketValue, type Companies, type Findings, type ProformaValue, type Table } from "../values";

const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

function tickersOf(values: unknown[] | undefined): string[] {
  const out = new Set<string>();
  for (const v of values ?? []) {
    const c = v as Companies & Findings & ProformaValue;
    for (const x of c.items ?? []) { const t = (x as { ticker?: string; tickers?: string[] }).ticker ?? (x as { tickers?: string[] }).tickers?.[0]; if (t) out.add(t.toUpperCase()); }
    for (const p of c.parties ?? []) if (p.ticker) out.add(p.ticker.toUpperCase());
  }
  return [...out].slice(0, 12);
}

register("scen.simulate", {
  async start(ctx) {
    const tickers = tickersOf(ctx.inputs.in);
    if (!tickers.length) throw Object.assign(new Error("Wire in companies, findings or a deal to simulate."), { status: 400 });
    const driver = (["replay", "shock", "event", "tail"] as const).find((d) => d === ctx.config.driver) ?? "replay";
    await ctx.progress("driver");
    let shockText = typeof ctx.config.shock === "string" ? ctx.config.shock : "";
    let title: string | undefined;
    let shock = undefined as undefined | ReturnType<typeof parseShock>["shock"];
    if (driver === "event" || driver === "tail") {
      const proposals = driver === "tail" ? await tailRisks(tickers) : await eventProposals(tickers);
      const pick = proposals[0];
      if (!pick) throw Object.assign(new Error(driver === "tail" ? "No tail risk could be imagined for these companies." : "No live events about these companies to build a scenario from."), { status: 404 });
      shock = { ...pick.shock, reasoning: pick.reasoning, sources: pick.sources };
      title = `${driver === "tail" ? "AI-imagined: " : ""}${pick.title}`;
      shockText = pick.title;
    }
    const method = (["auto", "bootstrap", "garch", "regimes", "diffusion"] as const).find((m) => m === ctx.config.method) ?? "auto";
    const spec = await withShock({ tickers, driver: driver as Driver, replay: typeof ctx.config.replay === "string" ? ctx.config.replay : "2022", shock, shockText, horizon: Number(ctx.config.horizon) || 60, method: (method === "diffusion" ? "auto" : method) as Method, paths: 1000, seed: 7 + ctx.runId, title });
    await ctx.progress("simulate");
    const r = await runMarket(spec);
    await ctx.progress("validate");
    const saved = await saveScenario(ctx.userId, { kind: "market", title: r.title, driver, spec: spec as unknown as Record<string, unknown>, result: r as unknown as Record<string, unknown> });
    const port = r.summary.finals.find((f) => f.series === "Portfolio")!;
    const value = marketValue(r, saved.id, driver);
    return { outputs: { scenario: value }, summary: `SYNTHETIC · ${r.title}: median ${pct(port.p50)}, 5th percentile ${pct(port.p5)} over ${r.horizon} days (realism ${r.realism.score})`, preview: { kind: "chart", synthetic: true, series: [{ label: "p5", values: value.fan![0].p5 }, { label: "median", values: value.fan![0].p50 }, { label: "p95", values: value.fan![0].p95 }] } };
  },
});

register("scen.synthetic", {
  async start(ctx) {
    const t = (ctx.inputs.table ?? [])[0] as Table | undefined;
    if (!t?.rows?.length) throw Object.assign(new Error("Wire in a table to copy."), { status: 400 });
    const wide = tableTooWide(t);
    if (wide) throw Object.assign(new Error(wide), { status: 400 });
    const input: TableIn = { columns: t.columns, rows: t.rows, title: t.title };
    const rows = Math.max(50, Math.min(10_000, Number(ctx.config.rows) || 1000)), seed = Math.max(1, Math.floor(Number(ctx.config.seed) || 7));
    await ctx.progress("learn");
    // Sequential trees by default (free, on the server); the copula and the ML service's GAN stay selectable for comparison.
    const method = ctx.config.method === "ctgan" ? "ctgan" : ctx.config.method === "statistical" ? "copula" : "cart";
    await ctx.progress("generate");
    const synth = method === "ctgan" ? await ctganSynth(input, rows, seed) : method === "copula" ? copulaSynth(input, rows, seed) : cartSynth(input, rows, seed);
    await ctx.progress("validate");
    const realism = tableRealism(input, synth);
    const table: Table = { title: synth.title, columns: synth.columns, rows: synth.rows, synthetic: { recipe: synth.synthetic!.recipe, seed, realism: realism.score } };
    const label = method === "ctgan" ? "CTGAN" : method === "copula" ? "Gaussian copula" : "sequential trees (CART)";
    return { outputs: { table }, summary: `SYNTHETIC · ${rows.toLocaleString("en-US")} rows by ${label}, realism ${realism.score}${realism.warnings.length ? ` (${realism.warnings[0]})` : ""}`, preview: { kind: "stats", items: [{ label: "Rows", value: rows.toLocaleString("en-US") }, { label: "Method", value: label }, { label: "Realism", value: `${realism.score} / 100` }, { label: "Seed", value: String(seed) }] } };
  },
});
