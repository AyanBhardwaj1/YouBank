/**
 * Networks · GNN block: for the wired-in companies (read into the graph first when they are not there
 * yet), the chosen finding: likely acquirers or targets from the deal model with their reason paths,
 * who a shock would reach, warm introduction paths from the person's CRM, or red flags; plus the
 * company's neighbourhood as a graph for the canvas preview.
 */
import { resolveTicker } from "@/lib/edgar/tickers";
import { exposureOf, predictions, redFlags, subgraph, warmIntros } from "../../graph/findings";
import { ingestCompany } from "../../graph/ingest";
import { companyByTicker, type NodeRow } from "../../graph/store";
import { register } from "../engine";
import type { Companies, GraphValue, Ranking } from "../values";

const LABEL: Record<string, string> = { acquirers: "Likely acquirers", targets: "Likely targets", contagion: "Exposure to a shock", intros: "Warm intro paths", flags: "Red flags" };
const tickersIn = (values: unknown[] | undefined) => [...new Set((values ?? []).flatMap((v) => (v as Companies).items?.map((c) => c.ticker) ?? []))].slice(0, 5);

register("net.graph", {
  async start(ctx) {
    const tickers = tickersIn(ctx.inputs.companies);
    if (!tickers.length) throw Object.assign(new Error("Wire in the companies to look at."), { status: 400 });
    const finding = typeof ctx.config.finding === "string" && LABEL[ctx.config.finding] ? ctx.config.finding : "acquirers";
    const limit = Math.max(3, Math.min(25, Number(ctx.config.limit) || 10));
    await ctx.progress("pull", `Reading ${tickers.join(", ")} from the graph`);
    const nodes: NodeRow[] = [];
    for (const t of tickers) {
      let n = await companyByTicker(t);
      if (!n && Date.now() < ctx.deadline - 150_000) {
        const tk = await resolveTicker(t);
        if (tk) { await ctx.progress("pull", `Building ${t}'s network from its filings`); await ingestCompany(tk.cik, Math.min(ctx.deadline - 60_000, Date.now() + 150_000)); n = await companyByTicker(t); }
      }
      if (n) nodes.push(n);
    }
    if (!nodes.length) throw Object.assign(new Error(`None of ${tickers.join(", ")} could be found in SEC filings.`), { status: 404 });
    await ctx.progress("filter");
    const items: Ranking["items"] = [];
    let scorecard: string | undefined;
    for (const n of nodes) {
      if (finding === "acquirers" || finding === "targets") {
        const p = await predictions(n, finding === "acquirers" ? "acquirer" : "target", limit);
        scorecard = p.scorecard;
        for (const x of p.items) items.push({ name: `${x.node.name}${nodes.length > 1 ? ` (for ${n.ticker})` : ""}`, ticker: x.node.ticker || undefined, nodeId: x.node.id, score: x.score, reasons: [...x.paths.slice(0, 2).map((path) => path.map((s) => s.text).join("; ")), ...x.also].slice(0, 4) });
      } else if (finding === "contagion") {
        for (const x of await exposureOf(n, limit)) items.push({ name: x.node.name, ticker: x.node.ticker || undefined, nodeId: x.node.id, score: x.score, reasons: [x.via.map((s) => s.text).join("; ")].filter(Boolean) });
      } else if (finding === "intros") {
        for (const x of await warmIntros(ctx.userId, n, limit)) items.push({ name: `${x.contact.name} (${x.contact.via}) to ${n.name}`, score: Math.round(x.strength * 100) / 100, reasons: x.steps.map((s) => s.text) });
      } else {
        for (const f of await redFlags(n)) items.push({ name: `${n.ticker}: ${f.title}`, ticker: n.ticker, nodeId: n.id, score: f.severity === "high" ? 1 : 0.5, reasons: [f.detail] });
      }
    }
    await ctx.progress("score");
    const g = await subgraph(nodes[0], 120);
    const graph: GraphValue = { nodes: g.nodes.map((x) => ({ id: x.id, name: x.name, kind: x.kind, ...(x.ticker ? { ticker: x.ticker } : {}) })), links: g.links.map((l) => ({ s: l.s, d: l.d, kind: l.kind })) };
    await ctx.progress("rank");
    const ranked = items.sort((a, b) => b.score - a.score).slice(0, limit * nodes.length);
    const ranking: Ranking = { finding: LABEL[finding], subject: nodes.map((n) => n.name).join(", "), items: ranked, ...(scorecard ? { scorecard } : {}) };
    return {
      outputs: { ranking, graph },
      summary: ranked.length ? `${ranked.length} ${LABEL[finding].toLowerCase()} for ${nodes.map((n) => n.ticker).join(", ")}` : `No ${LABEL[finding].toLowerCase()} found for ${nodes.map((n) => n.ticker).join(", ")}`,
      preview: { kind: "list", items: ranked.slice(0, 5).map((i) => ({ label: i.name, detail: i.reasons[0]?.slice(0, 120), score: i.score })) },
    };
  },
});
