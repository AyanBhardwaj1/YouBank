/**
 * Deal watch: when a signal touches a company in a pending or reported deal, say so, with the deal, the
 * side (acquirer or target), what the signal could plausibly do to the deal (the spread, the price, the
 * closing, a regulator's remedy) and the evidence. Pending deals are the Newsroom's takeovers of the last
 * nine months whose target the deal database does not show as completed or terminated; companies the
 * Deal Radar rates as likely targets count too, labelled as a model's estimate. The effects are
 * hypotheses from how deals usually respond, worded as such: never a prediction or advice.
 */
import { and, desc, gte, inArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { logError } from "@/lib/errors";
import { memo } from "@/lib/memo";
import { notifyWatchers } from "./notify";
import { record, trailFor } from "./provenance";

export const DEAL_IMPACT_VERSION = "deal watch v1";
const DAY = 86_400_000;
const TAKEOVERS = ["acquisition", "merger", "take_private", "tender"];

export type DealStage = "announced" | "reported" | "model";
export type PendingDeal = {
  key: string; stage: DealStage; kind: string; acquirer: string; acquirerTicker: string; target: string; targetTicker: string;
  announcedAt: string; valueUsd: number | null; consideration: string; headline: string; url: string; p?: number;
};
export type Side = "acquirer" | "target";
export type Category = "operations" | "environmental" | "regulatory" | "product" | "growth" | "market" | "disclosure";

/** Which signals bear on a deal, and how. */
export const IMPACT_KINDS: Record<string, Category> = {
  flaring: "operations", radar_change: "growth", ground_change: "growth", permits: "growth", methane_plume: "environmental",
  reactor_outage: "operations", fda_recall: "product", vehicle_recall: "product", crop_vigour: "market", water_extent: "market",
  vessel_traffic: "market", filing_change: "disclosure", graph_flag: "regulatory", layoff_notice: "operations", contract_award: "growth",
};

/** Headlines that report talks rather than a signed deal. Pure. */
export const REPORTED = /\b(in talks|talks to|explor(?:es|ing)|weigh(?:s|ing)|consider(?:s|ing)|approach(?:es|ed)?|nears?|said to|people familiar|sources say|rumou?r|could|may|bid for|eyes)\b/i;
export const stageOf = (headline: string): DealStage => (REPORTED.test(headline) ? "reported" : "announced");

type NewsDeal = { id: number; kind: string; acquirer: string; acquirerTicker: string; target: string; targetTicker: string; valueUsd: number | null; consideration: string; announcedAt: Date | string; sourceUrl: string; headline: string };
type OddsCard = { ticker: string; name?: string; p: number; at: string };

/** Pending deals from the Newsroom's takeovers (minus targets known to have closed or failed) and the Deal Radar's likely targets. Pure. */
export function pendingFrom(news: NewsDeal[], finished: Set<string>, odds: OddsCard[], now: number): PendingDeal[] {
  const out: PendingDeal[] = [];
  const seen = new Set<string>();
  for (const d of news) {
    const at = new Date(d.announcedAt).getTime();
    if (!TAKEOVERS.includes(d.kind) || now - at > 270 * DAY) continue;
    if (!d.acquirerTicker && !d.targetTicker) continue;
    if (d.targetTicker && finished.has(d.targetTicker)) continue;
    const pair = `${d.acquirerTicker}>${d.targetTicker}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    out.push({ key: `news:${d.id}`, stage: stageOf(d.headline), kind: d.kind, acquirer: d.acquirer, acquirerTicker: d.acquirerTicker, target: d.target, targetTicker: d.targetTicker, announcedAt: new Date(at).toISOString().slice(0, 10), valueUsd: d.valueUsd, consideration: d.consideration, headline: d.headline, url: d.sourceUrl });
  }
  for (const o of odds) {
    if (o.p < 0.25 || out.some((d) => d.targetTicker === o.ticker)) continue;
    out.push({ key: `radar:${o.ticker}`, stage: "model", kind: "acquisition", acquirer: "", acquirerTicker: "", target: o.name || o.ticker, targetTicker: o.ticker, announcedAt: o.at.slice(0, 10), valueUsd: null, consideration: "", headline: `Deal Radar: ${Math.round(o.p * 100)}% twelve-month odds that ${o.name || o.ticker} is acquired`, url: `/app/edge?view=radar&ticker=${o.ticker}`, p: o.p });
  }
  return out;
}

/** The sides of a deal a signal's tickers touch. Pure. */
export function sidesOf(deal: Pick<PendingDeal, "acquirerTicker" | "targetTicker">, tickers: string[]): { side: Side; ticker: string }[] {
  const out: { side: Side; ticker: string }[] = [];
  if (deal.targetTicker && tickers.includes(deal.targetTicker)) out.push({ side: "target", ticker: deal.targetTicker });
  if (deal.acquirerTicker && tickers.includes(deal.acquirerTicker)) out.push({ side: "acquirer", ticker: deal.acquirerTicker });
  return out;
}

/**
 * What a signal could plausibly do to a deal, as hypotheses in plain words, and how much it matters
 * (high only for a hard signal at the target of an announced deal). Pure.
 */
export function dealEffects(category: Category, side: Side, deal: Pick<PendingDeal, "stage" | "consideration" | "kind">, signal: { magnitude: number }): { effects: string[]; severity: "high" | "medium" | "low" } {
  const stock = /stock|share|mixed/i.test(deal.consideration) || deal.kind === "merger";
  const fx: string[] = [];
  if (deal.stage === "model") {
    fx.push(category === "growth" ? "Edge's Deal Radar already rates this company a possible target; growth on the ground can make it more attractive to a buyer." : "Edge's Deal Radar rates this company a possible target; a problem like this can lower the price a buyer would offer, or delay an approach. This is a model's estimate, not a reported deal.");
    return { effects: fx, severity: "low" };
  }
  if (side === "target") {
    if (category === "operations" || category === "environmental" || category === "product" || category === "regulatory") {
      fx.push("Spread: if investors read this as lasting damage to the target's earnings, the gap between the offer price and the target's share price can widen while they weigh whether the buyer renegotiates or walks.");
      fx.push("Price and terms: a problem found before closing gives the buyer leverage for a lower price, an escrow or a specific indemnity. Walking away under a material adverse effect clause almost never succeeds in court (Akorn v. Fresenius in 2018 is the rare exception), so renegotiation is the more plausible path.");
      if (category === "environmental") fx.push("Regulators: environmental problems at the target become the buyer's after closing; they are usually priced into an indemnity, and a pending enforcement action can add a closing condition or a consent decree.");
      if (category === "product" || category === "regulatory") fx.push("Closing: if FDA, NHTSA or another regulator acts on it (a warning letter, an investigation, a consent decree), the buyer's diligence on liabilities can take longer and push the closing date out.");
      if (category === "operations") fx.push("Closing: a one-off outage rarely affects closing; a run of them can matter when the target restates its representations at closing.");
    } else if (category === "growth") {
      fx.push("Spread: more building or drilling at the target supports the case for the price agreed and can narrow the spread if it eases doubts about the target's growth.");
      fx.push("Antitrust: where the two companies overlap, expansion at the target can draw a regulator's attention to local concentration, and divestitures are the usual remedy.");
    } else if (category === "market") {
      fx.push("Deals are priced on long-run cash flows, so one season's reading rarely moves terms; it matters more for a deal with a price adjustment or earn-out tied to near-term results.");
    } else {
      fx.push("New or changed disclosure at the target is what a buyer's lawyers read for; it can lead to questions on price or on the representations at closing.");
    }
  } else {
    fx.push(stock ? "Value to target holders: in a stock deal they are paid in the acquirer's shares, so a fall in the acquirer's price on this news lowers what the deal is worth to them and can widen the spread." : "Financing: in a cash deal the question is whether the acquirer's finances or appetite change; a large problem at the acquirer can make its lenders or shareholders more cautious.");
    if (category !== "market" && category !== "growth") fx.push("A large problem at the acquirer can give its own shareholders a reason to question the deal, if they vote on it.");
  }
  const hard = category === "operations" || category === "environmental" || category === "product" || category === "regulatory";
  const severity = side === "target" && deal.stage === "announced" && hard && signal.magnitude >= 0.6 ? "high" : category === "market" ? "low" : "medium";
  return { effects: fx, severity };
}

const KIND_WORDS: Record<string, string> = {
  flaring: "Flaring", radar_change: "New structures in radar", ground_change: "Ground change", permits: "A jump in drilling permits", methane_plume: "A methane plume",
  reactor_outage: "A nuclear unit offline", fda_recall: "FDA recalls", vehicle_recall: "Vehicle recalls", crop_vigour: "Crop condition", water_extent: "Water extent",
  vessel_traffic: "Ship traffic", filing_change: "Rewritten risk factors", graph_flag: "A red flag", layoff_notice: "A WARN layoff notice", contract_award: "A federal contract award",
};

/** A deal impact's title and summary. Pure. */
export function describeImpact(deal: PendingDeal, side: Side, ticker: string, signal: { kind: string; title: string }, effects: string[]): { title: string; summary: string } {
  const what = KIND_WORDS[signal.kind] ?? "A signal";
  const parties = deal.stage === "model" ? `${deal.target} (a possible target)` : `${deal.acquirer || deal.acquirerTicker} and ${deal.target || deal.targetTicker}`;
  const stage = deal.stage === "announced" ? `announced ${deal.announcedAt}` : deal.stage === "reported" ? `reported ${deal.announcedAt}, not confirmed` : "a model's estimate";
  return {
    title: `Deal watch: ${what} at the ${side} (${ticker}) in ${parties}`.slice(0, 200),
    summary: `${deal.headline} (${stage}). ${signal.title}. What it could mean for the deal, as hypotheses: ${effects.join(" ")}`.slice(0, 1400),
  };
}

/* ---------------- Reading and posting ---------------- */

const pending = () => memo("edge:deal-impact:pending", 10 * 60_000, async () => {
  const db = requireDb();
  const since = new Date(Date.now() - 270 * DAY);
  const [news, done, odds] = await Promise.all([
    db.select({ d: schema.newsDeals, headline: schema.newsClusters.headline }).from(schema.newsDeals).innerJoin(schema.newsClusters, sql`${schema.newsClusters.id} = ${schema.newsDeals.clusterId}`)
      .where(and(gte(schema.newsDeals.announcedAt, since), inArray(schema.newsDeals.kind, TAKEOVERS))).orderBy(desc(schema.newsDeals.announcedAt)).limit(400),
    db.select({ t: schema.edgeDeals.targetTicker }).from(schema.edgeDeals).where(sql`${schema.edgeDeals.status} in ('completed', 'terminated') and ${schema.edgeDeals.targetTicker} <> ''`),
    db.select({ visual: schema.edgeDetections.visual, at: schema.edgeDetections.detectedAt }).from(schema.edgeDetections).where(sql`${schema.edgeDetections.kind} = 'deal_odds' and ${schema.edgeDetections.detectedAt} > now() - interval '30 days'`).limit(200),
  ]);
  return pendingFrom(
    news.map((r) => ({ ...r.d, headline: r.headline })),
    new Set(done.map((r) => r.t)),
    odds.flatMap((r) => { const v = r.visual as { ticker?: string; name?: string; p?: number }; return v.ticker && typeof v.p === "number" ? [{ ticker: v.ticker, name: v.name, p: v.p, at: r.at.toISOString() }] : []; }),
    Date.now(),
  );
});

/** Deals Edge treats as pending now (for the globe and the API). */
export const pendingDeals = () => pending().catch(() => [] as PendingDeal[]);

/**
 * Check signals against pending deals: the given new cards, or every signal of the last three days.
 * Returns the new deal-watch cards (their watchers are told).
 */
export async function scanDealImpacts(deadline: number, opts: { ids?: number[] } = {}): Promise<{ deals: number; signals: number; created: number[] }> {
  const deals = await pendingDeals();
  const kinds = Object.keys(IMPACT_KINDS);
  if (!deals.length || (opts.ids && !opts.ids.length)) return { deals: deals.length, signals: 0, created: [] };
  const db = requireDb();
  const where = opts.ids
    ? and(inArray(schema.edgeDetections.id, opts.ids.slice(0, 300)), inArray(schema.edgeDetections.kind, kinds))
    : and(sql`${schema.edgeDetections.detectedAt} > now() - interval '3 days'`, inArray(schema.edgeDetections.kind, kinds), sql`${schema.edgeDetections.ownerId} is null`);
  const signals = await db.select().from(schema.edgeDetections).where(where).limit(400);
  const tickers = new Set(deals.flatMap((d) => [d.acquirerTicker, d.targetTicker]).filter(Boolean));
  const created: number[] = [];
  for (const s of signals) {
    if (Date.now() > deadline) break;
    if (s.ownerId || !s.tickers.some((t) => tickers.has(t))) continue;
    for (const deal of deals) {
      for (const { side, ticker } of sidesOf(deal, s.tickers)) {
        try {
          const category = IMPACT_KINDS[s.kind];
          const { effects, severity } = dealEffects(category, side, deal, s);
          const words = describeImpact(deal, side, ticker, s, effects);
          const site = (s.visual as { site?: { name?: string; lon: number; lat: number } }).site ?? null;
          const [row] = await db.insert(schema.edgeDetections).values({
            key: `deal_impact:v1:${deal.key}:${s.id}:${side}`, kind: "deal_impact", module: "deals", title: words.title, summary: words.summary,
            why: `${DEAL_IMPACT_VERSION}: each new signal's tickers are matched to the parties of takeovers the Newsroom recorded in the last nine months (less those the deal database shows completed or terminated) and to companies the Deal Radar gives 25% or more twelve-month odds of being acquired. The effects are hypotheses from how deals usually respond, not predictions: read the merger agreement's material adverse effect definition, the closing conditions and the spread before acting.`,
            confidence: Math.round(s.confidence * (deal.stage === "announced" ? 1 : deal.stage === "reported" ? 0.8 : 0.6) * 100) / 100,
            magnitude: Math.round(Math.min(1, s.magnitude * (side === "target" ? 1 : 0.7) + (severity === "high" ? 0.15 : 0)) * 100) / 100,
            tickers: [...new Set([deal.acquirerTicker, deal.targetTicker].filter(Boolean))], assetIds: s.assetIds, bbox: s.bbox,
            visual: { type: "deal_impact", deal, side, ticker, category, severity, effects, site, signal: { id: s.id, kind: s.kind, title: s.title, summary: s.summary.slice(0, 400), confidence: s.confidence, magnitude: s.magnitude, observedAt: (s.observedAt ?? s.detectedAt).toISOString() } },
            observedAt: s.observedAt ?? s.detectedAt,
          }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
          if (!row) continue;
          const trail = await trailFor([`detection:${s.id}`]);
          const now = new Date();
          await record(`detection:${row.id}`, [
            ...trail.map((t) => ({ sourceName: t.sourceName, sourceUrl: t.sourceUrl, license: t.license, method: t.method, modelVersion: t.modelVersion, retrievedAt: t.retrievedAt })),
            deal.stage === "model"
              ? { sourceName: "YouBank Edge Deal Radar", sourceUrl: deal.url, license: "YouBank (model estimate from public filings)", method: `${DEAL_IMPACT_VERSION}: twelve-month odds of 25% or more`, modelVersion: "", retrievedAt: now }
              : { sourceName: "YouBank Newsroom deal tracker", sourceUrl: deal.url, license: "YouBank (parsed from public reporting)", method: `${DEAL_IMPACT_VERSION}: deal parties and terms from the story`, modelVersion: "", retrievedAt: now },
          ]);
          created.push(row.id);
        } catch (e) {
          logError(e, { where: "edge-deal-impact" });
        }
      }
    }
  }
  if (created.length) await notifyWatchers(created).catch((e) => logError(e, { where: "edge-deal-impact-notify" }));
  return { deals: deals.length, signals: signals.length, created };
}
