/**
 * Stories: a canvas run published as a scrolling visual report. The sections follow the order a reader
 * needs (what changed on the ground, the deal's footprint, the network and its predictions, the
 * scenarios, the tables, the answers, then the cited memo), keep every value's labels (synthetic
 * stays synthetic), and export to PowerPoint here or to PDF from the page. Private by default; shared
 * with a team or by link when the owner chooses.
 */
import { randomBytes } from "node:crypto";
import PptxGenJS from "pptxgenjs";
import { and, desc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { myTeamIds } from "@/lib/teams/db";
import { kindOfValue, type Answer, type Findings, type GraphValue, type Memo, type ProformaValue, type Ranking, type Scenario, type Signal, type Table } from "./canvas/values";

export type Section = { kind: string; title: string; value: unknown };
export type StoryRow = typeof schema.edgeStories.$inferSelect;

const ORDER = ["findings", "proforma", "graph", "ranking", "scenario", "table", "answer", "signal", "memo"];

/** A section's heading from its value. Pure. */
export function sectionTitle(kind: string, v: unknown): string {
  switch (kind) {
    case "findings": return "What changed on the ground";
    case "proforma": return `The deal's footprint in the ${(v as ProformaValue).place || "region"}`;
    case "graph": return "The network";
    case "ranking": return `${(v as Ranking).finding} for ${(v as Ranking).subject}`;
    case "scenario": return `Scenario: ${(v as Scenario).title}`;
    case "table": return (v as Table).title ?? "Data";
    case "answer": return (v as Answer).question;
    case "signal": return `Signal: ${(v as Signal).metric}`;
    case "memo": return (v as Memo).title;
    default: return "Result";
  }
}

/** Values into ordered story sections; values that say nothing on their own (company lists, files) are left out. Pure. */
export function composeSections(values: unknown[]): Section[] {
  return values.map((value) => ({ value, kind: kindOfValue(value) ?? "" })).filter((x) => ORDER.includes(x.kind))
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)).map((x) => ({ kind: x.kind, title: sectionTitle(x.kind, x.value), value: x.value }));
}

export async function createStory(userId: string, s: { title: string; runId?: number | null; sections: Section[]; teamId?: number | null }): Promise<StoryRow> {
  const slug = randomBytes(8).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toLowerCase();
  const [row] = await requireDb().insert(schema.edgeStories).values({ ownerId: userId, teamId: s.teamId ?? null, runId: s.runId ?? null, title: s.title.slice(0, 200), slug, sections: s.sections }).returning();
  return row;
}

/** A story if this viewer may read it: its owner always, teammates when shared with the team, anyone with the link when published. */
export async function storyFor(slug: string, viewer: string | null): Promise<StoryRow | null> {
  const [row] = await requireDb().select().from(schema.edgeStories).where(eq(schema.edgeStories.slug, slug));
  if (!row) return null;
  if (row.visibility === "link" || (viewer && row.ownerId === viewer)) return row;
  if (viewer && row.visibility === "team" && row.teamId && (await myTeamIds(viewer)).includes(row.teamId)) return row;
  return null;
}

export async function setVisibility(userId: string, slug: string, visibility: "private" | "team" | "link", teamId: number | null): Promise<StoryRow | null> {
  const [row] = await requireDb().update(schema.edgeStories).set({ visibility, teamId: visibility === "team" ? teamId : null, updatedAt: new Date() }).where(and(eq(schema.edgeStories.slug, slug), eq(schema.edgeStories.ownerId, userId))).returning();
  return row ?? null;
}

export async function storiesOf(userId: string, limit = 30) {
  return requireDb().select({ slug: schema.edgeStories.slug, title: schema.edgeStories.title, visibility: schema.edgeStories.visibility, createdAt: schema.edgeStories.createdAt }).from(schema.edgeStories).where(eq(schema.edgeStories.ownerId, userId)).orderBy(desc(schema.edgeStories.createdAt)).limit(limit);
}


/** The story as a PowerPoint deck: a title slide, a slide per section (charts for scenarios, tables for tables), and the memo's text. */
export async function storyPptx(story: StoryRow): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  const font = "Helvetica";
  const title = (slide: PptxGenJS.Slide, text: string, tag?: string) => {
    slide.addText(text.slice(0, 120), { x: 0.5, y: 0.3, w: 12.3, h: 0.8, fontFace: font, fontSize: 24, bold: true, color: "1D2430" });
    if (tag) slide.addText(tag, { x: 0.5, y: 1.05, w: 12.3, h: 0.35, fontFace: font, fontSize: 11, color: "B45309" });
  };
  const cover = pptx.addSlide();
  cover.addText(story.title, { x: 0.6, y: 2.4, w: 12, h: 1.2, fontFace: font, fontSize: 36, bold: true, color: "1D2430" });
  cover.addText(`Edge story · ${story.createdAt.toISOString().slice(0, 10)}`, { x: 0.6, y: 3.6, w: 12, h: 0.5, fontFace: font, fontSize: 14, color: "6B7280" });
  for (const s of (story.sections as Section[])) {
    const slide = pptx.addSlide();
    const v = s.value;
    if (s.kind === "scenario") {
      const sc = v as Scenario;
      title(slide, s.title, `SYNTHETIC · ${sc.recipe.slice(0, 180)} · seed ${sc.seed}`);
      const fan = sc.fan?.[0];
      if (fan) slide.addChart(pptx.ChartType.line, [{ name: "5th percentile", labels: fan.p50.map((_, i) => String(i + 1)), values: fan.p5.map((x) => x * 100) }, { name: "Median", labels: fan.p50.map((_, i) => String(i + 1)), values: fan.p50.map((x) => x * 100) }, { name: "95th percentile", labels: fan.p50.map((_, i) => String(i + 1)), values: fan.p95.map((x) => x * 100) }], { x: 0.5, y: 1.5, w: 7.8, h: 5, showLegend: true, legendPos: "b", valAxisTitle: "% change", showValAxisTitle: true, lineSize: 2 });
      slide.addText(sc.stats.slice(0, 8).map((x) => ({ text: `${x.label}: ${x.value}`, options: { bullet: true } })), { x: 8.6, y: 1.6, w: 4.3, h: 4.8, fontFace: font, fontSize: 13, color: "1D2430", valign: "top" });
    } else if (s.kind === "table") {
      const t = v as Table;
      title(slide, s.title, t.synthetic ? `SYNTHETIC · ${t.synthetic.recipe.slice(0, 160)} · seed ${t.synthetic.seed}` : undefined);
      const rows = [t.columns.map((c) => ({ text: c.name, options: { bold: true } })), ...t.rows.slice(0, 14).map((r) => r.map((c) => ({ text: typeof c === "number" ? (Math.abs(c) >= 1000 ? Math.round(c).toLocaleString("en-US") : String(Math.round(c * 1000) / 1000)) : String(c ?? "") })))];
      slide.addTable(rows, { x: 0.5, y: 1.5, w: 12.3, fontFace: font, fontSize: 10, border: { type: "solid", pt: 0.5, color: "D9D9D9" }, autoPage: false });
    } else if (s.kind === "memo" || s.kind === "answer") {
      const text = s.kind === "memo" ? (v as Memo).markdown : (v as Answer).text;
      title(slide, s.title);
      slide.addText(text.replace(/\*\*/g, "").replace(/\*\(analysis\)\*/g, "(analysis)").slice(0, 2200), { x: 0.5, y: 1.4, w: 12.3, h: 5.6, fontFace: font, fontSize: 13, color: "1D2430", valign: "top" });
    } else if (s.kind === "ranking") {
      const r = v as Ranking;
      title(slide, s.title, r.scorecard);
      slide.addText(r.items.slice(0, 8).map((i, k) => ({ text: `${k + 1}. ${i.name}${i.ticker ? ` (${i.ticker})` : ""}: ${i.reasons[0] ?? ""}`.slice(0, 180), options: { bullet: false, breakLine: true } })), { x: 0.5, y: 1.5, w: 12.3, h: 5.5, fontFace: font, fontSize: 13, color: "1D2430", valign: "top" });
    } else if (s.kind === "findings") {
      const f = v as Findings;
      title(slide, s.title);
      slide.addText(f.items.slice(0, 6).map((x) => ({ text: `${x.title} (confidence ${Math.round(x.confidence * 100)}): ${x.summary}`.slice(0, 260), options: { bullet: true, breakLine: true } })), { x: 0.5, y: 1.4, w: 12.3, h: 5.6, fontFace: font, fontSize: 13, color: "1D2430", valign: "top" });
    } else if (s.kind === "proforma") {
      const p = v as ProformaValue;
      title(slide, s.title, p.method);
      slide.addText([...p.parties.map((x) => ({ text: `${x.label}: ${Math.round(x.capacityMMcfd)} MMcfd, ${x.plants} plants, ${Math.round(x.pipelineKm)} km of pipeline`, options: { bullet: true, breakLine: true } })), { text: `Together: ${Math.round(p.combined.capacityMMcfd)} MMcfd, ${Math.round(p.combined.capacityShare * 100)}% of mapped processing capacity`, options: { bullet: true, breakLine: true } }], { x: 0.5, y: 1.5, w: 12.3, h: 5, fontFace: font, fontSize: 14, color: "1D2430", valign: "top" });
    } else if (s.kind === "graph") {
      const g = v as GraphValue;
      title(slide, s.title);
      slide.addText(`${g.nodes.length} entities and ${g.links.length} links. Open the story online to explore the network.`, { x: 0.5, y: 1.5, w: 12.3, h: 1, fontFace: font, fontSize: 14, color: "1D2430" });
    } else if (s.kind === "signal") {
      const sg = v as Signal;
      title(slide, s.title);
      slide.addText(`${sg.value}${sg.previous !== null && sg.previous !== undefined ? ` (was ${sg.previous})` : ""}${sg.triggered ? " · crossed its line" : ""}\n${sg.detail}`, { x: 0.5, y: 1.6, w: 12.3, h: 2, fontFace: font, fontSize: 16, color: "1D2430" });
    }
  }
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

