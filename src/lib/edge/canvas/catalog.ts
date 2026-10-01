/**
 * The canvas's building blocks, shared by the browser and the server. A node belongs to a module
 * (sources, Earth, Documents, Networks, Scenarios, outputs), has typed input and output ports, and
 * expands into the steps it runs. Wires carry one kind of data from an output to an input that accepts
 * it. Pure: validation, next-node tips, automatic layout and the starter canvases live here too.
 */

export type Kind = "companies" | "places" | "findings" | "proforma" | "docs" | "answer" | "ranking" | "graph" | "scenario" | "table" | "memo" | "signal" | "file";
export type Module = "source" | "earth" | "documents" | "networks" | "scenarios" | "output";

export type Field =
  | { key: string; label: string; type: "tickers"; help?: string }
  | { key: string; label: string; type: "text" | "textarea"; placeholder?: string; help?: string; required?: boolean }
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[]; help?: string }
  | { key: string; label: string; type: "multiselect"; options: { value: string; label: string }[]; help?: string }
  | { key: string; label: string; type: "number"; min: number; max: number; step?: number; help?: string }
  | { key: string; label: string; type: "toggle"; help?: string };

export type Port = { name: string; label: string; kinds: (Kind | "any")[]; required?: boolean; multi?: boolean };
export type OutPort = { name: string; label: string; kind: Kind };

export type NodeDef = {
  type: string; module: Module; label: string; tech?: string; icon: string; blurb: string;
  inputs: Port[]; outputs: OutPort[]; steps: { id: string; label: string }[]; fields: Field[]; defaults: Record<string, unknown>;
};

export type CanvasNode = { id: string; type: string; position: { x: number; y: number }; data: { title?: string; config: Record<string, unknown>; expanded?: boolean } };
export type CanvasEdge = { id: string; source: string; sourceHandle: string; target: string; targetHandle: string };
export type Graph = { nodes: CanvasNode[]; edges: CanvasEdge[]; viewport?: { x: number; y: number; zoom: number } };

const PLACE_OPTIONS = [{ value: "permian", label: "Permian Basin" }, { value: "delaware", label: "Delaware Basin" }, { value: "midland", label: "Midland Basin" }, { value: "waha", label: "Waha hub" }];

export const NODES: NodeDef[] = [
  /* ---------- Sources ---------- */
  {
    type: "source.companies", module: "source", label: "Companies", icon: "Building2", blurb: "Tickers to work on: typed in, or everything you watch",
    inputs: [], outputs: [{ name: "companies", label: "Companies", kind: "companies" }], steps: [],
    fields: [{ key: "tickers", label: "Tickers", type: "tickers", help: "Leave empty to use the companies you watch in Edge" }],
    defaults: { tickers: [] },
  },
  {
    type: "source.place", module: "source", label: "Place", icon: "Map", blurb: "A region to watch",
    inputs: [], outputs: [{ name: "places", label: "Place", kind: "places" }], steps: [],
    fields: [{ key: "place", label: "Place", type: "select", options: PLACE_OPTIONS }],
    defaults: { place: "permian" },
  },
  {
    type: "source.deal", module: "source", label: "Deal", icon: "Handshake", blurb: "The companies in a deal: typed in, or the newest deal touching your watches",
    inputs: [], outputs: [{ name: "companies", label: "Parties", kind: "companies" }], steps: [],
    fields: [{ key: "parties", label: "Parties", type: "tickers", help: "Buyer first. Leave empty for the newest Newsroom deal that touches your watches" }],
    defaults: { parties: [] },
  },
  {
    type: "source.documents", module: "source", label: "Documents", icon: "FileSearch", blurb: "Filings, calls, your uploads, the workspace, the Newsroom and the web",
    inputs: [{ name: "companies", label: "Companies", kinds: ["companies"] }], outputs: [{ name: "docs", label: "Documents", kind: "docs" }], steps: [],
    fields: [
      { key: "sources", label: "Sources", type: "multiselect", options: [{ value: "sec", label: "SEC filings" }, { value: "uploads", label: "My uploads" }, { value: "audio", label: "Calls and recordings" }, { value: "workspace", label: "My workspace" }, { value: "newsroom", label: "Newsroom archive" }, { value: "web", label: "The live web" }] },
      { key: "forms", label: "Filing types", type: "multiselect", options: [{ value: "10-K", label: "10-K" }, { value: "10-Q", label: "10-Q" }, { value: "8-K", label: "8-K" }, { value: "DEF 14A", label: "Proxy" }, { value: "S-4", label: "S-4" }] },
      { key: "months", label: "Look back (months)", type: "number", min: 1, max: 36 },
    ],
    defaults: { sources: ["sec", "uploads"], forms: ["10-K", "10-Q", "8-K"], months: 12 },
  },
  {
    type: "source.dataset", module: "source", label: "Dataset", icon: "Table", blurb: "A table you uploaded (CSV or Excel)",
    inputs: [], outputs: [{ name: "table", label: "Table", kind: "table" }], steps: [],
    fields: [{ key: "fileId", label: "Uploaded file", type: "text", placeholder: "Pick a CSV or Excel upload" }],
    defaults: { fileId: "" },
  },

  /* ---------- Earth · GeoAI ---------- */
  {
    type: "earth.watch", module: "earth", label: "Earth", tech: "GeoAI", icon: "Globe", blurb: "What changed on the ground at the companies' sites or in a place",
    inputs: [{ name: "in", label: "Companies or place", kinds: ["companies", "places"], required: true }],
    outputs: [{ name: "findings", label: "Ground changes", kind: "findings" }],
    steps: [{ id: "assets", label: "Pull assets" }, { id: "check", label: "Check satellites" }, { id: "refine", label: "Confirm with foundation models" }, { id: "summarize", label: "Summarize" }],
    fields: [
      { key: "sites", label: "Sites per company", type: "number", min: 1, max: 8 },
      { key: "months", label: "Include findings from the last (months)", type: "number", min: 1, max: 12 },
      { key: "minConfidence", label: "Lowest confidence to keep", type: "number", min: 0, max: 0.9, step: 0.05 },
      { key: "refine", label: "Confirm with Prithvi and Segment Anything", type: "toggle" },
    ],
    defaults: { sites: 3, months: 6, minConfidence: 0.3, refine: true },
  },
  {
    type: "earth.terrain", module: "earth", label: "Terrain", tech: "GeoAI", icon: "Mountain", blurb: "The ground at sites and ground changes: slope, relief, and the earth new pads took to level, from lidar where it has been flown",
    inputs: [{ name: "in", label: "Ground changes or companies", kinds: ["findings", "companies"], required: true }],
    outputs: [{ name: "table", label: "Terrain", kind: "table" }],
    steps: [{ id: "elevation", label: "Read elevation" }, { id: "measure", label: "Measure" }],
    fields: [{ key: "sites", label: "Most sites", type: "number", min: 1, max: 12 }],
    defaults: { sites: 6 },
  },
  {
    type: "earth.proforma", module: "earth", label: "Deal what-if", tech: "GeoAI", icon: "Handshake", blurb: "What the companies would own together, where they overlap, and likely divestitures",
    inputs: [{ name: "companies", label: "Two to four companies", kinds: ["companies"], required: true }],
    outputs: [{ name: "proforma", label: "Pro-forma", kind: "proforma" }],
    steps: [{ id: "parties", label: "Resolve parties" }, { id: "overlay", label: "Overlay footprints" }, { id: "screen", label: "Screen counties" }, { id: "divest", label: "Name divestitures" }],
    fields: [{ key: "place", label: "Where", type: "select", options: PLACE_OPTIONS }],
    defaults: { place: "permian" },
  },

  /* ---------- Documents · RAG ---------- */
  {
    type: "docs.ask", module: "documents", label: "Documents", tech: "RAG", icon: "FileSearch", blurb: "A cited answer from the documents",
    inputs: [{ name: "docs", label: "Documents or companies", kinds: ["docs", "companies"], required: true }],
    outputs: [{ name: "answer", label: "Cited answer", kind: "answer" }],
    steps: [{ id: "gather", label: "Gather sources" }, { id: "retrieve", label: "Retrieve passages" }, { id: "answer", label: "Draft the answer" }, { id: "check", label: "Check citations" }],
    fields: [
      { key: "question", label: "Question", type: "textarea", placeholder: "What did management say about Permian volumes?", required: true },
      { key: "mode", label: "Strictness", type: "select", options: [{ value: "strict", label: "Strict: every claim quoted, or not found" }, { value: "balanced", label: "Balanced: analysis marked as analysis" }] },
      { key: "form", label: "Answer as", type: "select", options: [{ value: "auto", label: "Whatever fits" }, { value: "direct", label: "A direct answer" }, { value: "table", label: "A table" }, { value: "timeline", label: "A timeline" }, { value: "memo", label: "A memo" }] },
    ],
    defaults: { question: "", mode: "strict", form: "auto" },
  },
  {
    type: "docs.changes", module: "documents", label: "Change radar", tech: "RAG", icon: "Radar", blurb: "What changed between a company's last two filings",
    inputs: [{ name: "companies", label: "Companies", kinds: ["companies"], required: true }],
    outputs: [{ name: "table", label: "Changes", kind: "table" }, { name: "memo", label: "Summary", kind: "memo" }],
    steps: [{ id: "fetch", label: "Fetch filings" }, { id: "align", label: "Align sections" }, { id: "diff", label: "Find changes" }, { id: "summarize", label: "Summarize" }],
    fields: [
      { key: "form", label: "Filing", type: "select", options: [{ value: "10-K", label: "10-K (year on year)" }, { value: "10-Q", label: "10-Q (quarter on quarter)" }] },
      { key: "section", label: "Section", type: "select", options: [{ value: "risk", label: "Risk factors" }, { value: "mdna", label: "Management's discussion" }, { value: "all", label: "Everything" }] },
    ],
    defaults: { form: "10-K", section: "risk" },
  },

  /* ---------- Networks · GNN ---------- */
  {
    type: "net.graph", module: "networks", label: "Networks", tech: "GNN", icon: "Network", blurb: "Relationships, and predictions trained on them",
    inputs: [{ name: "companies", label: "Companies", kinds: ["companies"], required: true }],
    outputs: [{ name: "ranking", label: "Ranked findings", kind: "ranking" }, { name: "graph", label: "Graph", kind: "graph" }],
    steps: [{ id: "pull", label: "Pull graph" }, { id: "filter", label: "Filter" }, { id: "score", label: "Score (GNN)" }, { id: "rank", label: "Rank" }],
    fields: [
      { key: "finding", label: "Find", type: "select", options: [{ value: "acquirers", label: "Likely acquirers" }, { value: "targets", label: "Likely targets" }, { value: "contagion", label: "Contagion and exposure" }, { value: "intros", label: "Warm intro paths" }, { value: "flags", label: "Hidden links and red flags" }] },
      { key: "depth", label: "Hops", type: "number", min: 1, max: 3 },
      { key: "limit", label: "How many", type: "number", min: 3, max: 25 },
    ],
    defaults: { finding: "acquirers", depth: 2, limit: 10 },
  },

  /* ---------- Scenarios · Synthetic data ---------- */
  {
    type: "scen.simulate", module: "scenarios", label: "Scenarios", tech: "Synthetic data", icon: "FlaskConical", blurb: "Simulated paths for what could happen, always labeled synthetic",
    inputs: [{ name: "in", label: "Companies, findings or a deal", kinds: ["companies", "findings", "proforma", "table"] }],
    outputs: [{ name: "scenario", label: "Scenario", kind: "scenario" }],
    steps: [{ id: "driver", label: "Choose the driver" }, { id: "simulate", label: "Simulate" }, { id: "validate", label: "Validate realism" }],
    fields: [
      { key: "driver", label: "Driver", type: "select", options: [{ value: "replay", label: "Replay history" }, { value: "shock", label: "My shock" }, { value: "event", label: "From live events" }, { value: "tail", label: "AI-imagined tail risk" }] },
      { key: "replay", label: "History", type: "select", options: [{ value: "2008", label: "2008 crisis" }, { value: "2020", label: "2020 pandemic" }, { value: "2022", label: "2022 rate shock" }, { value: "oil2014", label: "Oil 2014-16" }] },
      { key: "shock", label: "Shock", type: "text", placeholder: "oil -30%, rates +150bp" },
      { key: "horizon", label: "Horizon (trading days)", type: "number", min: 5, max: 252 },
      { key: "method", label: "Method", type: "select", options: [{ value: "auto", label: "Chosen by data type" }, { value: "statistical", label: "Statistical (bootstrap, GARCH, regimes)" }, { value: "diffusion", label: "Deep generative (diffusion)" }] },
    ],
    defaults: { driver: "replay", replay: "2022", shock: "", horizon: 60, method: "auto" },
  },
  {
    type: "scen.synthetic", module: "scenarios", label: "Synthetic data", tech: "Synthetic data", icon: "FlaskConical", blurb: "A realistic synthetic copy of a table, labeled with its recipe and seed",
    inputs: [{ name: "table", label: "Table", kinds: ["table"], required: true }],
    outputs: [{ name: "table", label: "Synthetic table", kind: "table" }],
    steps: [{ id: "learn", label: "Learn the data" }, { id: "generate", label: "Generate" }, { id: "validate", label: "Validate realism" }],
    fields: [
      { key: "method", label: "Method", type: "select", options: [{ value: "auto", label: "Sequential trees (CART)" }, { value: "statistical", label: "Statistical (Gaussian copula)" }, { value: "ctgan", label: "Deep generative (CTGAN)" }] },
      { key: "rows", label: "Rows", type: "number", min: 50, max: 10000 },
      { key: "seed", label: "Seed", type: "number", min: 1, max: 999999 },
    ],
    defaults: { method: "auto", rows: 1000, seed: 7 },
  },

  /* ---------- Outputs ---------- */
  {
    type: "out.memo", module: "output", label: "Cited memo", icon: "FileText", blurb: "A memo from everything wired in, every claim cited",
    inputs: [{ name: "in", label: "Anything", kinds: ["any"], required: true, multi: true }],
    outputs: [{ name: "memo", label: "Memo", kind: "memo" }],
    steps: [{ id: "gather", label: "Gather evidence" }, { id: "write", label: "Write" }, { id: "check", label: "Check citations" }],
    fields: [
      { key: "style", label: "Style", type: "select", options: [{ value: "brief", label: "A brief (half a page)" }, { value: "memo", label: "A memo (a page or two)" }] },
      { key: "audience", label: "For", type: "text", placeholder: "Investment committee" },
    ],
    defaults: { style: "brief", audience: "" },
  },
  {
    type: "out.signal", module: "output", label: "Signal and alert", icon: "Bell", blurb: "A number to watch; deployed, it alerts you when it crosses a line",
    inputs: [{ name: "in", label: "Anything", kinds: ["any"], required: true }],
    outputs: [{ name: "signal", label: "Signal", kind: "signal" }], steps: [],
    fields: [
      { key: "when", label: "Alert when", type: "select", options: [{ value: "changes", label: "It changes" }, { value: "above", label: "It goes above" }, { value: "below", label: "It goes below" }] },
      { key: "threshold", label: "Line", type: "number", min: -1e9, max: 1e9, step: 0.01 },
    ],
    defaults: { when: "changes", threshold: 0 },
  },
  {
    type: "out.studio", module: "output", label: "Push to Studio", icon: "FileSpreadsheet", blurb: "Maps, networks, scenario sheets and memos into a Studio model or deck, reviewed there",
    inputs: [{ name: "in", label: "Anything", kinds: ["any"], required: true, multi: true }],
    outputs: [], steps: [],
    fields: [{ key: "target", label: "Studio model or deck (id)", type: "text", placeholder: "Leave empty to create one" }],
    defaults: { target: "" },
  },
  {
    type: "out.export", module: "output", label: "Export dataset", icon: "Download", blurb: "CSV or Excel of what is wired in",
    inputs: [{ name: "in", label: "Table, findings, ranking or pro-forma", kinds: ["table", "findings", "ranking", "proforma"], required: true }],
    outputs: [{ name: "file", label: "File", kind: "file" }], steps: [],
    fields: [{ key: "format", label: "Format", type: "select", options: [{ value: "csv", label: "CSV" }, { value: "xlsx", label: "Excel" }] }],
    defaults: { format: "csv" },
  },
  {
    type: "out.story", module: "output", label: "Story", icon: "Presentation", blurb: "A scrolling visual report of the run: map, graph, scenarios, then the cited memo",
    inputs: [{ name: "in", label: "Anything", kinds: ["any"], required: true, multi: true }],
    outputs: [{ name: "file", label: "Story", kind: "file" }], steps: [],
    fields: [{ key: "title", label: "Title", type: "text", placeholder: "Permian midstream: what changed" }],
    defaults: { title: "" },
  },
];

export const NODE: Record<string, NodeDef> = Object.fromEntries(NODES.map((n) => [n.type, n]));

export const MODULE_LABEL: Record<Module, string> = { source: "Sources", earth: "Earth · GeoAI", documents: "Documents · RAG", networks: "Networks · GNN", scenarios: "Scenarios · Synthetic data", output: "Outputs" };

/** Whether an output of kind `kind` may feed input `port`. Pure. */
export const accepts = (port: Port, kind: Kind) => port.kinds.includes("any") || port.kinds.includes(kind);

export type Issue = { nodeId: string; level: "error" | "warn"; message: string };

/** Everything wrong with a canvas before it runs: unknown nodes, missing inputs and settings, mismatched wires, loops. Pure. */
export function validate(g: Graph, available?: Set<string>): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const n of g.nodes) {
    const def = NODE[n.type];
    if (!def) { issues.push({ nodeId: n.id, level: "error", message: "Unknown block" }); continue; }
    if (available && !available.has(n.type)) issues.push({ nodeId: n.id, level: "error", message: `${def.label} is not available yet` });
    for (const port of def.inputs) {
      const wires = g.edges.filter((e) => e.target === n.id && e.targetHandle === port.name);
      if (port.required && !wires.length) issues.push({ nodeId: n.id, level: "error", message: `Connect ${port.label.toLowerCase()}` });
      if (!port.multi && wires.length > 1) issues.push({ nodeId: n.id, level: "error", message: `${port.label} takes one wire` });
    }
    for (const f of def.fields) {
      const v = n.data.config?.[f.key];
      if ("required" in f && f.required && (typeof v !== "string" || !v.trim())) issues.push({ nodeId: n.id, level: "error", message: `Fill in ${f.label.toLowerCase()}` });
    }
    if (n.type === "earth.proforma") {
      const src = g.edges.filter((e) => e.target === n.id).map((e) => byId.get(e.source));
      const tickers = src.flatMap((s) => (s ? tickersOf(s) : []));
      if (src.some((s) => s && (s.type === "source.companies" || s.type === "source.deal")) && tickers.length > 0 && (tickers.length < 2 || tickers.length > 4)) {
        issues.push({ nodeId: n.id, level: "warn", message: "A what-if compares two to four companies" });
      }
    }
    if (def.outputs.length && !g.edges.some((e) => e.source === n.id) && def.module !== "output") {
      issues.push({ nodeId: n.id, level: "warn", message: "Nothing uses this block's result yet" });
    }
  }
  for (const e of g.edges) {
    const s = byId.get(e.source), t = byId.get(e.target);
    const out = s && NODE[s.type]?.outputs.find((o) => o.name === e.sourceHandle);
    const port = t && NODE[t.type]?.inputs.find((i) => i.name === e.targetHandle);
    if (!s || !t || !out || !port) { issues.push({ nodeId: e.target, level: "error", message: "A wire points nowhere" }); continue; }
    if (!accepts(port, out.kind)) issues.push({ nodeId: t.id, level: "error", message: `${NODE[t.type].label} cannot use ${out.label.toLowerCase()}` });
  }
  if (hasCycle(g)) issues.push({ nodeId: g.nodes[0]?.id ?? "", level: "error", message: "Wires go round in a loop" });
  return issues;
}

const tickersOf = (n: CanvasNode) => {
  const v = n.data.config?.tickers ?? n.data.config?.parties;
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
};

export function hasCycle(g: Graph): boolean {
  try { order(g); return false; } catch { return true; }
}

/** Nodes in an order where every node comes after everything wired into it (Kahn). Throws on a loop. Pure. */
export function order(g: Graph): CanvasNode[] {
  const indeg = new Map(g.nodes.map((n) => [n.id, 0]));
  for (const e of g.edges) if (indeg.has(e.target) && indeg.has(e.source)) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  const queue = g.nodes.filter((n) => indeg.get(n.id) === 0);
  const out: CanvasNode[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    out.push(n);
    for (const e of g.edges.filter((x) => x.source === n.id)) {
      const d = (indeg.get(e.target) ?? 0) - 1;
      indeg.set(e.target, d);
      if (d === 0) { const t = g.nodes.find((x) => x.id === e.target); if (t) queue.push(t); }
    }
  }
  if (out.length !== g.nodes.length) throw new Error("cycle");
  return out;
}

/** Waves of nodes that can run together: each wave only needs earlier waves. Pure. */
export function waves(g: Graph): string[][] {
  const depth = new Map<string, number>();
  for (const n of order(g)) {
    const ins = g.edges.filter((e) => e.target === n.id).map((e) => depth.get(e.source) ?? 0);
    depth.set(n.id, ins.length ? Math.max(...ins) + 1 : 0);
  }
  const out: string[][] = [];
  for (const [id, d] of depth) (out[d] ??= []).push(id);
  return out.filter(Boolean);
}

/** What could come next: blocks that accept a result nothing uses yet. Pure. */
export function suggestions(g: Graph, available?: Set<string>): { after: string; kind: Kind; types: string[] }[] {
  const out: { after: string; kind: Kind; types: string[] }[] = [];
  for (const n of g.nodes) {
    const def = NODE[n.type];
    if (!def) continue;
    for (const o of def.outputs) {
      if (g.edges.some((e) => e.source === n.id && e.sourceHandle === o.name)) continue;
      const types = NODES.filter((d) => d.type !== n.type && d.module !== "output" && (!available || available.has(d.type)) && d.inputs.some((p) => accepts(p, o.kind))).map((d) => d.type).slice(0, 4);
      const outputs = NODES.filter((d) => d.module === "output" && (!available || available.has(d.type)) && d.inputs.some((p) => accepts(p, o.kind))).map((d) => d.type);
      out.push({ after: n.id, kind: o.kind, types: [...new Set([...types, ...outputs])].slice(0, 5) });
    }
  }
  return out;
}

/** Positions for a graph built without them (the AI builder): columns by depth, rows in order. Pure. */
export function layout(g: Graph): Graph {
  let ws: string[][];
  try { ws = waves(g); } catch { ws = [g.nodes.map((n) => n.id)]; }
  const pos = new Map<string, { x: number; y: number }>();
  ws.forEach((wave, col) => wave.forEach((id, row) => pos.set(id, { x: 60 + col * 320, y: 60 + row * 190 + (col % 2) * 30 })));
  return { ...g, nodes: g.nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })) };
}

let seq = 0;
export const newId = (prefix = "n") => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function makeNode(type: string, config: Record<string, unknown> = {}, id = newId(), position = { x: 0, y: 0 }): CanvasNode {
  const def = NODE[type];
  return { id, type, position, data: { config: { ...(def?.defaults ?? {}), ...config } } };
}

export const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): CanvasEdge =>
  ({ id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`, source, sourceHandle, target, targetHandle });

/* ---------------- Starter canvases ---------------- */

export type Template = { id: string; title: string; blurb: string; modules: Module[]; build: (ctx: { tickers: string[] }) => Graph };

export const TEMPLATES: Template[] = [
  {
    id: "asset-watch", title: "Asset watch + deal pro-forma", blurb: "Satellite change at the companies' plants, what a deal between them would combine, and a cited brief",
    modules: ["earth", "output"],
    build: ({ tickers }) => {
      const t = tickers.length >= 2 ? tickers.slice(0, 2) : ["ET", "TRGP"];
      const src = makeNode("source.companies", { tickers: t }, "companies");
      const earth = makeNode("earth.watch", {}, "earth");
      const deal = makeNode("earth.proforma", {}, "proforma");
      const memo = makeNode("out.memo", { style: "brief" }, "memo");
      const signal = makeNode("out.signal", { when: "changes" }, "signal");
      return layout({ nodes: [src, earth, deal, memo, signal], edges: [wire("companies", "companies", "earth", "in"), wire("companies", "companies", "proforma", "companies"), wire("earth", "findings", "memo", "in"), wire("proforma", "proforma", "memo", "in"), wire("earth", "findings", "signal", "in")] });
    },
  },
  {
    id: "supply-shock", title: "Supply-chain shock memo", blurb: "Who is exposed through the supply chain, a shock simulated across them, and a memo",
    modules: ["networks", "scenarios", "output"],
    build: ({ tickers }) => {
      const src = makeNode("source.companies", { tickers: tickers.slice(0, 3) }, "companies");
      const net = makeNode("net.graph", { finding: "contagion" }, "network");
      const sim = makeNode("scen.simulate", { driver: "shock", shock: "supplier outage, revenue -15%" }, "scenario");
      const memo = makeNode("out.memo", { style: "memo" }, "memo");
      return layout({ nodes: [src, net, sim, memo], edges: [wire("companies", "companies", "network", "companies"), wire("companies", "companies", "scenario", "in"), wire("network", "ranking", "memo", "in"), wire("scenario", "scenario", "memo", "in")] });
    },
  },
  {
    id: "buyer-finder", title: "Target + buyer finder", blurb: "Likely buyers from the graph model, the strategic case from filings, and a cited memo",
    modules: ["networks", "documents", "output"],
    build: ({ tickers }) => {
      const src = makeNode("source.companies", { tickers: tickers.slice(0, 1) }, "companies");
      const net = makeNode("net.graph", { finding: "acquirers" }, "network");
      const docs = makeNode("source.documents", { sources: ["sec"], forms: ["10-K", "10-Q"] }, "filings");
      const ask = makeNode("docs.ask", { question: "What would make this company attractive to a buyer, and what stands in the way?", mode: "strict" }, "rationale");
      const memo = makeNode("out.memo", { style: "memo" }, "memo");
      return layout({ nodes: [src, net, docs, ask, memo], edges: [wire("companies", "companies", "network", "companies"), wire("companies", "companies", "filings", "companies"), wire("filings", "docs", "rationale", "docs"), wire("network", "ranking", "memo", "in"), wire("rationale", "answer", "memo", "in")] });
    },
  },
  {
    id: "data-room", title: "Data room diligence", blurb: "Your uploaded data room read for risks, strictly cited, with an exportable table",
    modules: ["documents", "output"],
    build: () => {
      const docs = makeNode("source.documents", { sources: ["uploads"], forms: [] }, "dataroom");
      const risks = makeNode("docs.ask", { question: "List the key risks, liabilities and open issues, with where each is stated.", mode: "strict", form: "table" }, "risks");
      const memo = makeNode("out.memo", { style: "memo", audience: "Investment committee" }, "memo");
      return layout({ nodes: [docs, risks, memo], edges: [wire("dataroom", "docs", "risks", "docs"), wire("risks", "answer", "memo", "in")] });
    },
  },
];

export const TEMPLATE: Record<string, Template> = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
