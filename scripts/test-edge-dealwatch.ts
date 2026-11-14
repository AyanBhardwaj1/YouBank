/**
 * Deal watch: which deals count as pending, which side a signal touches, and the effect wording (honest
 * hypotheses, never promises), plus when a deal-watch card alerts at once.
 *   pnpm exec tsx scripts/test-edge-dealwatch.ts
 */
import { dealEffects, describeImpact, IMPACT_KINDS, pendingFrom, sidesOf, stageOf, type PendingDeal } from "@/lib/edge/dealimpact";
import { isBig } from "@/lib/edge/notify";
import { noveltyOf } from "@/lib/edge/feed";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}`, detail ?? ""); }
};

const now = Date.parse("2026-11-14T12:00:00Z");
const news = [
  { id: 1, kind: "acquisition", acquirer: "ONEOK", acquirerTicker: "OKE", target: "Targa Resources", targetTicker: "TRGP", valueUsd: 30e9, consideration: "stock", announcedAt: "2026-09-01T00:00:00Z", sourceUrl: "https://example.com/a", headline: "ONEOK agrees to buy Targa in $30 billion stock deal" },
  { id: 2, kind: "acquisition", acquirer: "Chevron", acquirerTicker: "CVX", target: "Hess Midstream", targetTicker: "HESM", valueUsd: null, consideration: "", announcedAt: "2026-11-01T00:00:00Z", sourceUrl: "https://example.com/b", headline: "Chevron in talks to buy Hess Midstream, people familiar say" },
  { id: 3, kind: "acquisition", acquirer: "Old Co", acquirerTicker: "OLD", target: "Older Co", targetTicker: "OLDR", valueUsd: null, consideration: "cash", announcedAt: "2025-10-01T00:00:00Z", sourceUrl: "", headline: "Old deal" },
  { id: 4, kind: "acquisition", acquirer: "Done Co", acquirerTicker: "DONE", target: "Closed Target", targetTicker: "CLSD", valueUsd: null, consideration: "cash", announcedAt: "2026-08-01T00:00:00Z", sourceUrl: "", headline: "Done Co buys Closed Target" },
  { id: 5, kind: "ipo", acquirer: "", acquirerTicker: "", target: "New Co", targetTicker: "NEWC", valueUsd: null, consideration: "", announcedAt: "2026-11-01T00:00:00Z", sourceUrl: "", headline: "New Co prices IPO" },
  { id: 6, kind: "merger", acquirer: "ONEOK", acquirerTicker: "OKE", target: "Targa Resources", targetTicker: "TRGP", valueUsd: 30e9, consideration: "stock", announcedAt: "2026-09-02T00:00:00Z", sourceUrl: "", headline: "ONEOK and Targa: more detail" },
];
const deals = pendingFrom(news, new Set(["CLSD"]), [{ ticker: "WES", name: "Western Midstream", p: 0.31, at: "2026-11-10T00:00:00Z" }, { ticker: "TRGP", p: 0.5, at: "2026-11-10T00:00:00Z" }, { ticker: "LOW", p: 0.1, at: "2026-11-10T00:00:00Z" }], now);

console.log("pending deals");
ok("takeovers of the last nine months are pending", deals.some((d) => d.targetTicker === "TRGP" && d.stage === "announced"));
ok("talks reported by people familiar are a reported stage", deals.find((d) => d.targetTicker === "HESM")?.stage === "reported");
ok("a deal more than nine months old is left out", !deals.some((d) => d.targetTicker === "OLDR"));
ok("a target the deal database shows closed is left out", !deals.some((d) => d.targetTicker === "CLSD"));
ok("an IPO is not a takeover", !deals.some((d) => d.targetTicker === "NEWC"));
ok("the same pair twice counts once", deals.filter((d) => d.targetTicker === "TRGP").length === 1);
ok("Deal Radar's likely targets count, labelled as the model's", deals.find((d) => d.targetTicker === "WES")?.stage === "model");
ok("but not below 25% odds, nor one already in a deal", !deals.some((d) => d.targetTicker === "LOW") && deals.filter((d) => d.targetTicker === "TRGP").length === 1);
ok("headline stages", stageOf("Company A explores sale") === "reported" && stageOf("A to acquire B for $5 billion") === "announced");

console.log("sides");
const trgp = deals.find((d) => d.targetTicker === "TRGP")!;
ok("a signal at the target", sidesOf(trgp, ["TRGP"]).map((s) => s.side).join() === "target");
ok("at the acquirer", sidesOf(trgp, ["OKE", "XOM"]).map((s) => s.side).join() === "acquirer");
ok("at both (a shared plant)", sidesOf(trgp, ["OKE", "TRGP"]).length === 2);
ok("at neither", sidesOf(trgp, ["XOM"]).length === 0);

console.log("effects, worded as hypotheses");
const op = dealEffects("operations", "target", trgp, { magnitude: 0.7 });
ok("flaring at the target of an announced deal is high", op.severity === "high");
ok("it covers the spread, the price and terms, and closing", op.effects.some((e) => e.startsWith("Spread")) && op.effects.some((e) => e.startsWith("Price and terms")) && op.effects.some((e) => e.startsWith("Closing")));
ok("and is honest that a walk-away rarely works", op.effects.some((e) => e.includes("almost never succeeds")));
ok("a small signal is only medium", dealEffects("operations", "target", trgp, { magnitude: 0.3 }).severity === "medium");
ok("environmental problems mention the regulator's remedy", dealEffects("environmental", "target", trgp, { magnitude: 0.7 }).effects.some((e) => e.startsWith("Regulators")));
ok("growth at the target can narrow the spread and draw antitrust attention", (() => { const g = dealEffects("growth", "target", trgp, { magnitude: 0.5 }).effects.join(" "); return g.includes("narrow the spread") && g.includes("Antitrust"); })());
ok("a stock deal's acquirer: value to target holders", dealEffects("operations", "acquirer", trgp, { magnitude: 0.8 }).effects[0].startsWith("Value to target holders"));
ok("a cash deal's acquirer: financing", dealEffects("operations", "acquirer", { ...trgp, consideration: "cash", kind: "acquisition" }, { magnitude: 0.8 }).effects[0].startsWith("Financing"));
ok("the acquirer side is never high", dealEffects("product", "acquirer", trgp, { magnitude: 1 }).severity !== "high");
ok("a reported deal is never high", dealEffects("operations", "target", deals.find((d) => d.stage === "reported")!, { magnitude: 1 }).severity !== "high");
const model = dealEffects("operations", "target", deals.find((d) => d.stage === "model")!, { magnitude: 1 });
ok("a model's target is low and says it is a model", model.severity === "low" && model.effects[0].includes("model's estimate"));
ok("market readings are low", dealEffects("market", "target", trgp, { magnitude: 1 }).severity === "low");
const all = (["operations", "environmental", "regulatory", "product", "growth", "market", "disclosure"] as const).flatMap((c) => (["target", "acquirer"] as const).flatMap((s) => dealEffects(c, s, trgp, { magnitude: 0.9 }).effects));
ok("no wording promises an outcome (no 'will', no 'guaranteed')", !all.some((e) => /\bwill\b|guarantee/i.test(e)), all.filter((e) => /\bwill\b|guarantee/i.test(e)));
ok("no exclamation marks", !all.some((e) => e.includes("!")));
ok("every signal kind has a category", Object.values(IMPACT_KINDS).every(Boolean) && IMPACT_KINDS.flaring === "operations" && IMPACT_KINDS.fda_recall === "product");

console.log("the card");
const w = describeImpact(trgp as PendingDeal, "target", "TRGP", { kind: "flaring", title: "Flaring at Targa's plant on 5 of the last 7 days" }, op.effects);
ok("the title names the signal, the side and the parties", w.title === "Deal watch: Flaring at the target (TRGP) in ONEOK and Targa Resources", w.title);
ok("the summary carries the deal, its stage, the signal and the hypotheses", w.summary.includes("announced 2026-09-01") && w.summary.includes("Flaring at Targa's plant") && w.summary.includes("as hypotheses"));
ok("a high deal-watch card alerts at once; a medium one waits for the digest", isBig({ kind: "deal_impact", confidence: 0.8, magnitude: 0.8, visual: { severity: "high" } }) && !isBig({ kind: "deal_impact", confidence: 0.8, magnitude: 0.8, visual: { severity: "medium" } }));
ok("deal-watch cards rank as rarely in the news", noveltyOf("deal_impact", 0) === 0.8 && noveltyOf("crop_vigour", 0) === 0.85 && noveltyOf("vehicle_recall", 0) === 0.55);
ok("new kinds alert on their own rules", isBig({ kind: "reactor_outage", confidence: 0.9, magnitude: 0.7, visual: {} }) && !isBig({ kind: "reactor_outage", confidence: 0.9, magnitude: 0.4, visual: {} }) && isBig({ kind: "crop_vigour", confidence: 0.8, magnitude: 0.6, visual: { metric: { z: -3.4 } } }) && !isBig({ kind: "crop_vigour", confidence: 0.8, magnitude: 0.6, visual: { metric: { z: -2.4 } } }));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
