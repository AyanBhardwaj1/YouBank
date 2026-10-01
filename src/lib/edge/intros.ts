/**
 * An intro request from one of Edge's warm paths, written like any draft and treated by autopilot like
 * one. It goes to the person who can make the introduction (the contact themselves, or, for a
 * teammate's pooled contact, that teammate), asks for it plainly and says how they connect, from the
 * filings. It waits in the review queue, or goes by itself only when intro requests are set to
 * autopilot and it clears every check.
 */
import { and, eq, inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { considerDraft } from "@/lib/crm/autopilot";
import { levelFor, type Autonomy } from "@/lib/crm/autopilot-rules";
import { composeDraft } from "@/lib/crm/compose";
import { getSettings } from "@/lib/crm/settings";
import { myTeamIds } from "@/lib/teams/db";
import { warmIntros, type Intro } from "./graph/findings";
import { companyByTicker } from "./graph/store";

export type IntroDraft = { draftId: number; to: string; scheduled: boolean; reasons: string[]; level: Autonomy };

/** The brief the drafting agent writes from: who to ask, for whom, and the path in words. Pure. */
export function introBrief(intro: Intro, target: string, teammate: string | null): string {
  const path = intro.steps.slice(1).map((s) => s.text).join("; then ");
  const first = (intro.contact.name || "").split(" ")[0] || "them";
  return teammate
    ? `Ask ${teammate}, a teammate, to introduce me to ${intro.contact.name}${intro.contact.company ? ` (${intro.contact.company})` : ""}, who is a way into ${target}. How they connect, from SEC filings: ${path}. Keep it short and internal; say why the introduction matters and offer to send a blurb they can forward.`
    : `Ask ${first} whether they would introduce me to the right person at ${target}, or talk to me themselves. How they connect, from SEC filings: ${path}. Keep it short, warm and specific; one clear ask; offer to send a blurb they can forward.`;
}

export async function draftIntro(user: CurrentUser, ticker: string, index: number): Promise<IntroDraft> {
  const settings = await getSettings(user.id);
  const level = levelFor(settings.autopilot, "intros");
  if (level === "off") throw Object.assign(new Error("Intro requests are off in your autopilot settings (Relationships, Agent settings). Copy the request instead, or switch them to Ask me."), { status: 409 });
  const node = await companyByTicker(ticker);
  if (!node) throw Object.assign(new Error("That company is not in the graph yet."), { status: 404 });
  const intro = (await warmIntros(user.id, node))[index];
  if (!intro) throw Object.assign(new Error("That path is no longer there; reload the list."), { status: 404 });

  // A teammate's pooled contact is reached through the teammate.
  let to = intro.contact.email, name = intro.contact.name, company = intro.contact.company, teammate: string | null = null;
  if (intro.contact.ownerId && intro.contact.ownerId !== user.id) {
    const teams = await myTeamIds(user.id);
    const [mate] = teams.length ? await requireDb().select({ email: schema.teamMembers.email, name: schema.teamMembers.name }).from(schema.teamMembers)
      .where(and(eq(schema.teamMembers.userId, intro.contact.ownerId), inArray(schema.teamMembers.teamId, teams))).limit(1) : [];
    if (!mate?.email) throw Object.assign(new Error("That contact belongs to a teammate whose address is not on your team list."), { status: 409 });
    to = mate.email; name = mate.name; company = ""; teammate = mate.name || mate.email;
  }
  const draft = await composeDraft(user.id, { to, name, company, brief: introBrief(intro, node.name, teammate) }, {
    kind: "intro", meta: { audience: teammate ? "internal" : "external", category: "intro", ticker, path: intro.steps.map((s) => s.text).slice(0, 6) },
  });
  const decided = await considerDraft(user.id, draft.id);
  return { draftId: draft.id, to, scheduled: decided.scheduled, reasons: decided.reasons, level };
}
