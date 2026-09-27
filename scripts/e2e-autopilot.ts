/**
 * End-to-end autopilot check: a real IMAP/SMTP mailbox, a real database, the live model.
 *
 * Uses a throwaway Ethereal mailbox (nodemailer's test service: nothing it "sends" is delivered) and
 * writes rows under a fresh e2e-* user. Point DATABASE_URL at a Neon test branch, never production:
 *
 *   DATABASE_URL=<branch url> EMAIL_TOKEN_SECRET=<any 16+ chars> OPENAI_API_KEY=... pnpm exec tsx scripts/e2e-autopilot.ts
 */
import nodemailer from "nodemailer";
import { and, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { saveImapAccount } from "@/lib/crm/accounts";
import { answerQuestion, tick } from "@/lib/crm/autopilot";
import { listOpenQuestions, listPlaybook } from "@/lib/crm/knowledge";
import { saveSettings } from "@/lib/crm/settings";
import { imapClient } from "@/lib/crm/imap";

const U = `e2e-${Date.now()}`;
let fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}${!cond && detail !== undefined ? `  -> ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
  if (!cond) fail++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

void (async () => {
  const db = requireDb();
  const acct = await nodemailer.createTestAccount();
  console.log(`user ${U}, mailbox ${acct.user}`);
  const smtp = nodemailer.createTransport({ host: acct.smtp.host, port: acct.smtp.port, secure: acct.smtp.secure, auth: { user: acct.user, pass: acct.pass } });
  // Ethereal keeps every message sent through it in the account's mailbox, whatever the From: says,
  // which is how "inbound" mail from prospects and coworkers is simulated here.
  const inbound = async (from: string, subject: string, text: string, headers?: Record<string, string>) => {
    const info = await smtp.sendMail({ from, to: acct.user, subject, text, headers });
    return info.messageId as string;
  };

  await saveSettings(U, {
    mode: "sales",
    about: "Ayan, founder of Ledgerline. We automate month-end reconciliation for mid-market finance teams.",
    signature: "Ayan\nLedgerline",
    knowledge: "Ledgerline integrates natively with NetSuite and QuickBooks Online. SOC 2 Type II. Setup takes about two weeks.",
    instructions: "Keep replies under 90 words.",
    internalDomains: ["ledgerline.io"],
    autopilot: {
      enabled: true, holdMinutes: 0, dailyCap: 20, autoSync: true,
      autonomy: { external: "auto", internal: "auto", campaigns: "auto", followUps: "off", nurture: "approve" },
      window: { tz: "UTC", start: 0, end: 24, weekdays: false },
    },
  });

  // 1. Connect the mailbox with its password: both servers are signed in to first.
  const account = await saveImapAccount(U, { email: acct.user, password: acct.pass, name: "Ayan", imapHost: "imap.ethereal.email", imapPort: 993, smtpHost: acct.smtp.host, smtpPort: acct.smtp.port });
  check("connected over IMAP/SMTP with an app password", account.provider === "imap" && account.status === "connected" && account.secret.startsWith("v1."), account.provider);
  let bad = "";
  try { await saveImapAccount(U, { email: acct.user, password: "wrong-password", imapHost: "imap.ethereal.email", imapPort: 993, smtpHost: acct.smtp.host, smtpPort: acct.smtp.port }); }
  catch (e) { bad = e instanceof Error ? e.message : String(e); }
  check("a wrong password is refused at connect time", /refused|app password/i.test(bad), bad);

  // 2. Mail arrives: a prospect asking something only the founder knows, a coworker, a newsletter, and an easy prospect question.
  const pricingId = await inbound('"Dana Li" <dana@paydragon-example.com>', "Ledgerline for PayDragon", "Hi Ayan, thanks for the note. We run 10 entities on NetSuite. What would pricing look like for us, and is there a pilot?");
  await inbound('"Sam Ortiz" <sam@ledgerline.io>', "Quick q", "Hey, a prospect asked which accounting systems we integrate with. Which ones should I tell them?");
  await inbound('"Stripe" <no-reply@stripe-example.com>', "Your weekly summary", "Here is your summary.", { "List-Unsubscribe": "<mailto:unsub@stripe-example.com>" });
  const joId = await inbound('"Jo Park" <jo@acme-example.com>', "Setup time?", "Hi Ayan, roughly how long does setup take with QuickBooks Online? Thanks, Jo");
  await sleep(3000);

  const t1 = await tick(U, "http://localhost:3000", Date.now() + 240_000);
  console.log("       tick 1:", JSON.stringify({ synced: t1.synced.map((s) => ({ triaged: s.triaged, fetched: s.fetched, errors: s.errors })), replies: t1.replies, queue: t1.queue, errors: t1.errors }));
  check("four threads read", (t1.synced[0]?.fetched ?? 0) >= 4, t1.synced);

  const drafts = await db.select().from(schema.crmDrafts).where(eq(schema.crmDrafts.userId, U));
  const threads = await db.select().from(schema.crmThreads).where(eq(schema.crmThreads.userId, U));
  const bySubject = (s: string) => threads.find((t) => t.subject.includes(s));
  const draftFor = (s: string) => drafts.filter((d) => d.threadId === bySubject(s)?.id);
  check("newsletter: filed, no reply drafted", draftFor("weekly summary").length === 0 && !bySubject("weekly summary")?.needsReply, draftFor("weekly summary"));
  const coworker = draftFor("Quick q")[0];
  check("coworker reply: answered from knowledge and sent by autopilot", coworker?.status === "sent" && coworker.sentBy === "autopilot" && coworker.meta.audience === "internal", coworker && { status: coworker.status, hold: coworker.holdReason, conf: coworker.confidence });
  const setup = draftFor("Setup time")[0];
  check("easy prospect question: sent by autopilot", setup?.status === "sent" && setup.sentBy === "autopilot", setup && { status: setup.status, hold: setup.holdReason, conf: setup.confidence });
  const pricing = draftFor("PayDragon")[0];
  const qs = await listOpenQuestions(U);
  check("pricing: held for you, with a question", pricing?.status === "pending" && !pricing.scheduledFor && qs.length >= 1, { status: pricing?.status, hold: pricing?.holdReason, qs: qs.map((q) => q.question) });
  console.log(`       held because: ${pricing?.holdReason}`);
  for (const q of qs) console.log(`       question: ${q.question}  (${q.context})`);
  if (coworker) console.log(`       coworker reply:\n${coworker.body.split("\n").map((l) => `         | ${l}`).join("\n")}`);

  // 3. Answer, and ask it to remember.
  for (const q of qs) {
    const a = "Growth plan: $4,000 a month for up to 10 entities, billed annually. We offer a free 30-day pilot on one entity.";
    await answerQuestion(U, q.id, a, true);
  }
  const book = await listPlaybook(U);
  check("answers joined the playbook", book.length >= 1, book);
  const t2 = await tick(U, "http://localhost:3000", Date.now() + 240_000);
  const afterAnswer = (await db.select().from(schema.crmDrafts).where(and(eq(schema.crmDrafts.userId, U), eq(schema.crmDrafts.threadId, bySubject("PayDragon")!.id))));
  const rewritten = afterAnswer.find((d) => d.status === "sent" || (d.status === "pending" && d.id !== pricing?.id));
  console.log("       tick 2 queue:", JSON.stringify(t2.queue));
  check("rewritten with the answer and sent by autopilot", rewritten?.status === "sent" && rewritten.sentBy === "autopilot" && /4,000|4000/.test(rewritten.body), rewritten && { status: rewritten.status, hold: rewritten.holdReason, body: rewritten.body.slice(0, 200) });
  if (rewritten) console.log(`       rewritten reply:\n${rewritten.body.split("\n").map((l) => `         | ${l}`).join("\n")}`);

  // 4. The next prospect asks the same thing: the playbook answers it, no question this time.
  await inbound('"Lee Chen" <lee@orbit-example.com>', "Pricing?", "Hi, what would Ledgerline cost for 8 entities?");
  await sleep(3000);
  await tick(U, "http://localhost:3000", Date.now() + 240_000);
  const lee = (await db.select().from(schema.crmThreads).where(eq(schema.crmThreads.userId, U))).find((t) => t.subject.includes("Pricing?"));
  const leeDraft = lee ? (await db.select().from(schema.crmDrafts).where(eq(schema.crmDrafts.threadId, lee.id)))[0] : undefined;
  const leeQs = (await listOpenQuestions(U)).filter((q) => q.threadId === lee?.id);
  check("second pricing question answered from the playbook, no new question", leeQs.length === 0 && leeDraft?.status === "sent" && /4,000|4000/.test(leeDraft.body), leeDraft && { status: leeDraft.status, hold: leeDraft.holdReason, qs: leeQs.map((q) => q.question) });

  // 5. You reply from your own mail client before autopilot does: its draft is withdrawn.
  await saveSettings(U, { autopilot: { enabled: true, holdMinutes: 30, dailyCap: 20, autoSync: true, autonomy: { external: "auto", internal: "auto", campaigns: "auto", followUps: "off", nurture: "approve" }, window: { tz: "UTC", start: 0, end: 24, weekdays: false } } });
  const kimId = await inbound('"Kim Ro" <kim@delta-example.com>', "NetSuite?", "Do you integrate with NetSuite?");
  await sleep(3000);
  await tick(U, "http://localhost:3000", Date.now() + 240_000);
  const kim = (await db.select().from(schema.crmThreads).where(eq(schema.crmThreads.userId, U))).find((t) => t.subject.includes("NetSuite?"));
  const kimDraft = kim ? (await db.select().from(schema.crmDrafts).where(eq(schema.crmDrafts.threadId, kim.id)))[0] : undefined;
  check("scheduled 30 minutes out", !!kimDraft?.scheduledFor && kimDraft.scheduledFor.getTime() > Date.now() + 25 * 60_000, kimDraft && { s: kimDraft.status, at: kimDraft.scheduledFor, hold: kimDraft.holdReason });
  await smtp.sendMail({ from: acct.user, to: "kim@delta-example.com", subject: "Re: NetSuite?", text: "Yes, natively. — Ayan (from my phone)", inReplyTo: kimId, references: [kimId] });
  await sleep(3000);
  if (kimDraft) await db.update(schema.crmDrafts).set({ scheduledFor: new Date(Date.now() - 1000) }).where(eq(schema.crmDrafts.id, kimDraft.id));
  const t4 = await tick(U, "http://localhost:3000", Date.now() + 240_000);
  const kimAfter = kimDraft ? (await db.select().from(schema.crmDrafts).where(eq(schema.crmDrafts.id, kimDraft.id)))[0] : undefined;
  console.log("       tick 4:", JSON.stringify({ youReplied: t4.synced.map((s) => s.youReplied), queue: t4.queue }));
  check("your own reply withdrew autopilot's", kimAfter?.status === "superseded", kimAfter && { s: kimAfter.status, hold: kimAfter.holdReason });

  // 6. What actually left the mailbox: signature, threading headers, the reply-to-self never duplicated.
  const client = imapClient({ imapHost: "imap.ethereal.email", imapPort: 993, imapSecure: true, smtpHost: "", smtpPort: 0, smtpSecure: false, username: acct.user }, acct.pass);
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  const all = await client.fetchAll("1:*", { envelope: true, source: true });
  lock.release(); await client.logout();
  const ours = all.filter((m) => m.envelope?.from?.[0]?.address === acct.user && /Ledgerline$/m.test(m.source?.toString() ?? ""));
  console.log(`       mailbox holds ${all.length} messages; ${ours.length} sent by the agent`);
  const reply = ours.find((m) => m.envelope?.subject?.startsWith("Re: Setup time?"));
  const src = reply?.source?.toString() ?? "";
  check("sent reply carries the signature and threads under the prospect's email", /Ayan\r?\nLedgerline/.test(src) && src.includes(`In-Reply-To: ${joId}`), src.slice(0, 500));
  check("the answered pricing reply went out too", ours.some((m) => m.envelope?.subject?.startsWith("Re: Ledgerline for PayDragon") && (m.source?.toString() ?? "").includes(`In-Reply-To: ${pricingId}`)));

  console.log(fail ? `\n${fail} FAILED` : "\nall checks passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
