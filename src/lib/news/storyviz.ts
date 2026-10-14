/**
 * The shapes behind a story's pictures, worked out from its own data so the drawing code stays dumb:
 * - a timeline: who reported it when, the filings, the deal, and earlier stories on the same companies;
 * - a relationship map: the companies, people, funds and agencies in it, with the deal's sides joined
 *   by what they are doing (acquiring, investing, advising) and, in the app only, the person's own
 *   contacts at those companies;
 * - which chart a short card should carry (a price reaction, a deal size, the key figures as bars, or
 *   how fast coverage spread), and the figures read as numbers;
 * - a 20-second version of the story for Brief mode.
 * Pure, safe on the client, tested.
 */
import type { NewsEntity, NewsSummary } from "@/db/schema";

/* ---------------- Timeline ---------------- */

export type TimelineItem = { title: string; source: string; kind: string; url: string; at: string; form?: string };
export type TimelineEvent = {
  at: string;
  kind: "first" | "source" | "filing" | "deal" | "earlier" | "update";
  label: string;
  detail?: string;
  url?: string;
  clusterId?: number;
};

const FORM_LABEL: Record<string, string> = {
  "8-K": "8-K current report", "S-1": "IPO registration (S-1)", "F-1": "IPO registration (F-1)", "424B4": "IPO pricing (424B4)", "SC 13D": "Activist stake (13D)",
  "SC TO-T": "Tender offer", "SC 13E3": "Going-private filing", DEFM14A: "Definitive merger proxy", PREM14A: "Preliminary merger proxy", "S-4": "Merger registration (S-4)",
  "NT 10-K": "Late annual report notice", "NT 10-Q": "Late quarterly report notice", D: "Form D private raise",
};

/**
 * A story's timeline, oldest first: the first report, each other outlet as it joined (the same outlet
 * twice is one entry), filings with their form, and up to four earlier stories on the same companies
 * from the month before. At most `limit` entries; the first report and the filings always stay.
 */
export function storyTimeline(items: TimelineItem[], earlier: { id: number; headline: string; at: string }[] = [], limit = 14): TimelineEvent[] {
  const sorted = [...items].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const seen = new Set<string>();
  const own: TimelineEvent[] = [];
  for (const i of sorted) {
    const key = i.kind === "filing" ? `filing:${i.url}` : i.source.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (i.kind === "filing") own.push({ at: i.at, kind: "filing", label: i.form ? FORM_LABEL[i.form] ?? `Form ${i.form}` : "SEC filing", detail: i.title, url: i.url });
    else own.push({ at: i.at, kind: own.some((e) => e.kind === "first") ? "source" : "first", label: own.some((e) => e.kind === "first") ? `${i.source} reports` : `First reported by ${i.source}`, detail: i.title, url: i.url });
  }
  if (!own.some((e) => e.kind === "first") && own[0]) own[0] = { ...own[0], kind: "first" };
  const firstAt = own[0] ? Date.parse(own[0].at) : Date.now();
  const prior: TimelineEvent[] = earlier
    .filter((e) => Date.parse(e.at) < firstAt && firstAt - Date.parse(e.at) < 31 * 86_400_000)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 4)
    .map((e) => ({ at: e.at, kind: "earlier" as const, label: "Earlier", detail: e.headline, clusterId: e.id }));
  // Keep the first report and every filing; trim the middle of a widely covered story.
  const keep = own.filter((e) => e.kind !== "source");
  const sources = own.filter((e) => e.kind === "source");
  const room = Math.max(0, limit - prior.length - keep.length);
  const chosen = sources.length <= room ? sources : [...sources.slice(0, Math.ceil(room / 2)), ...sources.slice(sources.length - Math.floor(room / 2))];
  return [...prior, ...keep, ...chosen].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/* ---------------- Relationship map ---------------- */

export type GraphNodeKind = "story" | "company" | "investor" | "fund" | "person" | "agency" | "advisor" | "contact";
export type GraphNode = { id: string; label: string; kind: GraphNodeKind; ticker?: string; role?: string; side?: "buyer" | "target" | "" };
export type GraphEdge = { from: string; to: string; label: string; kind: "deal" | "invest" | "advise" | "role" | "works" | "named" };
export type StoryGraph = { nodes: GraphNode[]; edges: GraphEdge[] };
export type GraphDeal = { kind: string; acquirer: string; target: string; investors: string[]; advisors: { firm: string; side: string; role: string }[] };

const keyOf = (name: string) => name.toLowerCase().replace(/[.,'’]/g, " ").replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|lp|plc|holdings?|group|the|sa|nv|ag|se)\b/g, " ").replace(/\s+/g, " ").trim();
const sameName = (a: string, b: string) => { const x = keyOf(a), y = keyOf(b); return !!x && !!y && (x === y || (x.length > 2 && y.includes(x)) || (y.length > 2 && x.includes(y))); };

const DEAL_VERB: Record<string, string> = {
  acquisition: "acquiring", merger: "merging with", take_private: "taking private", tender: "tender offer for", raise: "investing in", fund_close: "fund close", ipo: "listing",
  debt: "financing", bankruptcy: "bankruptcy", spin_off: "spinning off", stake: "stake in",
};

/**
 * The relationship map. Nodes are the story's entities (people tied to the company their role names,
 * if any), the deal's buyer and target joined by the deal, its investors and advisors, and, when
 * `contacts` is given (inside the app only, never on public pages), the person's own contacts at the
 * companies. Anything not otherwise joined hangs off the story itself. At most 16 nodes.
 */
export function storyGraph(headline: string, entities: NewsEntity[], deal: GraphDeal | null, contacts: { name: string; company: string; contactId?: number }[] = []): StoryGraph {
  const nodes: GraphNode[] = [{ id: "story", label: headline.length > 64 ? `${headline.slice(0, 61)}…` : headline, kind: "story" }];
  const edges: GraphEdge[] = [];
  const find = (name: string) => nodes.find((n) => n.kind !== "story" && n.kind !== "contact" && sameName(n.label, name));
  const add = (n: Omit<GraphNode, "id">): GraphNode => {
    const hit = n.kind !== "contact" ? find(n.label) : undefined;
    if (hit) { if (n.ticker && !hit.ticker) hit.ticker = n.ticker; if (n.side && !hit.side) hit.side = n.side; return hit; }
    const node = { ...n, id: `n${nodes.length}` };
    if (nodes.length < 16) nodes.push(node);
    return node;
  };
  const link = (from: GraphNode, to: GraphNode, label: string, kind: GraphEdge["kind"]) => {
    if (from.id === to.id || !nodes.includes(from) || !nodes.includes(to)) return;
    if (!edges.some((e) => (e.from === from.id && e.to === to.id) || (e.from === to.id && e.to === from.id))) edges.push({ from: from.id, to: to.id, label, kind });
  };
  if (deal) {
    const target = deal.target ? add({ label: deal.target, kind: "company", side: "target", role: "target" }) : null;
    const buyer = deal.acquirer ? add({ label: deal.acquirer, kind: ["raise", "fund_close"].includes(deal.kind) ? "investor" : "company", side: "buyer", role: deal.kind === "raise" ? "lead investor" : "buyer" }) : null;
    if (buyer && target) link(buyer, target, DEAL_VERB[deal.kind] ?? deal.kind.replace("_", " "), "deal");
    for (const inv of deal.investors.slice(0, 5)) { const n = add({ label: inv, kind: "investor" }); if (target) link(n, target, "invests in", "invest"); }
    for (const a of deal.advisors.slice(0, 5)) {
      const n = add({ label: a.firm, kind: "advisor", role: `${a.role} advisor` });
      const side = /buyer|acquirer|lender/i.test(a.side) ? buyer : target;
      if (side) link(n, side, `${a.role === "legal" ? "legal" : "financial"} advisor`, "advise");
    }
  }
  const people: NewsEntity[] = [];
  for (const e of entities) {
    if (e.kind === "person") { people.push(e); continue; }
    add({ label: e.name, kind: e.kind === "fund" ? "fund" : e.kind === "investor" ? "investor" : e.kind === "agency" ? "agency" : "company", ticker: e.ticker, role: e.role });
  }
  for (const p of people) {
    const n = add({ label: p.name, kind: "person", role: p.role });
    // "CEO of Acme", "Acme chief executive": tie a person to the company their role names.
    const at = p.role ? nodes.find((x) => (x.kind === "company" || x.kind === "fund" || x.kind === "investor") && p.role!.toLowerCase().includes(keyOf(x.label)) && keyOf(x.label).length > 2) : undefined;
    if (at) link(n, at, p.role!.replace(new RegExp(`\\s*(of|at)?\\s*${at.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), "").trim() || "works at", "role");
  }
  for (const c of contacts.slice(0, 4)) {
    const company = find(c.company);
    if (!company) continue;
    const n = add({ label: c.name, kind: "contact", role: "your contact" });
    link(n, company, "your contact", "works");
  }
  const story = nodes[0];
  for (const n of nodes.slice(1)) if (!edges.some((e) => e.from === n.id || e.to === n.id)) edges.push({ from: story.id, to: n.id, label: n.role ?? "named", kind: "named" });
  // Tie the deal pair to the story too, so the story sits at the centre of everything.
  const deals = edges.filter((e) => e.kind === "deal");
  for (const d of deals) if (!edges.some((e) => e.from === story.id && (e.to === d.from || e.to === d.to))) edges.push({ from: story.id, to: d.to, label: "the deal", kind: "named" });
  return { nodes, edges };
}

/**
 * Positions for the map: the story at the centre, the deal's sides and directly named entities on an
 * inner ring, everything tied to them (investors, advisors, people, contacts) on an outer ring next to
 * what they are tied to. Coordinates in a 0..1 square. Pure and deterministic, so it never jumps.
 */
export function layoutGraph(g: StoryGraph): Map<string, { x: number; y: number; ring: 0 | 1 | 2 }> {
  const pos = new Map<string, { x: number; y: number; ring: 0 | 1 | 2 }>();
  pos.set("story", { x: 0.5, y: 0.5, ring: 0 });
  // The inner ring: the deal's two sides, and whatever hangs straight off the story.
  const inner = g.nodes.filter((n) => n.id !== "story" && (n.side === "buyer" || n.side === "target" || g.edges.some((e) => (e.from === "story" && e.to === n.id) || (e.to === "story" && e.from === n.id))));
  const innerIds = new Set(inner.map((n) => n.id));
  // Buyer on the left, target on the right, everything else spread above and below.
  const buyer = inner.find((n) => n.side === "buyer"), target = inner.find((n) => n.side === "target");
  const others = inner.filter((n) => n !== buyer && n !== target);
  const angle = new Map<string, number>();
  if (buyer) angle.set(buyer.id, Math.PI);
  if (target) angle.set(target.id, 0);
  const free = buyer || target
    ? others.map((_, i) => (i % 2 === 0 ? -1 : 1) * (Math.PI / 2 + (Math.floor(i / 2) - (Math.ceil(others.length / 2) - 1) / 2) * 0.62))
    : others.map((_, i) => Math.PI + (i * 2 * Math.PI) / Math.max(1, others.length));
  others.forEach((n, i) => angle.set(n.id, free[i]));
  const r1 = 0.24, r2 = 0.42;
  for (const n of inner) { const a = angle.get(n.id)!; pos.set(n.id, { x: 0.5 + r1 * 1.1 * Math.cos(a), y: 0.5 + r1 * Math.sin(a), ring: 1 }); }
  // Outer nodes fan out around the inner node they are tied to, on the far side from the story.
  const outer = g.nodes.filter((n) => n.id !== "story" && !innerIds.has(n.id));
  const byAnchor = new Map<string, string[]>();
  for (const n of outer) {
    const e = g.edges.find((x) => (x.from === n.id && innerIds.has(x.to)) || (x.to === n.id && innerIds.has(x.from)));
    const anchor = e ? (e.from === n.id ? e.to : e.from) : "story";
    byAnchor.set(anchor, [...(byAnchor.get(anchor) ?? []), n.id]);
  }
  let loose = 0;
  for (const [anchor, ids] of byAnchor) {
    const base = anchor === "story" ? -Math.PI / 4 + loose++ * 1.1 : angle.get(anchor) ?? 0;
    const spread = Math.min(0.62, 2.2 / Math.max(1, ids.length));
    ids.forEach((id, k) => {
      // A lone node sits a little off the line from the story, so it never hides behind its anchor.
      const a = ids.length === 1 ? base + 0.5 : base + (k - (ids.length - 1) / 2) * spread;
      pos.set(id, { x: 0.5 + r2 * 1.1 * Math.cos(a), y: 0.5 + r2 * Math.sin(a), ring: 2 });
    });
  }
  // Keep everything inside the frame.
  for (const [id, p] of pos) pos.set(id, { ...p, x: Math.min(0.92, Math.max(0.08, p.x)), y: Math.min(0.93, Math.max(0.07, p.y)) });
  return pos;
}

/* ---------------- Figures and charts ---------------- */

/** "$4.1 billion" is 4.1e9, "18%" is 18 with unit "%", "1.2m shares" is 1.2e6. Null when no number. Pure. */
export function parseFigure(value: string): { n: number; unit: "$" | "%" | "x" | "" } | null {
  const v = value.replace(/,/g, "").trim();
  const m = v.match(/(-?\d+(?:\.\d+)?)\s*(?:(trillion|tn|billion|bn|b|million|mn|m|thousand|k)\b)?\s*(%|x\b)?/i);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const scale = (m[2] ?? "").toLowerCase();
  n *= /^(trillion|tn)$/.test(scale) ? 1e12 : /^(billion|bn|b)$/.test(scale) ? 1e9 : /^(million|mn|m)$/.test(scale) ? 1e6 : /^(thousand|k)$/.test(scale) ? 1e3 : 1;
  n = Math.round(n * 1e4) / 1e4;
  const unit = m[3] === "%" || /percent/i.test(v) ? "%" : m[3]?.toLowerCase() === "x" || /\bx\b|times/i.test(v) ? "x" : /[$€£]|usd|dollars?/i.test(v) ? "$" : "";
  return { n, unit };
}

/** The key figures that can share a bar chart: same unit, at least two, largest first. */
export function figureBars(numbers: NewsSummary["numbers"]): { label: string; value: string; n: number }[] {
  const parsed = numbers.map((x) => ({ ...x, f: parseFigure(x.value) })).filter((x) => x.f && x.f.n > 0);
  const byUnit = new Map<string, typeof parsed>();
  for (const p of parsed) byUnit.set(p.f!.unit, [...(byUnit.get(p.f!.unit) ?? []), p]);
  const best = [...byUnit.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  return best.length >= 2 ? best.map((p) => ({ label: p.label, value: p.value, n: p.f!.n })).sort((a, b) => b.n - a.n).slice(0, 5) : [];
}

export type ChartKind = "price" | "deal" | "figures" | "coverage" | "filing" | "none";

/** The one chart a short card carries: what the story's data supports best. Pure. */
export function chartFor(s: { tickers: string[]; deal: { valueUsd: number | null; premium: number | null } | null; summary: NewsSummary | null; sources: { at: string }[]; sourceCount: number; filing: { form: string } | null }, hasSpark: (t: string) => boolean): ChartKind {
  if (s.deal && (s.deal.valueUsd || s.deal.premium !== null)) return "deal";
  if (s.tickers.some(hasSpark)) return "price";
  if (s.summary && figureBars(s.summary.numbers).length >= 2) return "figures";
  if (s.filing) return "filing";
  if (s.sourceCount >= 2 && s.sources.length >= 2) return "coverage";
  return "none";
}

/**
 * Where on a 30-trading-day price line the story landed: the index of the close just before it, so the
 * chart can mark the reaction from there. Closes are daily and end today, so a story from today is
 * measured from yesterday's close. Null if before the window.
 */
export function eventIndex(closes: number, firstSeenAt: string, now: number): number | null {
  if (closes < 2) return null;
  const tradingDays = Math.round(((now - Date.parse(firstSeenAt)) / 86_400_000) * (5 / 7));
  const i = closes - 1 - tradingDays;
  return i >= 0 ? Math.min(closes - 2, i) : null;
}

/* ---------------- Brief mode ---------------- */

/** About how long a text takes to read, at 230 words a minute. */
export const readSeconds = (text: string) => Math.max(1, Math.round((text.trim().split(/\s+/).filter(Boolean).length / 230) * 60));

/**
 * The 20-second card: the headline and as many of the summary's bullets as fit in about 60 words (the
 * "why it matters" line only when room is left), so every card is a short, even read.
 */
export function briefCard(s: { headline: string; summary: NewsSummary | null }, maxWords = 62): { lines: string[]; why: string; seconds: number } {
  const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
  let used = words(s.headline);
  const lines: string[] = [];
  for (const b of s.summary?.bullets ?? []) {
    const w = words(b);
    if (lines.length && used + w > maxWords) break;
    if (!lines.length && used + w > maxWords) { lines.push(`${b.split(/\s+/).slice(0, Math.max(8, maxWords - used)).join(" ")}…`); used = maxWords; break; }
    lines.push(b);
    used += w;
    if (lines.length >= 2) break;
  }
  const why = s.summary?.why && used + words(s.summary.why) <= maxWords + 18 ? s.summary.why : "";
  return { lines, why, seconds: readSeconds([s.headline, ...lines, why].join(" ")) };
}
