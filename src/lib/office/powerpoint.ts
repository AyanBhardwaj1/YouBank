/**
 * YouBank for PowerPoint: puts a Studio deck into the open presentation and keeps it current. Every
 * slide YouBank inserts is tagged with its Studio slide and document, so "Refresh" can replace exactly
 * those slides, in place, with the model's current numbers, and leave the person's own slides alone.
 * Needs PowerPointApi 1.3 (insert from base64, tags).
 */
/// <reference types="office-js" />

type Ctx = PowerPoint.RequestContext;

export const PPT_API = "1.3";
const SLIDE_TAG = "YOUBANK_SLIDE";
const DOC_TAG = "YOUBANK_DOC";

/** Slides in an exported deck are numbered from 256 (PptxGenJS), which is how one slide is picked out of it. */
export const sourceSlideId = (index: number) => `${256 + index}#`;

export type LinkedSlide = { id: string; studio: string; doc: string; index: number };

export async function linkedSlides(ctx: Ctx): Promise<LinkedSlide[]> {
  const slides = ctx.presentation.slides;
  slides.load("items/id");
  await ctx.sync();
  const tags = slides.items.map((s) => { const t = s.tags; t.load("items/key,items/value"); return t; });
  await ctx.sync();
  return slides.items.flatMap((s, i) => {
    const m = new Map(tags[i].items.map((t) => [t.key.toUpperCase(), t.value]));
    const studio = m.get(SLIDE_TAG);
    return studio ? [{ id: s.id, studio, doc: m.get(DOC_TAG) ?? "", index: i }] : [];
  });
}

/** Insert slides from an exported deck after `afterId` (default: at the end) and tag each with its Studio slide. */
async function insert(ctx: Ctx, base64: string, pick: { source: string; studio: string }[] | null, all: string[], docId: number, afterId?: string): Promise<string[]> {
  const slides = ctx.presentation.slides;
  slides.load("items/id");
  await ctx.sync();
  const before = new Set(slides.items.map((s) => s.id));
  const target = afterId ?? slides.items[slides.items.length - 1]?.id;
  ctx.presentation.insertSlidesFromBase64(base64, { formatting: "KeepSourceFormatting", ...(target ? { targetSlideId: target } : {}), ...(pick ? { sourceSlideIds: pick.map((p) => p.source) } : {}) });
  await ctx.sync();
  slides.load("items/id");
  await ctx.sync();
  const added = slides.items.filter((s) => !before.has(s.id));
  const studio = pick ? pick.map((p) => p.studio) : all;
  added.forEach((s, i) => { if (studio[i]) { s.tags.add(SLIDE_TAG, studio[i]); s.tags.add(DOC_TAG, String(docId)); } });
  await ctx.sync();
  return added.map((s) => s.id);
}

/** Put the whole deck into the presentation, after the selected slide or at the end. */
export async function insertDeck(ctx: Ctx, base64: string, studioIds: string[], docId: number, afterId?: string): Promise<number> {
  return (await insert(ctx, base64, null, studioIds, docId, afterId)).length;
}

/**
 * Replace each linked slide with its current version, where it is; add slides that are new in Studio
 * after the last linked one; remove slides deleted in Studio. Slides the person made are not touched.
 */
export async function refreshDeck(ctx: Ctx, base64: string, studioIds: string[], docId: number): Promise<{ replaced: number; added: number; removed: number }> {
  const linked = (await linkedSlides(ctx)).filter((s) => s.doc === String(docId));
  if (!linked.length) return { replaced: 0, added: await insertDeck(ctx, base64, studioIds, docId), removed: 0 };
  const index = new Map(studioIds.map((id, i) => [id, i]));
  let replaced = 0, removed = 0, lastId = linked[linked.length - 1].id;
  for (const l of linked) {
    const i = index.get(l.studio);
    if (i === undefined) { ctx.presentation.slides.getItem(l.id).delete(); await ctx.sync(); removed++; continue; }
    const [fresh] = await insert(ctx, base64, [{ source: sourceSlideId(i), studio: l.studio }], studioIds, docId, l.id);
    ctx.presentation.slides.getItem(l.id).delete();
    await ctx.sync();
    if (l.id === lastId && fresh) lastId = fresh;
    replaced++;
  }
  const present = new Set(linked.map((l) => l.studio));
  const missing = studioIds.map((id, i) => ({ id, i })).filter((x) => !present.has(x.id));
  let added = 0;
  if (missing.length) {
    const stillThere = (await linkedSlides(ctx)).some((s) => s.id === lastId);
    added = (await insert(ctx, base64, missing.map((m) => ({ source: sourceSlideId(m.i), studio: m.id })), studioIds, docId, stillThere ? lastId : undefined)).length;
  }
  return { replaced, added, removed };
}

/** Stop refreshing the selected slides (the person has edited them by hand and wants to keep that). */
export async function unlinkSelected(ctx: Ctx): Promise<number> {
  const sel = ctx.presentation.getSelectedSlides();
  sel.load("items/id");
  await ctx.sync();
  for (const s of sel.items) { s.tags.delete(SLIDE_TAG); s.tags.delete(DOC_TAG); }
  await ctx.sync();
  return sel.items.length;
}

export async function selectedSlideId(ctx: Ctx): Promise<string | undefined> {
  try {
    const sel = ctx.presentation.getSelectedSlides();
    sel.load("items/id");
    await ctx.sync();
    return sel.items[sel.items.length - 1]?.id;
  } catch { return undefined; }
}
