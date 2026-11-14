"use client";

/** Where venues price the same question differently, net of fees, with the matcher's confidence. Information, not arbitrage. */
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { Spread } from "@/lib/predict/spread";
import { VENUE_LABEL, type Venue, type VenueState } from "@/lib/predict/types";
import { closesIn, Empty, points, prob, StaleNote, usd, useLoad, VenueBadge } from "./ui";

type Side = { key: string; venue: Venue; label: string; prob: number | null; bid: number | null; ask: number | null; volume24h: number | null; closeTime: string | null; url: string; realMoney: boolean };
type Row = { a: Side; b: Side; confidence: number; reasons: string[]; spread: Spread | null; annualised: number | null; days: number | null };
type Res = { pairs: Row[]; venues: VenueState[]; fees: Record<Venue, string>; note: string };

export function SpreadsTab({ onOpen }: { onOpen: (key: string) => void }) {
  const [min, setMin] = useState(0.6);
  const { data, error } = useLoad<Res>(`/api/predict/spreads?min=${min}`);
  const [realOnly, setRealOnly] = useState(true);
  const rows = (data?.pairs ?? []).filter((r) => !realOnly || (r.a.realMoney && r.b.realMoney));

  return (
    <div>
      <div className="panel mb-3 p-3">
        <p className="flex gap-1.5 text-[12px] text-fg"><Icon name="AlertTriangle" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />{data?.note ?? "Where venues price the same question differently. Not risk-free: venues' rules can resolve the same question differently."}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11.5px] text-muted">
          <label>Match confidence at least
            <select value={min} onChange={(e) => setMin(Number(e.target.value))} className="ctl ml-1.5 border border-line bg-panel px-2 py-1 text-[12px] text-fg">{[0.6, 0.7, 0.8, 0.9].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}</select>
          </label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={realOnly} onChange={(e) => setRealOnly(e.target.checked)} />Real-money venues only</label>
        </div>
      </div>
      <StaleNote venues={data?.venues} />
      {error && <p className="mb-2 rounded-[var(--radius)] border border-neg/40 bg-neg/10 p-2.5 text-[12px] text-neg">{error}</p>}
      {!data && !error && <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="shimmer h-24 ctl" />)}</div>}
      {data && !rows.length && <Empty icon="ArrowLeftRight" title="No matched markets right now">The matcher pairs a market only when its threshold, outcome, dates and names agree with another venue&apos;s. Lower the confidence, or include Manifold.</Empty>}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={`${r.a.key}|${r.b.key}`} className="panel p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {[r.a, r.b].map((s) => (
                <button key={s.key} onClick={() => onOpen(s.key)} className="min-w-0 rounded-[var(--radius)] border border-line p-2 text-left hover:border-line-strong">
                  <div className="flex items-center justify-between gap-2"><VenueBadge venue={s.venue} /><span className="font-mono text-[14px] font-semibold tabular-nums text-fg">{prob(s.prob)}</span></div>
                  <p className="mt-1 line-clamp-2 text-[12px] text-fg">{s.label}</p>
                  <p className="mt-1 text-[10.5px] text-muted">{s.bid !== null || s.ask !== null ? `${prob(s.bid)} / ${prob(s.ask)} · ` : ""}{usd(s.volume24h)} today · {closesIn(s.closeTime)}</p>
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
              <span className="text-muted">Gap <span className="font-mono tabular-nums text-fg">{points(r.spread?.gap ?? null)}</span></span>
              {r.spread ? (
                <>
                  <span className="text-muted">Yes on {VENUE_LABEL[r.spread.yesOn]}, no on {VENUE_LABEL[r.spread.noOn]}: costs <span className="font-mono tabular-nums text-fg">{prob(r.spread.cost)}</span> of $1, fees <span className="font-mono tabular-nums text-fg">{(r.spread.fees * 100).toFixed(1)}¢</span></span>
                  <span className="text-muted">After fees <span className={`font-mono font-semibold tabular-nums ${r.spread.net > 0 ? "text-pos" : "text-muted"}`}>{points(r.spread.net, 1)}</span>{r.annualised !== null && r.spread.net > 0 ? <span> (about {Math.round(r.annualised * 100)}% a year on the capital, to the later close)</span> : null}{!r.spread.quoted && " · from mid prices, rough"}</span>
                </>
              ) : <span className="text-muted">Play money on one side: no tradable spread.</span>}
              <span className="text-muted">Match {Math.round(r.confidence * 100)}%</span>
            </div>
            {r.reasons.length > 0 && <p className="mt-1 text-[11px] text-muted">Check the rules: {r.reasons.join("; ")}.</p>}
          </li>
        ))}
      </ul>
      {data && <p className="mt-3 text-[11px] text-muted">{Object.values(data.fees).join(" ")}</p>}
    </div>
  );
}
