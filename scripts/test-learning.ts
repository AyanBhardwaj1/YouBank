/** Checks for the adaptive engine's mathematics: pnpm exec tsx scripts/test-learning.ts */
import {
  auditRate, availableAngles, bucketOf, criticalChange, decayFactor, eStep, formatVariant, hourSlotOf, parseVariant, replyArrived,
  scopeOfBucket, scoreSend, slotWindow, trustState, unapprovedDetails, TRUST,
} from "@/lib/crm/engine";
import {
  betaCdf, betaQuantile, editRatio, interval, jaccard, logGamma, mean, populationPrior, probabilityBest,
  sampleBeta, seededRng, thompson,
} from "@/lib/crm/learning-math";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const near = (label: string, got: number, want: number, tol: number) => ok(label, Math.abs(got - want) <= tol ? "within tolerance" : got, "within tolerance");

console.log("special functions");
near("ln Γ(5) = ln 24", logGamma(5), Math.log(24), 1e-12);
near("ln Γ(0.5) = ln √π", logGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-12);
near("Beta(1,1) is uniform", betaCdf(0.37, 1, 1), 0.37, 1e-12);
near("Beta(2,3) CDF at 0.3 matches the closed form", betaCdf(0.3, 2, 3), 6 * 0.09 - 8 * 0.027 + 3 * 0.0081, 1e-10);
// Reference value by Simpson integration of the density (200,000 panels): 0.0100952083800478.
near("Beta(50,5) CDF, far tail", betaCdf(0.8, 50, 5), 0.0100952083800478, 1e-12);
near("median of a symmetric Beta", betaQuantile(0.5, 5, 5), 0.5, 1e-9);
near("quantile inverts the CDF", betaCdf(betaQuantile(0.05, 7, 3), 7, 3), 0.05, 1e-9);
const [lo, hi] = interval({ alpha: 12, beta: 2 });
ok("90% interval brackets the mean", lo < mean({ alpha: 12, beta: 2 }) && mean({ alpha: 12, beta: 2 }) < hi, true);

console.log("sampling");
const rng = seededRng(7);
let s = 0;
for (let i = 0; i < 20000; i++) s += sampleBeta(3, 7, rng);
near("Beta(3,7) draws average 0.3", s / 20000, 0.3, 0.01);
let small = 0;
for (let i = 0; i < 20000; i++) small += sampleBeta(0.5, 0.5, rng);
near("shape below one still sampled correctly", small / 20000, 0.5, 0.01);
ok("seeded draws repeat", [seededRng(1)(), seededRng(1)()], [seededRng(1)(), seededRng(1)()]);

console.log("Thompson sampling");
const arms = { strong: { alpha: 90, beta: 10 }, weak: { alpha: 10, beta: 90 } };
ok("plays the clearly better arm", thompson(arms, seededRng(3)).arm, "strong");
near("probability best, clear case", probabilityBest(arms, 2000, seededRng(4)).strong, 1, 0.001);
const unsure = { a: { alpha: 2, beta: 2 }, b: { alpha: 2, beta: 2 } };
near("equal arms split evenly", probabilityBest(unsure, 4000, seededRng(5)).a, 0.5, 0.04);
// A simulated campaign: true reply rates 12% vs 4%. Thompson should concentrate on the better angle.
const truth = { good: 0.12, poor: 0.04 };
const post = { good: { alpha: 1, beta: 1 }, poor: { alpha: 1, beta: 1 } };
const sim = seededRng(11);
let goodPulls = 0;
for (let t = 0; t < 1500; t++) {
  const { arm } = thompson(post, sim);
  if (arm === "good") goodPulls++;
  const reply = sim() < truth[arm];
  post[arm] = { alpha: post[arm].alpha + (reply ? 1 : 0), beta: post[arm].beta + (reply ? 0 : 1) };
}
ok("learns to favour the better angle (over 80% of 1,500 sends)", goodPulls / 1500 > 0.8, true);

console.log("empirical-Bayes priors");
ok("centred on the population rate", populationPrior(0.2, 4), { alpha: 1 + 4 * 0.2, beta: 1 + 4 * 0.8 });
ok("no population data: flat prior", populationPrior(null), { alpha: 1, beta: 1 });
near("prior mean sits near the crowd's rate", mean(populationPrior(0.9, 20)), 0.9, 0.05);

console.log("edits");
ok("sent as drafted", editRatio("Hi Maya, Tuesday works.", "Hi Maya,  Tuesday works."), 0);
ok("one word changed of four", editRatio("a b c d", "a b c e"), 0.25);
ok("rewritten", editRatio("Tuesday works for me", "Sorry, we have to pass on this one"), 1);
ok("the signature is not an edit", editRatio("Thanks.", "Thanks.\n\nAyan\nLedgerline", "Ayan\nLedgerline"), 0);
ok("near-duplicate lessons", jaccard("Keep replies under 80 words", "keep replies short, under 80 words") > 0.5, true);
ok("different lessons", jaccard("Never mention pricing in a first reply", "Sign off with just a first name") < 0.2, true);

console.log("earned autonomy: strata and labels");
ok("replies are stratified by audience and what they are about", [bucketOf({ kind: "reply", meta: { audience: "internal", category: "colleague" }, confidence: "high" }), bucketOf({ kind: "reply", meta: { category: "prospect" }, confidence: "" })], ["reply:internal:colleague", "reply:external:prospect"]);
ok("the model's own confidence is not a stratum", bucketOf({ kind: "reply", meta: { category: "prospect" }, confidence: "high" }) === bucketOf({ kind: "reply", meta: { category: "prospect" }, confidence: "low" }), true);
ok("campaign first touches and follow-ups are separate", [bucketOf({ kind: "campaign", meta: { step: 0 }, confidence: "" }), bucketOf({ kind: "campaign", meta: { step: 2 }, confidence: "" })], ["campaign:first", "campaign:follow"]);
ok("strata map to their autonomy setting", ["reply:internal:colleague", "reply:external:prospect", "campaign:first", "follow_up", "compose"].map(scopeOfBucket), ["internal", "external", "campaigns", "followUps", null]);
ok("sent unchanged is good", scoreSend(0.02), { outcome: "unchanged", good: true });
ok("a light edit is bad for certification", scoreSend(0.1), { outcome: "edited", good: false });
ok("a rewrite is bad", scoreSend(0.6), { outcome: "rewritten", good: false });
ok("a changed number is bad even when little else changed", scoreSend(0.02, true), { outcome: "critical", good: false });
ok("critical fields: a price edited", criticalChange("It is $4,000 a month.", "It is $3,500 a month."), true);
ok("critical fields: a day edited", criticalChange("Tuesday works.", "Thursday works."), true);
ok("critical fields: a link added", criticalChange("Book a time.", "Book a time: https://cal.com/ayan."), true);
ok("critical fields: wording only", criticalChange("Thanks Dana, Tuesday at 2pm works.", "Thanks, Dana. Tuesday at 2pm works!"), false);

console.log("earned autonomy: certification and demotion");
const counts = (good: number, bad: number, extra: { eprocess?: number; cancelStreak?: number } = {}) => ({ good, bad, observations: good + bad, ...extra });
ok("new: learning", trustState(counts(1, 0)).state, "learning");
// Flat prior: 90% confident the bad rate is at most 10% needs 1 − 0.9^(n+1) ≥ 0.9, i.e. 21 clean labels.
ok("20 of 20 good: not yet certified", trustState(counts(20, 0)).state, "learning");
ok("21 of 21 good: certified", trustState(counts(21, 0)).state, "trusted");
ok("certified bad rate is stated", trustState(counts(21, 0)).certifiedBadRate <= TRUST.certifyBadRate, true);
// Beta(41,3): 10% quantile ≈ 0.88, short of 0.90. Beta(96,6) (5 bad in 100): ≈ 0.91, certified.
ok("40 good, 2 bad: too few decisions to certify yet", trustState(counts(40, 2)).state, "learning");
ok("95 good, 5 bad: certified", trustState(counts(95, 5)).state, "trusted");
ok("80 good, 20 bad: not certified", trustState(counts(80, 20)).state, "learning");
ok("mostly edited: probation", trustState(counts(1, 3)).state, "probation");
ok("two bad labels are not enough for probation", trustState(counts(0, 2)).state, "learning");
ok("three cancelled sends in a row: probation", trustState(counts(30, 0, { cancelStreak: 3 })).state, "probation");
// Against a 10% bad rate: E = 2^bad × (0.8/0.9)^good. 10 bad in 40 ≈ 29.9 (demote); 9 in 40 ≈ 13.3 (keep).
let e = 1;
for (let i = 0; i < 40; i++) e = eStep(e, i < 10);
near("e-process value, 10 bad in 40", e, Math.pow(2, 10) * Math.pow(0.8 / 0.9, 30), 1e-9);
ok("e-process: 10 bad in 40 crosses 20 and demotes", [e >= 20, trustState(counts(30, 10, { eprocess: e })).state], [true, "probation"]);
let e9 = 1;
for (let i = 0; i < 40; i++) e9 = eStep(e9, i < 9);
ok("e-process: 9 bad in 40 stays below 20", e9 < 20, true);
near("half-life: a 90-day-old label counts half", decayFactor(90), 0.5, 1e-12);
ok("spot checks: 1 in 5 until 60 labels, then 1 in 20", [auditRate(10), auditRate(60)], [0.2, 0.05]);

console.log("outreach");
near("delay model: half of replies within a day", replyArrived(24), 1 - Math.exp(-24 / 36), 1e-12);
ok("delay model: a fresh send is barely a failure yet", replyArrived(1) < 0.05, true);
ok("'why now' only with a fresh Form D", [availableAngles(null).includes("why_now"), availableAngles({ listedIn: "formd", listedOn: new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10) }).includes("why_now"), availableAngles({ listedIn: "formd", listedOn: "2025-01-01" }).includes("why_now")], [false, true, false]);
const w = { tz: "America/New_York", start: 9, end: 17, weekdays: true };
ok("slot narrows the sending hours", slotWindow(w, "morning"), { ...w, start: 9, end: 11 });
ok("slot outside the hours keeps the hours", slotWindow({ ...w, start: 15, end: 17 }, "morning"), { ...w, start: 15, end: 17 });
ok("send slot from the local clock", [hourSlotOf(new Date("2026-09-28T13:30:00Z"), w.tz), hourSlotOf(new Date("2026-09-28T16:00:00Z"), w.tz), hourSlotOf(new Date("2026-09-28T19:00:00Z"), w.tz)], ["morning", "midday", "afternoon"]);
ok("variants round-trip with propensity", parseVariant(formatVariant({ angle: "question", hour: "midday", p: "0.412" })), { angle: "question", hour: "midday", p: "0.412" });

console.log("the security veto");
ok("a link from an inbound email is caught", unapprovedDetails("Pay here: https://evil.example/pay", "Our site is https://ledgerline.io"), ["https://evil.example/pay"]);
ok("the person's own link is fine", unapprovedDetails("Book at https://cal.com/ayan.", "Booking link: https://cal.com/ayan"), []);
ok("a new email address is caught", unapprovedDetails("Send it to billing@attacker.io", ""), ["billing@attacker.io"]);
ok("an account-like number is caught", unapprovedDetails("Wire to 123456789012", ""), ["123456789012"]);
ok("ordinary text passes", unapprovedDetails("Tuesday at 2pm works; I will send an invite.", ""), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
