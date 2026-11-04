/**
 * What a person can do with a finished answer (the terminal's AI screen): take it with its sources,
 * paste its table into a spreadsheet, keep it in Home's notes, or download it. Pure, tested in
 * scripts/test-answer-actions.ts.
 */
export type AnswerSource = { id: string; label: string; url: string };

/** The answer as Markdown with its sources listed under it, so citations still resolve once pasted elsewhere. */
export function answerMarkdown(content: string, sources: AnswerSource[], question?: string): string {
  const head = question ? `**Q:** ${question.trim()}\n\n` : "";
  const used = sources.filter((s) => content.includes(`[${s.id}]`) || content.includes(`${s.id},`) || content.includes(`, ${s.id}]`));
  const list = (used.length ? used : sources).map((s) => `- [${s.id}] ${s.label}: ${s.url}`).join("\n");
  return `${head}${content.trim()}${list ? `\n\nSources:\n${list}` : ""}\n`;
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** The first Markdown table in the text, as rows of cells (header first), or null. */
export function firstTable(md: string): string[][] | null {
  const lines = md.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes("|") || !isRule(lines[i + 1])) continue;
    const head = cells(lines[i]);
    const rows = [head];
    for (let j = i + 2; j < lines.length && lines[j].includes("|") && lines[j].trim(); j++) rows.push(cells(lines[j]));
    if (head.length >= 2 && rows.length >= 2) return rows;
  }
  return null;
}

/**
 * Rows as tab-separated text, which Excel, Sheets and Numbers paste into cells. Markdown emphasis and
 * citation marks come off ("**$5,435M** [S1]" pastes as "$5,435M"), and tabs or line breaks inside a cell
 * become spaces so the grid holds its shape.
 */
export function toTsv(rows: string[][]): string {
  const clean = (c: string) => c.replace(/\*\*|__|`/g, "").replace(/\s*\[S\d+(?:\s*,\s*S\d+)*\]/g, "").replace(/[\t\r\n]+/g, " ").trim();
  return rows.map((r) => r.map(clean).join("\t")).join("\n");
}

/** A short entry for Home's notes: the date, the question and the answer's opening, within `room` characters. */
export function noteEntry(question: string, answer: string, at: Date, room = 600): string {
  const when = at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const body = answer.replace(/\s*\[S\d+(?:\s*,\s*S\d+)*\]/g, "").replace(/[#*_`>|]/g, "").replace(/\n{2,}/g, "\n").trim();
  const head = `— ${when}: ${question.trim().slice(0, 140)}\n`;
  const space = Math.max(0, room - head.length);
  return head + (body.length > space ? `${body.slice(0, Math.max(0, space - 1)).trimEnd()}…` : body);
}

/** A file name for a downloaded answer, from its question. */
export function answerFileName(question: string, at: Date): string {
  const slug = question.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "answer";
  return `youbank-${slug}-${at.toISOString().slice(0, 10)}.md`;
}

/* ---------------- What to ask next ---------------- */

/** Follow-ups by the tools an answer used: what a person usually asks after that kind of answer. */
const NEXT: [RegExp, (t: string) => string[]][] = [
  [/^get_company_financials$|^get_xbrl_series$/, (t) => [`How does ${t} compare with its closest peers on growth and margins?`, `Show ${t}'s last eight quarters of revenue and operating margin as a table.`]],
  [/^get_trading_comps$/, (t) => [`Which of ${t}'s peers looks cheapest on EV/EBITDA, and why might that be?`, `What would ${t} be worth at the peer median multiple?`]],
  [/^search_filing$|^read_filing$|^read_document$/, (t) => [`Quote the exact passage from the filing behind that.`, `What risks does ${t}'s latest 10-K flag that changed from last year?`]],
  [/^filing_changes$/, (t) => [`Which of ${t}'s new or reworded risk factors matter most, and why?`, `What changed in ${t}'s MD&A between the last two 10-Qs?`]],
  [/^edgar_fulltext_search$/, () => [`Which of those filings matter most, and what do they say?`]],
  [/^get_recent_filings$/, (t) => [`Summarize ${t}'s most recent 8-K and why it matters.`]],
  [/^get_insider_transactions$/, (t) => [`Are ${t}'s insiders net buyers or sellers over the last year, in dollars?`]],
  [/^get_price_risk$|^quant_risk$/, (t) => [`How would ${t} have done in 2008 and 2020 drawdowns?`]],
  [/^get_credit_risk$/, (t) => [`What would it take for ${t}'s implied rating to move a notch?`]],
  [/^get_earnings_quality$/, (t) => [`Which accounting items drive ${t}'s earnings-quality score?`]],
  [/^get_revenue_forecast$/, (t) => [`What would have to be true for ${t} to beat the high end of that forecast?`]],
  [/^get_cost_of_capital$/, (t) => [`Build a quick DCF for ${t} with that WACC and show the sensitivity.`]],
  [/^screen_companies$/, () => [`Rank those by revenue growth and show the top five with their multiples.`]],
  [/^form_d_search$|^search_startups$/, () => [`Who are the founders and investors, and how do I reach them?`, `Which competitors raised recently?`]],
  [/^calc$/, () => [`Walk me through that calculation step by step.`]],
  [/^web_research$/, () => [`What do the SEC filings say about the same thing?`]],
  [/^get_token$|^token_valuation$/, () => [`What are the biggest token unlocks coming up, and how large are they?`]],
];

/**
 * Up to three questions worth asking after an answer, from the tools it used and the ticker in scope,
 * none repeating the question just asked. Pure; no model call.
 */
export function followUps(question: string, tools: string[], ticker: string): string[] {
  const t = ticker || "the company";
  const out: string[] = [];
  for (const name of tools) for (const [re, make] of NEXT) if (re.test(name)) for (const q of make(t)) if (!out.includes(q)) out.push(q);
  if (out.length < 2) out.push(`What are the two or three things that matter most for ${t} right now?`, `What would change your view on ${t}?`);
  const asked = question.toLowerCase();
  return out.filter((q) => !asked.includes(q.toLowerCase().slice(0, 30))).slice(0, 3);
}
