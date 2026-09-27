/**
 * .pptx export. Tables and column, bar, line and pie charts are native PowerPoint objects the person can
 * edit; football fields and waterfalls are drawn with shapes, as banks' own templates do, so their
 * geometry is exact. Every linked element is written with the model's current values.
 */
import PptxGenJS from "pptxgenjs";
import type { Engine } from "./engine";
import { formatValue } from "./format";
import { resolveChart, resolveMarker, resolveTable, resolveValue } from "./deck";
import type { SlideEl, StudioDocData } from "./types";

const h = (c: string) => c.replace("#", "").toUpperCase();
const GRAY = "7F7F7F";
const SERIES = ["0B2545", "C8963E", "5B7DB1", "8DA9C4", "A15C38", "6B8F71"];

type Slide = PptxGenJS.Slide;

function text(slide: Slide, el: Extract<SlideEl, { type: "text" }>, font: string, color: string) {
  const lines = el.text.split("\n");
  const bullets = el.bullets || lines.some((l) => /^\s*[-•]\s+/.test(l));
  slide.addText(
    lines.map((l) => ({ text: l.replace(/^\s*[-•]\s+/, ""), options: { bullet: bullets && /^\s*[-•]\s+/.test(l) ? { indent: 14 } : false, breakLine: true } })),
    { x: el.x, y: el.y, w: el.w, h: el.h, fontFace: font, fontSize: el.size ?? 14, bold: el.bold, color: el.color ? h(el.color) : color, align: el.align ?? "left", valign: "top", paraSpaceAfter: 6, margin: 4 },
  );
}

function table(slide: Slide, el: Extract<SlideEl, { type: "table" }>, engine: Engine, font: string, primary: string) {
  const rows = el.link ? resolveTable(el.link, engine) : (el.rows ?? []).map((r) => r.map((t) => ({ text: t, value: t })));
  if (!rows?.length) return;
  const cols = Math.max(...rows.map((r) => r.length));
  const first = Math.min(0.42, Math.max(0.24, 3 / (cols + 2)));
  const colW = [el.w * first, ...Array.from({ length: cols - 1 }, () => (el.w * (1 - first)) / Math.max(1, cols - 1))];
  const data = rows.map((r, i) => {
    const head = el.header !== false && i === 0;
    return Array.from({ length: cols }, (_, j) => {
      const c = r[j] as { text: string; bold?: boolean; align?: "left" | "center" | "right"; fill?: string } | undefined;
      return {
        text: c?.text ?? "",
        options: {
          bold: head || c?.bold, color: head ? "FFFFFF" : "1F1F1F", align: j === 0 ? "left" as const : (c?.align ?? "right"),
          fill: head ? { color: primary } : c?.fill ? { color: h(c.fill) } : undefined, valign: "middle" as const,
        },
      };
    });
  });
  const rowH = Math.min(0.32, el.h / rows.length);
  slide.addTable(data, { x: el.x, y: el.y, w: el.w, colW, rowH, fontFace: font, fontSize: el.size ?? 10, border: { type: "solid", pt: 0.5, color: "D9D9D9" }, autoPage: false, margin: 0.04 });
}

function metric(slide: Slide, pptx: PptxGenJS, el: Extract<SlideEl, { type: "metric" }>, engine: Engine, font: string, primary: string) {
  const v = el.link ? resolveValue(el.link, engine, el.nf)?.text ?? "" : el.value ?? "";
  slide.addShape(pptx.ShapeType.roundRect, { x: el.x, y: el.y, w: el.w, h: el.h, fill: { color: "F3F5F9" }, line: { color: "E1E6EF", width: 0.75 }, rectRadius: 0.06 });
  slide.addText(el.label, { x: el.x + 0.15, y: el.y + 0.1, w: el.w - 0.3, h: 0.3, fontFace: font, fontSize: 10, color: GRAY });
  slide.addText(v, { x: el.x + 0.15, y: el.y + 0.38, w: el.w - 0.3, h: el.h - 0.48, fontFace: font, fontSize: 24, bold: true, color: primary, valign: "middle" });
}

function football(slide: Slide, pptx: PptxGenJS, el: Extract<SlideEl, { type: "chart" }>, engine: Engine, font: string, primary: string, accent: string) {
  const d = resolveChart(el, engine);
  if (!d || d.series.length < 2) return;
  const marker = resolveMarker(el, engine);
  const lows = d.series[0].values, highs = d.series[1].values;
  const vals = [...lows, ...highs, marker?.value ?? null].filter((x): x is number => x !== null);
  if (!vals.length) return;
  const min = Math.min(...vals), max = Math.max(...vals), pad = (max - min) * 0.08 || 1;
  const lo = min - pad, hi = max + pad;
  const labelW = Math.min(3.6, el.w * 0.32);
  const px0 = el.x + labelW + 0.1, pw = el.w - labelW - 0.3;
  const X = (v: number) => px0 + ((v - lo) / (hi - lo)) * pw;
  const top = el.y + (el.title ? 0.45 : 0.1), rowH = Math.min(0.75, (el.h - (top - el.y) - 0.45) / Math.max(1, d.labels.length));
  const fmt = (v: number) => formatValue(v, el.nf ?? "$#,##0.00").text.trim();
  if (el.title) slide.addText(el.title, { x: el.x, y: el.y, w: el.w, h: 0.35, fontFace: font, fontSize: 12, bold: true, color: primary });
  d.labels.forEach((label, i) => {
    const y = top + i * rowH;
    slide.addText(label, { x: el.x, y, w: labelW, h: rowH, fontFace: font, fontSize: 11, color: "1F1F1F", valign: "middle" });
    const a = lows[i], b = highs[i];
    if (a === null || b === null) return;
    const x1 = X(Math.min(a, b)), x2 = X(Math.max(a, b));
    slide.addShape(pptx.ShapeType.rect, { x: x1, y: y + rowH * 0.22, w: Math.max(0.02, x2 - x1), h: rowH * 0.56, fill: { color: primary }, line: { color: primary, width: 0 } });
    slide.addText(fmt(Math.min(a, b)), { x: x1 - 1.05, y, w: 1.0, h: rowH, fontFace: font, fontSize: 9, color: GRAY, align: "right", valign: "middle" });
    slide.addText(fmt(Math.max(a, b)), { x: x2 + 0.05, y, w: 1.0, h: rowH, fontFace: font, fontSize: 9, color: GRAY, valign: "middle" });
  });
  if (marker) {
    const x = X(marker.value), y0 = top - 0.05, y1 = top + rowH * d.labels.length + 0.05;
    slide.addShape(pptx.ShapeType.line, { x, y: y0, w: 0, h: y1 - y0, line: { color: accent, width: 1.5, dashType: "dash" } });
    slide.addText(`${marker.label}: ${fmt(marker.value)}`, { x: x - 1.2, y: y1, w: 2.4, h: 0.3, fontFace: font, fontSize: 9, bold: true, color: accent, align: "center" });
  }
}

function waterfall(slide: Slide, pptx: PptxGenJS, el: Extract<SlideEl, { type: "chart" }>, engine: Engine, font: string, primary: string) {
  const d = resolveChart(el, engine);
  if (!d?.series.length) return;
  const vals = d.series[0].values.map((v) => v ?? 0);
  const isTotal = (l: string, i: number) => i === 0 || /total|value|ending|net|equity|enterprise/i.test(l);
  let run = 0;
  const bars = vals.map((v, i) => {
    if (isTotal(d.labels[i], i)) { run = v; return { from: 0, to: v, total: true }; }
    const from = run; run += v; return { from, to: run, total: false };
  });
  const all = bars.flatMap((b) => [b.from, b.to]);
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all), span = hi - lo || 1;
  const top = el.y + (el.title ? 0.45 : 0.1), ph = el.h - (top - el.y) - 0.55;
  const Y = (v: number) => top + ((hi - v) / span) * ph;
  const bw = el.w / bars.length;
  if (el.title) slide.addText(el.title, { x: el.x, y: el.y, w: el.w, h: 0.35, fontFace: font, fontSize: 12, bold: true, color: primary });
  bars.forEach((b, i) => {
    const y1 = Y(Math.max(b.from, b.to)), y2 = Y(Math.min(b.from, b.to));
    const color = b.total ? primary : b.to >= b.from ? "4E8F5A" : "B24C3E";
    slide.addShape(pptx.ShapeType.rect, { x: el.x + i * bw + bw * 0.15, y: y1, w: bw * 0.7, h: Math.max(0.01, y2 - y1), fill: { color }, line: { color, width: 0 } });
    slide.addText(formatValue(b.total ? b.to : b.to - b.from, el.nf ?? "#,##0.0").text.trim(), { x: el.x + i * bw, y: y1 - 0.28, w: bw, h: 0.26, fontFace: font, fontSize: 9, align: "center", color: "1F1F1F" });
    slide.addText(d.labels[i], { x: el.x + i * bw, y: top + ph + 0.05, w: bw, h: 0.45, fontFace: font, fontSize: 9, align: "center", color: GRAY });
  });
}

function nativeChart(slide: Slide, pptx: PptxGenJS, el: Extract<SlideEl, { type: "chart" }>, engine: Engine, font: string, primary: string) {
  const d = resolveChart(el, engine);
  if (!d?.series.length) return;
  const data = d.series.map((s) => ({ name: s.name, labels: d.labels, values: s.values.map((v) => v ?? 0) }));
  const type = el.kind === "line" ? pptx.ChartType.line : el.kind === "pie" ? pptx.ChartType.pie : pptx.ChartType.bar;
  slide.addChart(type, data, {
    x: el.x, y: el.y, w: el.w, h: el.h, barDir: el.kind === "bar" ? "bar" : "col", barGrouping: el.kind === "stacked" ? "stacked" : "clustered",
    chartColors: SERIES, showValue: el.kind !== "line", dataLabelFormatCode: el.nf?.replace(/_\)|\(|\)|;.*$/g, "") || "#,##0", dataLabelFontSize: 9,
    catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, catAxisLabelFontFace: font, valAxisLabelFontFace: font, valGridLine: { style: "none" },
    showLegend: data.length > 1 || el.kind === "pie", legendPos: "b", legendFontSize: 9, showTitle: !!el.title, title: el.title, titleFontSize: 11, titleColor: primary,
  });
}

export async function exportPptx(doc: StudioDocData, engine: Engine): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = doc.title;
  pptx.company = "YouBank";
  const t = doc.deck.theme;
  const primary = h(t.primary), accent = h(t.accent), font = t.font || "Arial";
  doc.deck.order.forEach((id, n) => {
    const s = doc.deck.slides[id];
    if (!s) return;
    const slide = pptx.addSlide();
    if (s.layout === "title" || s.layout === "section") {
      slide.background = { color: primary };
      slide.addText(s.title, { x: 0.8, y: 2.3, w: 11.7, h: 1.2, fontFace: font, fontSize: s.layout === "title" ? 40 : 32, bold: true, color: "FFFFFF", valign: "bottom" });
      slide.addShape(pptx.ShapeType.rect, { x: 0.8, y: 3.62, w: 1.3, h: 0.06, fill: { color: accent }, line: { color: accent, width: 0 } });
      if (s.subtitle) slide.addText(s.subtitle, { x: 0.8, y: 3.8, w: 11.7, h: 0.6, fontFace: font, fontSize: 18, color: "D9DEE8" });
      if (t.confidential) slide.addText("Strictly private and confidential", { x: 0.8, y: 6.75, w: 6, h: 0.3, fontFace: font, fontSize: 10, color: "AAB4C6" });
      return;
    }
    slide.addText(s.title, { x: 0.5, y: 0.28, w: 12.33, h: 0.7, fontFace: font, fontSize: 24, bold: true, color: primary, valign: "middle" });
    slide.addShape(pptx.ShapeType.line, { x: 0.5, y: 1.02, w: 12.33, h: 0, line: { color: accent, width: 1.5 } });
    for (const el of s.elements) {
      if (el.type === "text") text(slide, el, font, "1F1F1F");
      else if (el.type === "table") table(slide, el, engine, font, primary);
      else if (el.type === "metric") metric(slide, pptx, el, engine, font, primary);
      else if (el.type === "shape") slide.addShape(pptx.ShapeType.rect, { x: el.x, y: el.y, w: el.w, h: el.h, fill: { color: h(el.fill ?? "#F3F5F9") }, line: { color: h(el.line ?? el.fill ?? "#F3F5F9"), width: 0.75 } });
      else if (el.type === "chart") {
        if (el.kind === "football") football(slide, pptx, el, engine, font, primary, accent);
        else if (el.kind === "waterfall") waterfall(slide, pptx, el, engine, font, primary);
        else nativeChart(slide, pptx, el, engine, font, primary);
      }
    }
    if (s.sources) slide.addText(s.sources, { x: 0.5, y: 6.88, w: 10.8, h: 0.45, fontFace: font, fontSize: 8, color: GRAY, valign: "top" });
    slide.addText(`${n + 1}`, { x: 12.33, y: 6.95, w: 0.5, h: 0.3, fontFace: font, fontSize: 9, color: GRAY, align: "right" });
    if (t.confidential) slide.addText("Confidential", { x: 11.0, y: 6.95, w: 1.3, h: 0.3, fontFace: font, fontSize: 8, color: GRAY, align: "right" });
    if (s.notes) slide.addNotes(s.notes);
  });
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
