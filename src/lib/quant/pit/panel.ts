/**
 * QF3: the cross-sectional return panel, one per year (quant/panel/<year>.bin in R2): Float32 daily returns
 * for the universe, read by the factor engine and the risk model in one request (about 1,000 x 252 x 4 bytes,
 * 1 MB for the beta's universe). Missing returns are NaN. Pure encode and decode with a small JSON header.
 *
 * Layout: 4-byte little-endian header length, the header (UTF-8 JSON: version, year, symbols, dates), then
 * symbols x dates Float32 values, row by symbol.
 */
export type Panel = { year: number; symbols: string[]; dates: string[]; values: Float32Array; version: string };

export const PANEL_VERSION = "panel-1";
export const panelKey = (year: number, universe = "us-top1000") => `quant/panel/${universe}/${year}.bin`;

export function encodePanel(p: Panel): Uint8Array {
  if (p.values.length !== p.symbols.length * p.dates.length) throw new Error("Panel values do not match symbols x dates");
  const header = new TextEncoder().encode(JSON.stringify({ version: p.version, year: p.year, symbols: p.symbols, dates: p.dates }));
  const pad = (4 - ((4 + header.length) % 4)) % 4;
  const out = new Uint8Array(4 + header.length + pad + p.values.byteLength);
  new DataView(out.buffer).setUint32(0, header.length + pad, true);
  out.set(header, 4);
  for (let i = 0; i < pad; i++) out[4 + header.length + i] = 0x20;
  out.set(new Uint8Array(p.values.buffer, p.values.byteOffset, p.values.byteLength), 4 + header.length + pad);
  return out;
}

export function decodePanel(bytes: Uint8Array): Panel {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hl = view.getUint32(0, true);
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + hl)).trimEnd()) as { version: string; year: number; symbols: string[]; dates: string[] };
  const start = 4 + hl;
  const copy = bytes.slice(start, start + h.symbols.length * h.dates.length * 4);
  return { year: h.year, symbols: h.symbols, dates: h.dates, values: new Float32Array(copy.buffer, copy.byteOffset, h.symbols.length * h.dates.length), version: h.version };
}

/** Build a panel from per-symbol returns keyed by date. Pure. */
export function buildPanel(year: number, series: Record<string, Map<string, number>>, dates: string[]): Panel {
  const symbols = Object.keys(series).sort();
  const values = new Float32Array(symbols.length * dates.length).fill(NaN);
  symbols.forEach((s, i) => dates.forEach((d, j) => { const v = series[s].get(d); if (v !== undefined && Number.isFinite(v)) values[i * dates.length + j] = v; }));
  return { year, symbols, dates, values, version: PANEL_VERSION };
}

export const panelAt = (p: Panel, symbolIndex: number, dateIndex: number) => p.values[symbolIndex * p.dates.length + dateIndex];
