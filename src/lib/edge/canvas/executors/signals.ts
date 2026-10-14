/**
 * Signals blocks (Edge next): precedents from the deal database (E1), the Alt-Data Pulse's series (E3) and
 * the Deal Radar's odds (E4). Each reads stored, shared data first; the free work they may start (a stub
 * read, a Pulse refresh) runs only when the block's settings ask for it.
 */
import { buildQuery } from "../../deals/query";
import { bandSentence } from "../../deals/range";
import { similarDeals } from "../../deals/store";
import { register } from "../engine";
import type { Companies, DealsValue, ProformaValue, Table } from "../values";

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
