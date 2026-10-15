/**
 * CSV for Quant: a tolerant reader (quoted fields, embedded commas and quotes, CRLF) for broker exports and
 * uploads, and a writer whose cells are neutralised against spreadsheet formula injection: a cell that starts
 * with =, +, -, @, a tab or a carriage return is prefixed with an apostrophe (OWASP's advice), unless it is a
 * plain number. Pure, safe on the client.
 */

/** Parse CSV text into rows of strings. */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
      continue;
    }
    if (c === '"') q = true;
    else if (c === delimiter) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const FORMULA = /^[=+\-@\t\r]/;

/** One cell for a CSV export, quoted when needed and neutralised against formulas. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : typeof v === "string" ? v : JSON.stringify(v);
  if (typeof v !== "number" && FORMULA.test(s) && !/^[+-]?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (header: string[], rows: unknown[][]) => [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
