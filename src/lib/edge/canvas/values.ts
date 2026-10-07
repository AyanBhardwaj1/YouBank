/**
 * The data that travels along canvas wires, one shape per kind, and the three things every consumer
 * needs from any of them: rows for an export, numbered evidence for a cited memo, and a single number
 * for a signal. Synthetic values carry their recipe and seed and say so wherever they go. Pure.
 */
import type { Kind } from "./catalog";
import type { MarketResult } from "../scen/market";
import type { ClaimSupport, VerifierInfo } from "../claims/types";

export type Companies = { items: { ticker: string; name: string }[] };
export type Places = { items: { key?: string; name: string; bbox: number[] }[] };
export type Finding = { id: number; title: string; kind: string; confidence: number; tickers: string[]; site?: string; company?: string; lon?: number; lat?: number; observedAt: string | null; hectares?: number; verdict?: string; summary: string; sources: string[] };
export type Findings = { items: Finding[]; note?: string };
export type ProformaValue = { parties: { label: string; ticker: string; pipelineKm: number; plants: number; capacityMMcfd: number }[]; combined: { pipelineKm: number; plants: number; capacityMMcfd: number; capacityShare: number }; overlap: { counties: number; adjacentCounties: number; parallelKm: number }; counties: { name: string; hhiBefore: number | null; hhiAfter: number | null; delta: number | null; flag: string }[]; divestitures: { plant: string; company: string; capacityMMcfd: number; county: string; reason: string }[]; place: string; method: string };
export type Citation = { n: number; docId: number; title: string; page?: number; tStart?: number; quote: string; url?: string };
export type Answer = { question: string; mode: string; text: string; claims: { text: string; cites: number[]; analysis?: boolean }[]; citations: Citation[]; notFound: boolean; answerId?: number };
export type Ranking = { finding: string; subject: string; items: { name: string; ticker?: string; nodeId?: number; score: number; reasons: string[] }[]; scorecard?: string };
export type GraphValue = { nodes: { id: number; name: string; kind: string; ticker?: string }[]; links: { s: number; d: number; kind: string }[] };
export type Scenario = { id?: number; title: string; driver: string; synthetic: true; recipe: string; seed: number; horizon: number; paths: number; stats: { label: string; value: string }[]; fan?: { label: string; p5: number[]; p50: number[]; p95: number[] }[]; realism?: number };
export type Table = { columns: { name: string; type: "num" | "cat" | "text" }[]; rows: (string | number | null)[][]; synthetic?: { recipe: string; seed: number; realism?: number }; title?: string };
export type Memo = {
  title: string; markdown: string; sources: { n: number; label: string; url?: string }[];
  /** Calibrated Claims on the memo's paragraphs (indicative: the verifier is calibrated on answer claims). */
  paragraphs?: { text: string; cites: number[]; support?: ClaimSupport }[]; verifier?: VerifierInfo;
};
export type Signal = { metric: string; value: number; previous?: number | null; triggered: boolean; detail: string };
export type FileValue = { name: string; key: string; bytes: number; url?: string };

export type Evidence = { label: string; text: string; url?: string; synthetic?: boolean };

const fmt = (v: number, dp = 0) => v.toLocaleString("en-US", { maximumFractionDigits: dp });

/** Everything a value says, as short numbered facts a memo can cite. */
export function evidenceOf(kind: Kind | string, v: unknown): Evidence[] {
  if (!v || typeof v !== "object") return [];
  switch (kind) {
    case "findings": return (v as Findings).items.slice(0, 12).map((f) => ({ label: `${f.title} (${f.site ?? f.tickers.join(", ")}, ${f.observedAt?.slice(0, 10) ?? "undated"}, confidence ${Math.round(f.confidence * 100)})`, text: `${f.summary}${f.verdict ? ` Foundation-model check: ${f.verdict}.` : ""}` }));
    case "proforma": {
      const p = v as ProformaValue;
      return [
        { label: `Pro-forma footprint in the ${p.place}`, text: `${p.parties.map((x) => `${x.label}: ${fmt(x.capacityMMcfd)} MMcfd across ${x.plants} plants, ${fmt(x.pipelineKm)} km of mapped pipeline`).join("; ")}. Together ${fmt(p.combined.capacityMMcfd)} MMcfd, ${Math.round(p.combined.capacityShare * 100)}% of mapped processing capacity; both operate in ${p.overlap.counties} counties; ${fmt(p.overlap.parallelKm)} km of pipelines run within a kilometre of each other.` },
        ...p.counties.filter((c) => c.flag).slice(0, 4).map((c) => ({ label: `County screen: ${c.name}`, text: `Processing HHI ${c.hhiBefore ?? "n/a"} to ${c.hhiAfter ?? "n/a"} (+${c.delta ?? 0}), ${c.flag === "high" ? "above" : "near"} the 2023 Merger Guidelines screen.` })),
        ...(p.divestitures.length ? [{ label: "Likely divestitures", text: p.divestitures.slice(0, 5).map((d) => `${d.plant} (${d.company}, ${fmt(d.capacityMMcfd)} MMcfd, ${d.county})`).join("; ") }] : []),
      ];
    }
    case "answer": {
      const a = v as Answer;
      if (a.notFound) return [{ label: `Documents on "${a.question}"`, text: "The documents do not answer this." }];
      return a.citations.slice(0, 12).map((c) => ({ label: `${c.title}${c.page ? `, p. ${c.page}` : ""}${c.tStart !== undefined ? ` at ${Math.floor(c.tStart / 60)}:${String(Math.floor(c.tStart % 60)).padStart(2, "0")}` : ""}`, text: `"${c.quote}"`, url: c.url }));
    }
    case "ranking": {
      const r = v as Ranking;
      return r.items.slice(0, 10).map((i, k) => ({ label: `${r.finding} for ${r.subject}, #${k + 1}: ${i.name}${i.ticker ? ` (${i.ticker})` : ""}`, text: `score ${i.score.toFixed(2)}; ${i.reasons.slice(0, 2).join("; ")}${r.scorecard ? ` (${r.scorecard})` : ""}` }));
    }
    case "graph": { const g = v as GraphValue; return [{ label: "Relationship graph", text: `${g.nodes.length} entities and ${g.links.length} links.` }]; }
    case "scenario": {
      const s = v as Scenario;
      return [{ label: `SYNTHETIC scenario: ${s.title}`, text: `${s.paths} simulated paths over ${s.horizon} trading days (${s.recipe}, seed ${s.seed}). ${s.stats.map((x) => `${x.label}: ${x.value}`).join("; ")}.`, synthetic: true }];
    }
    case "table": {
      const t = v as Table;
      const head = { label: `${t.synthetic ? "SYNTHETIC " : ""}table${t.title ? `: ${t.title}` : ""}`, text: `${t.rows.length} rows; columns ${t.columns.map((c) => c.name).join(", ")}.${t.synthetic ? ` Synthetic (${t.synthetic.recipe}, seed ${t.synthetic.seed}).` : ""}`, synthetic: !!t.synthetic };
      // A short table's rows are evidence in themselves (a terrain reading, a ranking someone typed in).
      const rows = t.rows.length <= 50 ? t.rows.slice(0, 8).map((r, i) => ({ label: `${t.title ?? "Table"}, row ${i + 1}`, text: t.columns.map((c, j) => `${c.name}: ${r[j] ?? ""}`).join("; "), synthetic: !!t.synthetic })) : [];
      return [head, ...rows];
    }
    case "memo": { const m = v as Memo; return [{ label: m.title, text: m.markdown.slice(0, 1500) }]; }
    case "signal": { const s = v as Signal; return [{ label: `Signal: ${s.metric}`, text: `${s.value}${s.triggered ? " (crossed its line)" : ""}. ${s.detail}` }]; }
    case "companies": return [{ label: "Companies", text: (v as Companies).items.map((c) => `${c.name} (${c.ticker})`).join(", ") }];
    case "places": return [{ label: "Places", text: (v as Places).items.map((p) => p.name).join(", ") }];
    default: return [];
  }
}

/** A value as a table, for exports. */
export function rowsOf(kind: Kind | string, v: unknown): Table | null {
  if (!v || typeof v !== "object") return null;
  switch (kind) {
    case "table": return v as Table;
    case "findings": return {
      columns: ["id", "title", "company", "tickers", "site", "observed", "confidence", "hectares", "foundation_models", "lon", "lat"].map((name) => ({ name, type: ["id", "confidence", "hectares", "lon", "lat"].includes(name) ? "num" as const : "text" as const })),
      rows: (v as Findings).items.map((f) => [f.id, f.title, f.company ?? "", f.tickers.join(" "), f.site ?? "", f.observedAt?.slice(0, 10) ?? "", f.confidence, f.hectares ?? null, f.verdict ?? "", f.lon ?? null, f.lat ?? null]),
    };
    case "ranking": return {
      columns: [{ name: "rank", type: "num" }, { name: "name", type: "text" }, { name: "ticker", type: "text" }, { name: "score", type: "num" }, { name: "reasons", type: "text" }],
      rows: (v as Ranking).items.map((i, k) => [k + 1, i.name, i.ticker ?? "", Math.round(i.score * 1000) / 1000, i.reasons.join("; ")]),
    };
    case "proforma": {
      const p = v as ProformaValue;
      return {
        columns: [{ name: "county", type: "text" }, { name: "hhi_before", type: "num" }, { name: "hhi_after", type: "num" }, { name: "change", type: "num" }, { name: "screen", type: "text" }],
        rows: p.counties.map((c) => [c.name, c.hhiBefore, c.hhiAfter, c.delta, c.flag]),
      };
    }
    default: return null;
  }
}

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function toCsv(t: Table): string {
  const head = t.columns.map((c) => csvCell(c.name)).join(",");
  const body = t.rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const note = t.synthetic ? `# SYNTHETIC DATA: ${t.synthetic.recipe}, seed ${t.synthetic.seed}\n` : "";
  return `${note}${head}\n${body}`;
}

/** One number to watch from any value, and what it means. */
export function metricOf(kind: Kind | string, v: unknown): { metric: string; value: number; detail: string } | null {
  if (!v || typeof v !== "object") return null;
  switch (kind) {
    case "findings": { const f = v as Findings; const top = f.items.reduce((m, x) => Math.max(m, x.confidence), 0); return { metric: "Ground changes found", value: f.items.length, detail: f.items.length ? `highest confidence ${Math.round(top * 100)}` : "nothing new" }; }
    case "proforma": { const p = v as ProformaValue; const high = p.counties.filter((c) => c.flag === "high").length; return { metric: "Counties screening high", value: high, detail: `${Math.round(p.combined.capacityShare * 100)}% of mapped processing together` }; }
    case "answer": { const a = v as Answer; return { metric: "Cited claims", value: a.notFound ? 0 : a.claims.filter((c) => c.cites.length).length, detail: a.notFound ? "not found in the documents" : `${a.citations.length} passages` }; }
    case "ranking": { const r = v as Ranking; return { metric: `Top ${r.finding} score`, value: Math.round((r.items[0]?.score ?? 0) * 1000) / 1000, detail: r.items[0] ? `${r.items[0].name} leads` : "no candidates" }; }
    case "scenario": { const s = v as Scenario; const worst = s.stats.find((x) => /loss|var|drawdown/i.test(x.label)); return { metric: worst ? `SYNTHETIC ${worst.label}` : "SYNTHETIC paths", value: worst ? Number.parseFloat(worst.value) || 0 : s.paths, detail: `${s.recipe}, seed ${s.seed}` }; }
    case "table": return { metric: "Rows", value: (v as Table).rows.length, detail: (v as Table).synthetic ? "synthetic" : "" };
    case "graph": return { metric: "Links", value: (v as GraphValue).links.length, detail: `${(v as GraphValue).nodes.length} entities` };
    case "companies": return { metric: "Companies", value: (v as Companies).items.length, detail: "" };
    case "signal": return { metric: (v as Signal).metric, value: (v as Signal).value, detail: (v as Signal).detail };
    default: return null;
  }
}

/** Whether a signal crosses its line. Pure. */
export function crossed(when: string, value: number, threshold: number, previous: number | null | undefined): boolean {
  if (when === "above") return value > threshold;
  if (when === "below") return value < threshold;
  return previous !== null && previous !== undefined && value !== previous;
}

/** The kind a value arrived as, from the wire's source port (the engine passes values without kinds). */
export function kindOfValue(v: unknown): Kind | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if ("claims" in o && "citations" in o) return "answer";
  if ("combined" in o && "parties" in o) return "proforma";
  if ("finding" in o && "items" in o) return "ranking";
  if ("driver" in o && "synthetic" in o) return "scenario";
  if ("columns" in o && "rows" in o) return "table";
  if ("markdown" in o) return "memo";
  if ("metric" in o && "triggered" in o) return "signal";
  if ("nodes" in o && "links" in o) return "graph";
  if ("key" in o && "bytes" in o) return "file";
  if ("scope" in o) return "docs";
  if (Array.isArray(o.items)) {
    const first = (o.items as Record<string, unknown>[])[0];
    if (!first) return "findings";
    if ("confidence" in first) return "findings";
    if ("bbox" in first) return "places";
    if ("ticker" in first) return "companies";
  }
  return null;
}

const pctOf = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

/** A market scenario's result as the value that travels on wires and into Studio. Pure. */
export function marketValue(r: MarketResult, id: number | null, driver: string): Scenario {
  const port = r.summary.finals.find((f) => f.series === "Portfolio") ?? r.summary.finals[0];
  const fanOf = (name: string) => { const f = r.summary.fans.find((x) => x.series === name)!; return { label: name === "Portfolio" ? "Equal-weight portfolio" : name, p5: f.p5, p50: f.p50, p95: f.p95 }; };
  return {
    ...(id ? { id } : {}), title: r.title, driver: `${driver}${r.replay ? `: ${r.replay.label}` : r.shock ? `: ${r.shock.described}` : ""}`, synthetic: true, recipe: r.recipe, seed: r.seed, horizon: r.horizon, paths: r.paths,
    stats: [
      { label: "Median outcome", value: pctOf(port.p50) }, { label: "Bad case (5th percentile)", value: pctOf(port.p5) }, { label: "Chance of a loss", value: `${Math.round(port.probLoss * 100)}%` },
      { label: "Expected shortfall (95%)", value: pctOf(-port.cvar95) }, { label: "Worst drawdown in 1 of 20 paths", value: pctOf(r.summary.drawdown.p95) },
      ...r.summary.finals.filter((f) => f.series !== "Portfolio").slice(0, 4).map((f) => ({ label: `${f.series} median`, value: pctOf(f.p50) })),
    ],
    fan: ["Portfolio", ...r.names.slice(0, 3)].filter((n) => r.summary.fans.some((x) => x.series === n)).map(fanOf), realism: r.realism.score,
  };
}
