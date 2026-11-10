/**
 * Setting up a desk from the person's own words ("I run a two-person search fund; mostly sourcing and
 * outreach, keep it calm"). The small model reads the words and picks only from YouBank's own vocabularies
 * (features, layouts, widgets), so nothing it says can name a feature that does not exist; its picks are
 * then cleaned like any stored preference. Without a model, or when it fails, the keyword rules in
 * recommendDesk decide. Server only.
 */
import { z } from "zod";
import { structured } from "@/lib/ai/agent";
import { FEATURES, type NavId } from "@/lib/nav";
import type { RoleId } from "@/lib/roles";
import { CORE_FEATURES, LAYOUTS, WIDGETS, normalizeDesk, recommendDesk, widgetsFor, type DeskRecommendation } from "./desk";

const optional = FEATURES.filter((f) => !CORE_FEATURES.includes(f.id)).map((f) => f.id) as [NavId, ...NavId[]];

const Pick = z.object({
  show: z.array(z.enum(optional)).describe("Features this person will use"),
  layout: z.enum(LAYOUTS).describe("focus = minimal; home = calm and roomy; desk = dense, everything"),
  widgets: z.array(z.enum(WIDGETS)).describe("Home widgets in the order they matter to this person"),
  reasons: z.array(z.string()).describe("One short sentence per choice, addressed to the person"),
});

const SYSTEM = `You set up a finance workspace for one person from their own description of how they work.
Pick only from the listed features, layouts and widgets. Keep what a person in their role needs every day;
leave out what they did not ask for and would not use. Reasons are short, plain and addressed to them ("You
mentioned…"). Never invent features.`;

export async function setupFromWords(role: RoleId, words: string, opts: { now?: Date } = {}): Promise<DeskRecommendation & { via: "model" | "rules" }> {
  const rules = recommendDesk(role, words, opts.now);
  const text = words.trim();
  if (!text) return { ...rules, via: "rules" };
  const available = FEATURES.filter((f) => !CORE_FEATURES.includes(f.id) && (!f.roles || f.roles.includes(role)));
  const prompt = [
    `Role: ${role}.`,
    `Their words: """${text.slice(0, 1500)}"""`,
    `Features (id: what it is): ${available.map((f) => `${f.id}: ${f.blurb}`).join("; ")}.`,
    `Layouts: focus, home, desk. Widgets: ${WIDGETS.join(", ")}.`,
    `A rules-based starting point (improve on it): show ${available.filter((f) => !rules.desk.hidden.includes(f.id)).map((f) => f.id).join(", ")}; layout ${rules.desk.layout}.`,
  ].join("\n");
  try {
    const { data } = await structured(Pick, "desk_setup", SYSTEM, prompt, { task: "classify", timeoutMs: 20_000, maxTokens: 800 });
    const show = new Set<NavId>(data.show.filter((id) => available.some((f) => f.id === id)));
    if (show.size === 0) return { ...rules, via: "rules" };
    const hidden = available.map((f) => f.id).filter((id) => !show.has(id));
    const order = [...new Set(data.widgets)];
    const widgets = order.length ? [...order.map((id) => ({ id, on: true })), ...widgetsFor(data.layout, role).filter((w) => !order.includes(w.id)).map((w) => ({ ...w, on: false }))] : widgetsFor(data.layout, role);
    const desk = normalizeDesk({ layout: data.layout, widgets, hidden, source: "ai", setupAt: (opts.now ?? new Date()).toISOString() }, role);
    const pinned = rules.pinned.filter((id) => !desk.hidden.includes(id));
    // Shown to the person: short, plain sentences only.
    const reasons = data.reasons.map((r) => r.replace(/\s+/g, " ").trim().slice(0, 220)).filter(Boolean).slice(0, 6);
    return { desk, pinned: pinned.length ? pinned : ["home"], reasons: reasons.length ? reasons : rules.reasons, via: "model" };
  } catch {
    return { ...rules, via: "rules" };
  }
}
