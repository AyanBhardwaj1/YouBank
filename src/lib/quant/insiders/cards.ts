/**
 * Q7's Edge feed cards: an insider cluster or a large officer purchase (kind `quant.insider_cluster`) and a new
 * or raised 13D stake (kind `quant.activist`), shown to people who watch the company in Edge. One card per
 * event (key `quant:<event id>`), with its base rate when one exists and the filing as provenance. Alerts go
 * through Edge's notifyWatchers (isBig decides now or the digest). Background work: free data only.
 */
import { and, desc, gte, inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { notifyWatchers } from "@/lib/edge/notify";
import { record } from "@/lib/edge/provenance";
import { baseRateFor, CATALOG, signalBaseRate } from "../events/rates";
import { DISCLOSURES, T } from "../words";
import { INSIDER_VERSION } from "./store";

export const CARD_KINDS = { cluster_buy: "quant.insider_cluster", large_officer_buy: "quant.insider_cluster", cluster_sell: "quant.insider_cluster", activist_new: "quant.activist", activist_up: "quant.activist" } as const;
type EventType = keyof typeof CARD_KINDS;
const DAY = 86_400_000;

export type QuantCardVisual = {
  type: "quant_event"; eventType: EventType; label: string; ticker: string; totalUsd: number | null; insiders: { name: string; role: string; value: number }[];
  holder: string | null; percent: number | null; baseRate: ReturnType<typeof signalBaseRate>; url: string | null; disclaimer: string;
};

type EventRow = { id: string; type: string; symbol: string; issuerCik: string; occurredAt: string; acceptedAt: string; body: Record<string, unknown> };

/** The card for one stored event, or null for types that do not make cards. Pure. */
export function eventCard(e: EventRow, baseRate: ReturnType<typeof signalBaseRate>) {
  if (!(e.type in CARD_KINDS) || !e.symbol) return null;
  const type = e.type as EventType;
  const b = e.body;
  const ins = ((b.insiders as { name: string; role: string; value: number }[] | undefined) ?? []).slice(0, 8);
  const totalUsd = typeof b.totalUsd === "number" ? b.totalUsd : null;
  const percent = typeof b.to === "number" ? b.to : null;
  const activist = type.startsWith("activist");
  const explain = activist
    ? (type === "activist_new" ? T.activistNew(String(b.holder ?? "A holder"), percent) : T.activistUp(String(b.holder ?? "A holder"), typeof b.from === "number" ? b.from : null, percent))
    : type === "large_officer_buy" ? T.largeOfficerBuy(ins[0]?.role ?? "chief executive", totalUsd ?? ins[0]?.value ?? 0)
      : type === "cluster_sell" ? T.clusterSell(ins.length, Math.max(1, Number(b.days ?? 30)), totalUsd ?? 0) : T.clusterBuy(ins.length, Math.max(1, Number(b.days ?? 30)), totalUsd ?? 0);
  const rate = baseRate ? T.baseRate(baseRate.hitRate, baseRate.unconditionalHitRate, baseRate.window.replace(/^\+?(\d+)\.\.\+?(\d+)$/, "sessions $1 to $2 after the filing"), baseRate.n) : "No base rate yet: fewer than 30 past events of this kind have been measured.";
  // Size: dollars for insiders ($5 million and up is 1), the stake for an activist (10% and up is 1).
  const magnitude = activist ? Math.min(1, (percent ?? 5) / 10) : Math.min(1, Math.log10(1 + (totalUsd ?? 0)) / Math.log10(5e6));
  const confidence = activist ? 0.9 : Math.min(0.9, 0.55 + 0.1 * ins.length);
  const url = typeof b.url === "string" ? b.url : ins.length && typeof (b.insiders as { url?: string }[])[0]?.url === "string" ? (b.insiders as { url?: string }[])[0].url! : null;
  const visual: QuantCardVisual = { type: "quant_event", eventType: type, label: CATALOG[type]?.label ?? type, ticker: e.symbol, totalUsd, insiders: ins.map((i) => ({ name: i.name, role: i.role, value: i.value })), holder: activist ? String(b.holder ?? "") : null, percent, baseRate, url, disclaimer: DISCLOSURES.base_rate };
  return {
    key: `quant:${e.id}`.slice(0, 200), kind: CARD_KINDS[type], module: "quant",
    title: `${e.symbol}: ${CATALOG[type]?.label ?? type}`.slice(0, 200), summary: `${explain} ${rate}`.slice(0, 1200),
    why: (activist ? "A Schedule 13D is filed by a holder of more than 5% who may seek to influence the company; Item 4 states the purpose." : "Open-market trades by insiders, from SEC Form 4. Routine insiders (who trade in the same month most years), plan trades, offerings and 10%-owner funds are left out (Cohen, Malloy and Pomorski 2012).").slice(0, 1200),
    confidence, magnitude, tickers: [e.symbol], visual: visual as unknown as Record<string, unknown>, observedAt: new Date(e.acceptedAt),
  };
}

/** Cards for events accepted in the last `days` (default 3), each once; then alerts to watchers. */
export async function publishEventCards(deadline: number, days = 3): Promise<{ cards: number; alerts: number }> {
  const db = requireDb();
  const rows = await db.select().from(schema.quantEvents).where(and(inArray(schema.quantEvents.type, Object.keys(CARD_KINDS)), gte(schema.quantEvents.acceptedAt, new Date(Date.now() - days * DAY)))).orderBy(desc(schema.quantEvents.acceptedAt)).limit(200);
  if (!rows.length) return { cards: 0, alerts: 0 };
  const keys = rows.map((r) => `quant:${r.id}`.slice(0, 200));
  const done = new Set((await db.select({ key: schema.edgeDetections.key }).from(schema.edgeDetections).where(inArray(schema.edgeDetections.key, keys))).map((r) => r.key));
  const rates = new Map<string, ReturnType<typeof signalBaseRate>>();
  const ids: number[] = [];
  for (const r of rows) {
    if (Date.now() > deadline) break;
    if (done.has(`quant:${r.id}`.slice(0, 200))) continue;
    if (!rates.has(r.type)) rates.set(r.type, signalBaseRate(await baseRateFor(r.type).catch(() => null)));
    const card = eventCard({ id: r.id, type: r.type, symbol: r.symbol, issuerCik: r.issuerCik, occurredAt: String(r.occurredAt), acceptedAt: r.acceptedAt.toISOString(), body: r.body }, rates.get(r.type) ?? null);
    if (!card) continue;
    const [row] = await db.insert(schema.edgeDetections).values({ ...card, bbox: null }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
    if (!row) continue;
    const v = card.visual as unknown as QuantCardVisual;
    await record(`detection:${row.id}`, [{ sourceName: v.eventType.startsWith("activist") ? "SEC EDGAR Schedule 13D" : "SEC EDGAR Form 4", sourceUrl: v.url ?? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${r.issuerCik}`, license: "Public domain (SEC filings)", method: "Parsed from the filing; events by Quant Edge's rules (Q7); base rate from the event study (QF5)", modelVersion: INSIDER_VERSION, retrievedAt: new Date() }]).catch(() => null);
    ids.push(row.id);
  }
  const sent = ids.length ? await notifyWatchers(ids).catch(() => ({ now: 0, later: 0, contacts: 0 })) : { now: 0, later: 0, contacts: 0 };
  return { cards: ids.length, alerts: sent.now + sent.later };
}
