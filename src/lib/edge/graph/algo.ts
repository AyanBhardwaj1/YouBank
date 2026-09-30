/**
 * Graph algorithms behind the Networks findings, on plain arrays so they can be tested: the reason
 * paths that explain a prediction, ownership cycles, exposure to a shock, and the red flags insider
 * trading and 8-K items raise. Pure.
 */
import type { Form4Tx } from "./parse";

export type GLink = { id: number; s: number; d: number; kind: string; w: number };
export type Path = { nodes: number[]; links: number[]; cost: number };

/** Undirected adjacency with each link's id and kind. */
export function adjacency(links: GLink[]): Map<number, { to: number; link: number; kind: string }[]> {
  const adj = new Map<number, { to: number; link: number; kind: string }[]>();
  const add = (a: number, b: number, l: GLink) => { let x = adj.get(a); if (!x) adj.set(a, (x = [])); x.push({ to: b, link: l.id, kind: l.kind }); };
  for (const l of links) { add(l.s, l.d, l); add(l.d, l.s, l); }
  return adj;
}

/**
 * The best few simple paths between two nodes, up to `maxHops`: fewer hops first, and paths through
 * obscure shared nodes (a director on two boards) before paths through hubs (an index fund that holds
 * everyone). Hubs above `hubDegree` are never passed through.
 */
export function reasonPaths(links: GLink[], from: number, to: number, opts: { maxHops?: number; k?: number; hubDegree?: number; maxExpand?: number } = {}): Path[] {
  const maxHops = opts.maxHops ?? 3, k = opts.k ?? 3, hub = opts.hubDegree ?? 120, budget = opts.maxExpand ?? 50_000;
  const adj = adjacency(links);
  const deg = (n: number) => adj.get(n)?.length ?? 0;
  const out: Path[] = [];
  let expanded = 0;
  const walk = (node: number, nodes: number[], ls: number[], cost: number) => {
    if (expanded++ > budget) return;
    if (node === to && nodes.length > 1) { out.push({ nodes: [...nodes], links: [...ls], cost }); return; }
    if (ls.length >= maxHops) return;
    if (nodes.length > 1 && deg(node) > hub) return;
    for (const e of adj.get(node) ?? []) {
      if (nodes.includes(e.to)) continue;
      if (ls.length === maxHops - 1 && e.to !== to) continue;
      const step = 1 + (e.to === to ? 0 : 0.35 * Math.log2(1 + deg(e.to)));
      nodes.push(e.to); ls.push(e.link);
      walk(e.to, nodes, ls, cost + step);
      nodes.pop(); ls.pop();
    }
  };
  walk(from, [from], [], 0);
  const seen = new Set<string>();
  return out.sort((a, b) => a.cost - b.cost).filter((p) => { const key = p.nodes.join(">"); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, k);
}

/** Ownership that loops back on itself (A owns part of B, which owns part of A), up to `maxLen` steps. */
export function ownershipCycles(edges: { s: number; d: number }[], maxLen = 4): number[][] {
  const out = new Map<string, number[]>();
  const next = new Map<number, number[]>();
  for (const e of edges) { if (e.s === e.d) continue; const x = next.get(e.s) ?? []; x.push(e.d); next.set(e.s, x); }
  const walk = (start: number, node: number, path: number[]) => {
    for (const n of next.get(node) ?? []) {
      if (n === start && path.length >= 2) {
        const min = Math.min(...path), at = path.indexOf(min);
        const canon = [...path.slice(at), ...path.slice(0, at)];
        out.set(canon.join(">"), canon);
      } else if (!path.includes(n) && path.length < maxLen && n > start) walk(start, n, [...path, n]);
    }
  };
  for (const s of next.keys()) walk(s, s, [s]);
  return [...out.values()];
}

/**
 * Who a shock at `source` reaches: personalized PageRank over weighted links, both directions. Links
 * carry how much one side depends on the other (a customer's share of revenue, a stake's size), so
 * exposure follows real dependence rather than the mere count of links.
 */
export function exposure(links: { s: number; d: number; w: number }[], source: number, opts: { alpha?: number; iterations?: number } = {}): Map<number, number> {
  const alpha = opts.alpha ?? 0.2, iters = opts.iterations ?? 40;
  const out = new Map<number, { to: number; w: number }[]>();
  const add = (a: number, b: number, w: number) => { const x = out.get(a) ?? []; x.push({ to: b, w }); out.set(a, x); };
  for (const l of links) { const w = Math.max(1e-3, l.w); add(l.s, l.d, w); add(l.d, l.s, w); }
  let rank = new Map<number, number>([[source, 1]]);
  for (let i = 0; i < iters; i++) {
    const nextRank = new Map<number, number>([[source, alpha]]);
    for (const [n, r] of rank) {
      const es = out.get(n);
      if (!es?.length) { nextRank.set(source, (nextRank.get(source) ?? 0) + (1 - alpha) * r); continue; }
      const total = es.reduce((s, e) => s + e.w, 0);
      for (const e of es) nextRank.set(e.to, (nextRank.get(e.to) ?? 0) + (1 - alpha) * r * (e.w / total));
    }
    rank = nextRank;
  }
  rank.delete(source);
  return rank;
}

export type Flag = { kind: "insider_exit" | "insider_cluster" | "auditor_change" | "restatement" | "bankruptcy" | "delisting" | "leadership_turnover" | "impairment" | "circular_ownership" | "shared_director" | "related_party"; severity: "high" | "medium"; title: string; detail: string; date: string; people?: string[]; urls?: string[] };

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

/**
 * Insider trading worth a look: an insider selling most of their stake in the open market within 90
 * days (over $1M), or three or more insiders selling within any 30 days. Grants, tax withholding and
 * option exercises are not sales.
 */
export function insiderFlags(people: { name: string; title: string; txns: (Form4Tx & { url?: string })[] }[], now: string): Flag[] {
  const flags: Flag[] = [];
  const recent = (t: Form4Tx) => t.date && daysBetween(t.date, now) <= 180 && Date.parse(t.date) <= Date.parse(now);
  const sales: { name: string; date: string; url?: string }[] = [];
  for (const p of people) {
    const sold = p.txns.filter((t) => recent(t) && t.code === "S" && !t.acquired && !t.derivative && (t.shares ?? 0) > 0).sort((a, b) => a.date.localeCompare(b.date));
    for (const t of sold) sales.push({ name: p.name, date: t.date, url: t.url });
    const window = sold.filter((t) => daysBetween(t.date, now) <= 90);
    if (!window.length) continue;
    const shares = window.reduce((s, t) => s + (t.shares ?? 0), 0);
    const value = window.reduce((s, t) => s + (t.shares ?? 0) * (t.price ?? 0), 0);
    const after = window[window.length - 1].owned ?? null;
    const before = after !== null ? after + shares : null;
    if (before && before > 0 && shares / before >= 0.5 && value >= 1_000_000) {
      flags.push({ kind: "insider_exit", severity: shares / before >= 0.8 ? "high" : "medium", title: `${p.name} sold ${Math.round((shares / before) * 100)}% of their stake`, detail: `${p.title || "Insider"}: ${Math.round(shares).toLocaleString("en-US")} units or shares sold in the open market for about $${(value / 1e6).toFixed(1)}M in 90 days.`, date: window[window.length - 1].date, people: [p.name], urls: window.map((t) => t.url).filter((u): u is string => !!u).slice(0, 3) });
    }
  }
  sales.sort((a, b) => a.date.localeCompare(b.date));
  let best: typeof sales = [];
  for (let i = 0; i < sales.length; i++) {
    const inWindow = sales.filter((s) => Date.parse(s.date) >= Date.parse(sales[i].date) && daysBetween(s.date, sales[i].date) <= 30);
    if (new Set(inWindow.map((s) => s.name)).size > new Set(best.map((s) => s.name)).size) best = inWindow;
  }
  const names = [...new Set(best.map((s) => s.name))];
  if (names.length >= 3) flags.push({ kind: "insider_cluster", severity: names.length >= 5 ? "high" : "medium", title: `${names.length} insiders sold within a month`, detail: `${names.slice(0, 4).join(", ")}${names.length > 4 ? " and others" : ""} sold in the open market between ${best[0].date} and ${best[best.length - 1].date}.`, date: best[best.length - 1].date, people: names, urls: best.map((s) => s.url).filter((u): u is string => !!u).slice(0, 3) });
  return flags;
}

/** Red flags in a company's 8-K items: auditor changes, restatements, bankruptcy, delisting, impairments, and a run of officer departures. */
export function eventFlags(events: { date: string; items: string[]; url: string }[], now: string): Flag[] {
  const within = (d: string, days: number) => daysBetween(d, now) <= days && Date.parse(d) <= Date.parse(now);
  const flags: Flag[] = [];
  const first = (item: string, days: number) => events.filter((e) => e.items.includes(item) && within(e.date, days)).sort((a, b) => b.date.localeCompare(a.date))[0];
  const one = (item: string, days: number, f: Omit<Flag, "date" | "urls">) => { const e = first(item, days); if (e) flags.push({ ...f, date: e.date, urls: [e.url] }); };
  one("4.02", 3 * 365, { kind: "restatement", severity: "high", title: "Past financial statements can no longer be relied on", detail: "The company filed an 8-K under Item 4.02 (non-reliance on previously issued financial statements), which usually precedes a restatement." });
  one("4.01", 2 * 365, { kind: "auditor_change", severity: "medium", title: "The auditor changed", detail: "An 8-K under Item 4.01 reports a change of certifying accountant; the filing says whether there were disagreements." });
  one("1.03", 3 * 365, { kind: "bankruptcy", severity: "high", title: "Bankruptcy or receivership", detail: "An 8-K under Item 1.03 reports a bankruptcy or receivership." });
  one("3.01", 365, { kind: "delisting", severity: "medium", title: "A listing notice", detail: "An 8-K under Item 3.01: a notice of delisting or of failing a listing rule, or a transfer or voluntary delisting of a security (often preferred units after a redemption). Read the filing to tell which." });
  one("2.06", 365, { kind: "impairment", severity: "medium", title: "A material impairment", detail: "An 8-K under Item 2.06 reports a material impairment." });
  const departures = events.filter((e) => e.items.includes("5.02") && within(e.date, 365));
  if (departures.length >= 3) flags.push({ kind: "leadership_turnover", severity: departures.length >= 5 ? "high" : "medium", title: `${departures.length} director or officer changes in a year`, detail: "Each is an 8-K under Item 5.02 (departures and appointments of directors and officers).", date: departures.map((e) => e.date).sort().reverse()[0], urls: departures.slice(0, 3).map((e) => e.url) });
  return flags;
}

/** People on the boards of two or more of the given companies: interlocks. */
export function interlocks(directorships: { person: number; name: string; company: number }[]): { person: number; name: string; companies: number[] }[] {
  const by = new Map<number, { name: string; companies: Set<number> }>();
  for (const d of directorships) { const x = by.get(d.person) ?? { name: d.name, companies: new Set<number>() }; x.companies.add(d.company); by.set(d.person, x); }
  return [...by.entries()].filter(([, x]) => x.companies.size >= 2).map(([person, x]) => ({ person, name: x.name, companies: [...x.companies] }));
}
