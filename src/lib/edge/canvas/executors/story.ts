/**
 * The Story block: everything wired in, published as a scrolling visual report (private until the owner
 * shares it), with PowerPoint and PDF exports from the story page.
 */
import { composeSections, createStory } from "../../story";
import { register } from "../engine";
import type { Memo } from "../values";

register("out.story", {
  async start(ctx) {
    const values = ctx.inputs.in ?? [];
    const sections = composeSections(values);
    if (!sections.length) throw Object.assign(new Error("Wire in findings, a deal, a network, a scenario, an answer or a memo to tell a story."), { status: 400 });
    const memo = sections.find((s) => s.kind === "memo")?.value as Memo | undefined;
    const title = (typeof ctx.config.title === "string" && ctx.config.title.trim()) || memo?.title || sections[0].title;
    const story = await createStory(ctx.userId, { title, runId: ctx.runId, sections });
    const url = `/story/${story.slug}`;
    return {
      outputs: { file: { name: title, key: "", bytes: 0, url } },
      summary: `A ${sections.length}-section story: ${url} (private until you share it)`,
      preview: { kind: "list", items: sections.map((s) => ({ label: s.title })) },
    };
  },
});
