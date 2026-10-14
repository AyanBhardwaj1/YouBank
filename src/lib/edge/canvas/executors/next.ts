/**
 * Edge next blocks built by the second round: Call Desk (E5, `calls.read`) and the LBO Stress Lab (E6,
 * `scen.lbo`). Both are free: Call Desk reads stored calls (and, when asked, the companies' filed releases and
 * transcripts with the free classifier); the stress lab runs its 1,000-path preview. Neither opens a premium
 * scope, so a monitored canvas can re-run them, and `out.signal` can alert when breach odds cross a line.
 */
import { and, desc, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { commitmentsFor, readCall, type CallSummary } from "../../calls/store";
import { canRead } from "../../docs/store";
import { indexFilings } from "../../docs/sources";
import { defaultTranches, runLab } from "../../scen/lab";
import { saveScenario } from "../../scen/store";
import { register } from "../engine";
import type { Companies, DealsValue, Memo, Scenario, Table } from "../values";

const tickersIn = (values: unknown[] | undefined) => [...new Set((values ?? []).flatMap((v) => {
  const c = v as Companies & { scope?: { tickers?: string[] } };
  if (Array.isArray(c.items)) return c.items.map((x) => x.ticker).filter(Boolean);
  return c.scope?.tickers ?? [];
}))];
const pct = (v: number) => `${Math.round(v * 100)}%`;

register("calls.read", {
  async start(ctx) {
    const tickers = tickersIn(ctx.inputs.in).slice(0, 4);
    if (!tickers.length) throw Object.assign(new Error("Wire in the companies whose calls to read."), { status: 400 });
    const rows: Table["rows"] = [];
    const lines: string[] = [];
    const db = requireDb();
    for (const t of tickers) {
      await ctx.progress("calls", `Calls for ${t}`);
      if (ctx.config.read && Date.now() < ctx.deadline - 90_000) {
        const r = await indexFilings(t, ["8-K"], 4, Math.min(ctx.deadline - 60_000, Date.now() + 60_000)).catch(() => null);
        for (const id of r?.docIds ?? []) {
          if (Date.now() > ctx.deadline - 60_000) break;
          const [d] = await db.select({ meta: schema.edgeDocs.meta }).from(schema.edgeDocs).where(sql`${schema.edgeDocs.id} = ${id}`);
          const m = (d?.meta ?? {}) as { callDesk?: unknown; items?: string };
          if (!m.callDesk && /2\.02|7\.01/.test(m.items ?? "")) await readCall(ctx.userId, id).catch(() => null);
        }
      }
      const docs = await db.select({ id: schema.edgeDocs.id, ownerId: schema.edgeDocs.ownerId, teamId: schema.edgeDocs.teamId, title: schema.edgeDocs.title, desk: sql<{ summary?: CallSummary; said?: string; comparison?: { sentence: string } | null; avoided?: { topic: string }[] } | null>`${schema.edgeDocs.meta}->'callDesk'` })
        .from(schema.edgeDocs).where(and(sql`${schema.edgeDocs.meta}->>'ticker' = ${t}`, sql`${schema.edgeDocs.meta}->'callDesk'->'summary' is not null`)).orderBy(desc(schema.edgeDocs.createdAt)).limit(6);
      let call: (typeof docs)[number] | null = null;
      for (const d of docs) if (await canRead(ctx.userId, d)) { call = d; break; }
      await ctx.progress("promises", `Promises for ${t}`);
      const p = await commitmentsFor(ctx.userId, t).catch(() => null);
      if (call?.desk?.summary) {
        rows.push([t, "call", call.desk.said ?? "", call.title, pct(call.desk.summary.mean), `${pct(call.desk.summary.low)}-${pct(call.desk.summary.high)}`, (call.desk.avoided ?? []).map((a) => a.topic).join("; ")]);
        lines.push(`**${t}** (${call.title}): about ${pct(call.desk.summary.mean)} of answers did not address the question asked (80% interval ${pct(call.desk.summary.low)} to ${pct(call.desk.summary.high)}).${call.desk.comparison ? ` ${call.desk.comparison.sentence}` : ""}`);
      } else lines.push(`**${t}**: no call read yet.`);
      for (const r of (p?.rows ?? []).slice(0, 12)) rows.push([t, "promise", r.said ?? "", `${r.label}${r.period ? ` ${r.period.q ? `Q${r.period.q} ` : ""}FY${r.period.fy}` : ""}`, r.status, r.low !== null || r.high !== null ? `${r.low ?? ""} to ${r.high ?? ""}` : "", r.quote.slice(0, 200)]);
      if (p) lines.push(`Promises: ${p.hitRate.text}`);
    }
    await ctx.progress("write");
    const table: Table = { title: `Call Desk: ${tickers.join(", ")}`, columns: [{ name: "ticker", type: "cat" }, { name: "kind", type: "cat" }, { name: "date", type: "text" }, { name: "item", type: "text" }, { name: "rate_or_status", type: "text" }, { name: "interval_or_range", type: "text" }, { name: "detail", type: "text" }], rows };
    const memo: Memo = { title: `Call Desk: ${tickers.join(", ")}`, markdown: `${lines.join("\n\n")}\n\nA statistical reading of public words: whether an answer addressed the question asked. It never says anyone lied.`, sources: [] };
    return { outputs: { table, memo }, summary: `${rows.filter((r) => r[1] === "call").length} calls and ${rows.filter((r) => r[1] === "promise").length} promises for ${tickers.join(", ")}`, preview: { kind: "list", items: rows.slice(0, 5).map((r) => ({ label: `${r[0]} ${r[1]}: ${r[3]}`, detail: String(r[4]) })) } };
  },
});

register("scen.lbo", {
  async start(ctx) {
    const ticker = tickersIn(ctx.inputs.companies)[0];
    if (!ticker) throw Object.assign(new Error("Wire in the company to stress."), { status: 400 });
    const deals = (ctx.inputs.deals ?? [])[0] as DealsValue | undefined;
    await ctx.progress("inputs", `Reading ${ticker}`);
    const tranches = defaultTranches().map((t) => (t.kind === "tlb" ? { ...t, turns: Number(ctx.config.leverage) || 4 } : t.kind === "notes" ? { ...t, turns: Number(ctx.config.notes) >= 0 ? Number(ctx.config.notes) : 1.5 } : t));
    const maxLev = Number(ctx.config.maxLeverage) || 7;
    await ctx.progress("simulate");
    const r = await runLab({ ticker, tranches, covenants: { maxNetLeverage: maxLev, minInterestCover: 1.75, springing: false, springAt: 0.35 }, years: Math.max(2, Math.min(5, Number(ctx.config.years) || 5)), seed: 7 + ctx.runId, ...(deals?.range?.median ? { entryMultiple: deals.range.median } : {}) });
    await ctx.progress("stress");
    const saved = await saveScenario(ctx.userId, { kind: "lbo", title: r.title, driver: "lbo", spec: { ticker, tranches, years: r.result.years, seed: r.seed } as Record<string, unknown>, result: r as unknown as Record<string, unknown> });
    const s = r.result;
    const by = Math.min(3, s.years);
    const value: Scenario = {
      id: saved.id, title: r.title, driver: "lbo", synthetic: true, recipe: r.recipe, seed: r.seed, horizon: s.years * 252, paths: s.paths, ...(r.realism ? { realism: r.realism.score } : {}),
      stats: [
        { label: `Covenant breach probability by year ${by}`, value: pct(s.breachByYear[by - 1] ?? 0) }, { label: "Median IRR", value: `${(s.irr.p50 * 100).toFixed(1)}%` },
        { label: "IRR 10th to 90th percentile", value: `${(s.irr.p10 * 100).toFixed(0)}% to ${(s.irr.p90 * 100).toFixed(0)}%` }, { label: "Chance of losing money (MOIC under 1x)", value: pct(s.odds.moicBelowOne) },
        { label: `Most a sponsor can pay for ${pct(s.maxPrice.hurdle)} IRR with ${pct(s.maxPrice.confidence)} probability`, value: s.maxPrice.multiple ? `${s.maxPrice.multiple.toFixed(1)}x EBITDA` : "no price clears it" },
        { label: "Gentlest scenario that breaks it", value: s.reverse.sentence },
      ],
      fan: [{ label: "MOIC if exited that year", p5: s.fan.map((f) => f.p5), p50: s.fan.map((f) => f.p50), p95: s.fan.map((f) => f.p95) }],
    };
    const table: Table = { title: `${r.title} (synthetic)`, synthetic: { recipe: r.recipe, seed: r.seed, ...(r.realism ? { realism: r.realism.score } : {}) }, columns: [{ name: "year", type: "num" }, { name: "breach_by_year", type: "num" }, { name: "leverage_test_fails", type: "num" }, { name: "cover_test_fails", type: "num" }, { name: "moic_p5", type: "num" }, { name: "moic_p50", type: "num" }, { name: "moic_p95", type: "num" }], rows: s.heatmap.map((h, k) => [h.year, s.breachByYear[k], h.leverage, h.cover, s.fan[k]?.p5 ?? null, s.fan[k]?.p50 ?? null, s.fan[k]?.p95 ?? null]) };
    return { outputs: { scenario: value, table }, summary: `SYNTHETIC · ${r.name}: breach by year ${by} ${pct(s.breachByYear[by - 1] ?? 0)}, median IRR ${(s.irr.p50 * 100).toFixed(1)}% (${s.paths} paths)`, preview: { kind: "chart", synthetic: true, series: [{ label: "MOIC p5", values: s.fan.map((f) => f.p5) }, { label: "median", values: s.fan.map((f) => f.p50) }, { label: "p95", values: s.fan.map((f) => f.p95) }] } };
  },
});
