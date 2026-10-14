/**
 * Call Desk (E5): an earnings call's question-and-answer session as pairs. A call reaches Edge in one of two
 * shapes: a recording read into speaker turns (Parakeet or the premium speaker-labelled path, names guessed
 * only from what the call itself says), or a transcript filed on EDGAR as an 8-K exhibit (plain text with
 * "Operator:" and "Jane Doe -- Chief Financial Officer" style speaker lines). Both become turns; the Q&A
 * starts at the operator's cue; analysts are tagged from the operator's introductions ("our next question
 * comes from Sam Lee with Morgan Stanley"); each analyst question (with its follow-up) is paired with the
 * management answers that follow, until the next analyst. A pair whose roles are unclear is kept but marked,
 * and is not scored.
 *
 * Pure, tested on two fixture transcripts (one diarized, one plain) in scripts/test-edge-next.ts.
 */

export type Role = "operator" | "analyst" | "management" | "unknown";
export type Turn = { ord: number; speaker: string; role: Role; firm?: string; text: string; t?: number };
export type QaPair = {
  n: number; analyst: string; firm: string; question: string; answer: string; answerers: string[];
  /** Seconds into the recording where the question starts, when the call is a recording. */
  t?: number; followUp: boolean;
  /** Whether the roles are clear enough to score (an analyst asked, management answered). */
  clear: boolean;
};

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** "Jane Doe -- Chief Financial Officer" or "Jane Doe - Analyst, Morgan Stanley" or "JANE DOE:" as a speaker line (text may follow a colon). Pure. */
export function speakerLine(line: string): { speaker: string; title: string; rest: string } | null {
  const l = line.trim();
  if (!l) return null;
  const op = /^operator\b\s*[:\-—–]?\s*(.*)$/i.exec(l);
  if (op) return { speaker: "Operator", title: "", rest: op[1] };
  const colon = l.indexOf(":");
  const head = colon > 0 && colon <= 120 ? l.slice(0, colon).trim() : l.length <= 120 ? l : "";
  const rest = colon > 0 && colon <= 120 ? l.slice(colon + 1).trim() : "";
  if (!head) return null;
  // Name -- Title (the style of filed transcripts)
  const dash = /^([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,3})\s+(?:--|—|–|-)\s+(.{2,90})$/.exec(head);
  if (dash && /officer|president|chief|ceo|cfo|coo|analyst|director|vice|head|treasurer|relations|chairman|founder|partner|securities|capital|bank|research|&|llc|inc\b|group|markets|management/i.test(dash[2])) return { speaker: dash[1], title: clean(dash[2]), rest };
  if (colon > 0 && colon <= 120) {
    // Name, Title: text   or   Name: text  (a short, name-shaped label)
    const named = /^([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,3})(?:\s*,\s*(.{2,60}))?$/.exec(head);
    if (named && !/^(Q\d|Revenue|Net|Total|Note|Source|Forward|Safe|Item|Exhibit|Table|Page|Date|Time|Location)\b/.test(named[1])) return { speaker: named[1], title: clean(named[2] ?? ""), rest };
    return null;
  }
  // ALL CAPS NAME on its own line
  if (/^[A-Z][A-Z.'’\-]+(?:\s+[A-Z][A-Z.'’\-]+){1,3}$/.test(l) && !/^(QUESTION|ANSWER|PRESENTATION|PARTICIPANTS|CORPORATE|CONFERENCE|FORWARD|SAFE|EXHIBIT)\b/.test(l)) return { speaker: titleCase(l), title: "", rest: "" };
  return null;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Turns from a plain transcript (a filed exhibit): a speaker line starts a turn; other lines join it. Pure. */
export function turnsFromText(text: string): Turn[] {
  const lines = text.replace(/\r/g, "").split(/\n+/);
  const out: Turn[] = [];
  let cur: Turn | null = null;
  const titles = new Map<string, string>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const sp = speakerLine(line);
    if (sp) {
      if (cur && cur.text) out.push(cur);
      if (sp.title) titles.set(sp.speaker.toLowerCase(), sp.title);
      cur = { ord: out.length, speaker: sp.speaker, role: "unknown", text: clean(sp.rest) };
      const t = sp.title || titles.get(sp.speaker.toLowerCase()) || "";
      if (t) cur.firm = t;
      continue;
    }
    if (!cur) cur = { ord: 0, speaker: "", role: "unknown", text: "" };
    cur.text = clean(`${cur.text} ${line}`);
  }
  if (cur && cur.text) out.push(cur);
  return out.map((t, i) => ({ ...t, ord: i }));
}

/** Turns from a recording's passages (speaker per passage, start time), consecutive passages of one speaker merged. Pure. */
export function turnsFromChunks(chunks: { speaker: string; text: string; tStart?: number | null }[]): Turn[] {
  const out: Turn[] = [];
  for (const c of chunks) {
    const speaker = clean(c.speaker || "");
    const last = out[out.length - 1];
    if (last && last.speaker === speaker) { last.text = joinOverlap(last.text, c.text); continue; }
    const m = /^(.*?)(?:,\s*(.+))?$/.exec(speaker);
    out.push({ ord: out.length, speaker: m?.[1] ?? speaker, role: "unknown", text: clean(c.text), ...(c.tStart !== null && c.tStart !== undefined ? { t: c.tStart } : {}), ...(m?.[2] ? { firm: m[2] } : {}) });
  }
  return out;
}

/** Join two passages that may overlap (passages overlap by about a tenth): drop the repeated words. Pure. */
export function joinOverlap(a: string, b: string): string {
  const A = clean(a), B = clean(b);
  for (let k = Math.min(240, A.length, B.length); k >= 20; k--) if (A.endsWith(B.slice(0, k))) return `${A}${B.slice(k)}`;
  return `${A} ${B}`.trim();
}

/** The operator's introduction of an analyst: name and firm, or null. Pure. */
export function analystIntro(text: string): { name: string; firm: string } | null {
  const m = /(?:first|next|following|last|final|our|the)?\s*(?:question|questions)\s+(?:today\s+)?(?:comes|will come|is coming|is|are)?\s*(?:from(?: the line of)?)\s+([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,3})\s*(?:,|\s)\s*(?:with|from|of|at)\s+([A-Z][A-Za-z0-9&.'’\- ]{1,60}?)(?:[.,;]|\s+(?:please|your line|go ahead|you may)|$)/i.exec(text);
  if (m) return { name: clean(m[1]), firm: clean(m[2]) };
  const n = /(?:question|line)\s+(?:comes\s+)?from\s+([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,3})(?:[.,;]|$)/i.exec(text);
  return n ? { name: clean(n[1]), firm: "" } : null;
}

const QA_CUE = /question[- ]and[- ]answer|q\s*&\s*a\b|open (?:up )?(?:the|for) (?:line|lines|call|floor) (?:for|to) questions|(?:first|our first) question|take (?:your|our) (?:first )?questions|now begin the question/i;
const MGMT_TITLE = /chief|officer|ceo|cfo|coo|president|chair|founder|treasurer|investor relations|vice president|\bvp\b|head of|executive|management|director of/i;
const ANALYST_TITLE = /analyst|securities|capital|partners|bank|research|markets|morgan|goldman|jpmorgan|citi|barclays|ubs|wells|jefferies|bernstein|evercore|raymond|cowen|piper|stifel|rbc|td |scotia|mizuho|bofa|merrill|deutsche|credit suisse|keybanc|truist|baird|oppenheimer|wolfe|bmo/i;

/** Where the Q&A starts: the first operator (or host) turn with the cue, else the first analyst introduction; -1 when none. Pure. */
export function qaStart(turns: Turn[]): number {
  const i = turns.findIndex((t) => QA_CUE.test(t.text) && (isOperator(t.speaker) || t.ord > 0));
  if (i >= 0) return i;
  return turns.findIndex((t) => !!analystIntro(t.text));
}

const isOperator = (speaker: string) => /^(operator|moderator|host|conference operator)\b/i.test(speaker.trim());

/** Every turn with its role: operators by name, analysts by the operator's introductions or their titles, management by title or by speaking before the Q&A. Pure. */
export function assignRoles(turns: Turn[]): Turn[] {
  const start = qaStart(turns);
  const analysts = new Map<string, string>();
  for (const t of turns) {
    if (!isOperator(t.speaker) && !/question/i.test(t.text)) continue;
    const a = analystIntro(t.text);
    if (a) analysts.set(a.name.toLowerCase(), a.firm);
  }
  const before = new Set(turns.slice(0, start >= 0 ? start : 0).filter((t) => t.speaker && !isOperator(t.speaker)).map((t) => t.speaker.toLowerCase()));
  const lastName = (s: string) => s.toLowerCase().split(/\s+/).pop() ?? "";
  return turns.map((t) => {
    const s = t.speaker.toLowerCase();
    if (isOperator(t.speaker)) return { ...t, role: "operator" as Role };
    const known = analysts.get(s) ?? [...analysts.entries()].find(([n]) => lastName(n) === lastName(s) && lastName(s).length > 2)?.[1];
    if (known !== undefined) return { ...t, role: "analyst" as Role, firm: known || t.firm };
    if (t.firm && ANALYST_TITLE.test(t.firm) && !MGMT_TITLE.test(t.firm)) return { ...t, role: "analyst" as Role };
    if ((t.firm && MGMT_TITLE.test(t.firm)) || before.has(s)) return { ...t, role: "management" as Role };
    return { ...t, role: "unknown" as Role };
  });
}

/**
 * The Q&A as pairs: each analyst question (consecutive analyst turns) with the management turns after it, up
 * to the next analyst or operator introduction. A second question by the same analyst after an answer is a
 * follow-up pair. Unknown speakers inside an answer make the pair unclear. Pure.
 */
export function pairQa(raw: Turn[]): QaPair[] {
  const turns = assignRoles(raw);
  const start = qaStart(turns);
  if (start < 0) return [];
  const out: QaPair[] = [];
  let i = start;
  let lastAnalyst = "";
  while (i < turns.length) {
    const t = turns[i];
    if (t.role !== "analyst") {
      // An unknown speaker right after an operator introduction is the analyst the operator named.
      const intro = t.role === "operator" ? analystIntro(t.text) : null;
      if (intro && turns[i + 1] && turns[i + 1].role === "unknown") turns[i + 1] = { ...turns[i + 1], role: "analyst", firm: intro.firm };
      i++; continue;
    }
    const q: Turn[] = [];
    while (i < turns.length && turns[i].role === "analyst") q.push(turns[i++]);
    const a: Turn[] = [];
    let unclear = false;
    while (i < turns.length && turns[i].role !== "analyst" && turns[i].role !== "operator") {
      if (turns[i].role === "unknown") unclear = true;
      a.push(turns[i++]);
    }
    const analyst = q[0].speaker || "Analyst";
    const question = clean(q.map((x) => x.text).join(" "));
    const answer = clean(a.map((x) => x.text).join(" "));
    if (!question) continue;
    out.push({
      n: out.length + 1, analyst, firm: q[0].firm ?? "", question, answer, answerers: [...new Set(a.map((x) => x.speaker).filter(Boolean))],
      ...(q[0].t !== undefined ? { t: q[0].t } : {}), followUp: analyst === lastAnalyst && out.length > 0,
      clear: !!answer && !unclear && a.some((x) => x.role === "management") && question.split(/\s+/).length >= 4,
    });
    lastAnalyst = analyst;
  }
  return out;
}

/** Whether a text reads like an earnings-call transcript (operator cues and questions), not a press release. Pure. */
export function looksLikeTranscript(text: string): boolean {
  const head = text.slice(0, 200_000);
  const ops = (head.match(/\boperator\b/gi) ?? []).length;
  return ops >= 2 && QA_CUE.test(head) && (head.match(/\bquestion\b/gi) ?? []).length >= 3;
}
