"use client";

/** The Book against open prediction markets: which events touch which positions, and whether yes helps or hurts each. */
import Link from "next/link";
import { useState } from "react";
import type { MarketExposure } from "@/lib/predict/exposure";
import type { VenueState } from "@/lib/predict/types";
import { Change, closesIn, EffectTag, Empty, ProbBar, StaleNote, useLoad, VenueBadge } from "./ui";

type Res = { source: "book" | "tickers"; positions: number; tickers?: string[]; exposure: (MarketExposure & { line: string })[]; venues?: VenueState[] };

export function ExposureTab({ onOpen }: { onOpen: (key: string) => void }) {
  const [tickers, setTickers] = useState("");
  const [asked, setAsked] = useState("");
  const { data, error, busy } = useLoad<Res>(`/api/predict/exposure${asked ? `?tickers=${encodeURIComponent(asked)}` : ""}`);

  return (
    <div>
      <div className="panel mb-3 p-3">
        <p className="text-[12px] text-fg">{data?.source === "tickers" ? `Checking ${data.positions} ticker${data.positions === 1 ? "" : "s"} you entered.` : data?.positions ? `Checking the ${data.positions} position${data.positions === 1 ? "" : "s"} in your Book.` : "Checks the positions in your Book, or tickers you enter."} Links come from named companies and from rules (a Fed cut and homebuilders, tariffs and importers); the direction is how the name has tended to move, not a forecast.</p>
        <form onSubmit={(e) => { e.preventDefault(); setAsked(tickers.trim()); }} className="mt-2 flex flex-col gap-2 sm:flex-row">
          <label className="min-w-0 flex-1"><span className="sr-only">Tickers</span>
            <input value={tickers} onChange={(e) => setTickers(e.target.value.toUpperCase())} placeholder="Or enter tickers: JPM, DHI, WMT, COIN" className="ctl w-full border border-line bg-panel px-2.5 py-2 font-mono text-[12.5px] text-fg outline-none focus:border-accent" />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="ctl bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-60">Check</button>
            {asked && <button type="button" onClick={() => { setTickers(""); setAsked(""); }} className="ctl border border-line px-3 py-2 text-[12.5px] text-muted hover:text-fg">My Book</button>}
          </div>
        </form>
      </div>
      <StaleNote venues={data?.venues} />
      {error && <p className="mb-2 rounded-[var(--radius)] border border-neg/40 bg-neg/10 p-2.5 text-[12px] text-neg">{error}</p>}
      {!data && busy && <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="shimmer h-24 ctl" />)}</div>}
      {data && data.source === "book" && !data.positions && (
        <Empty icon="Briefcase" title="Your Book is empty">Add positions in <Link href="/app/book" className="text-accent hover:underline">Book</Link>, or enter tickers above.</Empty>
      )}
      {data && data.positions > 0 && !data.exposure.length && <Empty icon="Briefcase" title="No open market touches these names">None of today&apos;s traded markets names these companies or moves their sectors through a rule.</Empty>}
      <ul className="space-y-2">
        {data?.exposure.map((e) => (
          <li key={e.key} className="panel p-3">
            <div className="flex items-start justify-between gap-3">
              <button onClick={() => onOpen(e.key)} className="min-w-0 text-left">
                <span className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted"><VenueBadge venue={e.venue} small />{closesIn(e.closeTime)}</span>
                <span className="mt-1 line-clamp-2 block text-[12.5px] font-medium text-fg hover:text-accent">{e.label}</span>
              </button>
              <span className="flex shrink-0 flex-col items-end gap-1"><ProbBar p={e.prob} /><Change v={e.change24h} /></span>
            </div>
            <p className="mt-1.5 text-[11.5px] text-muted">{e.line}</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {e.positions.map((p) => <li key={p.ticker} title={p.why} className="flex items-center gap-1 rounded-[var(--radius)] border border-line px-1.5 py-0.5 text-[11px]"><span className="font-mono text-fg">{p.ticker}</span><span className="text-muted">{p.direction}</span><EffectTag effect={p.effect} /></li>)}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
