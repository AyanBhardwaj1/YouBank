/**
 * Graph algorithms behind the Networks findings, on plain arrays so they can be tested: the reason
 * paths that explain a prediction, ownership rings, integrated (ultimate) ownership, exposure to a
 * shock, a Clayton Act section 8 screen of shared directors and officers, and the red flags insider
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
 * Strongly connected components (Tarjan's algorithm, run with an explicit stack so a long chain cannot
 * overflow the call stack): the sets of nodes that can each reach every other along the links. Only
 * components of two or more nodes are returned, each sorted, in order of their smallest member. Pure.
 */
export function stronglyConnected(edges: { s: number; d: number }[]): number[][] {
  const next = new Map<number, number[]>();
  for (const e of edges) {
    if (e.s === e.d) continue;
    const x = next.get(e.s);
    if (x) x.push(e.d); else next.set(e.s, [e.d]);
    if (!next.has(e.d)) next.set(e.d, []);
  }
  const index = new Map<number, number>(), low = new Map<number, number>(), onStack = new Set<number>();
  const stack: number[] = [], out: number[][] = [];
  let counter = 0;
  const visit = (v: number) => { index.set(v, counter); low.set(v, counter); counter++; stack.push(v); onStack.add(v); };
  for (const root of next.keys()) {
    if (index.has(root)) continue;
    visit(root);
    // Each frame is a node and how many of its links the walk has followed.
    const frames: [number, number][] = [[root, 0]];
    while (frames.length) {
      const frame = frames[frames.length - 1];
      const v = frame[0], outs = next.get(v)!;
      if (frame[1] < outs.length) {
        const w = outs[frame[1]++];
        if (!index.has(w)) { visit(w); frames.push([w, 0]); } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
        continue;
      }
      frames.pop();
      if (frames.length) { const u = frames[frames.length - 1][0]; low.set(u, Math.min(low.get(u)!, low.get(v)!)); }
      if (low.get(v) === index.get(v)) {
        const comp: number[] = [];
        let w: number;
        do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== v);
        if (comp.length >= 2) out.push(comp.sort((a, b) => a - b));
      }
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * Ownership rings: every set of owners whose stakes and subsidiaries loop back on themselves, however
 * long the loop, each reported once (a strongly connected component of the ownership links) with the
 * links that run inside it. Pure.
 */
export function ownershipRings<T extends { s: number; d: number }>(links: T[]): { members: number[]; links: T[] }[] {
  const comps = stronglyConnected(links);
  const ring = new Map<number, number>();
  comps.forEach((c, i) => c.forEach((n) => ring.set(n, i)));
  const inside = comps.map(() => [] as T[]);
  for (const l of links) { const i = ring.get(l.s); if (l.s !== l.d && i !== undefined && ring.get(l.d) === i) inside[i].push(l); }
  return comps.map((members, i) => ({ members, links: inside[i] }));
}

/** The shortest loop through `node` along some links (breadth first), as the links in order from it; empty when there is none. Pure. */
export function loopThrough<T extends { s: number; d: number }>(links: T[], node: number): T[] {
  const next = new Map<number, T[]>();
  for (const l of links) if (l.s !== l.d) { const x = next.get(l.s); if (x) x.push(l); else next.set(l.s, [l]); }
  const via = new Map<number, T>();
  const queue = [node];
  for (let i = 0; i < queue.length; i++) {
    for (const l of next.get(queue[i]) ?? []) {
      if (l.d === node) {
        const path = [l];
        for (let at = queue[i]; at !== node; at = path[0].s) path.unshift(via.get(at)!);
        return path;
      }
      if (!via.has(l.d)) { via.set(l.d, l); queue.push(l.d); }
    }
  }
  return [];
}

export type Stake = { s: number; d: number; share: number };

/**
 * Integrated ownership (Vitali, Glattfelder and Battiston, "The network of global corporate control",
 * 2011): each holder's share of `target`, held directly and through every chain of stakes, loops
 * included. It is the target's column of W~ = (I - W)^-1 W, where W[i][j] is the share of j that i holds,
 * summed as a Neumann series (x = w + Wx) until no share moves by more than `tol`. One stake counts per
 * holder and company (the larger), and where the stakes filed in one company add up to more than all
 * of it they are scaled down to 100%. The target's own entry (through a loop) is left out. Pure.
 */
export function integratedOwnership(stakes: Stake[], target: number, opts: { tol?: number; maxIter?: number } = {}): Map<number, number> {
  const tol = opts.tol ?? 1e-6, maxIter = opts.maxIter ?? 1000;
  // W by column: for each company, who holds it and how much.
  const into = new Map<number, Map<number, number>>();
  for (const st of stakes) {
    if (st.s === st.d || !(st.share > 0)) continue;
    let col = into.get(st.d);
    if (!col) into.set(st.d, (col = new Map()));
    col.set(st.s, Math.max(col.get(st.s) ?? 0, Math.min(1, st.share)));
  }
  for (const col of into.values()) {
    const sum = [...col.values()].reduce((a, b) => a + b, 0);
    if (sum > 1) for (const [k, v] of col) col.set(k, v / sum);
  }
  // The series term by term: the share reaching each holder through chains of n + 1 stakes.
  const total = new Map<number, number>();
  let term = new Map(into.get(target) ?? []);
  for (let it = 0; it < maxIter && term.size; it++) {
    let moved = 0;
    for (const [i, v] of term) { total.set(i, (total.get(i) ?? 0) + v); moved = Math.max(moved, v); }
    if (moved < tol) break;
    const next = new Map<number, number>();
    for (const [j, v] of term) for (const [i, w] of into.get(j) ?? []) next.set(i, (next.get(i) ?? 0) + w * v);
    term = next;
  }
  total.delete(target);
  return total;
}

/** The chain of stakes that carries the most of `target` to `holder` (the largest product of shares), from the holder down; empty when none does. Pure. */
export function strongestChain<T extends Stake>(stakes: T[], holder: number, target: number): T[] {
  const out = new Map<number, T[]>();
  for (const st of stakes) if (st.s !== st.d && st.share > 0) { const x = out.get(st.s); if (x) x.push(st); else out.set(st.s, [st]); }
  // Dijkstra on -ln(share): the shortest path is the strongest chain.
  const dist = new Map<number, number>([[holder, 0]]), via = new Map<number, T>(), done = new Set<number>();
  for (;;) {
    let v: number | null = null, best = Infinity;
    for (const [n, d] of dist) if (!done.has(n) && d < best) { best = d; v = n; }
    if (v === null || v === target) break;
    done.add(v);
    for (const st of out.get(v) ?? []) {
      const d = best - Math.log(Math.min(1, st.share));
      if (!done.has(st.d) && d < (dist.get(st.d) ?? Infinity)) { dist.set(st.d, d); via.set(st.d, st); }
    }
  }
  if (!via.has(target) || holder === target) return [];
  const chain: T[] = [];
  for (let at = target; at !== holder; at = chain[0].s) chain.unshift(via.get(at)!);
  return chain;
}

/**
 * Section 8 of the Clayton Act, as the FTC revised its thresholds for 2026 (Federal Register, 16 January
 * 2026): no one may be a director or officer of two competing corporations that each have capital, surplus
 * and undivided profits above $54,402,000, unless either one's competitive sales are under $5,440,200 (or
 * under 2% of its sales, or each one's under 4%).
 */
export const SECTION_8 = {
  year: 2026, capital: 54_402_000, competitiveSales: 5_440_200,
  source: "https://www.federalregister.gov/documents/2026/01/16/2026-00880/revised-jurisdictional-thresholds-for-section-8-of-the-clayton-act",
};

export type Section8Company = { name: string; sic?: string | null; industry?: string | null; equity?: number | null; revenue?: number | null };
export type Section8Hit = { industry: string; sizes: { measure: "equity" | "revenue"; value: number }[] };

/**
 * Whether two companies screen in under section 8: they compete (the same four-digit SIC code, or where
 * either has none, the same industry label) and both clear the threshold, measured by stockholders' equity
 * where the graph has it (the closest public figure to capital, surplus and undivided profits) and by
 * revenue where it does not. Banks are outside section 8. Null when the pair does not screen in. Pure.
 */
export function section8Screen(a: Section8Company, b: Section8Company, threshold = SECTION_8.capital): Section8Hit | null {
  const sic = (c: Section8Company) => (c.sic ?? "").trim();
  const label = (c: Section8Company) => (c.industry ?? "").trim();
  let industry: string;
  if (sic(a) && sic(b)) {
    if (sic(a) !== sic(b) || sic(a).startsWith("60")) return null;
    industry = `SIC ${sic(a)}${label(a) ? ` (${label(a)})` : ""}`;
  } else if (label(a) && label(b) && label(a).toLowerCase() === label(b).toLowerCase()) industry = `the industry ${label(a)}`;
  else return null;
  const size = (c: Section8Company) => (typeof c.equity === "number" ? { measure: "equity" as const, value: c.equity } : typeof c.revenue === "number" ? { measure: "revenue" as const, value: c.revenue } : null);
  const sa = size(a), sb = size(b);
  if (!sa || !sb || sa.value <= threshold || sb.value <= threshold) return null;
  return { industry, sizes: [sa, sb] };
}

const DAY_MS = 86_400_000;
const shift = (d: string, days: number) => new Date(Date.parse(d) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Whether one person's seats at two companies, each known from its first and latest Form 4, show them
 * serving both at once and still serving: each seat filed within a year before the other began (insiders
 * file at least yearly, so a seat silent for longer had likely ended), and both have filed in the last 18
 * months. Seats from Form 4 never end in the graph, so someone who moved from one company to the other
 * would otherwise look like they sit at both. Pure.
 */
export function servedTogether(a: { first: string | null; last: string | null }, b: { first: string | null; last: string | null }, now: string): boolean {
  const aFirst = a.first ?? a.last, aLast = a.last ?? a.first, bFirst = b.first ?? b.last, bLast = b.last ?? b.first;
  if (!aFirst || !aLast || !bFirst || !bLast) return false;
  const recent = shift(now, -548);
  return aLast >= shift(bFirst, -365) && bLast >= shift(aFirst, -365) && aLast >= recent && bLast >= recent;
}

const usd = (v: number) => (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${Math.round(v / 1e6).toLocaleString("en-US")}M`);

/** The red flag for a pair that screens in under section 8: labelled a screen, not legal advice, and citing the FTC's 2026 thresholds. Pure. */
export function section8Flag(person: string, here: { name: string; role: string; url?: string; since?: string | null }, there: { name: string; role: string; url?: string; since?: string | null }, hit: Section8Hit, now: string): Flag {
  const [h, t] = hit.sizes;
  const sizes = h.measure === t.measure
    ? `${h.measure === "equity" ? "stockholders' equity, standing in for capital, surplus and undivided profits" : "revenue, since the graph has no equity figure for them"}: ${here.name} ${usd(h.value)}, ${there.name} ${usd(t.value)}`
    : `${here.name}'s ${h.measure === "equity" ? "stockholders' equity" : "revenue (no equity figure)"} of ${usd(h.value)} and ${there.name}'s ${t.measure === "equity" ? "stockholders' equity" : "revenue (no equity figure)"} of ${usd(t.value)}`;
  const since = [here.since, there.since].filter((d): d is string => !!d).sort().pop();
  return {
    kind: "interlocking_directorate", severity: "medium", title: "Possible interlocking directorate",
    detail: `${person} is ${here.role} of ${here.name} and ${there.role} of ${/[.!?]$/.test(there.name) ? there.name : `${there.name}.`} Both are in ${hit.industry}, and both are above the FTC's ${SECTION_8.year} section 8 threshold of $${SECTION_8.capital.toLocaleString("en-US")}, measured by ${sizes}. Section 8 of the Clayton Act bars one person from being a director or officer of two competing corporations of that size. This is a screen of SEC data, not legal advice: there is no segment data, so the exceptions for small competitive sales (under $${SECTION_8.competitiveSales.toLocaleString("en-US")}, or under 2% or 4% of a company's sales) were not checked, and a shared industry code does not prove the two compete.`,
    date: since ?? now, people: [person], urls: [here.url, there.url].filter((u): u is string => !!u && /^https?:/.test(u)),
    refs: [{ label: `FTC ${SECTION_8.year} section 8 thresholds`, url: SECTION_8.source }],
  };
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

export type Flag = { kind: "insider_exit" | "insider_cluster" | "auditor_change" | "restatement" | "bankruptcy" | "delisting" | "leadership_turnover" | "impairment" | "circular_ownership" | "shared_director" | "related_party" | "interlocking_directorate"; severity: "high" | "medium"; title: string; detail: string; date: string; people?: string[]; urls?: string[]; /** Sources that are not filings (a regulator's notice), with their names. */ refs?: { label: string; url: string }[]; /** Tells apart flags of one kind on one day (a pair flag: the person and the other company). */ key?: string };

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
