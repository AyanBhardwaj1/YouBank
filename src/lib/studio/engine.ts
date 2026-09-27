/**
 * The calculation engine. Formulas are parsed once, their precedents recorded, and values computed
 * lazily and cached. An edit invalidates only the cells that depend on it, so recalculation after a
 * keystroke touches what changed and nothing else. The same engine runs in the browser (display) and
 * on the server (the agent's reads, sensitivity tables, exports).
 */
import { MAX_COL, MAX_ROW, addr as A1, contains, parseAddr, parseRange, type Rect } from "./address";
import { FormulaSyntaxError, functionsOf, parse, refsOf, namesOf, type Node, type RefTok } from "./formula";
import { formatValue } from "./format";
import { FUNCTIONS, type FnCtx } from "./functions";
import { CalcError, ERR, compare, errorFromCode, isArr, isErr, isRange, toNumber, toText, type Arr, type Prim, type RangeVal, type Val } from "./values";
import type { CellData, Scalar, Workbook } from "./types";

const VOLATILE = new Set(["OFFSET", "INDIRECT", "TODAY", "NOW", "RAND", "RANDBETWEEN"]);

/** Raised inside evaluation when a cycle is met, so the outermost call can solve it iteratively. */
class CycleSignal { constructor(readonly key: string) {} }

type Parsed = { node: Node | null; error?: CalcError; volatile: boolean; cells: string[]; ranges: { sheet: string; rect: Rect }[]; unsupported: string[] };

export type Here = { sheet: string; r: number; c: number };

const K = (sheet: string, a: string) => `${sheet}!${a}`;
const splitKey = (k: string): [string, string] => { const i = k.lastIndexOf("!"); return [k.slice(0, i), k.slice(i + 1)]; };

export class Engine {
  readonly wb: Workbook;
  private sheetIds = new Map<string, string>();
  private parsed = new Map<string, Parsed>();
  private cache = new Map<string, Prim>();
  private dependents = new Map<string, Set<string>>();
  private rangeDeps = new Map<string, { rect: Rect; key: string }[]>();
  private volatile = new Set<string>();
  private evaluating = new Set<string>();
  private cyclic = new Set<string>();
  private depth = 0;
  private overrides = new Map<string, Prim>();
  private used = new Map<string, { rows: number; cols: number }>();
  private formulaCells = new Map<string, Set<string>>();
  /** Strongly connected groups of formulas (circular references), found when a cycle is first met. */
  private sccs: string[][] = [];
  private sccOf = new Map<string, number>();
  private sccInfo = new Map<number, { iterations: number; converged: boolean }>();
  private solving = new Set<number>();
  private iterates = new Map<string, number>();

  constructor(wb: Workbook) {
    this.wb = wb;
    this.rebuild();
  }

  /** Re-read the whole workbook: after sheets are added, renamed or removed. */
  rebuild() {
    this.sheetIds.clear(); this.parsed.clear(); this.cache.clear(); this.dependents.clear(); this.rangeDeps.clear();
    this.volatile.clear(); this.cyclic.clear(); this.used.clear(); this.formulaCells.clear();
    this.sccs = []; this.sccOf.clear(); this.sccInfo.clear();
    for (const id of this.wb.order) {
      const s = this.wb.sheets[id];
      if (!s) continue;
      this.sheetIds.set(s.name.toLowerCase(), id);
      let rows = 0, cols = 0;
      for (const a of Object.keys(s.cells)) {
        const p = parseAddr(a);
        if (!p) continue;
        rows = Math.max(rows, p.r); cols = Math.max(cols, p.c);
      }
      this.used.set(id, { rows, cols });
    }
    for (const id of this.wb.order) {
      const s = this.wb.sheets[id];
      if (!s) continue;
      for (const [a, cell] of Object.entries(s.cells)) if (cell?.f) this.index(id, a, cell.f);
    }
  }

  sheetId(name: string): string | null {
    return this.sheetIds.get(name.toLowerCase()) ?? (this.wb.sheets[name] ? name : null);
  }

  usedRange(sheet: string) { return this.used.get(sheet) ?? { rows: 0, cols: 0 }; }

  /* ---------------- Dependency graph ---------------- */

  private refRect(ref: RefTok, own: string): { sheet: string; rect: Rect } | null {
    const sheet = ref.sheet !== undefined ? this.sheetId(ref.sheet) : own;
    if (!sheet) return null;
    return { sheet, rect: { r1: Math.min(ref.r1, ref.r2), c1: Math.min(ref.c1, ref.c2), r2: Math.max(ref.r1, ref.r2), c2: Math.max(ref.c1, ref.c2) } };
  }

  private forgetCycles() { if (this.sccs.length) { this.sccs = []; this.sccOf.clear(); this.sccInfo.clear(); } }

  private index(sheet: string, a: string, formula: string) {
    const key = K(sheet, a);
    this.forgetCycles();
    let parsed: Parsed;
    try {
      const node = parse(formula);
      const fns = functionsOf(node);
      const refs = [...refsOf(node)];
      for (const n of namesOf(node)) {
        const target = this.nameTarget(n);
        if (target) { try { refs.push(...refsOf(parse(target))); } catch { /* bad name target */ } }
      }
      const cells: string[] = [];
      const ranges: { sheet: string; rect: Rect }[] = [];
      for (const r of refs) {
        const rr = this.refRect(r, sheet);
        if (!rr) continue;
        const { rect } = rr;
        if (rect.r1 === rect.r2 && rect.c1 === rect.c2) cells.push(K(rr.sheet, A1(rect.r1, rect.c1)));
        else ranges.push(rr);
      }
      parsed = { node, volatile: [...fns].some((f) => VOLATILE.has(f)), cells, ranges, unsupported: [...fns].filter((f) => !FUNCTIONS[f]) };
    } catch (e) {
      parsed = { node: null, error: e instanceof FormulaSyntaxError ? ERR.syntax : ERR.value, volatile: false, cells: [], ranges: [], unsupported: [] };
    }
    this.parsed.set(key, parsed);
    for (const c of parsed.cells) {
      let set = this.dependents.get(c);
      if (!set) this.dependents.set(c, (set = new Set()));
      set.add(key);
    }
    for (const r of parsed.ranges) {
      let list = this.rangeDeps.get(r.sheet);
      if (!list) this.rangeDeps.set(r.sheet, (list = []));
      list.push({ rect: r.rect, key });
    }
    if (parsed.volatile) this.volatile.add(key);
    let fc = this.formulaCells.get(sheet);
    if (!fc) this.formulaCells.set(sheet, (fc = new Set()));
    fc.add(a);
  }

  private unindex(sheet: string, a: string) {
    const key = K(sheet, a);
    const p = this.parsed.get(key);
    if (!p) return;
    this.forgetCycles();
    for (const c of p.cells) this.dependents.get(c)?.delete(key);
    for (const r of p.ranges) {
      const list = this.rangeDeps.get(r.sheet);
      if (list) this.rangeDeps.set(r.sheet, list.filter((x) => x.key !== key));
    }
    this.volatile.delete(key);
    this.parsed.delete(key);
    this.formulaCells.get(sheet)?.delete(a);
  }

  /** Every cell whose value depends on `key`, directly or not. */
  dependentsOf(key: string): Set<string> {
    const out = new Set<string>();
    const stack = [key];
    while (stack.length) {
      const k = stack.pop()!;
      const [sheet, a] = splitKey(k);
      const p = parseAddr(a);
      const next: string[] = [...(this.dependents.get(k) ?? [])];
      if (p) for (const d of this.rangeDeps.get(sheet) ?? []) if (contains(d.rect, p.r, p.c)) next.push(d.key);
      for (const n of next) if (!out.has(n)) { out.add(n); stack.push(n); }
    }
    return out;
  }

  /** Direct precedents of a formula cell, as keys (ranges expanded to their formula cells and values). */
  precedentsOf(key: string, formulasOnly = false): string[] {
    const p = this.parsed.get(key);
    if (!p) return [];
    const out = formulasOnly ? p.cells.filter((c) => this.parsed.has(c)) : [...p.cells];
    for (const r of p.ranges) {
      const sheet = this.wb.sheets[r.sheet];
      if (!sheet) continue;
      const pool = formulasOnly ? [...(this.formulaCells.get(r.sheet) ?? [])] : Object.keys(sheet.cells);
      for (const a of pool) { const q = parseAddr(a); if (q && contains(r.rect, q.r, q.c)) out.push(K(r.sheet, a)); }
    }
    return out;
  }

  private invalidate(key: string) {
    this.cache.delete(key);
    this.cyclic.delete(key);
    for (const d of this.dependentsOf(key)) { this.cache.delete(d); this.cyclic.delete(d); }
    for (const v of this.volatile) {
      this.cache.delete(v);
      for (const d of this.dependentsOf(v)) this.cache.delete(d);
    }
  }

  /* ---------------- Edits ---------------- */

  /** Set or clear one cell and invalidate what depends on it. The workbook object is mutated. */
  setCell(sheet: string, a: string, cell: CellData | null) {
    const s = this.wb.sheets[sheet];
    if (!s) throw new Error(`No sheet ${sheet}`);
    const prev = s.cells[a];
    if (prev?.f) this.unindex(sheet, a);
    if (cell && (cell.f !== undefined || cell.v !== undefined || cell.s !== undefined || cell.cv !== undefined)) s.cells[a] = cell;
    else delete s.cells[a];
    if (cell?.f) this.index(sheet, a, cell.f);
    const p = parseAddr(a);
    if (p) {
      const u = this.used.get(sheet) ?? { rows: 0, cols: 0 };
      this.used.set(sheet, { rows: Math.max(u.rows, p.r), cols: Math.max(u.cols, p.c) });
    }
    this.invalidate(K(sheet, a));
  }

  /* ---------------- Evaluation ---------------- */

  private nameTarget(name: string): string | null {
    const names = this.wb.names ?? {};
    const hit = Object.keys(names).find((n) => n.toLowerCase() === name.toLowerCase());
    return hit ? names[hit] : null;
  }

  private get iterative() { return this.wb.calc?.iterative !== false; }

  /** The computed value of a cell. */
  value(sheet: string, a: string): Prim {
    const key = K(sheet, a);
    if (this.overrides.has(key)) return this.overrides.get(key)!;
    const cell = this.wb.sheets[sheet]?.cells[a];
    if (!cell) return null;
    if (cell.f === undefined) return (cell.v ?? null) as Prim;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const scc = this.sccOf.get(key);
    if (scc !== undefined && this.iterative) {
      if (this.solving.has(scc)) return this.iterates.get(key) ?? 0;
      this.solveScc(scc);
      return this.cache.get(key) ?? ERR.cycle;
    }
    if (this.evaluating.has(key)) {
      this.cyclic.add(key);
      if (this.iterative) throw new CycleSignal(key);
      throw ERR.cycle;
    }
    if (this.depth === 0 && this.iterative) {
      // The outermost call: if a cycle is met below, find the circular groups, then solve them.
      try { return this.compute(sheet, a, cell); }
      catch (e) {
        if (!(e instanceof CycleSignal)) throw e;
        this.findCycles();
        return this.value(sheet, a);
      }
    }
    return this.compute(sheet, a, cell);
  }

  private compute(sheet: string, a: string, cell: CellData): Prim {
    const key = K(sheet, a);
    if (this.depth > 150) this.warm(key);
    const p = parseAddr(a)!;
    const here: Here = { sheet, r: p.r, c: p.c };
    const parsed = this.parsed.get(key);
    let v: Prim;
    this.evaluating.add(key);
    this.depth++;
    try {
      if (!parsed?.node) v = parsed?.error ?? ERR.syntax;
      else v = this.scalar(this.evalNode(parsed.node, here), here);
    } catch (e) {
      if (!(e instanceof CalcError)) throw e;
      v = e;
      if (e === ERR.cycle) this.cyclic.add(key);
    } finally {
      this.evaluating.delete(key);
      this.depth--;
    }
    if (isErr(v) && parsed?.unsupported.length && cell.cv !== undefined && cell.cv !== null) v = cell.cv as Prim;
    if (typeof v === "number" && !Number.isFinite(v)) v = ERR.num;
    if (!this.sccOf.has(key) || !this.solving.has(this.sccOf.get(key)!)) this.cache.set(key, v);
    return v;
  }

  /** Evaluate a long chain of precedents bottom-up, so deep models do not exhaust the call stack. */
  private warm(start: string) {
    const order: string[] = [];
    const seen = new Set<string>();
    const stack: [string, boolean][] = [[start, false]];
    while (stack.length) {
      const [k, done] = stack.pop()!;
      if (done) { order.push(k); continue; }
      if (seen.has(k) || this.cache.has(k)) continue;
      seen.add(k);
      stack.push([k, true]);
      for (const p of this.precedentsOf(k, true)) if (!seen.has(p) && !this.cache.has(p)) stack.push([p, false]);
    }
    const depth = this.depth;
    this.depth = 0;
    try {
      for (const k of order) {
        if (k === start || this.evaluating.has(k)) continue;
        const [s, a] = splitKey(k);
        try { this.value(s, a); } catch { /* cycles are reported when reached normally */ }
      }
    } finally { this.depth = depth; }
  }

  isCyclic(sheet: string, a: string) { const k = K(sheet, a); return this.cyclic.has(k) || this.sccOf.has(k); }

  /** How a circular group was solved: iterations used and whether it converged. */
  cycleInfo(sheet: string, a: string): { iterations: number; converged: boolean; size: number } | null {
    const i = this.sccOf.get(K(sheet, a));
    if (i === undefined) return null;
    const info = this.sccInfo.get(i);
    return info ? { ...info, size: this.sccs[i].length } : null;
  }

  /** Tarjan's algorithm, iteratively, over formula-to-formula dependencies. */
  private findCycles() {
    const index = new Map<string, number>(), low = new Map<string, number>(), onStack = new Set<string>(), stack: string[] = [];
    const out: string[][] = [];
    let n = 0;
    const succ = new Map<string, string[]>();
    const next = (k: string) => { let s = succ.get(k); if (!s) succ.set(k, (s = this.precedentsOf(k, true))); return s; };
    for (const start of this.parsed.keys()) {
      if (index.has(start)) continue;
      const work: [string, number][] = [[start, 0]];
      index.set(start, n); low.set(start, n); n++; stack.push(start); onStack.add(start);
      while (work.length) {
        const top = work[work.length - 1];
        const v = top[0], ns = next(v);
        if (top[1] < ns.length) {
          const w = ns[top[1]++];
          if (!this.parsed.has(w)) continue;
          if (!index.has(w)) { index.set(w, n); low.set(w, n); n++; stack.push(w); onStack.add(w); work.push([w, 0]); }
          else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
        } else {
          work.pop();
          if (work.length) { const u = work[work.length - 1][0]; low.set(u, Math.min(low.get(u)!, low.get(v)!)); }
          if (low.get(v) === index.get(v)) {
            const comp: string[] = [];
            let w: string;
            do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== v);
            if (comp.length > 1 || next(v).includes(v)) out.push(this.orderWithin(comp, next));
          }
        }
      }
    }
    this.sccs = out;
    this.sccOf.clear();
    out.forEach((c, i) => c.forEach((k) => this.sccOf.set(k, i)));
  }

  /**
   * Order a circular group so each cell follows the cells it reads, ignoring the edges that close the
   * loop. Substitution then moves values forward in one pass, so a loop that is switched off settles
   * at once and a live one converges in fewer iterations.
   */
  private orderWithin(comp: string[], next: (k: string) => string[]): string[] {
    const inGroup = new Set(comp), done = new Set<string>(), out: string[] = [];
    for (const start of comp) {
      if (done.has(start)) continue;
      const stack: [string, number][] = [[start, 0]];
      done.add(start);
      while (stack.length) {
        const top = stack[stack.length - 1];
        const ns = next(top[0]);
        if (top[1] < ns.length) {
          const w = ns[top[1]++];
          if (inGroup.has(w) && !done.has(w)) { done.add(w); stack.push([w, 0]); }
        } else { out.push(top[0]); stack.pop(); }
      }
    }
    return out;
  }

  /**
   * Solve a circular group by repeated substitution (Gauss-Seidel), as Excel's iterative calculation
   * does: stop when no member moves by more than maxChange, or after maxIterations.
   */
  private solveScc(i: number) {
    const members = this.sccs[i];
    const max = this.wb.calc?.maxIterations ?? 100, tol = this.wb.calc?.maxChange ?? 0.001;
    const last = new Map<string, Prim>();
    let iterations = 0, converged = false;
    this.solving.add(i);
    const depth = this.depth;
    this.depth = 0;
    try {
      for (; iterations < max; iterations++) {
        let delta = 0;
        for (const m of members) {
          const [s, a] = splitKey(m);
          const cell = this.wb.sheets[s]?.cells[a];
          if (!cell) continue;
          this.cache.delete(m);
          let v: Prim;
          try { v = this.compute(s, a, cell); } catch (e) { if (e instanceof CalcError) v = e; else throw e; }
          this.cache.delete(m);
          last.set(m, v);
          const x = typeof v === "number" ? v : 0;
          delta = Math.max(delta, Math.abs(x - (this.iterates.get(m) ?? 0)));
          this.iterates.set(m, x);
        }
        if (delta <= tol) { converged = true; iterations++; break; }
      }
    } finally {
      this.solving.delete(i);
      this.depth = depth;
    }
    this.sccInfo.set(i, { iterations, converged });
    for (const m of members) this.cache.set(m, converged ? (last.get(m) ?? null) : ERR.cycle);
  }

  private rangeOf(ref: RefTok, here: Here): RangeVal {
    const rr = this.refRect(ref, here.sheet);
    if (!rr) throw ERR.ref;
    return { kind: "range", sheet: rr.sheet, ...rr.rect };
  }

  private refFromText(text: string, own: string): RangeVal | null {
    try {
      const n = parse(text);
      if (n.k !== "ref") return null;
      return this.rangeOf(n.ref, { sheet: own, r: 1, c: 1 });
    } catch { return null; }
  }

  grid(v: Val): Arr {
    if (isArr(v)) return v;
    if (!isRange(v)) return [[v]];
    const u = this.used.get(v.sheet) ?? { rows: 0, cols: 0 };
    const r2 = v.r2 === MAX_ROW ? Math.max(v.r1, u.rows) : v.r2;
    const c2 = v.c2 === MAX_COL ? Math.max(v.c1, u.cols) : v.c2;
    if ((r2 - v.r1 + 1) * (c2 - v.c1 + 1) > 2_000_000) throw ERR.num;
    const out: Arr = [];
    for (let r = v.r1; r <= r2; r++) {
      const row: Prim[] = [];
      for (let c = v.c1; c <= c2; c++) {
        try { row.push(this.value(v.sheet, A1(r, c))); } catch (e) { if (e instanceof CalcError) row.push(e); else throw e; }
      }
      out.push(row);
    }
    return out;
  }

  scalar(v: Val, here: Here): Prim {
    if (isArr(v)) return v[0]?.[0] ?? null;
    if (!isRange(v)) return v;
    if (v.r1 === v.r2 && v.c1 === v.c2) return this.value(v.sheet, A1(v.r1, v.c1));
    if (v.c1 === v.c2 && here.r >= v.r1 && here.r <= v.r2) return this.value(v.sheet, A1(here.r, v.c1));
    if (v.r1 === v.r2 && here.c >= v.c1 && here.c <= v.c2) return this.value(v.sheet, A1(v.r1, here.c));
    return ERR.value;
  }

  private evalNode(n: Node, here: Here): Val {
    switch (n.k) {
      case "num": return n.v;
      case "str": return n.v;
      case "bool": return n.v;
      case "err": return errorFromCode(n.v);
      case "miss": return null;
      case "ref": return this.rangeOf(n.ref, here);
      case "name": {
        const target = this.nameTarget(n.v);
        if (!target) throw ERR.name;
        return this.evalNode(parse(target), here);
      }
      case "fn": {
        const fn = FUNCTIONS[n.name];
        if (!fn) throw ERR.unsupported;
        const ctx: FnCtx = {
          ev: (x) => this.evalNode(x, here),
          grid: (v) => this.grid(v),
          scalar: (v) => this.scalar(v, here),
          here,
          markVolatile: () => undefined,
          refFromText: (t) => this.refFromText(t, here.sheet),
        };
        return fn(ctx, n.args);
      }
      case "neg": return this.map1(this.evalNode(n.a, here), here, (x) => -toNumber(x));
      case "pos": return this.evalNode(n.a, here);
      case "pct": return this.map1(this.evalNode(n.a, here), here, (x) => toNumber(x) / 100);
      case "bin": return this.binary(n.op, this.evalNode(n.a, here), this.evalNode(n.b, here), here);
    }
  }

  private map1(v: Val, here: Here, f: (x: Prim) => Prim): Val {
    if (isArr(v) || (isRange(v) && !(v.r1 === v.r2 && v.c1 === v.c2))) {
      return this.grid(v).map((row) => row.map((x) => { try { if (isErr(x)) return x; return f(x); } catch (e) { if (e instanceof CalcError) return e; throw e; } }));
    }
    const s = this.scalar(v, here);
    if (isErr(s)) throw s;
    return f(s);
  }

  private op(op: string, a: Prim, b: Prim): Prim {
    if (isErr(a)) throw a;
    if (isErr(b)) throw b;
    switch (op) {
      case "+": return toNumber(a) + toNumber(b);
      case "-": return toNumber(a) - toNumber(b);
      case "*": return toNumber(a) * toNumber(b);
      case "/": { const d = toNumber(b); if (d === 0) throw ERR.div0; return toNumber(a) / d; }
      case "^": { const r = Math.pow(toNumber(a), toNumber(b)); if (!Number.isFinite(r)) throw ERR.num; return r; }
      case "&": return toText(a) + toText(b);
      case "=": return compare(a, b) === 0;
      case "<>": return compare(a, b) !== 0;
      case "<": return compare(a, b) < 0;
      case ">": return compare(a, b) > 0;
      case "<=": return compare(a, b) <= 0;
      case ">=": return compare(a, b) >= 0;
    }
    throw ERR.value;
  }

  private binary(op: string, a: Val, b: Val, here: Here): Val {
    const multi = (v: Val) => isArr(v) || (isRange(v) && !(v.r1 === v.r2 && v.c1 === v.c2));
    if (!multi(a) && !multi(b)) return this.op(op, this.scalar(a, here), this.scalar(b, here));
    const ga = this.grid(a), gb = this.grid(b);
    const rows = Math.max(ga.length, gb.length), cols = Math.max(ga[0]?.length ?? 0, gb[0]?.length ?? 0);
    const pick = (g: Arr, r: number, c: number): Prim => {
      const rr = g.length === 1 ? 0 : r, cc = (g[0]?.length ?? 0) === 1 ? 0 : c;
      const v = g[rr]?.[cc];
      return v === undefined ? ERR.na : v;
    };
    const out: Arr = [];
    for (let r = 0; r < rows; r++) {
      const row: Prim[] = [];
      for (let c = 0; c < cols; c++) {
        try { row.push(this.op(op, pick(ga, r, c), pick(gb, r, c))); } catch (e) { if (e instanceof CalcError) row.push(e); else throw e; }
      }
      out.push(row);
    }
    return out;
  }

  /* ---------------- Reading ---------------- */

  /** A value that never throws: errors (including cycles) come back as values. */
  get(sheet: string, a: string): Prim {
    try { return this.value(sheet, a); } catch (e) { if (e instanceof CalcError) return e; throw e; }
  }

  display(sheet: string, a: string): { text: string; color?: string; value: Prim } {
    const value = this.get(sheet, a);
    const cell = this.wb.sheets[sheet]?.cells[a];
    const f = formatValue(value, cell?.s?.nf);
    return { ...f, value };
  }

  /** Evaluate a formula as if it were in a cell, without storing it. */
  evaluate(formula: string, sheet: string, at = "A1"): Prim {
    const p = parseAddr(at) ?? { r: 1, c: 1 };
    try { return this.scalar(this.evalNode(parse(formula), { sheet, ...p }), { sheet, ...p }); }
    catch (e) { if (e instanceof CalcError) return e; if (e instanceof FormulaSyntaxError) return ERR.syntax; throw e; }
  }

  /* ---------------- What-if ---------------- */

  /** Compute something with some cells temporarily replaced. Nothing in the workbook changes. */
  withOverrides<T>(ov: Record<string, Prim>, fn: () => T): T {
    const keys = Object.keys(ov);
    for (const k of keys) { this.overrides.set(k, ov[k]); this.invalidate(k); }
    try { return fn(); }
    finally { for (const k of keys) { this.overrides.delete(k); this.invalidate(k); } }
  }

  /** A two-way data table: the output for every (row value, column value) pair. */
  table(sheet: string, output: string, rowInput: string, colInput: string, rowValues: number[], colValues: number[]): Prim[][] {
    const out = this.resolve(output, sheet), ri = this.resolve(rowInput, sheet), ci = this.resolve(colInput, sheet);
    return rowValues.map((rv) => colValues.map((cv) => this.withOverrides({ [K(ri.sheet, ri.a)]: rv, [K(ci.sheet, ci.a)]: cv }, () => this.get(out.sheet, out.a))));
  }

  /** Find the input that makes `target` equal `goal` (secant method, then bisection). */
  goalSeek(sheet: string, target: string, goal: number, changing: string): { value: number; result: number } | null {
    const t = this.resolve(target, sheet), ch = this.resolve(changing, sheet);
    const key = K(ch.sheet, ch.a);
    const f = (x: number) => { const v = this.withOverrides({ [key]: x }, () => this.get(t.sheet, t.a)); return typeof v === "number" ? v - goal : NaN; };
    const start = this.get(ch.sheet, ch.a);
    let x0 = typeof start === "number" && start !== 0 ? start : 0.1, x1 = x0 * 1.1 + 0.01;
    let f0 = f(x0), f1 = f(x1);
    for (let i = 0; i < 100 && Number.isFinite(f0) && Number.isFinite(f1); i++) {
      if (Math.abs(f1) < 1e-9 * Math.max(1, Math.abs(goal))) return { value: x1, result: f1 + goal };
      if (f1 === f0) break;
      const x2 = x1 - (f1 * (x1 - x0)) / (f1 - f0);
      x0 = x1; f0 = f1; x1 = x2; f1 = f(x1);
    }
    // Bracket and bisect.
    let lo = -1e6, hi = 1e6, flo = f(lo), fhi = f(hi);
    for (const span of [1, 10, 100, 1e4, 1e6]) { lo = -span; hi = span; flo = f(lo); fhi = f(hi); if (flo * fhi <= 0) break; }
    if (!(flo * fhi <= 0)) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2, fm = f(mid);
      if (Math.abs(fm) < 1e-9 * Math.max(1, Math.abs(goal))) return { value: mid, result: fm + goal };
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return { value: (lo + hi) / 2, result: f((lo + hi) / 2) + goal };
  }

  /** "Sheet!A1" or "A1" (on `own`) as a sheet id and address. */
  resolve(ref: string, own: string): { sheet: string; a: string } {
    const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(ref.trim());
    const sheetName = m ? (m[1] ?? m[2]).replace(/''/g, "'") : null;
    const sheet = sheetName ? this.sheetId(sheetName) : own;
    if (!sheet) throw new Error(`No sheet named ${sheetName}`);
    const a = (m ? m[3] : ref).replace(/\$/g, "").toUpperCase();
    if (!parseAddr(a)) throw new Error(`Not a cell: ${ref}`);
    return { sheet, a };
  }

  /** Values of a rectangle, for the agent and for linked slide elements. */
  read(sheet: string, range: string): Prim[][] {
    const rect = parseRange(range);
    if (!rect) throw new Error(`Not a range: ${range}`);
    const u = this.usedRange(sheet);
    const r2 = rect.r2 === MAX_ROW ? u.rows : rect.r2, c2 = rect.c2 === MAX_COL ? u.cols : rect.c2;
    const out: Prim[][] = [];
    for (let r = rect.r1; r <= r2; r++) { const row: Prim[] = []; for (let c = rect.c1; c <= c2; c++) row.push(this.get(sheet, A1(r, c))); out.push(row); }
    return out;
  }

  parsedFormula(sheet: string, a: string) { return this.parsed.get(K(sheet, a)) ?? null; }
}

/** A literal typed into a cell, as a value: numbers (including "1,200" and "12%"), booleans, text. */
export function literal(input: string): Scalar {
  const t = input.trim();
  if (t === "") return null;
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  const n = /^[-+]?[$]?[\d,]*\.?\d+(?:[eE][-+]?\d+)?%?$/.test(t.replace(/\s/g, "")) ? Number(t.replace(/[$,%\s]/g, "")) / (t.endsWith("%") ? 100 : 1) : NaN;
  return Number.isFinite(n) ? n : input;
}
