/**
 * Source blocks: companies (typed in, or everything the person watches), a place, and a deal (typed
 * in, or the newest Newsroom deal that touches their watches and the map).
 */
import { recentDeals } from "@/lib/news/deals";
import { MAPPED_COMPANIES } from "../../companies";
import { partyFor } from "../../proforma";
import { PLACES } from "../../sources/eia";
import { listWatches } from "../../watches";
import { register } from "../engine";
import type { Companies, Places } from "../values";

const tickerList = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,]+/) : [])
  .map((t) => String(t).trim().toUpperCase()).filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t));

const nameOf = (ticker: string) => MAPPED_COMPANIES.find((c) => c.ticker === ticker)?.company ?? ticker;

register("source.companies", {
  async start(ctx) {
    let tickers = [...new Set(tickerList(ctx.config.tickers))].slice(0, 12);
    let from = "typed in";
    if (!tickers.length) {
      tickers = (await listWatches(ctx.userId)).filter((w) => w.kind === "company" && w.target.ticker).map((w) => w.target.ticker!).slice(0, 12);
      from = "your watches";
    }
    if (!tickers.length) throw Object.assign(new Error("Type some tickers, or watch a company in Edge first."), { status: 400 });
    const value: Companies = { items: tickers.map((ticker) => ({ ticker, name: nameOf(ticker) })) };
    return { outputs: { companies: value }, summary: `${tickers.join(", ")} (${from})`, preview: { kind: "list", items: value.items.map((c) => ({ label: c.name, detail: c.ticker })) } };
  },
});

register("source.place", {
  async start(ctx) {
    const key = typeof ctx.config.place === "string" && PLACES[ctx.config.place] ? ctx.config.place : "permian";
    const p = PLACES[key];
    const value: Places = { items: [{ key, name: p.name, bbox: p.bbox }] };
    const [x0, y0, x1, y1] = p.bbox;
    return { outputs: { places: value }, summary: p.name, preview: { kind: "map", bbox: p.bbox, points: [{ lon: (x0 + x1) / 2, lat: (y0 + y1) / 2, label: p.name, tone: "accent" }] } };
  },
});

register("source.deal", {
  async start(ctx) {
    let parties = tickerList(ctx.config.parties).slice(0, 4);
    let summary = "";
    if (parties.length < 2) {
      const watched = new Set((await listWatches(ctx.userId)).filter((w) => w.kind === "company" && w.target.ticker).map((w) => w.target.ticker!));
      const deals = await recentDeals({ days: 90, kinds: ["acquisition", "merger", "take_private", "tender"], limit: 120 });
      const pick = deals.map((d) => ({ d, a: partyFor(d.acquirerTicker || d.acquirer), b: partyFor(d.targetTicker || d.target) }))
        .find(({ a, b }) => a?.tickers[0] && b?.tickers[0] && a.label !== b.label && (watched.has(a.tickers[0]) || watched.has(b.tickers[0]) || MAPPED_COMPANIES.some((c) => c.ticker === a.tickers[0]) && MAPPED_COMPANIES.some((c) => c.ticker === b.tickers[0])));
      if (!pick) throw Object.assign(new Error("No deal in the last 90 days touches your watches or the mapped companies; type the parties instead."), { status: 400 });
      parties = [pick.a!.tickers[0], pick.b!.tickers[0]];
      summary = `${pick.d.headline.slice(0, 120)} (${pick.d.announcedAt.toISOString().slice(0, 10)})`;
    }
    const value: Companies = { items: parties.map((ticker) => ({ ticker, name: nameOf(ticker) })) };
    return { outputs: { companies: value }, summary: summary || `${value.items.map((c) => c.name).join(" + ")}`, preview: { kind: "list", items: value.items.map((c, i) => ({ label: c.name, detail: i === 0 ? "buyer" : "target" })) } };
  },
});
