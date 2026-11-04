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
