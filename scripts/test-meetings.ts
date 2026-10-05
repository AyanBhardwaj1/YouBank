/**
 * Checks for the meeting copilot's pure parts, against fixtures: no network, no database, no model.
 *   pnpm exec tsx scripts/test-meetings.ts
 *
 * Covers transcript chunk stitching (overlaps, re-sent chunks, per-chunk speaker labels, the person's
 * own voice from the microphone levels), participant matching, the notes parser (action items, owners,
 * dates), proposed deal changes, the notetaker's webhook signatures and transcripts, meeting context,
 * the transcription engines' answers and the premium features.
 */
import { createHmac } from "node:crypto";
import { featureById, FEATURES } from "@/lib/billing/features";
import { MEETINGS_FREE_NOTES } from "@/lib/billing/features/meetings";
import { parseRecallEvent, participantsFromRecall, recallState, recallStatus, segmentsFromRecall, verifySvix } from "@/lib/meetings/bot";
import { autoJoinDue, cleanAppTitle, mergeContexts } from "@/lib/meetings/context";
import { entryBody } from "@/lib/meetings/crm";
import { dealPatch, describeChanges, isoDay, parseMoney, proposeDealChanges, type DealLite } from "@/lib/meetings/diff";
import { dedupePeople, matchParticipants, nameScore, nameTokens } from "@/lib/meetings/match";
import { durationLabel, isMeetingUrl, normalizeSettings, platformOfUrl, refusedBy } from "@/lib/meetings/model";
import { parseNotes, resolveDue } from "@/lib/meetings/notes";
import { chunkLabel, dropRepeatedPrefix, labelSelf, nameSpeakers, parseLevels, renderTranscript, stitch, turns, type Chunk } from "@/lib/meetings/stitch";
import { pickTranscriber, segmentsFromMl, segmentsFromOpenAi } from "@/lib/meetings/transcribe";
import { DEAL_STAGES } from "@/lib/crm/model";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function stitching() {
  console.log("transcript chunk stitching");
  // Two 30-second chunks; the second starts a second early, so "the end of" is heard in both.
  const chunks: Chunk[] = [
    { seq: 1, startSec: 29, durationSec: 30, segments: [
      { start: 0, end: 3.2, text: "the end of October if legal signs off.", speaker: "A" },
      { start: 4, end: 9, text: "That works for us.", speaker: "B" },
    ] },
    { seq: 0, startSec: 0, durationSec: 30, segments: [
      { start: 0, end: 4, text: "Thanks for joining, everyone.", speaker: "A" },
      { start: 4.5, end: 12, text: "Let's start with the pricing update.", speaker: "B" },
      { start: 26, end: 30, text: "We can close by the end of", speaker: "A" },
    ] },
  ];
  const s = stitch(chunks);
  check("chunks are ordered by number, not arrival", s[0].text === "Thanks for joining, everyone.", s.map((x) => x.text));
  check("times become meeting times", s[3].start === 29 && s[4].start === 33 && s[4].end === 38, s.map((x) => [x.start, x.end]));
  check("words heard in both chunks' overlap appear once", s[3].text === "October if legal signs off.", s[3].text);
  check("diarizer labels are kept apart per chunk", eq(s.map((x) => x.speaker), ["S0A", "S0B", "S0A", "S1A", "S1B"]), s.map((x) => x.speaker));
  const resent = stitch([...chunks, { seq: 1, startSec: 29, durationSec: 30, segments: [{ start: 1, end: 5, text: "Second copy wins.", speaker: "A" }] }]);
  check("a chunk sent twice: the later copy replaces it", resent.length === 4 && resent[3].text === "Second copy wins.", resent.map((x) => x.text));
  // A segment the earlier chunk cut at its end, heard whole in the next chunk past the seam.
  const seam = stitch([
    { seq: 0, startSec: 0, durationSec: 30, segments: [{ start: 2, end: 10, text: "Opening.", speaker: "A" }, { start: 29.6, end: 30, text: "Rev", speaker: "A" }] },
    { seq: 1, startSec: 29, durationSec: 30, segments: [{ start: 0.6, end: 4, text: "Revenue grew forty percent.", speaker: "A" }] },
  ]);
  check("a fragment cut at the seam gives way to the whole sentence", eq(seam.map((x) => x.text), ["Opening.", "Revenue grew forty percent."]), seam.map((x) => x.text));
  check("empty and blank segments are dropped", stitch([{ seq: 0, startSec: 0, durationSec: 5, segments: [{ start: 0, end: 1, text: "  " }] }]).length === 0);
  check("contiguous chunks without overlap keep everything", stitch([
    { seq: 0, startSec: 0, durationSec: 30, segments: [{ start: 25, end: 29, text: "One." }] },
    { seq: 1, startSec: 30, durationSec: 30, segments: [{ start: 0, end: 2, text: "One more." }] },
  ]).length === 2);

  check("names stay names; anonymous labels are namespaced", chunkLabel("Maya Chen", 4) === "Maya Chen" && chunkLabel("speaker_2", 4) === "S42" && chunkLabel("B", 7) === "S7B" && chunkLabel("You", 3) === "You");
  check("repeated words: two or more words, or one long word", dropRepeatedPrefix("we said the", "the deal") === "the deal" && dropRepeatedPrefix("send the term sheet", "term sheet today") === "today" && dropRepeatedPrefix("about revenue", "revenue was up") === "was up");

  const levels = parseLevels("ff00".repeat(8) + "10ff".repeat(8));
  check("levels parse from hex, bad hex gives none", levels.length === 32 && levels[0] === 255 && parseLevels("zz").length === 0 && parseLevels("abc").length === 0);
  const activity = { frameSec: 0.25, mic: [...Array(8).fill(200), ...Array(8).fill(10)], sys: [...Array(8).fill(5), ...Array(8).fill(180)] };
  const labelled = labelSelf([{ start: 0, end: 2, text: "Mine.", speaker: "A" }, { start: 2, end: 4, text: "Theirs.", speaker: "B" }], activity);
  check("speech into the microphone is You; system audio is not", labelled[0].speaker === "You" && labelled[1].speaker === "B", labelled);
  check("microphone only: levels say nothing, labels stay", labelSelf([{ start: 0, end: 2, text: "x", speaker: "A" }], { frameSec: 0.25, mic: Array(8).fill(200), sys: Array(8).fill(0) })[0].speaker === "A");

  const named = nameSpeakers(s, [{ label: "S0B", name: "Maya Chen" }]);
  check("the notes' speaker names replace labels; unnamed ones read Speaker", named[1].speaker === "Maya Chen" && named[0].speaker === "Speaker");
  const t = turns([{ start: 0, end: 2, text: "Hi.", speaker: "You" }, { start: 2.5, end: 4, text: "How are you?", speaker: "You" }, { start: 4, end: 5, text: "Good.", speaker: "Maya" }]);
  check("consecutive segments by one speaker merge into a turn", t.length === 2 && t[0].text === "Hi. How are you?");
  const rendered = renderTranscript([{ start: 65, end: 70, text: "Hello.", speaker: "Maya" }]);
  check("rendered as [mm:ss] Speaker: text", rendered === "[01:05] Maya: Hello.", rendered);
  const long = renderTranscript(Array.from({ length: 400 }, (_, i) => ({ start: i * 10, end: i * 10 + 5, text: `Line ${i} ${"x".repeat(80)}`, speaker: i % 2 ? "A1" : "B1" })), 8000);
  check("a very long meeting keeps its start and end and says what was cut", long.length <= 8400 && long.includes("Line 0 ") && long.includes("Line 399 ") && /left out for length/.test(long));
}

function matching() {
  console.log("participant matching");
  const contacts = [
    { id: 1, name: "Maya Chen", email: "maya@ledgerline.io", company: "Ledgerline" },
    { id: 2, name: "Tom Baker", email: "tom@acme.com", company: "Acme" },
    { id: 3, name: "Tom Becker", email: "tbecker@northwind.com", company: "Northwind" },
    { id: 4, name: "", email: "priya.shah@kestrel.vc", company: "Kestrel" },
    { id: 5, name: "José Álvarez", email: "jose@fundo.mx", company: "Fundo" },
  ];
  check("display names lose titles, companies and punctuation", eq(nameTokens("Dr. Maya Chen (Ledgerline)"), ["maya", "chen"]) && eq(nameTokens("Maya Chen | Ledgerline"), ["maya", "chen"]) && eq(nameTokens("maya.chen"), ["maya", "chen"]));
  check("name scores: exact, initial, reversed, first name alone", nameScore("Maya Chen", "Maya Chen") === 0.95 && nameScore("Maya C.", "Maya Chen") === 0.78 && nameScore("Chen, Maya", "Maya Chen") === 0.85 && nameScore("Maya", "Maya Chen") === 0.5);
  const m = matchParticipants([
    { name: "Maya Chen (Ledgerline)" },
    { name: "Tom B." },
    { name: "Thomas", email: "TOM@acme.com" },
    { name: "priya.shah" },
    { name: "Jose Alvarez" },
    { name: "Sam Ortiz", email: "sam@newco.io" },
    { name: "You" },
    { name: "Ayan B", email: "me@youbank.app" },
  ], contacts, { emails: ["me@youbank.app"], name: "Ayan Bhardwaj" });
  check("a name that fits one contact well links by name", m[0].contactId === 1 && m[0].how === "name");
  check("an initial that fits two contacts links neither (even when an email placed one)", m[1].contactId === null && eq(m[1].candidates, [3]), m[1]);
  check("an email settles it, whatever the name, in any case", m[2].contactId === 2 && m[2].how === "email" && m[2].confidence === 1);
  check("a handle matches a contact known only by email", m[3].contactId === 4, m[3]);
  check("accents do not matter", m[4].contactId === 5, m[4]);
  check("a new person with an email is left to be created", m[5].contactId === null && m[5].how === "none" && !m[5].self);
  check("the person themselves is never their own contact", m[6].self && m[7].self);
  const claimed = matchParticipants([{ name: "Maya Chen" }, { name: "Someone", email: "maya@ledgerline.io" }], contacts);
  check("a contact claimed by email is not handed to a namesake", claimed[1].contactId === 1 && claimed[0].contactId === null, claimed);
  check("a first name alone never links", matchParticipants([{ name: "Maya" }], contacts)[0].contactId === null);
  const d = dedupePeople([{ name: "Maya Chen" }, { name: "maya chen", email: "Maya@Ledgerline.io" }, { name: "Maya Chen (Ledgerline)", email: "maya@ledgerline.io" }, { name: "" }]);
  check("the same person from two lists becomes one, keeping the email", d.length === 1 && d[0].email === "maya@ledgerline.io", d);
}

function notes() {
  console.log("action items and notes parsing");
  const monday = new Date("2026-10-05T15:00:00Z");
  check("due dates: ISO, tomorrow, weekday, end of week, in N weeks, end of month", resolveDue("2026-10-20", monday) === "2026-10-20" && resolveDue("tomorrow", monday) === "2026-10-06"
    && resolveDue("Friday", monday) === "2026-10-09" && resolveDue("by next Friday", monday) === "2026-10-09" && resolveDue("Monday", monday) === "2026-10-12"
    && resolveDue("end of week", monday) === "2026-10-09" && resolveDue("in 2 weeks", monday) === "2026-10-19" && resolveDue("end of month", monday) === "2026-10-31");
  check("vague or bad dates are no date", resolveDue("soon", monday) === null && resolveDue("2026-13-45", monday) === null && resolveDue("", monday) === null);
  const raw = {
    summary: "  Ledgerline walked through the Series A.  ",
    decisions: ["Move to diligence", "Move to diligence", "", 7],
    actionItems: [
      { text: "Send the data room link", owner: "me", due: "Friday" },
      { text: "Share Q3 numbers", owner: "Maya Chen", due: "2026-10-20" },
      { text: "Intro to legal", owner: "Ayan Bhardwaj", due: "soon" },
      { text: "", owner: "x", due: "" },
      "not an object",
    ],
    openQuestions: ["Who leads the round?"],
    speakers: [{ label: "S3A", name: "Maya Chen" }, { label: "A", name: "Tom" }, { label: "S4B", name: "" }],
    participants: [
      { name: "Maya Chen", email: "MAYA@LEDGERLINE.IO", company: "Ledgerline", title: "CFO", sentiment: 3, interest: "HIGH", signals: ["Asked for a term sheet by month end"], facts: ["Closing a $2M bridge in November"], topics: ["Pricing", "Security review"], knows: [], asks: ["timeline"] },
      { name: "You", email: "", company: "", title: "", sentiment: 0, interest: "high", signals: [], facts: [], topics: [], knows: [], asks: [] },
      { name: "Tom Baker", email: "not-an-email", company: "Acme", title: "", sentiment: "warm", interest: "keen", signals: [], facts: [], topics: [], knows: [], asks: [] },
    ],
    deals: [{ company: "Ledgerline", stage: "Diligence", round: "Series A", amount: "$8M", valuation: "", sector: "", nextStep: "Data room review", nextStepDue: "next Tuesday", quote: "we're raising eight million" }, { company: "" }],
    followUps: [{ to: "Maya Chen", email: "maya@ledgerline.io", subject: "Next steps", body: "Thanks Maya..." }, { to: "Tom", email: "", subject: "x", body: "" }],
  };
  const n = parseNotes(raw, { meetingDate: monday, selfName: "Ayan Bhardwaj" });
  check("the summary is trimmed and lists deduplicated", n.summary === "Ledgerline walked through the Series A." && eq(n.decisions, ["Move to diligence"]));
  check("action items keep text, owner and a resolved date", n.actionItems.length === 3 && n.actionItems[1].owner === "Maya Chen" && n.actionItems[1].due === "2026-10-20");
  check("an owner who is the person becomes You (by 'me' or by their name)", n.actionItems[0].owner === "You" && n.actionItems[0].mine && n.actionItems[2].owner === "You" && n.actionItems[2].mine);
  check("relative due dates resolve against the meeting date; vague ones keep their words", n.actionItems[0].due === "2026-10-09" && n.actionItems[2].due === null && n.actionItems[2].dueText === "soon");
  check("only chunk labels can be named, and only with a name", eq(n.speakers, [{ label: "S3A", name: "Maya Chen" }]));
  check("participants: the person is left out, emails checked and lowercased", n.participants.length === 2 && n.participants[0].email === "maya@ledgerline.io" && n.participants[1].email === "");
  check("sentiment is clamped, interest kept to its words, topics lowercased", n.participants[0].sentiment === 1 && n.participants[0].interest === "high" && n.participants[1].sentiment === 0 && n.participants[1].interest === "unclear" && n.participants[0].topics[0] === "pricing");
  check("deal terms need a company; their due date resolves", n.deals.length === 1 && n.deals[0].nextStepDue === "2026-10-06");
  check("follow-ups need a recipient and a body", n.followUps.length === 1 && n.followUps[0].to === "Maya Chen");
  const empty = parseNotes("garbage", { meetingDate: monday });
  check("an answer of the wrong shape gives empty notes, not an error", empty.summary === "" && empty.actionItems.length === 0 && empty.participants.length === 0);
  const body = entryBody({ startedAt: monday, durationSec: 1860 }, "Ledgerline Series A", n, n.participants[0]);
  check("a contact's timeline entry carries their signals, facts and the summary", body.startsWith("Ledgerline Series A · 2026-10-05 · 31 min") && body.includes("Asked for a term sheet") && body.includes("Closing a $2M bridge") && body.includes("Summary:"));
}

function diffing() {
  console.log("proposed deal changes");
  check("money: $8M, 12.5 million, 1.2bn, 800k, $3,000,000, plain numbers", parseMoney("$8M") === 8e6 && parseMoney("12.5 million") === 12.5e6 && parseMoney("1.2bn") === 1.2e9
    && parseMoney("800k") === 8e5 && parseMoney("$3,000,000") === 3e6 && parseMoney(4500000) === 4.5e6 && parseMoney("USD 2m") === 2e6);
  check("not money is null", parseMoney("eight million") === null && parseMoney("") === null && parseMoney(-5) === null);
  const deal: DealLite = { id: 9, name: "Ledgerline", stage: "screening", sector: "Fintech", round: "Seed", amountUsd: 2e6, valuationUsd: null, nextStep: "Send deck", nextStepDue: null };
  const p = proposeDealChanges(deal, { stage: "Diligence", round: "Series A", amount: "$8M", valuation: "40 million", nextStep: "send deck.", sector: "", quote: "we're raising eight million at forty" }, DEAL_STAGES);
  check("stated differences become changes, from and to", eq(p.changes.map((c) => [c.field, c.from, c.to]), [["round", "Seed", "Series A"], ["amountUsd", 2e6, 8e6], ["valuationUsd", null, 4e7]]), p.changes);
  check("the same next step said differently is no change; a blank is never a change", !p.changes.some((c) => c.field === "nextStep" || c.field === "sector"));
  check("a stage by its label proposes a move", eq(p.stage, { from: "screening", to: "diligence" }) && p.quote.startsWith("we're raising"));
  check("the deal's own stage, or one outside the pipeline, proposes nothing", proposeDealChanges(deal, { stage: "screening" }, DEAL_STAGES).stage === null && proposeDealChanges(deal, { stage: "Won" }, DEAL_STAGES).stage === null);
  check("an amount within 1% is the same amount", proposeDealChanges(deal, { amount: "2.01 million" }, DEAL_STAGES).changes.length === 0);
  check("dates: a new due date is a change, the same one is not", proposeDealChanges(deal, { nextStepDue: "2026-10-20" }, DEAL_STAGES).changes[0]?.to === "2026-10-20"
    && proposeDealChanges({ ...deal, nextStepDue: "2026-10-20T12:00:00.000Z" }, { nextStepDue: "2026-10-20" }, DEAL_STAGES).changes.length === 0 && isoDay("Oct 20") === null);
  const patch = dealPatch([...p.changes, { field: "nextStepDue", to: "2026-10-20" }, { field: "stage", to: "won" }, { field: "notes", to: "x" }]);
  check("accepting writes only those fields, typed", patch.round === "Series A" && patch.amountUsd === 8e6 && patch.valuationUsd === 4e7 && (patch.nextStepDue as Date).toISOString().startsWith("2026-10-20") && !("stage" in patch) && !("notes" in patch));
  const money = (n: number | null) => (n == null ? "" : `$${n / 1e6}M`);
  check("a proposal reads as from → to", describeChanges(p.changes, money) === "Round: Seed → Series A; Amount: $2M → $8M; Valuation: blank → $40M", describeChanges(p.changes, money));
}

function webhooks() {
  console.log("notetaker webhooks and transcripts");
  const secret = `whsec_${Buffer.from("a-test-signing-key-0123456789").toString("base64")}`;
  const body = JSON.stringify({ event: "bot.done", data: { data: { code: "done", sub_code: null, updated_at: "2026-10-05T16:00:00Z" }, bot: { id: "bot_123", metadata: { youbank_meeting: "42" } } } });
  const now = 1_790_000_000;
  const sign = (id: string, ts: number, b: string) => createHmac("sha256", Buffer.from("a-test-signing-key-0123456789")).update(`${id}.${ts}.${b}`).digest("base64");
  const headers = (h: Record<string, string>) => new Headers(h);
  const good = headers({ "svix-id": "msg_1", "svix-timestamp": String(now), "svix-signature": `v1,${sign("msg_1", now, body)}` });
  check("a correctly signed webhook verifies", verifySvix(secret, good, body, now));
  check("a changed body does not", !verifySvix(secret, good, body.replace("bot_123", "bot_999"), now));
  check("a stale or future timestamp does not", !verifySvix(secret, good, body, now + 301) && !verifySvix(secret, good, body, now - 301));
  check("the wrong secret does not", !verifySvix(`whsec_${Buffer.from("another-key").toString("base64")}`, good, body, now));
  check("several signatures: any one valid is enough", verifySvix(secret, headers({ "svix-id": "msg_1", "svix-timestamp": String(now), "svix-signature": `v1,AAAA v1,${sign("msg_1", now, body)}` }), body, now));
  check("Standard Webhooks header names work too", verifySvix(secret, headers({ "webhook-id": "msg_1", "webhook-timestamp": String(now), "webhook-signature": `v1,${sign("msg_1", now, body)}` }), body, now));
  check("missing headers or no secret refuse", !verifySvix(secret, headers({}), body, now) && !verifySvix("", good, body, now));

  check("current events parse", eq(parseRecallEvent(JSON.parse(body)), { botId: "bot_123", code: "done", event: "bot.done" }));
  check("older status_change events parse", eq(parseRecallEvent({ event: "bot.status_change", data: { bot_id: "bot_7", status: { code: "in_call_recording" } } }), { botId: "bot_7", code: "in_call_recording", event: "bot.status_change" }));
  check("an event without a bot is ignored", parseRecallEvent({ event: "bot.done", data: {} }) === null && parseRecallEvent(null) === null);
  check("statuses map to meeting states", recallStatus("joining_call") === "joining" && recallStatus("in_waiting_room") === "joining" && recallStatus("in_call_recording") === "live" && recallStatus("call_ended") === "processing" && recallStatus("done") === "processing" && recallStatus("fatal") === "failed");

  const transcript = [
    { participant: { id: 1, name: "Maya Chen", email: "Maya@Ledgerline.io" }, words: [{ text: "We're", start_timestamp: { relative: 3.1 }, end_timestamp: { relative: 3.4 } }, { text: "raising", start_timestamp: { relative: 3.4 }, end_timestamp: { relative: 3.9 } }, { text: "eight", start_timestamp: { relative: 3.9 }, end_timestamp: { relative: 4.2 } }, { text: "million", start_timestamp: { relative: 4.2 }, end_timestamp: { relative: 4.7 } }, { text: ".", start_timestamp: { relative: 4.7 }, end_timestamp: { relative: 4.8 } }] },
    { participant: { id: 2, name: "Ayan" }, words: [{ text: "Great", start_timestamp: { relative: 0.5 }, end_timestamp: { relative: 1 } }] },
    { participant: { id: 3, name: "Silent" }, words: [] },
  ];
  const segs = segmentsFromRecall(transcript);
  check("Recall's transcript becomes named segments in time order", segs.length === 2 && segs[0].speaker === "Ayan" && segs[1].text === "We're raising eight million." && segs[1].start === 3.1 && segs[1].end === 4.8, segs);
  check("participants come from the list and the transcript, once each (silent ones too)", eq(participantsFromRecall([{ name: "Maya Chen", email: "maya@ledgerline.io" }, { name: "Guest" }], transcript).map((p) => p.name), ["Maya Chen", "Guest", "Ayan", "Silent"]));
  const state = recallState({ id: "bot_1", status_changes: [{ code: "joining_call" }, { code: "in_call_recording" }, { code: "done" }], recordings: [{ media_shortcuts: { transcript: { status: { code: "done" }, data: { download_url: "https://example.test/t.json" } }, participant_events: { data: { participants_download_url: "https://example.test/p.json" } } } }] });
  check("a finished bot reports its transcript and participants", state.status === "processing" && state.transcriptUrl === "https://example.test/t.json" && state.participantsUrl === "https://example.test/p.json");
  const failed = recallState({ id: "bot_2", status_changes: [{ code: "fatal", sub_code: "meeting_not_found" }] });
  check("a failed bot says why", failed.status === "failed" && /meeting_not_found/.test(failed.error ?? ""));
}

function contextAndModel() {
  console.log("meeting context, settings and engines");
  check("window titles lose the app's name", cleanAppTitle("Q3 review with Ledgerline | Microsoft Teams") === "Q3 review with Ledgerline" && cleanAppTitle("Meet - Weekly pipeline - Google Chrome") === "Weekly pipeline" && cleanAppTitle("Meet – abc-defg-hij") === "" && cleanAppTitle("Zoom Meeting") === "" && cleanAppTitle("Huddle with Maya Chen") === "Maya Chen");
  const merged = mergeContexts([
    { source: "calendar", title: "Ledgerline Series A", people: [{ name: "Maya Chen", email: "maya@ledgerline.io" }], meetingUrl: "https://zoom.us/j/123" },
    { source: "app", title: "Zoom window", platform: "" },
    { source: "manual", contactIds: [3, 3, -1], dealIds: [9], people: [{ name: "maya chen" }] },
  ]);
  check("merged: the first title wins, people deduplicated, picks cleaned, platform from the link", merged.title === "Ledgerline Series A" && merged.people.length === 1 && eq(merged.contactIds, [3]) && merged.platform === "zoom" && eq(merged.sources, ["calendar", "app", "manual"]));
  const now = Date.parse("2026-10-05T15:00:00Z");
  const upcoming = [
    { id: "a", title: "Ledgerline", startsAt: "2026-10-05T15:02:00Z", endsAt: null, meetingUrl: "https://zoom.us/j/1", people: [] },
    { id: "b", title: "Board meeting", startsAt: "2026-10-05T15:01:00Z", endsAt: null, meetingUrl: "https://meet.google.com/abc-defg-hij", people: [] },
    { id: "c", title: "Later", startsAt: "2026-10-05T17:00:00Z", endsAt: null, meetingUrl: "https://zoom.us/j/2", people: [] },
    { id: "d", title: "No link", startsAt: "2026-10-05T15:01:00Z", endsAt: null, meetingUrl: "", people: [] },
    { id: "e", title: "Sent already", startsAt: "2026-10-05T15:01:00Z", endsAt: null, meetingUrl: "https://zoom.us/j/3", people: [] },
  ];
  const settings = { autoJoin: true, neverApps: [], neverKeywords: ["board"] };
  check("auto-join: soon, with a link, not refused, not sent; nothing when off", eq(autoJoinDue(upcoming, settings, new Set(["e"]), now).map((m) => m.id), ["a"]) && autoJoinDue(upcoming, { ...settings, autoJoin: false }, new Set(), now).length === 0);

  const s = normalizeSettings({ retentionDays: -4, neverApps: ["zoom", "skype", "zoom"], autoStartApps: ["teams"], neverKeywords: ["  HR ", "", 5], botName: "  \u0007Notes  ", noticeText: "" });
  check("settings come back in range", s.retentionDays === 0 && eq(s.neverApps, ["zoom"]) && eq(s.neverKeywords, ["HR"]) && s.botName === "Notes" && s.noticeText.length > 20 && s.autoNotes && !s.autoJoin);
  check("never-record by app or by word", refusedBy(s, "zoom", "") !== null && refusedBy(s, "teams", "HR sync") !== null && refusedBy(s, "teams", "Pipeline review") === null);
  check("meeting links: hosts we can join", isMeetingUrl("https://us02web.zoom.us/j/123") && isMeetingUrl("https://teams.microsoft.com/l/meetup-join/x") && isMeetingUrl("https://meet.google.com/abc-defg-hij") && !isMeetingUrl("http://zoom.us/j/1") && !isMeetingUrl("https://evil.example/zoom.us") && !isMeetingUrl("https://app.slack.com/huddle/x"));
  check("platform from a link", platformOfUrl("https://acme.webex.com/meet/x") === "webex" && platformOfUrl("https://zoom.us.evil.com/j/1") === null);
  check("durations read plainly", durationLabel(42) === "42 s" && durationLabel(600) === "10 min" && durationLabel(3900) === "1 h 05 min");

  const diarized = { task: "transcribe", duration: 30, text: "Hi there. Hello.", segments: [{ id: "seg_0", type: "transcript.text.segment", start: 0.2, end: 1.4, speaker: "A", text: " Hi there. " }, { id: "seg_1", type: "transcript.text.segment", start: 1.6, end: 2.4, speaker: "B", text: "Hello." }, { id: "seg_2", start: 3, end: 3, speaker: "A", text: "" }] };
  check("OpenAI diarized answers become labelled segments", eq(segmentsFromOpenAi(diarized, 30), [{ start: 0.2, end: 1.4, text: "Hi there.", speaker: "A" }, { start: 1.6, end: 2.4, text: "Hello.", speaker: "B" }]));
  check("a plain answer becomes one segment for the chunk", eq(segmentsFromOpenAi({ text: "Just text." }, 29.5), [{ start: 0, end: 29.5, text: "Just text." }]) && segmentsFromOpenAi({ text: "" }, 30).length === 0);
  check("the ML service's transcript parses", segmentsFromMl({ segments: [{ start: 1, end: 2, text: "Bonjour." }, { start: 2, end: 3 }] }).length === 1 && segmentsFromMl(null).length === 0);
  check("engines: OpenAI with a key, the ML service without, forced either way, none when nothing is set up",
    pickTranscriber({ OPENAI_API_KEY: "sk-test" })?.id === "openai" && pickTranscriber({ OPENAI_API_KEY: "sk-test" })?.diarizes === true
    && pickTranscriber({ EDGE_ML_URL: "https://ml.test", EDGE_ML_SECRET: "s" })?.id === "ml"
    && pickTranscriber({ OPENAI_API_KEY: "sk-test", EDGE_ML_URL: "https://ml.test", EDGE_ML_SECRET: "s", MEETINGS_TRANSCRIBE: "ml" })?.id === "ml"
    && pickTranscriber({ OPENAI_API_KEY: "sk-test", MEETINGS_TRANSCRIBE_MODEL: "gpt-4o-mini-transcribe" })?.diarizes === false
    && pickTranscriber({}) === null && pickTranscriber({ MEETINGS_TRANSCRIBE: "ml" }) === null);
}

function premium() {
  console.log("premium features");
  const ids = ["meetings.bot", "meetings.live", "meetings.notes"];
  check("all three are registered once", ids.every((id) => FEATURES.filter((f) => f.id === id).length === 1));
  check("each is metered with an honest cost", ids.every((id) => { const f = featureById(id); return !!f && f.metered && (f.costPerUseUsd ?? 0) > 0 && f.minPlan === "pro"; }));
  check("the bot costs most per use, live suggestions least", (featureById("meetings.bot")!.costPerUseUsd ?? 0) > (featureById("meetings.notes")!.costPerUseUsd ?? 0) && (featureById("meetings.notes")!.costPerUseUsd ?? 0) > (featureById("meetings.live")!.costPerUseUsd ?? 0));
  check("a few notes a month stay free", MEETINGS_FREE_NOTES > 0 && featureById("meetings.notes")!.description.includes(String(MEETINGS_FREE_NOTES)));
}

stitching();
matching();
notes();
diffing();
webhooks();
contextAndModel();
premium();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
