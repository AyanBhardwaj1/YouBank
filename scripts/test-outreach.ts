/** Rule checks for nurture, follow-ups, stale deals, funding signals and sequences: pnpm exec tsx scripts/test-outreach.ts */
import { DAY_MS, needsConsent, nextDueAfter, normalizeCompany, normalizeSteps } from "@/lib/crm/model";
import { followUpCandidates, matchFundingSignals, nurtureCandidates, pool, staleDeals, type ContactActivity, type ThreadActivity } from "@/lib/crm/scan";
import { parseLeadList, statsFor } from "@/lib/crm/campaigns";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};

const now = new Date("2026-09-26T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY_MS);

console.log("company names");
ok("legal suffix dropped", normalizeCompany("Ledgerline, Inc."), "ledgerline");
ok("case and punctuation", normalizeCompany("LEDGERLINE LLC"), "ledgerline");
ok("a different company stays different", normalizeCompany("Ledgerline Capital"), "ledgerline capital");
ok("ampersand", normalizeCompany("Smith & Co"), "smith and");

console.log("consent guard");
ok("EU and Canadian domains need consent", [needsConsent("anna@firma.de"), needsConsent("luc@startup.fr"), needsConsent("sam@co.ca")], [true, true, true]);
ok("UK, US and generic domains do not", [needsConsent("jo@firm.co.uk"), needsConsent("jo@acme.com"), needsConsent("jo@acme.io")], [false, false, false]);

console.log("sequences");
ok("first step pinned to day 0, sorted", normalizeSteps([{ dayOffset: 9, instruction: "b" }, { dayOffset: 3, instruction: "a" }]).map((s) => s.dayOffset), [0, 9]);
ok("blank steps dropped, defaults when empty", normalizeSteps([{ dayOffset: 0, instruction: "  " }]).length, 3);
ok("not an array falls back to defaults", normalizeSteps(null).length, 3);
const steps = [{ dayOffset: 0, instruction: "a" }, { dayOffset: 4, instruction: "b" }, { dayOffset: 10, instruction: "c" }];
ok("next step due after the gap", nextDueAfter(steps, 0, now)?.toISOString(), new Date(now.getTime() + 4 * DAY_MS).toISOString());
ok("gap measured between steps, not from day 0", nextDueAfter(steps, 1, now)?.toISOString(), new Date(now.getTime() + 6 * DAY_MS).toISOString());
ok("sequence over after the last step", nextDueAfter(steps, 2, now), null);

console.log("follow-ups");
const t = (o: Partial<ThreadActivity>): ThreadActivity => ({
  threadId: 1, subject: "s", category: "founder_pitch", dealId: null, contactId: 1, lastDirection: "outbound",
  lastMessageId: 1, lastAt: daysAgo(6), inCampaign: false, hasPendingDraft: false, ...o,
});
ok("waiting past the window", followUpCandidates([t({})], now, 5).map((x) => x.waited), [6]);
ok("not yet", followUpCandidates([t({ lastAt: daysAgo(3) })], now, 5).length, 0);
ok("they wrote last: that is a reply, not a follow-up", followUpCandidates([t({ lastDirection: "inbound" })], now, 5).length, 0);
ok("older than 30 days is nurture's job", followUpCandidates([t({ lastAt: daysAgo(40) })], now, 5).length, 0);
ok("newsletters are ignored", followUpCandidates([t({ category: "newsletter" })], now, 5).length, 0);
ok("any thread on a deal counts", followUpCandidates([t({ category: "other", dealId: 9 })], now, 5).length, 1);
ok("campaign threads run their own sequence", followUpCandidates([t({ inCampaign: true })], now, 5).length, 0);
ok("a draft already waiting", followUpCandidates([t({ hasPendingDraft: true })], now, 5).length, 0);

console.log("stale deals");
const d = { dealId: 1, name: "Acme", stage: "diligence", contactId: 1, updatedAt: daysAgo(30), lastEmailAt: null as Date | null };
ok("quiet diligence deal flagged", staleDeals([d], now, 21).map((x) => x.quiet), [30]);
ok("a recent email keeps it alive", staleDeals([{ ...d, lastEmailAt: daysAgo(2) }], now, 21).length, 0);
ok("inbox is not a live deal yet", staleDeals([{ ...d, stage: "inbox" }], now, 21).length, 0);
ok("closed stages ignored", staleDeals([{ ...d, stage: "passed" }], now, 21).length, 0);

console.log("nurture");
const c = (o: Partial<ContactActivity>): ContactActivity => ({
  contactId: 1, kind: "founder", optedOut: false, lastSentAt: daysAgo(200), lastContactAt: daysAgo(190), exchanges: 4, busy: false, lastEvaluatedAt: null, ...o,
});
const rule = { cadenceDays: 180, anchor: "last_sent", kinds: ["founder"], minExchanges: 3 };
ok("due on last sent", nurtureCandidates([c({})], rule, now).map((x) => x.quiet), [200]);
ok("anchor on last contact uses either direction", nurtureCandidates([c({ lastContactAt: daysAgo(100) })], { ...rule, anchor: "last_contact" }, now).length, 0);
ok("opted out is never considered", nurtureCandidates([c({ optedOut: true })], rule, now).length, 0);
ok("already has outreach in flight", nurtureCandidates([c({ busy: true })], rule, now).length, 0);
ok("too few exchanges", nurtureCandidates([c({ exchanges: 2 })], rule, now).length, 0);
ok("wrong kind", nurtureCandidates([c({ kind: "banker" })], rule, now).length, 0);
ok("empty kinds means everyone", nurtureCandidates([c({ kind: "banker" })], { ...rule, kinds: [] }, now).length, 1);
ok("a recent skip is not re-asked", nurtureCandidates([c({ lastEvaluatedAt: daysAgo(10) })], rule, now).length, 0);
ok("an old skip is asked again after the cadence", nurtureCandidates([c({ lastEvaluatedAt: daysAgo(181) })], rule, now).length, 1);
ok("never emailed is never due", nurtureCandidates([c({ lastSentAt: null, lastContactAt: null })], rule, now).length, 0);
ok("most engaged first", nurtureCandidates([c({ contactId: 1, exchanges: 4 }), c({ contactId: 2, exchanges: 9 })], rule, now).map((x) => x.contactId), [2, 1]);

console.log("funding signals");
const filing = { sourceId: "0001-26-1", name: "Ledgerline, Inc.", officers: ["Maya Ruiz", "Tom Lee"], raised: "$6.00M", raisedUsd: 6e6, filedOn: "2026-09-20", url: "u", industry: "Other Technology" };
const e = { contactId: 1, dealId: null, name: "Maya Ruiz", company: "Ledgerline", since: null };
ok("officer match", matchFundingSignals([e], [filing]).map((m) => m.strength), ["officer"]);
ok("distinctive name alone", matchFundingSignals([{ ...e, name: "Someone Else" }], [filing]).map((m) => m.strength), ["name"]);
ok("generic short name needs an officer match", matchFundingSignals([{ ...e, name: "X", company: "Arc" }], [{ ...filing, name: "ARC LLC" }]).length, 0);
ok("short name with officer match is fine", matchFundingSignals([{ ...e, company: "Arc" }], [{ ...filing, name: "ARC LLC" }]).length, 1);
ok("similar but different company", matchFundingSignals([{ ...e, company: "Ledgerline Capital" }], [filing]).length, 0);
ok("filings before the relationship are skipped", matchFundingSignals([{ ...e, since: new Date("2026-09-22") }], [filing]).length, 0);
ok("no company, no match", matchFundingSignals([{ ...e, company: "" }], [filing]).length, 0);

console.log("lead lists");
ok("email, name, company, notes", parseLeadList("maya@ledgerline.io, Maya Ruiz, Ledgerline, met at dinner"),
  [{ email: "maya@ledgerline.io", name: "Maya Ruiz", company: "Ledgerline", notes: "met at dinner" }]);
ok("address anywhere in the line", parseLeadList("Jo Park\tjo@acme.dev\tAcme"), [{ email: "jo@acme.dev", name: "Jo Park", company: "Acme", notes: "" }]);
ok("lines without an address dropped", parseLeadList("just a name\n\nbob@y.io"), [{ email: "bob@y.io", name: "", company: "", notes: "" }]);

console.log("campaign funnel");
const lead = (o: Record<string, unknown>) => ({
  id: 1, campaignId: 1, userId: "u", contactId: null, startupId: null, email: "", name: "", company: "", notes: "", status: "sourced",
  fit: null, fitReason: "", step: 0, nextDueAt: null, lastSentAt: null, repliedAt: null, repliedAtStep: null, threadId: null, createdAt: daysAgo(20), ...o,
}) as Parameters<typeof statsFor>[1][number];
const camp = { steps } as Parameters<typeof statsFor>[0];
const stats = statsFor(camp, [
  lead({ id: 1, status: "replied", contactId: 11, lastSentAt: daysAgo(5), repliedAt: daysAgo(3), repliedAtStep: 1 }),
  lead({ id: 2, status: "active", lastSentAt: daysAgo(2), email: "a@b.co" }),
  lead({ id: 3, status: "qualified" }),
  lead({ id: 4, status: "disqualified" }),
], [{ campaignLeadId: 1, status: "sent" }, { campaignLeadId: 1, status: "sent" }, { campaignLeadId: 2, status: "sent" }, { campaignLeadId: 3, status: "pending" }],
[{ contactId: 11, createdAt: daysAgo(1) }, { contactId: 99, createdAt: daysAgo(1) }]);
ok("contacted and replied", [stats.contacted, stats.replied], [2, 1]);
ok("reply rate over contacted", stats.replyRate, 0.5);
ok("replies attributed to the step that earned them", stats.repliesByStep, [0, 1, 0]);
ok("emails sent vs waiting", [stats.emailsSent, stats.pendingDrafts], [3, 1]);
ok("only deals from this campaign's contacts", stats.dealsOpened, 1);
ok("qualified with no address needs one", stats.needsEmail, 1);

console.log("pool");
void (async () => {
  const r = await pool([1, 2, 3, 4], 2, Date.now() + 10_000, async (n) => { if (n === 3) throw new Error("boom"); return n * 2; });
  ok("finishes the rest when one fails", [r.done.sort(), r.errors], [[2, 4, 8], ["boom"]]);
  const late = await pool([1, 2, 3], 2, Date.now() - 1, async (n) => n);
  ok("starts nothing past the deadline", [late.done.length, late.unstarted], [0, 3]);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
