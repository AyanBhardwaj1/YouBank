/**
 * Text helpers the Documents screens share with the server: matching a quote against a passage in any
 * language, where a quote falls among the pieces of a page (so a viewer can highlight it), and a
 * word-level diff for reworded paragraphs. Pure, and safe to import in the browser.
 */

/** Lower case, letters and digits in any script, single spaces; full stops kept only inside numbers. */
export function normText(s: string): string {
  return s.normalize("NFKC").toLowerCase()
    .replace(/[“”"'’‘`]/g, "")
    .replace(/[^\p{L}\p{N}%$.]+/gu, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words a quote may add or drop without changing what it says. Negations, numbers and prepositions are never among them. */
const SOFT = new Set(["a", "an", "the", "that", "which", "and"]);

/**
 * Where a quote's words line up with a passage's from `start`: exact words, a word the passage splits
 * across a line break ("infra-" "structure"), and at most three soft words added or dropped. Returns
 * the passage index after the match, or -1.
 */
function alignAt(q: string[], p: string[], start: number): number {
  let i = 0, j = start, soft = 0;
  while (i < q.length) {
    if (j < p.length && q[i] === p[j]) { i++; j++; continue; }
    if (j + 1 < p.length && p[j] + p[j + 1] === q[i]) { i++; j += 2; continue; }
    if (i + 1 < q.length && j < p.length && q[i] + q[i + 1] === p[j]) { i += 2; j++; continue; }
    if (soft < 3 && SOFT.has(q[i])) { soft++; i++; continue; }
    if (soft < 3 && j < p.length && SOFT.has(p[j]) && j > start) { soft++; j++; continue; }
    return -1;
  }
  return j;
}

/**
 * Whether a quote really appears in a passage: word for word once case, spacing, punctuation and
 * quote marks are set aside, in any script. A few harmless differences are allowed (an article added
 * or dropped, a word hyphenated across a line, an omission marked with an ellipsis); a changed word or
 * number is not.
 */
export function quoteFound(quote: string, passage: string): boolean {
  const q = normText(quote);
  if (q.length < 8) return false;
  const p = normText(passage);
  if (p.includes(q)) return true;
  const pw = p.split(" ");
  const pieces = quote.split(/\.{3}|…/).map((x) => normText(x).split(" ").filter(Boolean)).filter((w) => w.length);
  let from = 0;
  for (const piece of pieces) {
    let end = -1;
    for (let j = from; j < pw.length && end < 0; j++) if (pw[j] === piece[0] || piece[0].startsWith(pw[j]) || SOFT.has(piece[0])) end = alignAt(piece, pw, j);
    if (end < 0) return false;
    from = end;
  }
  return true;
}

/**
 * Which pieces of a text (a PDF page's text items, a passage's words) a quote covers: those under the
 * quote when it appears whole, otherwise those holding runs of four of its words close together
 * (hyphenated line breaks, a dropped word). Returns the pieces' indexes in order.
 */
export function locateQuote(pieces: string[], quote: string): number[] {
  const q = normText(quote);
  if (q.length < 4) return [];
  const starts: number[] = [], ends: number[] = [];
  let joined = "";
  for (const p of pieces) {
    const n = normText(p);
    starts.push(joined.length);
    if (n) joined += `${n} `;
    ends.push(joined.length - (n ? 1 : 0));
  }
  const cover = (ranges: [number, number][]) => pieces.map((_, i) => i).filter((i) => ends[i] > starts[i] && ranges.some(([a, b]) => starts[i] < b && ends[i] > a));
  const at = joined.indexOf(q);
  if (at >= 0) return cover([[at, at + q.length]]);
  const words = q.split(" ");
  if (words.length < 4) return [];
  const hits: [number, number][] = [];
  for (let i = 0; i + 4 <= words.length; i += 2) {
    const g = words.slice(i, i + 4).join(" ");
    for (let from = 0, k = joined.indexOf(g); k >= 0 && hits.length < 400; from = k + 1, k = joined.indexOf(g, from)) hits.push([k, k + g.length]);
  }
  if (!hits.length) return [];
  // Keep the densest cluster: the hits within one and a half quote-lengths of the best anchor.
  const span = q.length * 1.5;
  let best: [number, number][] = [];
  for (const [a] of hits) {
    const near = hits.filter(([b]) => b >= a && b <= a + span);
    if (near.length > best.length) best = near;
  }
  return best.length >= Math.min(2, hits.length) ? cover(best) : [];
}

export type DiffPart = { t: "same" | "add" | "del"; s: string };

/** Word-level differences between two versions of a paragraph (longest common subsequence). */
export function wordDiff(before: string, after: string, maxWords = 900): DiffPart[] {
  const a = before.trim().split(/\s+/).filter(Boolean), b = after.trim().split(/\s+/).filter(Boolean);
  if (!a.length || !b.length || a.length > maxWords || b.length > maxWords) {
    return [...(a.length ? [{ t: "del" as const, s: a.join(" ") }] : []), ...(b.length ? [{ t: "add" as const, s: b.join(" ") }] : [])];
  }
  const key = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}%$]+/gu, "");
  const ka = a.map(key), kb = b.map(key);
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = ka[i] === kb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (t: DiffPart["t"], s: string) => { const last = out[out.length - 1]; if (last && last.t === t) last.s += ` ${s}`; else out.push({ t, s }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) { push("same", b[j]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) push("del", a[i++]);
    else push("add", b[j++]);
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("add", b[j++]);
  return out;
}

/** m:ss or h:mm:ss for a time in seconds. */
export function clockOf(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
