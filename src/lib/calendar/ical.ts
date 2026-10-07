/**
 * A small iCalendar (RFC 5545) reader and writer. Pure.
 *
 * It keeps the file's own structure: a tree of components (VCALENDAR, VEVENT, VTIMEZONE, VALARM...)
 * whose properties hold their raw values and parameters. Reading a calendar and writing it back
 * gives the same calendar, which matters for CalDAV: when YouBank reschedules one meeting it edits
 * that event's resource in place, and every property it does not understand (alarms, a client's
 * X- extensions, attachments) has to survive the round trip.
 *
 * What it handles that naive parsers miss:
 * - line folding (a CRLF followed by a space or tab continues the line), including folds that fall
 *   inside a multi-byte UTF-8 character on output;
 * - quoted parameter values that contain ':' ';' or ',' (`CN="Ruiz, Maya"`);
 * - TEXT escaping (\n \, \; \\);
 * - bare LF line endings and stray blank lines, which real feeds have.
 */

export type ICalProp = { name: string; params: Record<string, string>; value: string };
export type ICalComponent = { name: string; props: ICalProp[]; components: ICalComponent[] };

/* ---------------- Reading ---------------- */

/** Logical lines: folds removed, blank lines dropped. */
export function unfold(text: string): string[] {
  return text.replace(/^\uFEFF/, "").replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n").filter((l) => l.trim() !== "");
}

/** One content line: NAME;PARAM=a;PARAM="b:c":value. Null when it is not one. */
export function parseLine(line: string): ICalProp | null {
  let i = 0;
  while (i < line.length && line[i] !== ";" && line[i] !== ":") i++;
  const name = line.slice(0, i).trim().toUpperCase();
  if (!name || i >= line.length) return null;
  const params: Record<string, string> = {};
  while (line[i] === ";") {
    i++;
    const eq = line.indexOf("=", i);
    if (eq < 0) return null;
    const key = line.slice(i, eq).trim().toUpperCase();
    i = eq + 1;
    let val = "", inQuotes = false;
    while (i < line.length) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; i++; continue; }
      if (!inQuotes && (ch === ";" || ch === ":")) break;
      val += ch;
      i++;
    }
    params[key] = val;
  }
  if (line[i] !== ":") return null;
  return { name, params, value: line.slice(i + 1) };
}

/**
 * Every top-level component in a file, normally one VCALENDAR. Unbalanced END lines are ignored and
 * unclosed components are closed at the end, so a truncated feed still yields what it has.
 */
export function parseICal(text: string): ICalComponent[] {
  const roots: ICalComponent[] = [];
  const stack: ICalComponent[] = [];
  for (const line of unfold(text)) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "BEGIN") {
      const c: ICalComponent = { name: p.value.trim().toUpperCase(), props: [], components: [] };
      (stack.length ? stack[stack.length - 1].components : roots).push(c);
      stack.push(c);
    } else if (p.name === "END") {
      const name = p.value.trim().toUpperCase();
      const at = stack.map((c) => c.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
    } else if (stack.length) {
      stack[stack.length - 1].props.push(p);
    }
  }
  return roots;
}

/** The VCALENDARs of a file, merged into one, so feeds that concatenate several still read whole. */
export function parseCalendar(text: string): ICalComponent {
  const cals = parseICal(text).filter((c) => c.name === "VCALENDAR");
  if (cals.length === 0) throw new Error("That is not an iCalendar file (no BEGIN:VCALENDAR).");
  if (cals.length === 1) return cals[0];
  return { name: "VCALENDAR", props: cals[0].props, components: cals.flatMap((c) => c.components) };
}

export const propOf = (c: ICalComponent, name: string): ICalProp | undefined => c.props.find((p) => p.name === name);
export const propsOf = (c: ICalComponent, name: string): ICalProp[] => c.props.filter((p) => p.name === name);
export const childrenOf = (c: ICalComponent, name: string): ICalComponent[] => c.components.filter((x) => x.name === name);

/** TEXT values: \n is a line break, and \, \; \\ are literal. */
export function unescapeText(v: string): string {
  return v.replace(/\\([\\;,nN])/g, (_, ch: string) => (ch === "n" || ch === "N" ? "\n" : ch));
}

export function escapeText(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export const textOf = (c: ICalComponent, name: string): string => {
  const p = propOf(c, name);
  return p ? unescapeText(p.value) : "";
};

/* ---------------- Dates and durations ---------------- */

/**
 * A DATE or DATE-TIME as written. `wall` is the clock reading as epoch ms (see tz.ts); `utc` marks a
 * trailing Z; `tzid` is the TZID parameter; neither means a floating time.
 */
export type DateValue = { wall: number; date: boolean; utc: boolean; tzid: string | null };

export function parseDateValue(value: string, params: Record<string, string> = {}): DateValue | null {
  const v = value.trim();
  const d = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (d) return { wall: Date.UTC(+d[1], +d[2] - 1, +d[3]), date: true, utc: false, tzid: null };
  const t = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i);
  if (!t) return null;
  const wall = Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5], +(t[6] ?? 0));
  const utc = !!t[7];
  return { wall, date: false, utc, tzid: utc ? null : params.TZID || null };
}

/** Every value of a multi-valued date property (EXDATE, RDATE): comma lists and repeated lines. */
export function dateValuesOf(c: ICalComponent, name: string): DateValue[] {
  const out: DateValue[] = [];
  for (const p of propsOf(c, name)) {
    for (const raw of p.value.split(",")) {
      // RDATE;VALUE=PERIOD:start/end or start/duration: the start is what recurs.
      const dv = parseDateValue(raw.split("/")[0], p.params);
      if (dv) out.push(dv);
    }
  }
  return out;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function formatDate(wall: number): string {
  const d = new Date(wall);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

export function formatDateTime(wall: number, utc: boolean): string {
  const d = new Date(wall);
  return `${formatDate(wall)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}${utc ? "Z" : ""}`;
}

/** A DateValue back to a property's value and parameters. */
export function formatDateValue(dv: DateValue): { value: string; params: Record<string, string> } {
  if (dv.date) return { value: formatDate(dv.wall), params: { VALUE: "DATE" } };
  return { value: formatDateTime(dv.wall, dv.utc), params: dv.tzid && !dv.utc ? { TZID: dv.tzid } : {} };
}

/** "PT1H30M", "-P1D", "P2W" -> milliseconds. Null when it is not a duration. */
export function parseDuration(v: string): number | null {
  const m = v.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m || v.trim().length <= 2) return null;
  const ms = ((((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 24 + +(m[4] ?? 0)) * 60 + +(m[5] ?? 0)) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

/** "+0530" -> 330 minutes. */
export function parseUtcOffset(v: string): number | null {
  const m = v.trim().match(/^([+-])(\d{2})(\d{2})(\d{2})?$/);
  if (!m) return null;
  const mins = +m[2] * 60 + +m[3];
  return m[1] === "-" ? -mins : mins;
}

/* ---------------- Writing ---------------- */

const needsQuotes = /[:;,]/;

function formatParams(params: Record<string, string>): string {
  return Object.entries(params).map(([k, v]) => `;${k}=${needsQuotes.test(v) && !/^".*"$/.test(v) ? `"${v.replace(/"/g, "'")}"` : v}`).join("");
}

/**
 * Fold a content line at 75 octets, never inside a UTF-8 character: a continuation line starts
 * with one space, which readers drop.
 */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0, limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Back off to a character boundary: continuation bytes look like 10xxxxxx.
    while (end < bytes.length && end > start && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // the leading space counts toward the 75
  }
  return out.join("\r\n ");
}

export function serializeProp(p: ICalProp): string {
  return foldLine(`${p.name}${formatParams(p.params)}:${p.value}`);
}

/** A component tree back to text, CRLF line endings, folded. */
export function serializeICal(c: ICalComponent): string {
  const lines: string[] = [];
  const walk = (x: ICalComponent) => {
    lines.push(`BEGIN:${x.name}`);
    for (const p of x.props) lines.push(serializeProp(p));
    for (const child of x.components) walk(child);
    lines.push(`END:${x.name}`);
  };
  walk(c);
  return `${lines.join("\r\n")}\r\n`;
}

/** Set (or with `value` null, remove) a property, keeping its place in the component. */
export function setProp(c: ICalComponent, name: string, value: string | null, params: Record<string, string> = {}): void {
  const i = c.props.findIndex((p) => p.name === name);
  if (value === null) { c.props = c.props.filter((p) => p.name !== name); return; }
  const prop = { name, params, value };
  if (i >= 0) { c.props[i] = prop; c.props = c.props.filter((p, j) => p.name !== name || j === i); }
  else c.props.push(prop);
}

export function cloneComponent(c: ICalComponent): ICalComponent {
  return { name: c.name, props: c.props.map((p) => ({ name: p.name, params: { ...p.params }, value: p.value })), components: c.components.map(cloneComponent) };
}
