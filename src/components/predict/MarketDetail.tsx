"use client";

/**
 * One market in full: its probability over time beside the same question on other venues, the order book
 * (or best bid and ask), the venue's resolution rules, the spread to each other venue net of fees, the
 * stocks, sectors and factors it moves, what it touches in the person's Book, and their watch and forecasts.
 */
import { useState } from "react";
import { LineChart, type LineSeries } from "@/components/charts/LineChart";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import type { MarketExposure } from "@/lib/predict/exposure";
import type { Mapping } from "@/lib/predict/mapping";
import type { Spread } from "@/lib/predict/spread";
import { CATEGORY_LABEL, VENUE_LABEL, type Book, type Market, type PricePoint, type Venue } from "@/lib/predict/types";
import { cents, Change, closesIn, DirTag, EffectTag, Empty, points, prob, ProbBar, usd, useLoad, VenueBadge } from "./ui";

type Detail = {
  market: Market; venueNote: string; daysToClose: number | null; history: PricePoint[]; book: Book | null; bookDepth: boolean;
  counterparts: { market: Market; confidence: number; reasons: string[]; history: PricePoint[]; spread: Spread | null; annualised: number | null }[];
  fees: Partial<Record<Venue, string>>; mapping: Mapping;
  exposure: (MarketExposure & { line: string }) | null;
  watch: { threshold: number; baseProb: number | null } | null;
  forecasts: { id: number; p: number; marketP: number | null; day: string; outcome: number | null; brier: number | null; marketBrier: number | null }[];
};

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
type Range = "1w" | "1m" | "3m";

/** Several venues' histories on one time axis: hourly buckets for a week, daily otherwise; the last price in each bucket. */
function aligned(range: Range, series: { name: string; points: PricePoint[] }[]): LineSeries[] {
  const hourly = range === "1w";
  const label = (t: number) => { const d = new Date(t); const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); return hourly ? `${md} ${String(d.getHours()).padStart(2, "0")}h` : md; };
  const bucket = (t: number) => (hourly ? Math.floor(t / 3_600_000) * 3_600_000 : Math.floor(t / 86_400_000) * 86_400_000);
  const keys = [...new Set(series.flatMap((s) => s.points.map((p) => bucket(p.t))))].sort((a, b) => a - b);
  if (keys.length < 2) return [];
  return series.filter((s) => s.points.length).map((s) => {
    const by = new Map<number, number>();
    for (const p of s.points) by.set(bucket(p.t), p.p);
    return { name: s.name, points: keys.map((k) => ({ x: label(k), y: by.get(k) ?? null })) };
  });
}

export function MarketDetail({ marketKey, onBack, onOpen }: { marketKey: string; onBack: () => void; onOpen: (key: string) => void }) {
  const [range, setRange] = useState<Range>("1m");
  const { data, error, busy, reload: load } = useLoad<Detail>(`/api/predict/market?key=${encodeURIComponent(marketKey)}&range=${range}`);
  // The last answer stands in while the next range loads, but never another market's.
  const d = data && data.market.key === marketKey ? data : null;

  const back = <button onClick={onBack} className="mb-2 flex items-center gap-1 text-[12px] text-muted hover:text-fg"><Icon name="ArrowLeft" className="h-3.5 w-3.5" />All markets</button>;
  if (error && !d) return <div>{back}<Empty icon="AlertTriangle" title="This market could not be opened">{error}</Empty></div>;
  if (!d) return <div>{back}<div className="space-y-2"><div className="shimmer h-24 ctl" /><div className="shimmer h-52 ctl" /><div className="shimmer h-32 ctl" /></div></div>;
  const m = d.market;
  const series = aligned(range, [{ name: VENUE_LABEL[m.venue], points: d.history }, ...d.counterparts.map((c) => ({ name: VENUE_LABEL[c.market.venue], points: c.history }))]);

  return (
    <div className={busy ? "opacity-80" : ""}>
      {back}
      <section className="panel p-3">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted"><VenueBadge venue={m.venue} />{CATEGORY_LABEL[m.category]} · {closesIn(m.closeTime)}{m.status !== "open" && <span className="font-semibold text-accent"> · {m.status === "resolved" ? `resolved ${m.result}` : "closed"}</span>}</div>
        <h2 className="mt-1.5 text-[17px] font-semibold leading-snug text-fg">{m.title}</h2>
        {m.outcome && <p className="text-[13px] font-medium text-accent">{m.outcome}</p>}
        {m.question && m.question !== m.title && <p className="mt-1 text-[12px] text-muted">{m.question}</p>}
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,260px)_1fr] sm:items-center">
          <div><ProbBar p={m.prob} wide /><p className="mt-1 text-[11px] text-muted">Implied probability (yes price) · <Change v={m.change24h} /> in 24h</p></div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] sm:grid-cols-4">
            <div><dt className="text-muted">Bid / ask</dt><dd className="font-mono tabular-nums text-fg">{cents(m.bid)} / {cents(m.ask)}</dd></div>
            <div><dt className="text-muted">24h volume</dt><dd className="font-mono tabular-nums text-fg">{usd(m.volume24h)}</dd></div>
            <div><dt className="text-muted">{m.openInterest !== null ? "Open interest" : "Liquidity"}</dt><dd className="font-mono tabular-nums text-fg">{m.openInterest !== null ? `${Math.round(m.openInterest).toLocaleString("en-US")} ct` : usd(m.liquidity)}</dd></div>
            <div><dt className="text-muted">Total volume</dt><dd className="font-mono tabular-nums text-fg">{usd(m.volume)}</dd></div>
          </dl>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a href={m.url} target="_blank" rel="noreferrer" className="ctl inline-flex items-center gap-1.5 bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg">{m.realMoney ? `Trade on ${VENUE_LABEL[m.venue]}` : `Open on ${VENUE_LABEL[m.venue]}`}<Icon name="ExternalLink" className="h-3.5 w-3.5" /></a>
          <span className="text-[11px] text-muted">{d.venueNote} YouBank does not place trades; this is information, not advice.</span>
        </div>
      </section>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <section className="panel p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-fg">Probability over time{d.counterparts.length ? ", with other venues" : ""}</h3>
              <div className="flex gap-1">{(["1w", "1m", "3m"] as Range[]).map((r) => <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} className={`ctl px-2 py-1 text-[11px] ${range === r ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:text-fg"}`}>{r === "1w" ? "Week" : r === "1m" ? "Month" : "3 months"}</button>)}</div>
            </div>
            {series.length ? <LineChart series={series} format={(v) => `${Math.round(v * 100)}%`} title="Yes price as implied probability" height={210} /> : <p className="text-[12px] text-muted">{m.venue === "gemini" || m.venue === "manifold" ? `${VENUE_LABEL[m.venue]} does not publish a price history we can read.` : "No price history for this range yet."}</p>}
          </section>

          <section className="panel p-3">
            <h3 className="mb-2 text-[13px] font-semibold text-fg">The same question on other venues</h3>
            {!d.counterparts.length ? <p className="text-[12px] text-muted">No other venue lists a question we can match to this one with confidence.</p> : (
              <ul className="space-y-2">
                {d.counterparts.map((c) => (
                  <li key={c.market.key} className="rounded-[var(--radius)] border border-line p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button onClick={() => onOpen(c.market.key)} className="min-w-0 text-left"><span className="flex items-center gap-1.5"><VenueBadge venue={c.market.venue} /><span className="truncate text-[12.5px] text-fg hover:text-accent">{c.market.outcome || c.market.title}</span></span></button>
                      <ProbBar p={c.market.prob} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                      <span>Gap {points(c.spread?.gap ?? (c.market.prob !== null && m.prob !== null ? c.market.prob - m.prob : null))}</span>
                      {c.spread && <span>Yes on {VENUE_LABEL[c.spread.yesOn]}, no on {VENUE_LABEL[c.spread.noOn]}: <span className={`font-mono tabular-nums ${c.spread.net > 0 ? "text-pos" : "text-muted"}`}>{points(c.spread.net, 1)}</span> after fees{c.spread.quoted ? "" : " (from mid prices, rough)"}</span>}
                      <span>Match confidence {Math.round(c.confidence * 100)}%</span>
                    </div>
                    {c.reasons.length > 0 && <p className="mt-1 text-[11px] text-muted">{c.reasons.join("; ")}.</p>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-muted">A spread is not risk-free: each venue resolves on its own rules, which can differ, and money is tied up until settlement. {Object.values(d.fees).join(" ")}</p>
          </section>

          <MovesCard key={m.key} marketKey={m.key} mapping={d.mapping} />

          <section className="panel p-3">
            <h3 className="mb-2 text-[13px] font-semibold text-fg">Resolution rules</h3>
            {m.rules ? <p className="whitespace-pre-line text-[12px] leading-relaxed text-fg">{m.rules}</p> : <p className="text-[12px] text-muted">{VENUE_LABEL[m.venue]} did not send rules with this market. Read them on the venue before relying on the price.</p>}
          </section>
        </div>

        <div className="min-w-0 space-y-3">
          <WatchCard market={m} watch={d.watch} reload={load} />
          <ForecastCard market={m} forecasts={d.forecasts} reload={load} />
          <section className="panel p-3">
            <h3 className="mb-2 text-[13px] font-semibold text-fg">Your book</h3>
            {d.exposure ? (
              <>
                <p className="text-[12px] text-fg">{d.exposure.line}</p>
                <ul className="mt-2 space-y-1">{d.exposure.positions.map((p) => <li key={p.ticker} className="flex items-center justify-between gap-2 text-[11.5px]"><span className="font-mono text-fg">{p.ticker} <span className="text-muted">{p.direction}{p.weight !== null ? ` ${p.weight}%` : ""}</span></span><EffectTag effect={p.effect} /></li>)}</ul>
              </>
            ) : <p className="text-[12px] text-muted">Nothing in your Book is linked to this market.</p>}
          </section>
          <OrderBook book={d.book} depth={d.bookDepth} venue={m.venue} />
        </div>
      </div>
    </div>
  );
}

function MovesCard({ marketKey, mapping: initial }: { marketKey: string; mapping: Mapping }) {
  const [mapping, setMapping] = useState(initial);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    setBusy(true); setNote(null);
    try { const r = await fetchJson<{ mapping: Mapping; note: string }>("/api/predict/map", json("POST", { key: marketKey })); setMapping(r.mapping); setNote(r.note); }
    catch (e) { setNote(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const empty = !mapping.tickers.length && !mapping.sectors.length && !mapping.factors.length;
  return (
    <section className="panel p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-fg">What it moves</h3>
        <button onClick={ask} disabled={busy} className="ctl border border-line px-2 py-1 text-[11px] text-muted hover:text-fg disabled:opacity-60"><Icon name="Sparkles" className="mr-1 inline h-3 w-3" />{busy ? "Asking…" : "Ask the AI for more names"}</button>
      </div>
      {mapping.rules.length > 0 && <p className="mb-2 text-[11.5px] text-muted">Rules: {mapping.rules.join("; ")}. Signs are for yes becoming likelier; sizes are unknown.</p>}
      {empty && <p className="text-[12px] text-muted">No rule links this market to listed stocks.</p>}
      {mapping.tickers.length > 0 && (
        <ul className="mb-2 space-y-1">{mapping.tickers.map((t) => <li key={t.ticker} className="flex flex-wrap items-baseline gap-x-2 text-[12px]"><span className="font-mono font-semibold text-fg">{t.ticker}</span><DirTag dir={t.dir} /><span className="text-[11px] text-muted">{t.why}{t.source === "ai" ? " (AI)" : ""}</span></li>)}</ul>
      )}
      {mapping.sectors.length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">{mapping.sectors.map((s) => <div key={s.name} className="rounded-[var(--radius)] border border-line px-2 py-1.5 text-[11.5px]"><div className="flex items-center justify-between gap-2"><span className="text-fg">{s.name}{s.etf ? <span className="font-mono text-muted"> {s.etf}</span> : null}</span><DirTag dir={s.dir} /></div>{s.members.length > 0 && <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted">{s.members.join(" ")}</div>}</div>)}</div>
      )}
      {mapping.factors.length > 0 && <p className="mt-2 text-[11.5px] text-muted">Factors: {mapping.factors.map((f) => `${f.name} (${f.dir === 1 ? "up" : f.dir === -1 ? "down" : "mixed"})`).join(", ")}.</p>}
      {note && <p className="mt-2 text-[11.5px] text-muted">{note}</p>}
    </section>
  );
}

function WatchCard({ market, watch, reload }: { market: Market; watch: Detail["watch"]; reload: () => void }) {
  const [t, setT] = useState(String(Math.round((watch?.threshold ?? 0.05) * 100)));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (stop = false) => {
    setBusy(true); setMsg(null);
    try {
      if (stop) await fetchJson(`/api/predict/watch?key=${encodeURIComponent(market.key)}`, { method: "DELETE" });
      else await fetchJson("/api/predict/watch", json("POST", { key: market.key, eventId: market.eventId, threshold: Number(t) }));
      setMsg(stop ? "Stopped watching." : `You will be alerted when this moves ${t} points from the last price you were told about.`);
      reload();
    } catch (e) { setMsg(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <section className="panel p-3">
      <h3 className="mb-1 text-[13px] font-semibold text-fg">Alert me on a move</h3>
      <p className="mb-2 text-[11.5px] text-muted">{watch ? `Watching: alerts at ${Math.round(watch.threshold * 100)} points from ${prob(watch.baseProb)}.` : "Get an alert in the bell and your alert channels when the price moves this far."}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11.5px] text-muted">Move of
          <select value={t} onChange={(e) => setT(e.target.value)} className="ctl ml-1.5 border border-line bg-panel px-2 py-1.5 text-[12.5px] text-fg">{[3, 5, 10, 15, 20].map((n) => <option key={n} value={n}>{n} points</option>)}</select>
        </label>
        <button onClick={() => save()} disabled={busy || market.status !== "open"} className="ctl bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-60">{watch ? "Update" : "Watch"}</button>
        {watch && <button onClick={() => save(true)} disabled={busy} className="ctl border border-line px-3 py-1.5 text-[12px] text-muted hover:text-fg">Stop</button>}
      </div>
      {msg && <p className="mt-2 text-[11.5px] text-muted">{msg}</p>}
    </section>
  );
}

function ForecastCard({ market, forecasts, reload }: { market: Market; forecasts: Detail["forecasts"]; reload: () => void }) {
  const [p, setP] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await fetchJson("/api/predict/forecast", json("POST", { key: market.key, eventId: market.eventId, p: Number(p) })); setMsg("Recorded. It is scored when the market resolves, beside the market's price now."); setP(""); reload(); }
    catch (e) { setMsg(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <section className="panel p-3">
      <h3 className="mb-1 text-[13px] font-semibold text-fg">Your forecast</h3>
      <p className="mb-2 text-[11.5px] text-muted">Paper only. Record your own chance of yes; when the market resolves it gets a Brier score (0 is perfect, 0.25 a coin flip) beside the market&apos;s.</p>
      <div className="flex items-center gap-2">
        <label className="relative w-24"><span className="sr-only">Your probability in percent</span>
          <input inputMode="numeric" value={p} onChange={(e) => setP(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))} placeholder={market.prob !== null ? String(Math.round(market.prob * 100)) : "50"} className="ctl w-full border border-line bg-panel py-1.5 pl-2 pr-6 text-right font-mono text-[13px] tabular-nums text-fg outline-none focus:border-accent" />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-muted">%</span>
        </label>
        <button onClick={save} disabled={busy || !p || market.status !== "open"} className="ctl bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-60">Record</button>
      </div>
      {msg && <p className="mt-2 text-[11.5px] text-muted">{msg}</p>}
      {forecasts.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-line pt-2">
          {forecasts.map((f) => (
            <li key={f.id} className="flex justify-between gap-2 text-[11.5px]">
              <span className="text-muted">{f.day}: you <span className="font-mono text-fg">{prob(f.p)}</span>, market <span className="font-mono">{prob(f.marketP)}</span></span>
              <span className="font-mono tabular-nums text-muted">{f.brier !== null ? `Brier ${f.brier.toFixed(3)} vs ${f.marketBrier?.toFixed(3) ?? "–"}` : "open"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OrderBook({ book, depth, venue }: { book: Book | null; depth: boolean; venue: Venue }) {
  if (!book) return <section className="panel p-3"><h3 className="mb-1 text-[13px] font-semibold text-fg">Order book</h3><p className="text-[12px] text-muted">{VENUE_LABEL[venue]} gave no bids or offers for this market.</p></section>;
  const rows = Math.max(book.bids.length, book.asks.length);
  const max = Math.max(1, ...book.bids.map((b) => b[1]), ...book.asks.map((a) => a[1]));
  const spread = book.bids[0] && book.asks[0] ? book.asks[0][0] - book.bids[0][0] : null;
  return (
    <section className="panel p-3">
      <h3 className="mb-1 text-[13px] font-semibold text-fg">{depth ? "Order book (yes side)" : "Best bid and ask"}</h3>
      <p className="mb-2 text-[11px] text-muted">{spread !== null ? `Spread ${cents(spread)}. ` : ""}{depth ? "Contracts or shares at each price." : `${VENUE_LABEL[venue]}'s full book could not be read; this is its best bid and ask.`}</p>
      <div className="grid grid-cols-2 gap-2 text-[11.5px]">
        <div><div className="mb-1 text-[10.5px] uppercase tracking-wider text-muted">Bids</div>{Array.from({ length: rows }).map((_, i) => { const b = book.bids[i]; return <div key={i} className="relative h-5">{b && <><div className="absolute inset-y-0.5 right-0 rounded-sm bg-pos/15" style={{ width: depth ? `${(b[1] / max) * 100}%` : "0%" }} /><div className="relative flex justify-between px-1 font-mono tabular-nums"><span className="text-pos">{cents(b[0])}</span>{depth && <span className="text-muted">{Math.round(b[1]).toLocaleString("en-US")}</span>}</div></>}</div>; })}</div>
        <div><div className="mb-1 text-[10.5px] uppercase tracking-wider text-muted">Asks</div>{Array.from({ length: rows }).map((_, i) => { const a = book.asks[i]; return <div key={i} className="relative h-5">{a && <><div className="absolute inset-y-0.5 left-0 rounded-sm bg-neg/15" style={{ width: depth ? `${(a[1] / max) * 100}%` : "0%" }} /><div className="relative flex justify-between px-1 font-mono tabular-nums"><span className="text-neg">{cents(a[0])}</span>{depth && <span className="text-muted">{Math.round(a[1]).toLocaleString("en-US")}</span>}</div></>}</div>; })}</div>
      </div>
    </section>
  );
}
