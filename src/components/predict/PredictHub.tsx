"use client";

/**
 * Prediction markets (/app/predict): event odds from Kalshi, Polymarket, Gemini and Manifold in one list, each
 * market in full (history, book, rules, the same question elsewhere, the stocks it moves), where venues
 * disagree net of fees, what the markets touch in the person's Book, and their watches and paper forecasts.
 * The address holds the tab, the filters and the open market, so a link reopens the same view. Phones: rows
 * stack, tabs scroll, nothing overflows at 390px.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { lazyPanel } from "@/components/ui/lazyPanel";
import { useTabInView } from "@/components/ui/useTabInView";
import { CATEGORY_LABEL, CATEGORIES, VENUE_LABEL, VENUES, type Market, type Venue, type VenueState } from "@/lib/predict/types";
import { DEFAULT_FILTERS, filtersToParams, parseFilters, SORTS, type Filters } from "@/lib/predict/query";
import { useSubNav } from "@/lib/subnav";
import { Change, closesIn, Disclaimer, Empty, ProbBar, StaleNote, usd, useLoad, VenueBadge } from "./ui";

const TabLoading = () => <div className="shimmer h-48 ctl" />;
const MarketDetail = lazyPanel(() => import("./MarketDetail").then((m) => m.MarketDetail), TabLoading);
const SpreadsTab = lazyPanel(() => import("./SpreadsTab").then((m) => m.SpreadsTab), TabLoading);
const ExposureTab = lazyPanel(() => import("./ExposureTab").then((m) => m.ExposureTab), TabLoading);
const WatchTab = lazyPanel(() => import("./WatchTab").then((m) => m.WatchTab), TabLoading);

export type PredictTab = "markets" | "spreads" | "exposure" | "watch";
const TABS: { id: PredictTab; label: string; icon: string }[] = [
  { id: "markets", label: "Markets", icon: "Percent" },
  { id: "spreads", label: "Cross-venue spreads", icon: "ArrowLeftRight" },
  { id: "exposure", label: "Event exposure", icon: "Briefcase" },
  { id: "watch", label: "Watchlist and forecasts", icon: "Bell" },
];

type ListResponse = { markets: (Market & { watched: boolean })[]; total: number; venues: VenueState[]; asOf: string };

export function PredictHub({ initialTab, initialMarket, initialParams }: { initialTab?: string; initialMarket?: string; initialParams?: Record<string, string | undefined> }) {
  const [tab, setTab] = useState<PredictTab>(TABS.find((t) => t.id === initialTab)?.id ?? "markets");
  const [market, setMarket] = useState<string | null>(initialMarket && /^(kalshi|polymarket|gemini|manifold):/.test(initialMarket) ? initialMarket : null);
  const [filters, setFilters] = useState<Filters>(() => parseFilters(Object.fromEntries(Object.entries(initialParams ?? {}).filter(([, v]) => v !== undefined)) as Record<string, string>));
  const tabRow = useTabInView<HTMLElement>(tab);
  useSubNav("/app/predict", (v) => { if (TABS.some((t) => t.id === v)) { setTab(v as PredictTab); setMarket(null); } });

  // The address: the tab, the browser's filters, and the open market. Replaced, not pushed, as other workspaces do.
  useEffect(() => {
    if (typeof window === "undefined" || window.location.pathname !== "/app/predict") return;
    const u = tab === "markets" ? filtersToParams(filters) : new URLSearchParams();
    if (tab !== "markets") u.set("tab", tab);
    if (market) u.set("market", market);
    const next = `/app/predict${u.toString() ? `?${u.toString()}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [tab, filters, market]);

  const open = useCallback((key: string) => { setMarket(key); document.getElementById("predict-top")?.scrollIntoView({ block: "start" }); }, []);

  return (
    <div className="h-full overflow-auto">
      <div id="predict-top" className="mx-auto max-w-6xl p-3 sm:p-4">
        <div className="mb-3">
          <h1 className="display text-[26px] leading-tight text-fg sm:text-[30px]">Prediction markets</h1>
          <p className="mt-1 max-w-3xl text-[12.5px] text-muted">What traders on Kalshi, Polymarket and Gemini pay for a $1 contract on an event is its implied probability. See which events move your names, where venues disagree after fees, and how your own forecasts score against the market.</p>
        </div>
        <nav ref={tabRow} className="-mx-3 mb-3 flex gap-1 overflow-x-auto px-3 sm:mx-0 sm:px-0" aria-label="Prediction markets">
          {TABS.map((t) => (
            <button key={t.id} aria-current={tab === t.id && !market ? "page" : undefined} onClick={() => { setTab(t.id); setMarket(null); }} className={`ctl flex shrink-0 items-center gap-1.5 px-3 py-2 text-[12.5px] ${tab === t.id && !market ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}><Icon name={t.icon} className="h-3.5 w-3.5" />{t.label}</button>
          ))}
        </nav>
        {market ? (
          <MarketDetail marketKey={market} onBack={() => setMarket(null)} onOpen={open} />
        ) : (
          <>
            {tab === "markets" && <MarketsTab filters={filters} setFilters={setFilters} onOpen={open} />}
            {tab === "spreads" && <SpreadsTab onOpen={open} />}
            {tab === "exposure" && <ExposureTab onOpen={open} />}
            {tab === "watch" && <WatchTab onOpen={open} />}
          </>
        )}
        <Disclaimer />
      </div>
    </div>
  );
}

/* ---------------- Markets ---------------- */

function MarketsTab({ filters, setFilters, onOpen }: { filters: Filters; setFilters: (f: Filters) => void; onOpen: (key: string) => void }) {
  const [q, setQ] = useState(filters.q);
  const params = useMemo(() => filtersToParams(filters).toString(), [filters]);
  const { data, error, busy } = useLoad<ListResponse>(`/api/predict?${params}${params ? "&" : ""}limit=150`);

  // The search box settles for a moment before it filters.
  useEffect(() => {
    if (q === filters.q) return;
    const t = setTimeout(() => setFilters({ ...filters, q: q.trim() }), 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleVenue = (v: Venue) => setFilters({ ...filters, venues: filters.venues.includes(v) ? filters.venues.filter((x) => x !== v) : [...filters.venues, v] });
  const sel = "ctl border border-line bg-panel px-2 py-1.5 text-[12.5px] text-fg outline-none focus:border-accent";

  return (
    <div>
      <div className="panel mb-3 space-y-2 p-2.5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search markets</span>
            <Icon name="Search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: fed december, tariff china, nvidia…" className="ctl w-full border border-line bg-panel py-2 pl-8 pr-2.5 text-[13px] text-fg outline-none focus:border-accent" />
          </label>
          <div className="flex gap-2">
            <label className="min-w-0 flex-1 sm:flex-none"><span className="sr-only">Category</span>
              <select value={filters.cat} onChange={(e) => setFilters({ ...filters, cat: e.target.value as Filters["cat"] })} className={`${sel} w-full`}>
                <option value="finance">Markets and policy</option>
                <option value="all">Everything</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </label>
            <label className="min-w-0 flex-1 sm:flex-none"><span className="sr-only">Sort</span>
              <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as Filters["sort"] })} className={`${sel} w-full`}>
                {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {VENUES.map((v) => {
            const on = filters.venues.includes(v);
            return <button key={v} onClick={() => toggleVenue(v)} aria-pressed={on} className={`ctl border px-2 py-1 text-[11.5px] ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{VENUE_LABEL[v]}</button>;
          })}
          {(filters.venues.length > 0 || filters.q || filters.cat !== "finance" || filters.sort !== "volume") && (
            <button onClick={() => { setQ(""); setFilters(DEFAULT_FILTERS); }} className="ml-auto text-[11.5px] text-muted underline-offset-2 hover:text-fg hover:underline">Clear filters</button>
          )}
        </div>
      </div>

      <StaleNote venues={data?.venues} />
      {error && <p className="mb-2 rounded-[var(--radius)] border border-neg/40 bg-neg/10 p-2.5 text-[12px] text-neg">{error}</p>}
      {!data && busy && <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="shimmer h-14 ctl" />)}</div>}
      {data && !data.markets.length && (
        <Empty title={data.venues.every((v) => !v.ok) ? "The venues could not be reached" : "No open markets match"}>
          {data.venues.every((v) => !v.ok) ? "None of the venues answered just now. Try again in a few minutes." : "Try fewer words, another category, or Everything."}
        </Empty>
      )}
      {data && data.markets.length > 0 && (
        <div className={`panel overflow-hidden ${busy ? "opacity-70" : ""}`}>
          <div className="hidden grid-cols-[minmax(0,1fr)_92px_80px_72px_80px_96px] gap-2 border-b border-line px-3 py-1.5 text-[10.5px] uppercase tracking-wider text-muted md:grid">
            <span>Market</span><span>Venue</span><span className="text-right">Yes</span><span className="text-right">24h</span><span className="text-right">24h vol</span><span className="text-right">Closes</span>
          </div>
          <ul>
            {data.markets.map((m) => (
              <li key={m.key} className="border-b border-line last:border-b-0">
                <button onClick={() => onOpen(m.key)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-elevated md:grid-cols-[minmax(0,1fr)_92px_80px_72px_80px_96px] md:gap-2">
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-[12.5px] font-medium text-fg">{m.title}</span>
                    {m.outcome && <span className="mt-0.5 block truncate text-[11.5px] text-accent">{m.outcome}</span>}
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted md:hidden">
                      <VenueBadge venue={m.venue} small />{CATEGORY_LABEL[m.category]} · {usd(m.volume24h)} today · {closesIn(m.closeTime)}{m.watched && <Icon name="Bell" className="h-3 w-3 text-accent" />}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1 md:hidden"><ProbBar p={m.prob} /><Change v={m.change24h} /></span>
                  <span className="hidden items-center gap-1 md:flex"><VenueBadge venue={m.venue} />{m.watched && <Icon name="Bell" className="h-3 w-3 text-accent" />}</span>
                  <span className="hidden justify-end md:flex"><ProbBar p={m.prob} /></span>
                  <span className="hidden text-right md:block"><Change v={m.change24h} /></span>
                  <span className="hidden text-right font-mono text-[11.5px] tabular-nums text-muted md:block">{usd(m.volume24h)}</span>
                  <span className="hidden text-right text-[11px] text-muted md:block">{closesIn(m.closeTime)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-3 py-2 text-[11px] text-muted">{data.total > data.markets.length ? `The ${data.markets.length} most relevant of ${data.total.toLocaleString("en-US")} open markets. Search to narrow.` : `${data.total.toLocaleString("en-US")} open market${data.total === 1 ? "" : "s"}.`} Prices are each venue&apos;s yes price; Manifold&apos;s are play money.</p>
        </div>
      )}
    </div>
  );
}
