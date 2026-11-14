/**
 * QF1 adapters from Prediction markets (src/lib/predict):
 * - `predict.prob`: an open, traded market a rule links to a stock or ETF becomes a `probability` QuantSignal
 *   on that instrument: P(the event), as the venue's price, with the bid and ask as its interval and the price
 *   a day earlier as its base rate. It is the probability of an event that moves the name, not of the name's
 *   return, and the question says so. Tagged with the direction the rule gives (up, down or mixed).
 * - `predict.moves`: each instrument's signed 24-hour probability pressure (Σ direction x 24h move over the
 *   markets that touch it) as a cross-sectional `score`: a z-score across every instrument with pressure that
 *   day, clipped to [-3, 3]. It says the event markets moved toward outcomes that have historically helped (or
 *   hurt) the name, not that the name will move.
 * Neither is calibrated yet (method "none", n 0): there is no resolved history of these signals. Prices are
 * impersonal public data; no person's input is used.
 */
import { siteLink } from "@/lib/site";
import { mappings, relevant } from "@/lib/predict/exposure";
import { touched, type Dir } from "@/lib/predict/mapping";
import { marketLabel } from "@/lib/predict/normalize";
import { loadMarkets } from "@/lib/predict/store";
import { VENUE_LABEL, type Market } from "@/lib/predict/types";
import { CONTRACT_VERSION, type QuantSignal } from "../contracts";
import { publishSignals, storedSignalIds, type PublishResult } from "../signals";
import { normSymbol, signalId } from "../validate";
import { forbiddenIn } from "../words";

export const PREDICT_VERSION = "2026-11-14.1";
const ETFS = new Set(["ITB", "VNQ", "XLU", "IWM", "TLT", "KRE", "XLF", "UUP", "TIP", "QQQ", "XLE", "GLD", "XLY", "XLI", "XLP", "XRT", "CARZ", "SLX", "KWEB", "SMH", "XBI", "MNA", "ITA", "ICLN", "SHV", "JETS", "IBIT", "ETHA", "KIE", "VGK"]);
const DIR_WORD: Record<Dir, string> = { 1: "has tended to rise", [-1]: "has tended to fall", 0: "has moved either way" } as Record<Dir, string>;
const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
/** Trading days to a close, roughly (five in seven), at least one. */
const tradingDays = (closeTime: string | null, now: Date) => (closeTime ? Math.max(1, Math.round(((Date.parse(closeTime) - now.getTime()) / 86_400_000) * (5 / 7))) : 21);

/** A market's link to one instrument as a probability signal, or null when it cannot be one. Pure. */
export function predictProbSignal(m: Market, ticker: string, link: { dir: Dir; why: string }, now = new Date()): QuantSignal | null {
  if (m.prob === null || m.status !== "open" || !m.realMoney) return null;
  const symbol = normSymbol(ticker);
  const asOf = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString(); // the hour: one signal per market, name and hour
  const base = { contract: CONTRACT_VERSION, producer: "predict.prob", producerVersion: PREDICT_VERSION, instrument: { symbol, assetClass: (ETFS.has(symbol) ? "etf" : "equity") as "etf" | "equity", currency: "USD" }, asOf, horizonDays: tradingDays(m.closeTime, now) };
  const p = m.prob, low = Math.min(p, m.bid ?? p), high = Math.max(p, m.ask ?? p);
  const prior = m.change24h !== null ? Math.min(1, Math.max(0, r4(p - m.change24h))) : p;
  const closes = m.closeTime ? Date.parse(m.closeTime) : Number.POSITIVE_INFINITY;
  const validUntil = new Date(Math.min(closes, Date.parse(asOf) + 2 * 86_400_000)).toISOString();
  if (Date.parse(validUntil) <= Date.parse(asOf)) return null;
  const move = m.change24h === null ? "" : `, ${m.change24h >= 0 ? "up" : "down"} ${Math.abs(Math.round(m.change24h * 100))} points in a day`;
  const head = `${VENUE_LABEL[m.venue]} prices this event at ${Math.round(p * 100)}%${move}; as such events become likelier, ${symbol} ${DIR_WORD[link.dir]}`;
  const reason = link.why.replace(/\s+/g, " ").slice(0, 120);
  // The reason is a rule's own words; if one ever reads as advice, the sentence goes without it.
  const explain = forbiddenIn(reason).length ? `${head}.` : `${head} (${reason}).`;
  return {
    ...base, id: signalId(base), computedAt: now.toISOString(), reconstructed: false, validUntil, kind: "probability",
    probability: { p: r4(p), low: r4(low), high: r4(high), baseRate: prior, question: `Does "${marketLabel(m).slice(0, 200)}" resolve yes on ${VENUE_LABEL[m.venue]} (${m.id})? This is the event's probability, not ${symbol}'s return.` },
    universe: "predict-mapped",
    explain,
    evidence: [{ label: marketLabel(m).slice(0, 200), url: m.url.startsWith("https://") ? m.url : siteLink(`/app/predict?market=${encodeURIComponent(m.key)}`), source: VENUE_LABEL[m.venue], licence: "Public market data from the venue's API", knownAt: asOf, retrievedAt: now.toISOString() }],
    calibration: { method: "none", n: 0 },
    tags: ["predict", m.venue, m.category, link.dir === 1 ? "yes-helps" : link.dir === -1 ? "yes-hurts" : "mixed", "not-a-return-forecast"],
  };
}

/** Each instrument's pressure today: Σ dir x change24h over the markets touching it (mixed links count nothing). Pure. */
export function pressures(markets: Market[]): Map<string, { pressure: number; markets: Market[] }> {
  const out = new Map<string, { pressure: number; markets: Market[] }>();
  const maps = mappings(markets.filter(relevant));
  for (const m of markets) {
    if (!relevant(m) || m.change24h === null) continue;
    for (const [t, h] of touched(maps.get(m.key)!)) {
      if (h.dir === 0) continue;
      const x = out.get(t) ?? { pressure: 0, markets: [] };
      x.pressure += h.dir * m.change24h; x.markets.push(m);
      out.set(t, x);
    }
  }
  return out;
}

/** Pressure as cross-sectional score signals (z-scores, clipped). Needs at least five instruments with pressure. Pure. */
export function moveSignals(markets: Market[], now = new Date()): QuantSignal[] {
  const ps = [...pressures(markets)].filter(([, x]) => x.pressure !== 0);
  // A cross-section needs breadth: five names, moved by at least three different markets.
  if (ps.length < 5 || new Set(ps.flatMap(([, x]) => x.markets.map((m) => m.key))).size < 3) return [];
  const mean = ps.reduce((s, [, x]) => s + x.pressure, 0) / ps.length;
  const sd = Math.sqrt(ps.reduce((s, [, x]) => s + (x.pressure - mean) ** 2, 0) / (ps.length - 1)) || 0;
  if (!(sd > 0)) return [];
  const asOf = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString();
  return ps.map(([ticker, x]) => {
    const symbol = normSymbol(ticker);
    const base = { contract: CONTRACT_VERSION, producer: "predict.moves", producerVersion: PREDICT_VERSION, instrument: { symbol, assetClass: (ETFS.has(symbol) ? "etf" : "equity") as "etf" | "equity", currency: "USD" }, asOf, horizonDays: 1 };
    const z = Math.max(-3, Math.min(3, (x.pressure - mean) / sd));
    const top = [...x.markets].sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0))[0];
    return {
      ...base, id: signalId(base), computedAt: now.toISOString(), reconstructed: false, validUntil: new Date(Date.parse(asOf) + 2 * 86_400_000).toISOString(), kind: "score" as const,
      score: Math.round(z * 1000) / 1000, universe: "predict-mapped",
      explain: `In the last day, ${x.markets.length} prediction market${x.markets.length === 1 ? "" : "s"} linked to ${symbol} moved a net ${Math.abs(Math.round(x.pressure * 100))} points toward outcomes that have tended to ${x.pressure >= 0 ? "help" : "hurt"} it; the largest was ${VENUE_LABEL[top.venue]}'s, ${Math.round((top.change24h ?? 0) * 100)} points.`,
      evidence: x.markets.slice(0, 3).map((m) => ({ label: marketLabel(m).slice(0, 200), url: m.url, source: VENUE_LABEL[m.venue], licence: "Public market data from the venue's API", knownAt: asOf, retrievedAt: now.toISOString() })),
      calibration: { method: "none" as const, n: 0 }, tags: ["predict", "moves", "not-a-return-forecast"],
    };
  });
}

/** Build both producers' signals from a list of markets, at most `max` probability signals (most traded first). Pure. */
export function predictSignals(markets: Market[], now = new Date(), max = 400): QuantSignal[] {
  const out: QuantSignal[] = [];
  const maps = mappings(markets.filter(relevant));
  const ranked = markets.filter(relevant).sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  for (const m of ranked) {
    if (out.length >= max) break;
    for (const [t, h] of touched(maps.get(m.key)!)) {
      if (out.length >= max) break;
      const s = predictProbSignal(m, t, h, now);
      if (s) out.push(s);
    }
  }
  // One probability signal per instrument and hour (the signal id): the most traded market's.
  const seen = new Set<string>();
  return [...out.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true))), ...moveSignals(markets, now)];
}

/** Publish this hour's prediction-market signals (the nightly pass, or the predict cron). */
export async function publishPredictSignals(): Promise<PublishResult & { candidates: number }> {
  const { markets } = await loadMarkets(["kalshi", "polymarket", "gemini"]);
  const all = predictSignals(markets);
  const stored = await storedSignalIds(all.map((s) => s.id));
  return { ...(await publishSignals(all.filter((s) => !stored.has(s.id)))), candidates: all.length };
}
