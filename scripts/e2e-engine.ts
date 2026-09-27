/**
 * End-to-end check of the adaptive engine against a real database: earned autonomy (certification,
 * probation, spot checks, cancels, the security veto), lessons from edits, and outreach experiments.
 * Writes rows under a fresh engine-* user. Point DATABASE_URL at a Neon test branch, never production:
 *
 *   DATABASE_URL=<branch url> E2E_STUB_LESSONS=1 pnpm exec tsx scripts/e2e-engine.ts
 *
 * Without E2E_STUB_LESSONS the lesson step calls the live model (needs OPENAI_API_KEY or ANTHROPIC_API_KEY).
 */
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { considerDraft } from "@/lib/crm/autopilot";
import {
  armPosteriors, chooseArm, engineOverview, inferLessons, learnFromSend, lessonsFor, recordCancel, settleOutreach, trustGate, type InferLessons,
} from "@/lib/crm/engine";
import { getSettings, saveSettings } from "@/lib/crm/settings";

const U = process.env.E2E_USER || `engine-${Date.now()}`; // E2E_USER=dev-<name> seeds an account for YOUBANK_DEV_USER=<name>
let fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}${!cond && detail !== undefined ? `  -> ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
  if (!cond) fail++;
};
const DAY = 86_400_000;

// Lessons use the live model unless E2E_STUB_LESSONS=1, which swaps in a fixed inference so the merge,
// reinforcement and feedback plumbing can be checked without an API key.
const stub: InferLessons = async (_u, _c, original, final, known) => [
  ...(/!/.test(original) && !/!/.test(final) ? ["Do not use exclamation marks"] : []),
  ...(final.split(/\s+/).length < original.split(/\s+/).length * 0.7 ? ["Keep replies short and to the point"] : []),
  ...(/\b(mon|tues|wednes|thurs|fri)day\b/i.test(final) && !/\bday\b/i.test(original) ? ["Propose a specific day and time instead of asking for availability"] : []),
].map((rule) => ({ rule, sameAs: known.find((k) => k.rule === rule)?.id ?? null }));
const infer = process.env.E2E_STUB_LESSONS === "1" ? stub : inferLessons;

void (async () => {
  const db = requireDb();
  console.log(`user ${U}`);
  await saveSettings(U, {
    mode: "sales", signature: "Ayan\nLedgerline", knowledge: "Book a call at https://cal.com/ayan.",
    autopilot: { enabled: true, holdMinutes: 0, dailyCap: 50, autoSync: false, window: { tz: "UTC", start: 0, end: 24, weekdays: false },
      autonomy: { external: "auto", internal: "approve", campaigns: "approve", followUps: "off", nurture: "approve" } },
  });
  const settings = await getSettings(U);

  const sent = async (audience: string, category: string, original: string, final: string) => {
    const [d] = await db.insert(schema.crmDrafts).values({
      userId: U, kind: "reply", meta: { audience, category }, confidence: "high", toAddresses: [{ name: "", address: "x@example.com" }],
      subject: "Re: test", body: `${final}\n\nAyan\nLedgerline`, originalBody: original, status: "sent", sentBy: "you", sentAt: new Date(),
    }).returning();
    return learnFromSend(U, d.id, "Ayan\nLedgerline", infer);
  };
  const pending = async (audience: string, category: string, body: string) => {
    const [d] = await db.insert(schema.crmDrafts).values({
      userId: U, kind: "reply", meta: { audience, category }, confidence: "high", toAddresses: [{ name: "", address: "kim@delta-example.com" }],
      subject: "Re: hi", body, originalBody: body, status: "pending",
    }).returning();
    return d;
  };

  // 1. Certification: coworker replies, sent exactly as written, 24 times.
  for (let i = 0; i < 24; i++) await sent("internal", "colleague", `Sure, the deck is in the shared drive under Sales/${i}.`, `Sure, the deck is in the shared drive under Sales/${i}.`);
  let overview = await engineOverview(U, settings.autopilot.autonomy);
  const coworker = overview.trust.find((t) => t.bucket === "reply:internal:colleague");
  check("24 of 24 good: certified (90% confident ≤ 10% need edits)", coworker?.state === "trusted" && coworker.certifiedBadRate <= 0.1, coworker);
  check("…and autopilot is suggested (coworker replies are on Ask me)", overview.suggestions.some((s) => s.scope === "internal"), overview.suggestions);
  console.log(`       suggestion: ${overview.suggestions[0]?.text}`);

  // 2. A changed number counts against a draft even when little else changed.
  const critical = await sent("internal", "colleague", "It is $4,000 a month for up to ten entities.", "It is $3,500 a month for up to ten entities.");
  check("a changed price is a bad label", critical.scored?.outcome === "critical" && critical.scored.good === false, critical.scored);

  // 3. Probation: replies to prospects keep getting rewritten.
  const rewrites: [string, string][] = [
    ["Thanks so much for reaching out! We would absolutely love to set up a call to discuss this further. Please let me know what times work best for you!", "Thanks, Dana. Tuesday 2pm PT works; I'll send an invite."],
    ["Great question! Our platform is incredibly flexible and can definitely support your use case. Let me know if you'd like to hop on a call!", "Yes, we support NetSuite multi-entity. Happy to show you on a call Thursday."],
    ["Thank you so much for your interest! We are really excited to potentially work together. Please let me know your availability!", "Thanks. Does Wednesday at 10am work for a 20-minute call?"],
    ["Absolutely! We'd be thrilled to help. Let me know what works for you and we can find a time!", "Glad to help. Monday 3pm or Tuesday 11am?"],
  ];
  for (const [o, f] of rewrites) await sent("external", "prospect", o, f);
  overview = await engineOverview(U, settings.autopilot.autonomy);
  const prospects = overview.trust.find((t) => t.bucket === "reply:external:prospect");
  check("mostly rewritten: prospect replies are on probation", prospects?.state === "probation", prospects);
  const held = await considerDraft(U, (await pending("external", "prospect", "Thanks, Kim. Tuesday works.")).id);
  check("a confident prospect reply is still held while on probation", !held.scheduled && held.reasons.some((r) => /probation/.test(r)), held);

  // 4. Spot checks and the security veto, on a stratum with no history yet.
  process.env.AUTOPILOT_SPOT_CHECK_RATE = "1";
  const spot = await considerDraft(U, (await pending("external", "customer", "Thanks, the invoice is attached.")).id);
  check("spot check routes a would-be automatic send to the person", !spot.scheduled && spot.reasons.some((r) => /spot check/.test(r)), spot);
  process.env.AUTOPILOT_SPOT_CHECK_RATE = "0";
  const go = await considerDraft(U, (await pending("external", "customer", "Thanks, all received. Talk Thursday.")).id);
  check("with no spot check, a clean confident reply is scheduled", go.scheduled, go);
  const mine = await considerDraft(U, (await pending("external", "customer", "Book any slot at https://cal.com/ayan.")).id);
  check("the person's own link is allowed", mine.scheduled, mine);
  const foreign = await considerDraft(U, (await pending("external", "customer", "Please update your details at https://secure-payments.example/verify.")).id);
  check("a link the person never gave is held (prompt-injection defence)", !foreign.scheduled && foreign.reasons.some((r) => /not approved/.test(r)), foreign);

  // 5. Three stopped automatic sends in a row demote a certified stratum.
  for (let i = 0; i < 3; i++) await recordCancel(U, { id: 0, kind: "reply", meta: { audience: "internal", category: "colleague" }, confidence: "high" });
  const gate = await trustGate(U, { kind: "reply", meta: { audience: "internal", category: "colleague" }, confidence: "high" }, () => 1);
  check("three cancels in a row: probation", !!gate && /stopped the last 3/.test(gate), gate);

  // 6. Lessons: the rewrites above show a pattern.
  const lessons = await db.select().from(schema.crmLessons).where(eq(schema.crmLessons.userId, U));
  console.log(`       lessons learned (${lessons.length}):`);
  for (const l of lessons) console.log(`         - [${l.context}, seen ${l.evidence}×] ${l.rule}`);
  check("lessons were learned from the edits", lessons.length >= 1, lessons);
  check("repeats are merged and reinforced, not duplicated", lessons.some((l) => l.evidence >= 2), lessons.map((l) => [l.rule, l.evidence]));
  const block = await lessonsFor(U, "reply:external");
  check("lessons seen twice feed the next draft", block.includes("Style lessons") && lessons.filter((l) => l.evidence >= 2).every((l) => block.includes(l.rule)), block.slice(0, 300));

  // 7. Outreach: 60 first emails; "question" openings get replies, "brief" ones get opt-outs.
  const [camp] = await db.insert(schema.crmCampaigns).values({ userId: U, name: "Engine test", steps: [{ dayOffset: 0, instruction: "x" }] }).returning();
  const plan: Record<string, { replies: number; optOuts: number }> = { insight: { replies: 1, optOuts: 0 }, question: { replies: 6, optOuts: 0 }, outcome: { replies: 1, optOuts: 0 }, brief: { replies: 1, optOuts: 3 } };
  const seen: Record<string, number> = { insight: 0, question: 0, outcome: 0, brief: 0 };
  for (let i = 0; i < 60; i++) {
    const angle = Object.keys(plan)[i % 4];
    const k = seen[angle]++;
    const replied = k < plan[angle].replies;
    const optedOut = !replied && k < plan[angle].replies + plan[angle].optOuts;
    const sentAt = new Date(Date.now() - 20 * DAY);
    const [lead] = await db.insert(schema.crmCampaignLeads).values({
      campaignId: camp.id, userId: U, email: `lead${i}@example.com`, status: replied ? "replied" : optedOut ? "opted_out" : "finished",
      lastSentAt: sentAt, repliedAt: replied || optedOut ? new Date(sentAt.getTime() + 2 * DAY) : null, step: 1,
    }).returning();
    await db.insert(schema.crmDrafts).values({
      userId: U, kind: "campaign", campaignLeadId: lead.id, meta: { step: 0 }, toAddresses: [{ name: "", address: lead.email }],
      subject: "hi", body: "b", originalBody: "b", status: "sent", sentBy: "autopilot", sentAt, variant: `angle:${angle};hour:${i % 2 ? "morning" : "afternoon"}`,
    });
  }
  const settled = await settleOutreach(U, "UTC");
  check("every first email settled exactly once, opt-outs as negatives", settled.replied + settled.negative + settled.unanswered === 60 && settled.negative === 3, settled);
  const again = await settleOutreach(U, "UTC");
  check("settling again counts nothing twice", again.replied + again.negative + again.unanswered === 0, again);
  const angles = await armPosteriors(U, "angle");
  console.log(`       angles: ${Object.entries(angles).map(([k, v]) => `${k} ${v.rewards}/${v.pulls} (opt-outs ${v.negatives})`).join(", ")}`);
  check("opt-outs are recorded against their angle", Math.round(angles.brief.negatives) === 3, angles.brief);
  check("an untried angle is centred on the pooled rate, not a flat 50%", angles.why_now.pulls === 0 && angles.why_now.alpha / (angles.why_now.alpha + angles.why_now.beta) < 0.3, angles.why_now);
  overview = await engineOverview(U, settings.autopilot.autonomy);
  const best = [...overview.angles].sort((a, b) => (b.pBest ?? 0) - (a.pBest ?? 0))[0];
  check("the engine is confident 'question' openings work best", best.arm === "question" && (best.pBest ?? 0) > 0.9, overview.angles.map((a) => [a.arm, a.rewards, a.pulls, a.pBest?.toFixed(2)]));
  check("an unused sleeping angle claims no chance of being best", overview.angles.find((a) => a.arm === "why_now")?.pBest === null, overview.angles);
  let picks = 0, explored = 0;
  for (let i = 0; i < 60; i++) {
    const c = await chooseArm(U, "angle", ["insight", "question", "outcome", "brief"]);
    if (c.arm === "question") picks++;
    if (c.explore) explored++;
    if (!(c.propensity > 0 && c.propensity <= 1)) check("propensity is a probability", false, c);
  }
  check("Thompson sampling mostly chooses it, and still explores", picks >= 40 && explored >= 1, { picks, explored });

  console.log(fail ? `\n${fail} FAILED` : "\nall checks passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
