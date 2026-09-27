/** Autopilot rule checks: pnpm exec tsx scripts/test-autopilot.ts */
import { simpleParser } from "mailparser";
import {
  audienceOf, autoSendVerdict, capReached, hasPlaceholder, insideWindow, isAutomatedAddress, isAutomatedMessage,
  levelFor, nextSendTime, normalizeAutopilot, selectPlaybook, type SendCheck,
} from "@/lib/crm/autopilot-rules";
import { buildRaw } from "@/lib/crm/gmail";
import { toIncoming } from "@/lib/crm/imap";
import { withSignature } from "@/lib/crm/send";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};

void (async () => {
  console.log("settings");
  const d = normalizeAutopilot(undefined);
  ok("off by default", d.enabled, false);
  ok("replies ask first by default", [d.autonomy.external, d.autonomy.internal], ["approve", "approve"]);
  ok("junk is cleaned", normalizeAutopilot({ enabled: "yes", holdMinutes: -5, dailyCap: 9999, autonomy: { external: "sure" }, window: { tz: "Mars/Olympus", start: 30, end: 2 } }),
    { enabled: false, regulated: false, autonomy: d.autonomy, holdMinutes: 0, dailyCap: 400, window: { tz: "UTC", start: 23, end: 24, weekdays: true }, autoSync: true });
  ok("regulated mode forces autopilot off", normalizeAutopilot({ enabled: true, regulated: true }).enabled, false);
  ok("valid zone kept", normalizeAutopilot({ window: { tz: "America/Los_Angeles" } }).window.tz, "America/Los_Angeles");
  ok("campaign override wins", levelFor(normalizeAutopilot({ autonomy: { campaigns: "approve" } }), "campaigns", "auto"), "auto");
  ok("default override follows the setting", levelFor(normalizeAutopilot({ autonomy: { campaigns: "auto" } }), "campaigns", "default"), "auto");

  console.log("sending hours");
  const ny = { tz: "America/New_York", start: 9, end: 17, weekdays: true };
  // 2026-09-28 is a Monday. 13:00Z = 09:00 in New York (EDT, UTC-4).
  ok("09:00 local Monday is inside", insideWindow(new Date("2026-09-28T13:00:00Z"), ny), true);
  ok("08:59 local is outside", insideWindow(new Date("2026-09-28T12:59:00Z"), ny), false);
  ok("17:00 local is outside (end is exclusive)", insideWindow(new Date("2026-09-28T21:00:00Z"), ny), false);
  ok("Saturday is outside on weekdays", insideWindow(new Date("2026-09-26T15:00:00Z"), ny), false);
  ok("before hours: waits for 09:00 same day", nextSendTime(new Date("2026-09-28T10:30:00Z"), ny).toISOString(), "2026-09-28T13:00:00.000Z");
  ok("after hours Friday: waits for Monday 09:00", nextSendTime(new Date("2026-09-25T22:10:00Z"), ny).toISOString(), "2026-09-28T13:00:00.000Z");
  ok("inside: goes now", nextSendTime(new Date("2026-09-28T14:05:00Z"), ny).toISOString(), "2026-09-28T14:05:00.000Z");
  const india = { tz: "Asia/Kolkata", start: 10, end: 18, weekdays: false };
  ok("half-hour zone: 09:40 IST waits until 10:00 IST", nextSendTime(new Date("2026-09-28T04:10:00Z"), india).toISOString(), "2026-09-28T04:30:00.000Z");
  const dst = { tz: "America/New_York", start: 9, end: 10, weekdays: false };
  // US clocks go back on 2026-11-01. 09:00 EST that day is 14:00Z.
  ok("across the daylight-saving change", nextSendTime(new Date("2026-10-31T14:30:00Z"), dst).toISOString(), "2026-11-01T14:00:00.000Z");

  console.log("what never goes out on its own");
  ok("brackets", hasPlaceholder("Hi [Name], thanks"), true);
  ok("mustache", hasPlaceholder("See {{link}}"), true);
  ok("TBD", hasPlaceholder("Pricing is TBD"), true);
  ok("clean text", hasPlaceholder("Tuesday at 2pm works. Talk then."), false);
  ok("noreply", isAutomatedAddress("no-reply@stripe.com"), true);
  ok("notifications", isAutomatedAddress("notifications@github.com"), true);
  ok("a person", isAutomatedAddress("maya@ledgerline.io"), false);
  const headers = (h: Record<string, string>) => (n: string) => h[n];
  ok("out-of-office auto reply", isAutomatedMessage(headers({ "auto-submitted": "auto-replied" }), "maya@x.io"), true);
  ok("auto-submitted: no is a person", isAutomatedMessage(headers({ "auto-submitted": "no" }), "maya@x.io"), false);
  ok("mailing list", isAutomatedMessage(headers({ "list-unsubscribe": "<mailto:u@x.io>" }), "news@x.io"), true);
  ok("bulk precedence", isAutomatedMessage(headers({ precedence: "bulk" }), "a@x.io"), true);
  ok("Exchange OOF", isAutomatedMessage(headers({ "x-auto-response-suppress": "All" }), "a@x.io"), true);
  ok("plain person", isAutomatedMessage(headers({}), "maya@x.io"), false);

  console.log("coworkers");
  ok("same domain", audienceOf("sam@ledgerline.io", ["ledgerline.io"]), "internal");
  ok("subdomain", audienceOf("sam@eu.ledgerline.io", ["ledgerline.io"]), "internal");
  ok("lookalike domain is external", audienceOf("sam@notledgerline.io", ["ledgerline.io"]), "external");
  ok("no domains: everyone external", audienceOf("sam@ledgerline.io", []), "external");

  console.log("the send verdict");
  const good: SendCheck = {
    enabled: true, level: "auto", kind: "reply", confidence: "high", sensitive: false, openQuestions: 0, needsInput: 0,
    body: "Tuesday at 2pm works. I'll send an invite.", subject: "Re: Pilot", recipients: ["maya@ledgerline.io"],
    recipientOptedOut: false, replyingToAutomated: false, autoSentInThread: 0,
  };
  ok("a confident, clean reply goes", autoSendVerdict(good), { ok: true, reasons: [] });
  ok("master switch off", autoSendVerdict({ ...good, enabled: false }).ok, false);
  ok("ask-me level", autoSendVerdict({ ...good, level: "approve" }).ok, false);
  ok("medium confidence", autoSendVerdict({ ...good, confidence: "medium" }).ok, false);
  ok("sensitive", autoSendVerdict({ ...good, sensitive: true }).ok, false);
  ok("needs an answer", autoSendVerdict({ ...good, needsInput: 1 }).reasons, ["It needs an answer from you"]);
  ok("placeholder", autoSendVerdict({ ...good, body: "Hi [Name]" }).reasons, ["It contains a blank to fill in"]);
  ok("to a noreply", autoSendVerdict({ ...good, recipients: ["noreply@x.io"] }).ok, false);
  ok("answering a bot", autoSendVerdict({ ...good, replyingToAutomated: true }).ok, false);
  ok("loop guard", autoSendVerdict({ ...good, autoSentInThread: 2 }).ok, false);
  ok("opted out: a reply is still allowed", autoSendVerdict({ ...good, recipientOptedOut: true }).ok, true);
  ok("opted out: outreach is not", autoSendVerdict({ ...good, kind: "campaign", recipientOptedOut: true }).ok, false);
  ok("every reason is listed", autoSendVerdict({ ...good, enabled: false, confidence: "low", sensitive: true }).reasons.length, 3);
  const now = new Date("2026-09-28T15:00:00Z");
  ok("cap counts the last 24 hours", capReached([new Date("2026-09-28T01:00:00Z"), new Date("2026-09-27T14:00:00Z")], now, 2), false);
  ok("cap reached", capReached([new Date("2026-09-28T01:00:00Z"), new Date("2026-09-28T02:00:00Z")], now, 2), true);

  console.log("playbook");
  const entries = [
    { id: 1, question: "What does it cost for ten entities?", answer: "Growth plan, $4,000 a month." },
    { id: 2, question: "Are you SOC 2 compliant?", answer: "Yes, SOC 2 Type II since March." },
    { id: 3, question: "Do you integrate with NetSuite?", answer: "Yes, natively." },
  ];
  ok("small playbooks go in whole", selectPlaybook(entries, "anything").length, 3);
  ok("large playbooks: the relevant answer is chosen", selectPlaybook(entries, "What would pricing cost for our ten entities?", 80).map((e) => e.id), [1]);
  ok("nothing relevant, nothing sent", selectPlaybook(entries, "lunch on friday?", 60), []);

  console.log("signatures");
  ok("added once", withSignature("Thanks,", "Ayan\nLedgerline"), "Thanks,\n\nAyan\nLedgerline");
  ok("not twice", withSignature("Thanks,\n\nAyan\nLedgerline", "Ayan\nLedgerline"), "Thanks,\n\nAyan\nLedgerline");
  ok("no signature set", withSignature("Thanks,", "  "), "Thanks,");

  console.log("raw mail");
  const raw = Buffer.from(buildRaw({ to: ["maya@ledgerline.io"], subject: "Re: Pilot — café", body: "Tuesday works.", inReplyTo: "<a1@x.io>", references: ["<root@x.io>"], messageId: "<m1@fund.vc>" }), "base64url");
  const text = raw.toString("utf8");
  ok("Message-ID set", /\r\nMessage-ID: <m1@fund.vc>\r\n/.test(text), true);
  ok("threading headers", /In-Reply-To: <a1@x.io>\r\nReferences: <root@x.io> <a1@x.io>/.test(text), true);
  ok("UTF-8 subject encoded", /Subject: =\?UTF-8\?B\?/.test(text), true);

  const incoming = await simpleParser(Buffer.from([
    'From: "Maya Ruiz" <Maya@Ledgerline.io>', "To: me@fund.vc", "Subject: Re: Pilot", "Message-ID: <r2@ledgerline.io>",
    "In-Reply-To: <m1@fund.vc>", "References: <root@x.io> <m1@fund.vc>", "Date: Mon, 28 Sep 2026 10:00:00 -0400",
    "Content-Type: text/plain; charset=utf-8", "", "Sounds good.", "", "On Mon, Sep 28, 2026 at 9:00 AM Me <me@fund.vc> wrote:", "> Tuesday works.",
  ].join("\r\n")));
  const m = toIncoming(incoming, "me@fund.vc");
  ok("parsed sender, lower-cased", [m.fromName, m.fromAddress, m.direction], ["Maya Ruiz", "maya@ledgerline.io", "inbound"]);
  ok("quoted history stripped", m.body, "Sounds good.");
  ok("threading ids", [m.rfcMessageId, m.inReplyTo, m.references, m.threadRoot], ["<r2@ledgerline.io>", "<m1@fund.vc>", ["<root@x.io>", "<m1@fund.vc>"], "<root@x.io>"]);
  ok("not automated", m.automated, false);
  const mine = toIncoming(await simpleParser(Buffer.from("From: me@fund.vc\r\nTo: a@b.io\r\nSubject: x\r\n\r\nhi")), "me@fund.vc");
  ok("own mail is outbound", mine.direction, "outbound");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
