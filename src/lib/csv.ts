/**
 * CSV cells for exports people open in spreadsheets. Pure, safe on the client.
 *
 * A cell starting with =, +, -, @, a tab or a carriage return is a formula to Excel, Sheets and Numbers
 * (CSV injection: a ticker or a broker's message could carry one). Such text gets a leading apostrophe, as
 * OWASP advises; plain numbers, negative ones included, are left alone. Then the usual quoting.
 */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: unknown[]) => cells.map(csvCell).join(",");
