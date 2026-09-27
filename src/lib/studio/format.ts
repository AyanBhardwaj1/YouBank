/**
 * Excel number formats: enough of the language for finance models. Sections (positive; negative;
 * zero; text), colours, literals, thousands separators, scaling commas, percentages, multiples
 * ("0.0x"), accounting padding and dates.
 */
import { dateFromSerial, generalNumber, isErr, roundHalfAway, type Prim } from "./values";

export type Formatted = { text: string; color?: string };

const COLORS: Record<string, string> = { red: "#C00000", blue: "#0000FF", green: "#008000", black: "#000000", white: "#FFFFFF", magenta: "#FF00FF", cyan: "#00B0F0", yellow: "#B8860B" };

/** Split on ";" outside quotes, escapes and brackets. */
export function sections(nf: string): string[] {
  const out: string[] = [];
  let cur = "", q = false, br = false;
  for (let i = 0; i < nf.length; i++) {
    const ch = nf[i];
    if (ch === "\\" && !q) { cur += ch + (nf[i + 1] ?? ""); i++; continue; }
    if (ch === "\"") q = !q;
    else if (!q && ch === "[") br = true;
    else if (!q && ch === "]") br = false;
    if (ch === ";" && !q && !br) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** Strip [Red], [>100] and locale tags; keep a currency symbol from [$€-2]. */
function stripBrackets(sec: string): { body: string; color?: string } {
  let color: string | undefined;
  const body = sec.replace(/\[([^\]]*)\]/g, (_m, inner: string) => {
    const c = COLORS[inner.toLowerCase()];
    if (c) { color = c; return ""; }
    const cur = /^\$([^-\]]*)/.exec(inner);
    if (cur) return cur[1] ? `"${cur[1]}"` : "";
    return "";
  });
  return { body, color };
}

/** The section's text with quoted literals and escapes removed, to classify it. */
const bare = (s: string) => s.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/_.|\*./g, "");

const isDateSection = (s: string) => /[yd]|[hs]|am\/pm|a\/p/i.test(bare(s)) || (/m/i.test(bare(s)) && !/[0#?]/.test(bare(s)));

function formatNumber(x: number, sec: string): string {
  // First pass: where the digit placeholders end, so trailing commas can be read as scaling.
  let lastPh = -1;
  for (let i = 0, q = false; i < sec.length; i++) {
    const ch = sec[i];
    if (ch === "\"") { q = !q; continue; }
    if (q) continue;
    if (ch === "\\" || ch === "_" || ch === "*") { i++; continue; }
    if (ch === "0" || ch === "#" || ch === "?") lastPh = i;
  }
  let prefix = "", suffix = "", intPat = "", decPat = "", dot = false, seen = false, percent = 0, scale = 0, grouping = false;
  let sci: { sign: string; digits: number } | null = null;
  for (let i = 0; i < sec.length; i++) {
    const ch = sec[i];
    const lit = (s: string) => { if (seen && i > lastPh) suffix += s; else if (!seen) prefix += s; else suffix += s; };
    if (ch === "\"") { const j = sec.indexOf("\"", i + 1); lit(sec.slice(i + 1, j < 0 ? undefined : j)); i = j < 0 ? sec.length : j; continue; }
    if (ch === "\\") { lit(sec[i + 1] ?? ""); i++; continue; }
    if (ch === "_") { lit(" "); i++; continue; }
    if (ch === "*") { i++; continue; }
    if (ch === "0" || ch === "#" || ch === "?") { seen = true; if (dot) decPat += ch; else intPat += ch; continue; }
    if (ch === ".") { if (!dot && i < lastPh) { dot = true; continue; } lit(ch); continue; }
    if (ch === ",") {
      if (seen && i < lastPh && !dot) { grouping = true; continue; }
      if (seen && i > lastPh) { scale++; continue; }
      lit(ch); continue;
    }
    if (ch === "%") { percent++; lit("%"); continue; }
    if ((ch === "E" || ch === "e") && (sec[i + 1] === "+" || sec[i + 1] === "-") && seen) {
      let j = i + 2, digits = 0;
      while (sec[j] === "0" || sec[j] === "#") { digits++; j++; }
      sci = { sign: sec[i + 1], digits: Math.max(1, digits) };
      i = j - 1;
      continue;
    }
    if (ch === "@") { lit(""); continue; }
    lit(ch);
  }
  let v = x * Math.pow(100, percent) / Math.pow(1000, scale);
  let expPart = "";
  if (sci) {
    const e = v === 0 ? 0 : Math.floor(Math.log10(Math.abs(v)));
    v = v / Math.pow(10, e);
    expPart = `E${e < 0 ? "-" : sci.sign === "+" ? "+" : ""}${String(Math.abs(e)).padStart(sci.digits, "0")}`;
  }
  const decimals = decPat.length;
  const minDec = (decPat.match(/0/g) ?? []).length;
  const fixed = roundHalfAway(v, decimals).toFixed(decimals);
  let [ip, dp = ""] = fixed.split(".");
  ip = ip.replace("-", "");
  if (decimals > minDec) {
    let cut = dp.length;
    while (cut > minDec && dp[cut - 1] === "0") cut--;
    const opt = decPat.slice(cut);
    dp = dp.slice(0, cut) + (opt.includes("?") ? " ".repeat(opt.length) : "");
  }
  const minInt = (intPat.match(/0/g) ?? []).length;
  if (ip === "0" && minInt === 0) ip = "";
  ip = ip.padStart(minInt, "0");
  if (grouping) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const qs = (intPat.match(/\?/g) ?? []).length;
  if (qs && ip.length < intPat.length) ip = ip.padStart(intPat.length, " ");
  return prefix + ip + (dot ? "." + dp : "") + expPart + suffix;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatDate(serial: number, sec: string): string {
  const d = dateFromSerial(serial);
  const frac = serial - Math.floor(serial);
  const totalSec = Math.round(frac * 86400);
  const H = Math.floor(totalSec / 3600), Mi = Math.floor((totalSec % 3600) / 60), Se = totalSec % 60;
  const ampm = /am\/pm|a\/p/i.test(sec);
  let out = "";
  let prevHour = false;
  for (let i = 0; i < sec.length;) {
    const rest = sec.slice(i);
    const tok = /^(yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|am\/pm|a\/p|"[^"]*"|\\.|_.|\*.|.)/i.exec(rest)![0];
    const lower = tok.toLowerCase();
    const nextIsSec = /^[^a-z]*s/i.test(sec.slice(i + tok.length));
    switch (lower) {
      case "yyyy": out += d.getUTCFullYear(); break;
      case "yy": out += String(d.getUTCFullYear()).slice(-2); break;
      case "mmmmm": out += MONTHS[d.getUTCMonth()][0]; break;
      case "mmmm": out += MONTHS[d.getUTCMonth()]; break;
      case "mmm": out += MONTHS[d.getUTCMonth()].slice(0, 3); break;
      case "mm": out += prevHour || nextIsSec ? String(Mi).padStart(2, "0") : String(d.getUTCMonth() + 1).padStart(2, "0"); break;
      case "m": out += prevHour || nextIsSec ? String(Mi) : String(d.getUTCMonth() + 1); break;
      case "dddd": out += DAYS[d.getUTCDay()]; break;
      case "ddd": out += DAYS[d.getUTCDay()].slice(0, 3); break;
      case "dd": out += String(d.getUTCDate()).padStart(2, "0"); break;
      case "d": out += String(d.getUTCDate()); break;
      case "hh": out += String(ampm ? ((H + 11) % 12) + 1 : H).padStart(2, "0"); break;
      case "h": out += String(ampm ? ((H + 11) % 12) + 1 : H); break;
      case "ss": out += String(Se).padStart(2, "0"); break;
      case "s": out += String(Se); break;
      case "am/pm": out += H < 12 ? "AM" : "PM"; break;
      case "a/p": out += H < 12 ? "A" : "P"; break;
      default:
        if (tok.startsWith("\"")) out += tok.slice(1, -1);
        else if (tok.startsWith("\\")) out += tok[1];
        else if (tok.startsWith("_")) out += " ";
        else if (tok.startsWith("*")) { /* fill: ignore */ }
        else out += tok;
    }
    prevHour = lower === "h" || lower === "hh" || (prevHour && !/[a-z]/i.test(lower));
    i += tok.length;
  }
  return out;
}

export function formatValue(v: Prim, nf?: string): Formatted {
  if (isErr(v)) return { text: v.code };
  if (v === null) return { text: "" };
  if (typeof v === "boolean") return { text: v ? "TRUE" : "FALSE" };
  const fmt = nf && nf.trim() && nf.trim().toLowerCase() !== "general" ? nf : null;
  const secs = fmt ? sections(fmt) : [];
  if (typeof v === "string") {
    const textSec = secs.length >= 4 ? secs[3] : secs.find((s) => s.includes("@"));
    if (!textSec) return { text: v };
    const { body, color } = stripBrackets(textSec);
    let out = "";
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === "@") out += v;
      else if (ch === "\"") { const j = body.indexOf("\"", i + 1); out += body.slice(i + 1, j < 0 ? undefined : j); i = j < 0 ? body.length : j; }
      else if (ch === "\\") { out += body[i + 1] ?? ""; i++; }
      else if (ch === "_") { out += " "; i++; }
      else if (ch === "*") i++;
      else out += ch;
    }
    return { text: out, color };
  }
  if (!Number.isFinite(v)) return { text: "#NUM!" };
  if (!fmt) return { text: generalNumber(v) };
  let sec = secs[0];
  let x = v;
  let sign = "";
  if (v < 0 && secs.length >= 2 && secs[1] !== "") { sec = secs[1]; x = -v; }
  else if (v === 0 && secs.length >= 3 && secs[2] !== "") sec = secs[2];
  else if (v < 0) { x = -v; sign = "-"; }
  const { body, color } = stripBrackets(sec);
  if (bare(body).trim().toLowerCase() === "general") return { text: sign + generalNumber(x), color };
  if (isDateSection(body)) return { text: formatDate(v, body), color };
  const text = formatNumber(x, body);
  // A negative value that rounds to zero shows without its minus sign, as in Excel.
  const zeroish = !/[1-9]/.test(text);
  return { text: (zeroish ? "" : sign) + text, color };
}

/** Common formats offered in the toolbar. */
export const NUMBER_FORMATS: { label: string; nf: string }[] = [
  { label: "General", nf: "General" },
  { label: "Number (1,234.5)", nf: "#,##0.0_);(#,##0.0)" },
  { label: "Whole (1,235)", nf: "#,##0_);(#,##0)" },
  { label: "Currency ($1,234.5)", nf: "$#,##0.0_);($#,##0.0)" },
  { label: "Percent (12.5%)", nf: "0.0%" },
  { label: "Multiple (8.5x)", nf: "0.0\"x\"" },
  { label: "Per share ($12.34)", nf: "$#,##0.00_);($#,##0.00)" },
  { label: "Date (2026-09-30)", nf: "yyyy-mm-dd" },
  { label: "Year (FY2026)", nf: "\"FY\"0" },
];
