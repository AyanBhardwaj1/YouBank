/**
 * Signals blocks (Edge next): precedents from the deal database (E1), the Alt-Data Pulse's series (E3) and
 * the Deal Radar's odds (E4). Each reads stored, shared data first; the free work they may start (a stub
 * read, a Pulse refresh) runs only when the block's settings ask for it.
 */
import { buildQuery } from "../../deals/query";
import { bandSentence } from "../../deals/range";
import { similarDeals } from "../../deals/store";
import { companyNode } from "../../entities/resolve";
import { falseAlarms, loadWarn, pulseOf, refreshCompany } from "../../pulse/ingest";
import { changeVerdict, falseAlarmSentence } from "../../series/change";
import { metricDef } from "../../series/metrics";
import { oddsFor } from "../../odds/score";
import { register } from "../engine";
import type { Companies, DealsValue, Findings, ProformaValue, Ranking, SeriesValue, Table } from "../values";

const tickersIn = (values: unknown[] | undefined) => [...new Set((values ?? []).flatMap((v) => {
  const c = v as Companies & ProformaValue;
  if (Array.isArray(c.items)) return c.items.map((x) => x.ticker).filter(Boolean);
  if (Array.isArray(c.parties)) return c.parties.map((p) => p.ticker).filter(Boolean);
  return [];
}))];

register("deals.precedents", {
  async start(ctx) {
    const tickers = tickersIn(ctx.inputs.in).slice(0, 3);
    if (!tickers.length) throw Object.assign(new Error("Wire in the companies to find precedents for."), { status: 400 });
    const years = Math.max(1, Math.min(12, Number(ctx.config.years) || 8));
    const k = Math.max(5, Math.min(40, Number(ctx.config.k) || 15));
    const buyer = typeof ctx.config.buyer === "string" ? ctx.config.buyer : "";
    const from = new Date(Date.now() - years * 365 * 86_400_000).toISOString().slice(0, 10);
    const items: DealsValue["items"] = [];
    let last: Awaited<ReturnType<typeof similarDeals>> | null = null;
    for (const t of tickers) {
      await ctx.progress("query", `Describing ${t}`);
      const q = await buildQuery({ ticker: t, buyerType: buyer });
      if (!q) continue;
      await ctx.progress("retrieve", `Finding deals like ${t}`);
      last = await similarDeals(q, { from, buyer: buyer || undefined }, k);
      for (const r of last.results) if (!items.some((x) => x.id === r.id)) {
        const src = r.sources.find((s) => s.role === "proxy" || s.role === "tender") ?? r.sources[0];
        items.push({ id: r.id, target: r.targetName || "Unnamed target", buyer: r.acquirerName, announced: String(r.announcedAt ?? ""), evUsdMm: r.evUsdMm, evEbitda: r.evEbitda, evRevenue: r.evRevenue, premium: r.premiumUnaffected, buyerType: r.buyerType, why: r.why, url: src?.url ?? "" });
      }
    }
    await ctx.progress("range");
    const range = last?.range.evEbitda ? { median: last.range.evEbitda.median, p25: last.range.evEbitda.p25, p75: last.range.evEbitda.p75, n: last.range.evEbitda.n } : null;
    const band = last?.range.band ? { ...last.range.band, text: bandSentence(last.range.band) } : null;
    const value: DealsValue = { type: "deals", title: `Deals like ${tickers.join(", ")}`, query: tickers.join(", "), method: last?.query.method ?? "", items: items.slice(0, k * tickers.length), range, band };
    const table: Table = { title: value.title, columns: [{ name: "target", type: "text" }, { name: "buyer", type: "text" }, { name: "announced", type: "text" }, { name: "ev_usd_mm", type: "num" }, { name: "ev_ebitda", type: "num" }, { name: "premium", type: "num" }, { name: "why", type: "text" }], rows: value.items.map((x) => [x.target, x.buyer, x.announced, x.evUsdMm, x.evEbitda, x.premium, x.why.join("; ")]) };
    return {
      outputs: { deals: value, table },
      summary: value.items.length ? `${value.items.length} precedents${range ? `, median ${range.median.toFixed(1)}x EV/EBITDA` : ""}` : "No precedents in the deal database yet for these companies",
      preview: { kind: "list", items: value.items.slice(0, 5).map((x) => ({ label: `${x.target}${x.buyer ? ` / ${x.buyer}` : ""}`, detail: [x.evEbitda ? `${x.evEbitda.toFixed(1)}x` : "", x.why.slice(0, 2).join("; ")].filter(Boolean).join(" · "), score: undefined })) },
    };
  },
});

register("pulse.signals", {
  async start(ctx) {
    const tickers = tickersIn(ctx.inputs.companies).slice(0, 5);
    if (!tickers.length) throw Object.assign(new Error("Wire in the companies to read signals for."), { status: 400 });
    const want = typeof ctx.config.metric === "string" ? ctx.config.metric : "";
    const items: SeriesValue["items"] = [];
    const found: Findings["items"] = [];
    const notices = ctx.config.refresh ? await loadWarn().catch(() => []) : [];
    const fa = await falseAlarms().catch(() => ({} as Record<string, number>));
    const famOf = (m: string) => (m.startsWith("jobs.dept") ? "jobs.dept" : m.startsWith("jobs") ? "jobs" : m === "wiki.views" ? "attention" : m.startsWith("patents") ? "patents" : "");
    for (const t of tickers) {
      await ctx.progress("crosswalk", `Matching ${t}`);
      const node = await companyNode(t);
      if (!node) continue;
      if (ctx.config.refresh && Date.now() < ctx.deadline - 60_000) { await ctx.progress("read", `Reading ${t}'s sources`); await refreshCompany(node.id, Math.min(ctx.deadline - 30_000, Date.now() + 60_000), { notices }).catch(() => undefined); }
      await ctx.progress("detect");
      const p = await pulseOf(node.id);
      if (!p) continue;
      for (const [metric, points] of Object.entries(p.series)) {
        if (want && metric !== want) continue;
        if (!want && (metric.startsWith("jobs.dept.") || metric.startsWith("jobs.tell.") || metric === "jobs.new" || metric === "patents.apps" || metric === "usasp.awards")) continue;
        const v = points.length >= 12 ? changeVerdict(points.map((x) => x.value)) : null;
        const def = metricDef(metric);
        items.push({ ticker: t, name: p.name, metric, label: def?.label ?? metric, unit: def?.unit ?? "", points: points.slice(-104), latest: points.at(-1)?.value ?? null, change: v && Number.isFinite(v.move) ? v.move : null, changeProb: v?.prob ?? null, falseAlarms: v && famOf(metric) ? falseAlarmSentence(fa[famOf(metric)] ?? NaN) : "", source: def?.source ?? "" });
      }
      for (const f of p.findings.slice(0, 6)) found.push({ id: f.id, title: f.title, kind: f.kind, confidence: f.confidence, tickers: [t], observedAt: f.observedAt, summary: f.summary, sources: [] });
    }
    const value: SeriesValue = { type: "series", items, ...(items.length ? {} : { note: "No signals stored for these companies yet; switch on 'Read the sources now'." }) };
    return {
      outputs: { series: value, findings: { items: found } satisfies Findings },
      summary: `${items.length} series, ${found.length} recent changes for ${tickers.join(", ")}`,
      preview: { kind: "chart", series: items.slice(0, 4).map((x) => ({ label: `${x.ticker} ${x.label}`, values: x.points.slice(-26).map((p) => p.value) })) },
    };
  },
});

register("odds.score", {
  async start(ctx) {
    const tickers = tickersIn(ctx.inputs.companies).slice(0, 25);
    if (!tickers.length) throw Object.assign(new Error("Wire in the companies to score."), { status: 400 });
    await ctx.progress("features");
    const items: Ranking["items"] = [];
    const rows: Table["rows"] = [];
    let version = "", scorecard = "";
    for (const t of tickers) {
      const node = await companyNode(t);
      const o = node ? await oddsFor(node.id) : null;
      if (!o) continue;
      version = o.version; scorecard = o.scorecard;
      items.push({ name: o.name, ticker: o.ticker, nodeId: o.nodeId, score: o.p, reasons: [`model probability ${(o.p * 100).toFixed(1)}%${o.low !== null && o.high !== null ? ` (interval ${(o.low * 100).toFixed(0)}-${(o.high * 100).toFixed(0)}%)` : ""} against a ${(o.base * 100).toFixed(1)}% sector base rate`, ...o.reasons.map((r) => `${r.direction === "up" ? "raises" : "lowers"} it: ${r.label}`)] });
      rows.push([o.ticker, o.name, o.p, o.low, o.high, o.base, o.reasons.map((r) => r.label).join("; ")]);
    }
    await ctx.progress("score");
    await ctx.progress("explain");
    const ranked = items.sort((a, b) => b.score - a.score);
    const ranking: Ranking = { finding: "12-month sale odds (Deal Radar, model probability)", subject: tickers.join(", "), items: ranked, ...(scorecard ? { scorecard: `${scorecard} A statistical estimate from public filings, not a rumour or advice.` } : {}) };
    const table: Table = { title: `Deal Radar ${version}`, columns: [{ name: "ticker", type: "cat" }, { name: "name", type: "text" }, { name: "probability_12m", type: "num" }, { name: "low", type: "num" }, { name: "high", type: "num" }, { name: "sector_base_rate", type: "num" }, { name: "reasons", type: "text" }], rows };
    return {
      outputs: { ranking, table },
      summary: ranked.length ? `${ranked.length} scored; highest ${ranked[0].ticker} at ${(ranked[0].score * 100).toFixed(1)}% (model probability)` : "None of these companies is scored yet (this round covers energy, technology and healthcare)",
      preview: { kind: "list", items: ranked.slice(0, 5).map((i) => ({ label: `${i.ticker ?? i.name}`, detail: i.reasons[0], score: i.score })) },
    };
  },
});
