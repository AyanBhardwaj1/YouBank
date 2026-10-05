import { and, desc, eq, gte, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { listAccounts, type AccountRow } from "./accounts";
import { approveAction, scanFollowUps } from "./actions";
import {
  audienceOf, autoSendVerdict, capReached, insideWindow, levelFor, nextSendTime,
  type AutonomyScope,
} from "./autopilot-rules";
import { prepareCampaign } from "./campaigns";
import { createDraft, ingestThreadDelta, mailboxAddresses, processThread, supersedeReplies, type DraftRow } from "./db";
import { chooseArm, formatVariant, parseVariant, slotWindow, trustGate, unapprovedDetails } from "./engine";
import { listPlaybook } from "./knowledge";
import { addPlaybookEntry, generalizeAnswer, openQuestionsFor } from "./knowledge";
import { openMailbox, type Mailbox } from "./mailbox";
import { sendDraft } from "./send";
import { claimLock, getSettings, internalDomains, releaseLock, type SettingsRow } from "./settings";
import { syncAccount, type SyncResult } from "./sync";
import { describeFailure } from "@/lib/errors";
import { AUTOPILOT, CAMPAIGNS, planAllows } from "./plan";

/**
 * The autopilot: the part of the agent that acts on its own.
 *
 * It only ever does what the person switched on. With autopilot off (the default), everything the
 * agent writes waits in the review queue exactly as before. With it on, each kind of email follows its
 * own setting (off, ask me, autopilot), and a draft is sent automatically only when it clears every
 * check in autoSendVerdict. Anything doubtful is handed to the person with the reason written down.
 * Automatic sends wait out a hold period, go out only inside the person's sending hours, stay under a
 * daily cap, and are re-checked against the live mailbox first, so a reply the person already sent, or
 * a new message from the other side, stops them.
 */

/** Which autonomy setting governs a draft. Compose is always manual. */
export function scopeOf(draft: Pick<DraftRow, "kind" | "meta">): AutonomyScope | null {
  switch (draft.kind) {
    case "reply": return draft.meta.audience === "internal" ? "internal" : "external";
    case "follow_up": return "followUps";
    case "campaign": return "campaigns";
    case "nurture": return "nurture";
    case "intro": return "intros";
    default: return null;
  }
}

/** The override a campaign or nurture rule sets for its own emails, if any. */
async function overrideFor(draft: DraftRow): Promise<string | null> {
  const db = requireDb();
  if (draft.kind === "campaign" && draft.campaignLeadId) {
    const [row] = await db.select({ mode: schema.crmCampaigns.sendMode }).from(schema.crmCampaignLeads)
      .innerJoin(schema.crmCampaigns, eq(schema.crmCampaigns.id, schema.crmCampaignLeads.campaignId))
      .where(eq(schema.crmCampaignLeads.id, draft.campaignLeadId));
    return row?.mode ?? null;
  }
  if (draft.kind === "nurture" && draft.meta.ruleId) {
    const [row] = await db.select({ mode: schema.crmNurtureRules.sendMode }).from(schema.crmNurtureRules).where(eq(schema.crmNurtureRules.id, draft.meta.ruleId));
    return row?.mode ?? null;
  }
  return null;
}

/** Everything autoSendVerdict needs to know about one draft, read fresh. */
async function checkDraft(draft: DraftRow, settings: SettingsRow) {
  const db = requireDb();
  const scope = scopeOf(draft);
  const level = scope ? levelFor(settings.autopilot, scope, await overrideFor(draft)) : "approve";
  // Autopilot is premium: without it in the plan, the switch counts as off and the draft waits for the person.
  const enabled = settings.autopilot.enabled && (await planAllows(draft.userId, AUTOPILOT));
  const [questions, contact, answering, autoSent] = await Promise.all([
    openQuestionsFor(draft.id),
    draft.contactId ? db.select({ optedOutAt: schema.crmContacts.optedOutAt }).from(schema.crmContacts).where(eq(schema.crmContacts.id, draft.contactId)).then((r) => r[0]) : null,
    draft.replyToMessageId ? db.select({ automated: schema.crmMessages.automated }).from(schema.crmMessages).where(eq(schema.crmMessages.id, draft.replyToMessageId)).then((r) => r[0]) : null,
    draft.threadId
      ? db.select({ n: sql<number>`count(*)::int` }).from(schema.crmDrafts).where(and(eq(schema.crmDrafts.threadId, draft.threadId), eq(schema.crmDrafts.sentBy, "autopilot"), gte(schema.crmDrafts.sentAt, new Date(Date.now() - 86_400_000)))).then((r) => r[0]?.n ?? 0)
      : 0,
  ]);
  const verdict = autoSendVerdict({
    enabled, level, kind: draft.kind, confidence: draft.confidence, sensitive: draft.sensitive,
    openQuestions: draft.citations.length, needsInput: questions.length, body: draft.body, subject: draft.subject,
    recipients: draft.toAddresses.map((a) => a.address), recipientOptedOut: !!contact?.optedOutAt,
    replyingToAutomated: !!answering?.automated, autoSentInThread: autoSent,
  });
  if (level === "auto" && enabled && verdict.ok) {
    // Security: links, addresses and account numbers must come from the person, never from inbound text.
    const playbook = await listPlaybook(draft.userId);
    const approved = [settings.knowledge, settings.instructions, settings.signature, settings.about, ...playbook.map((p) => p.answer)].join("\n");
    const foreign = unapprovedDetails(`${draft.subject}\n${draft.body}`, approved);
    if (foreign.length) return { level, ok: false, reasons: [`It contains ${foreign.length === 1 ? "a link or detail" : "links or details"} you have not approved (${foreign.slice(0, 2).join(", ")})`] };
    // Earned autonomy: probation, or a spot check that keeps the person's labels coming.
    const hold = await trustGate(draft.userId, draft).catch(() => null);
    if (hold) return { level, ok: false, reasons: [hold] };
  }
  return { level, ...verdict };
}

/**
 * Decide what happens to a freshly written draft: schedule it for an automatic send, or leave it for
 * the person. When the person had asked for autopilot and it still has to wait, the reason is saved
 * so the review queue can say why.
 */
export async function considerDraft(userId: string, draftId: number): Promise<{ scheduled: boolean; reasons: string[] }> {
  const db = requireDb();
  const [draft] = await db.select().from(schema.crmDrafts).where(and(eq(schema.crmDrafts.id, draftId), eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.status, "pending")));
  if (!draft) return { scheduled: false, reasons: ["Not pending"] };
  const settings = await getSettings(userId);
  const verdict = await checkDraft(draft, settings);
  if (verdict.ok) {
    // A campaign's first email goes out in a send slot chosen by Thompson sampling; everything else
    // goes at the first moment the person's own sending hours allow.
    let window = settings.autopilot.window;
    let variant = draft.variant;
    if (draft.kind === "campaign" && (draft.meta.step ?? 0) === 0) {
      const slot = await chooseArm<"morning" | "midday" | "afternoon">(userId, "hour").catch(() => null);
      if (slot) { window = slotWindow(window, slot.arm); variant = formatVariant({ ...parseVariant(draft.variant), hour: slot.arm }); }
    }
    const at = nextSendTime(new Date(Date.now() + settings.autopilot.holdMinutes * 60_000), window);
    await db.update(schema.crmDrafts).set({ scheduledFor: at, holdReason: "", variant }).where(eq(schema.crmDrafts.id, draft.id));
    return { scheduled: true, reasons: [] };
  }
  const expectedAuto = verdict.level === "auto" && settings.autopilot.enabled;
  await db.update(schema.crmDrafts).set({ scheduledFor: null, holdReason: expectedAuto ? `Autopilot left this for you: ${verdict.reasons.join("; ")}.` : "" })
    .where(eq(schema.crmDrafts.id, draft.id));
  return { scheduled: false, reasons: verdict.reasons };
}

/**
 * After a thread is triaged: if it needs a reply and the person's settings say to write one, write it
 * and decide whether it can go by itself. A reply already waiting for an older message is replaced.
 */
export async function afterTriage(userId: string, threadId: number): Promise<{ drafted: boolean; scheduled: boolean }> {
  const db = requireDb();
  const [thread] = await db.select().from(schema.crmThreads).where(and(eq(schema.crmThreads.id, threadId), eq(schema.crmThreads.userId, userId)));
  if (!thread?.needsReply) return { drafted: false, scheduled: false };

  const [newest] = await db.select().from(schema.crmMessages)
    .where(and(eq(schema.crmMessages.threadId, threadId), eq(schema.crmMessages.direction, "inbound"))).orderBy(desc(schema.crmMessages.sentAt)).limit(1);
  if (!newest || newest.automated) return { drafted: false, scheduled: false };

  const waiting = await db.select().from(schema.crmDrafts)
    .where(and(eq(schema.crmDrafts.threadId, threadId), inArray(schema.crmDrafts.status, ["pending", "sending"]), inArray(schema.crmDrafts.kind, ["reply", "follow_up"])));
  if (waiting.some((d) => d.status === "sending" || d.replyToMessageId === newest.id)) return { drafted: false, scheduled: false };
  if (waiting.length) await supersedeReplies(userId, threadId, "They wrote again, so this reply was rewritten.");

  const [settings, mailboxes] = await Promise.all([getSettings(userId), mailboxAddresses(userId)]);
  const scope: AutonomyScope = audienceOf(newest.fromAddress, internalDomains(settings, mailboxes)) === "internal" ? "internal" : "external";
  if (settings.autopilot.autonomy[scope] === "off") return { drafted: false, scheduled: false };

  const draft = await createDraft(userId, threadId, { kind: "reply" });
  const { scheduled } = await considerDraft(userId, draft.id);
  return { drafted: true, scheduled };
}

/* ---------------- The person's answers ---------------- */

/**
 * The person answered one of the agent's questions. Once every question on that draft is settled, the
 * draft is rewritten with the answers, and goes through the same autopilot decision as any other.
 * With `remember`, the answer joins the playbook and is used for every similar email from now on.
 */
export async function answerQuestion(userId: string, questionId: number, answer: string, remember: boolean) {
  const db = requireDb();
  const text = answer.trim();
  if (!text) throw new Error("Write an answer first");
  const [q] = await db.update(schema.crmQuestions).set({ answer: text.slice(0, 4000), status: "answered", remember, answeredAt: new Date() })
    .where(and(eq(schema.crmQuestions.id, questionId), eq(schema.crmQuestions.userId, userId), eq(schema.crmQuestions.status, "open"))).returning();
  if (!q) throw new Error("That question was already answered or closed");
  if (remember) await addPlaybookEntry(userId, { ...(await generalizeAnswer(userId, q.question, text)), source: "answered" });

  if (!q.draftId) return { question: q, draft: null, scheduled: false, remaining: 0 };
  const remaining = await openQuestionsFor(q.draftId);
  if (remaining.length) return { question: q, draft: null, scheduled: false, remaining: remaining.length };

  const [old] = await db.select().from(schema.crmDrafts).where(eq(schema.crmDrafts.id, q.draftId));
  if (!old || old.status !== "pending" || !old.threadId) return { question: q, draft: null, scheduled: false, remaining: 0 };
  const answered = await db.select().from(schema.crmQuestions).where(and(eq(schema.crmQuestions.draftId, q.draftId), eq(schema.crmQuestions.status, "answered")));
  await db.update(schema.crmDrafts).set({ status: "superseded", holdReason: "Rewritten with your answers.", decidedAt: new Date(), scheduledFor: null })
    .where(eq(schema.crmDrafts.id, old.id));
  const draft = await createDraft(userId, old.threadId, {
    kind: old.kind as "reply" | "follow_up",
    meta: old.meta,
    instruction: `The reader answered your questions. Use these answers; they are authoritative:\n${answered.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n")}`,
  });
  const { scheduled } = await considerDraft(userId, draft.id);
  return { question: q, draft, scheduled, remaining: 0 };
}

export async function dismissQuestion(userId: string, questionId: number): Promise<void> {
  await requireDb().update(schema.crmQuestions).set({ status: "dismissed" })
    .where(and(eq(schema.crmQuestions.id, questionId), eq(schema.crmQuestions.userId, userId)));
}

/* ---------------- The send queue ---------------- */

export type QueueResult = { sent: number; held: number; deferred: number; superseded: number; failed: number; errors: string[] };

/**
 * Before an automatic reply goes, look at the conversation as the mailbox has it now. If the other
 * side wrote again, the reply is rewritten; if the person already answered, it is withdrawn.
 */
async function stillCurrent(userId: string, draft: DraftRow, mailbox: Mailbox | null): Promise<boolean> {
  if (!draft.threadId || !mailbox) return true;
  const db = requireDb();
  const [thread] = await db.select().from(schema.crmThreads).where(eq(schema.crmThreads.id, draft.threadId));
  if (!thread || thread.providerThreadId.startsWith("manual-")) return true;
  const live = await mailbox.thread(thread.providerThreadId).catch(() => null);
  if (!live) return true;
  const delta = await ingestThreadDelta(userId, { providerThreadId: thread.providerThreadId, accountId: thread.accountId, subject: thread.subject, messages: live.messages });
  if (delta.addedOutbound > 0 && delta.addedInbound === 0) {
    await supersedeReplies(userId, thread.id, "You replied yourself, so this draft was withdrawn.");
    return false;
  }
  if (delta.addedInbound > 0) {
    await supersedeReplies(userId, thread.id, "They wrote again before this went, so it was rewritten.");
    await processThread(userId, thread.id);
    await afterTriage(userId, thread.id);
    return false;
  }
  return true;
}

/** Send the scheduled drafts that are due, within the window and the cap. */
export async function sendDue(userId: string, origin: string, deadline: number): Promise<QueueResult> {
  const db = requireDb();
  const out: QueueResult = { sent: 0, held: 0, deferred: 0, superseded: 0, failed: 0, errors: [] };
  const now = new Date();

  // A send that started and never finished (the host was cut off) is not retried blindly: it may
  // have gone. A person decides.
  await db.update(schema.crmDrafts).set({ status: "pending", scheduledFor: null, holdReason: "Sending did not finish. Check your Sent folder before sending it again." })
    .where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.status, "sending"), lt(schema.crmDrafts.decidedAt, new Date(Date.now() - 15 * 60_000))));

  const due = await db.select().from(schema.crmDrafts)
    .where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.status, "pending"), isNotNull(schema.crmDrafts.scheduledFor), lte(schema.crmDrafts.scheduledFor, now)))
    .orderBy(schema.crmDrafts.scheduledFor).limit(40);
  if (due.length === 0) return out;

  // Automatic sends need Autopilot in the plan, checked before every send pass that has work: without
  // it, what was scheduled waits for the person with the reason, and nothing goes out on its own.
  if (!(await planAllows(userId, AUTOPILOT))) {
    const held = await db.update(schema.crmDrafts).set({ scheduledFor: null, holdReason: "Autopilot is not part of your plan now, so this waits for you to send it." })
      .where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.status, "pending"), isNotNull(schema.crmDrafts.scheduledFor))).returning({ id: schema.crmDrafts.id });
    out.held = held.length;
    return out;
  }

  const settings = await getSettings(userId);
  const ap = settings.autopilot;
  if (!ap.enabled) {
    await db.update(schema.crmDrafts).set({ scheduledFor: null, holdReason: "Autopilot was switched off before this went." })
      .where(inArray(schema.crmDrafts.id, due.map((d) => d.id)));
    out.held = due.length;
    return out;
  }
  if (!insideWindow(now, ap.window)) {
    await db.update(schema.crmDrafts).set({ scheduledFor: nextSendTime(now, ap.window) }).where(inArray(schema.crmDrafts.id, due.map((d) => d.id)));
    out.deferred = due.length;
    return out;
  }

  const recent = await db.select({ at: schema.crmDrafts.sentAt }).from(schema.crmDrafts)
    .where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.sentBy, "autopilot"), gte(schema.crmDrafts.sentAt, new Date(Date.now() - 86_400_000))));
  const sentTimes = recent.map((r) => r.at!).filter(Boolean);

  const accounts = await listAccounts(userId);
  const mailboxes = new Map<number, Mailbox | null>();
  const mailboxFor = async (draft: DraftRow): Promise<Mailbox | null> => {
    const [thread] = draft.threadId ? await db.select({ accountId: schema.crmThreads.accountId }).from(schema.crmThreads).where(eq(schema.crmThreads.id, draft.threadId)) : [];
    const account: AccountRow | undefined = accounts.find((a) => a.id === thread?.accountId) ?? accounts[0];
    if (!account) return null;
    if (!mailboxes.has(account.id)) mailboxes.set(account.id, await openMailbox(account, origin).catch(() => null));
    return mailboxes.get(account.id) ?? null;
  };

  try {
    for (const draft of due) {
      if (Date.now() > deadline) break;
      const verdict = await checkDraft(draft, settings);
      if (!verdict.ok) {
        await db.update(schema.crmDrafts).set({ scheduledFor: null, holdReason: `Autopilot left this for you: ${verdict.reasons.join("; ")}.` }).where(eq(schema.crmDrafts.id, draft.id));
        out.held++;
        continue;
      }
      if (capReached(sentTimes, new Date(), ap.dailyCap)) {
        const oldest = [...sentTimes].sort((a, b) => a.getTime() - b.getTime())[0];
        const room = nextSendTime(new Date((oldest?.getTime() ?? Date.now()) + 86_400_000), ap.window);
        await db.update(schema.crmDrafts).set({ scheduledFor: room, holdReason: `Your daily autopilot limit of ${ap.dailyCap} was reached; it goes when there is room.` }).where(eq(schema.crmDrafts.id, draft.id));
        out.deferred++;
        continue;
      }
      if (draft.campaignLeadId) {
        const [lead] = await db.select({ status: schema.crmCampaignLeads.status }).from(schema.crmCampaignLeads).where(eq(schema.crmCampaignLeads.id, draft.campaignLeadId));
        if (!lead || !["qualified", "active"].includes(lead.status)) {
          await db.update(schema.crmDrafts).set({ status: "superseded", scheduledFor: null, holdReason: "The lead is no longer in the sequence.", decidedAt: new Date() }).where(eq(schema.crmDrafts.id, draft.id));
          out.superseded++;
          continue;
        }
      }
      try {
        if (!(await stillCurrent(userId, draft, await mailboxFor(draft)))) { out.superseded++; continue; }
        await sendDraft(userId, draft.id, origin, undefined, { by: "autopilot" });
        sentTimes.push(new Date());
        out.sent++;
      } catch (e) {
        const message = describeFailure(e, 502, "autopilot-send").message;
        out.failed++;
        out.errors.push(`${draft.subject}: ${message}`);
        const [after] = await db.select({ attempts: schema.crmDrafts.attempts }).from(schema.crmDrafts).where(eq(schema.crmDrafts.id, draft.id));
        const giveUp = (after?.attempts ?? 0) >= 3;
        await db.update(schema.crmDrafts).set(giveUp
          ? { scheduledFor: null, holdReason: `Autopilot could not send this after three tries: ${message}` }
          : { scheduledFor: new Date(Date.now() + 10 * 60_000) })
          .where(and(eq(schema.crmDrafts.id, draft.id), eq(schema.crmDrafts.status, "pending")));
      }
    }
  } finally {
    for (const m of mailboxes.values()) await m?.close().catch(() => undefined);
  }
  return out;
}

/* ---------------- One pass ---------------- */

export type TickResult = {
  locked: boolean; synced: (SyncResult & { address: string })[]; replies: { drafted: number; scheduled: number };
  followUps: number; campaigns: { drafted: number; scheduled: number }; queue: QueueResult | null; errors: string[];
};

/**
 * One autopilot pass for one person: read new mail and answer what the settings allow, draft due
 * follow-ups and campaign steps, then send whatever is due. Runs every few minutes from the
 * heartbeat, and never overlaps itself for the same person.
 */
export async function tick(userId: string, origin: string, deadline: number): Promise<TickResult> {
  const out: TickResult = { locked: false, synced: [], replies: { drafted: 0, scheduled: 0 }, followUps: 0, campaigns: { drafted: 0, scheduled: 0 }, queue: null, errors: [] };
  if (!(await claimLock(userId, 5))) { out.locked = true; return out; }
  const attempt = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try { return await fn(); } catch (e) { out.errors.push(`${label}: ${describeFailure(e, 502, `autopilot:${label}`).message}`); return null; }
  };
  try {
    const settings = await getSettings(userId);
    const ap = settings.autopilot;

    if (ap.autoSync) {
      for (const account of await listAccounts(userId)) {
        if (account.status !== "connected" || Date.now() > deadline - 60_000) continue;
        const r = await attempt(`sync ${account.address}`, () => syncAccount(userId, account, origin, {
          deadline: deadline - 60_000,
          onTriaged: async (threadId) => {
            const d = await attempt("reply", () => afterTriage(userId, threadId));
            if (d?.drafted) out.replies.drafted++;
            if (d?.scheduled) out.replies.scheduled++;
          },
        }));
        if (r) out.synced.push({ ...r, address: account.address });
      }
    }

    if (ap.autonomy.followUps !== "off" && Date.now() < deadline - 45_000) {
      await attempt("follow-ups", () => scanFollowUps(userId));
      const db = requireDb();
      const pending = await db.select({ id: schema.crmActions.id }).from(schema.crmActions)
        .where(and(eq(schema.crmActions.userId, userId), eq(schema.crmActions.status, "pending"), eq(schema.crmActions.kind, "follow_up"))).limit(5);
      for (const a of pending) {
        if (Date.now() > deadline - 45_000) break;
        const r = await attempt("follow-up draft", () => approveAction(userId, a.id));
        if (r?.draftId) { out.followUps++; await considerDraft(userId, r.draftId); }
      }
    }

    if (Date.now() < deadline - 45_000) {
      const db = requireDb();
      const active = await db.select({ id: schema.crmCampaigns.id }).from(schema.crmCampaigns)
        .where(and(eq(schema.crmCampaigns.userId, userId), eq(schema.crmCampaigns.status, "active")));
      // Campaign steps are drafted on the heartbeat only for plans that include campaigns.
      const live = active.length && (await planAllows(userId, CAMPAIGNS)) ? active : [];
      for (const c of live) {
        if (Date.now() > deadline - 45_000) break;
        const r = await attempt("campaign", () => prepareCampaign(userId, c.id, deadline - 45_000));
        for (const id of r?.draftIds ?? []) {
          out.campaigns.drafted++;
          if ((await considerDraft(userId, id)).scheduled) out.campaigns.scheduled++;
        }
      }
    }

    out.queue = await attempt("send queue", () => sendDue(userId, origin, deadline - 5_000));
    return out;
  } finally {
    await releaseLock(userId);
  }
}

/** Everyone with a connected mailbox, in random order so no one waits behind the same people every pass. */
export async function autopilotUsers(): Promise<string[]> {
  const rows = await requireDb().execute(sql`
    select user_id as "userId" from (select distinct user_id from ${schema.emailAccounts} where status = 'connected') u order by random()`);
  return (rows.rows as { userId: string }[]).map((r) => r.userId);
}
