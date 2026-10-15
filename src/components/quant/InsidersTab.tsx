"use client";

/**
 * Q7 INSC: insider and activist events from SEC Form 4 and Schedule 13D, with the base rate of what followed
 * similar events. Insiders' habitual trades (the same month most years) are told apart from opportunistic ones;
 * plan trades, offerings and 10%-owner funds are left out. One company's trades with ?ticker; the board otherwise.
 */
import { useEffect, useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { Icon } from "@/components/ui/Icon";
import type { BoardRow } from "@/lib/quant/insiders/store";
import type { Tx } from "@/lib/quant/insiders/rules";
import { Button, Card, Disclosures, ErrorNote, Field, inputCls, json, num, pct, Table, usd, useQuantCall, useRun } from "./ui";

type BoardResp = { yours: BoardRow[]; market: BoardRow[]; pro: boolean; watched: number; disclosures: string[] };
type CompanyResp = { trades: (Tx & { habit: string; excluded: string | null })[]; events: BoardRow[]; disclosures: string[] };

export function InsidersTab({ initialTicker }: { initialTicker?: string }) {
  const [ticker, setTicker] = useState(initialTicker ?? "");
  const [shown, setShown] = useState(initialTicker ?? "");
  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-[12.5px] text-muted">When several insiders buy their own company&apos;s shares within weeks, or an activist files a 13D, history shows what tended to follow. Each event carries that base rate: how many past events it rests on, the average excess return with its interval, and how often it beat the market against how often any stock did.</p>
      <form onSubmit={(e) => { e.preventDefault(); setShown(ticker.trim().toUpperCase()); }} className="flex max-w-md items-end gap-2">
        <Field label="One company"><input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="Ticker" className={inputCls} /></Field>
        <Button type="submit">Show</Button>
        {shown && <Button kind="ghost" onClick={() => { setShown(""); setTicker(""); }}>Board</Button>}
      </form>
      {shown ? <Company ticker={shown} /> : <Board />}
    </div>
  );
}

function EventRow({ e, onRead }: { e: BoardRow; onRead?: (id: string) => void }) {
  const b = e.baseRate;
  return (
    <li className="rounded-md border border-line p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-fg">{e.symbol || e.issuerCik} <span className="font-normal text-muted">· {e.label}</span></span>
        <span className="text-[11px] text-muted">{e.acceptedAt.slice(0, 10)}{e.url && <> · <a href={e.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">filing</a></>}</span>
      </div>
      <p className="mt-1 text-[12px] text-fg">{e.explain}</p>
      {b ? <p className="mt-1 text-[11.5px] text-muted">After {num(b.n, 0)} similar events ({b.era}): average {pct(b.car, 1, true)} versus the market over sessions {b.window} (95%: {pct(b.low, 1, true)} to {pct(b.high, 1, true)}); beat it {pct(b.hitRate, 0)} of the time against {pct(b.unconditionalHitRate, 0)} for any stock.</p>
        : <p className="mt-1 text-[11.5px] text-muted">{e.pending ? "Base rate pending: fewer than 30 past events measured so far." : "No base rate for this type yet."}</p>}
      {onRead && e.type.startsWith("activist") && <button onClick={() => onRead(e.id)} className="mt-1 text-[11.5px] text-accent hover:underline">Read the stated purpose (Item 4)</button>}
    </li>
  );
}

function Board() {
  const call = useQuantCall();
  const r = useRun<BoardResp>();
  const item4 = useRun<{ reading: { intent: string; summary: string; quote: string; verified: boolean } }>();
  useEffect(() => { void r.run(() => call("/api/quant/insiders")); }, [call]); // eslint-disable-line react-hooks/exhaustive-deps
  const read = (eventId: string) => item4.run(() => call("/api/quant/insiders", json("POST", { eventId })));
  if (r.busy && !r.data) return <div className="shimmer h-40 rounded-md" />;
  const d = r.data;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title={`Companies you watch${d ? ` (${d.watched})` : ""}`}>
        {d?.yours.length ? <ul className="space-y-2">{d.yours.map((e) => <EventRow key={e.id} e={e} onRead={read} />)}</ul> : <p className="text-[12px] text-muted">No recent events on companies you watch in Edge or hold.</p>}
      </Card>
      <Card title="Across the market" right={d && !d.pro ? <span className="text-[11px] text-muted">Top 20; full board and CSV <PremiumBadge feature="quant.insiders-pro" /></span> : d?.pro ? <a href="/api/quant/insiders?format=csv" className="flex items-center gap-1 text-[11.5px] text-accent hover:underline"><Icon name="Download" className="h-3.5 w-3.5" />CSV</a> : null}>
        {d?.market.length ? <ul className="space-y-2">{d.market.map((e) => <EventRow key={e.id} e={e} onRead={read} />)}</ul> : <p className="text-[12px] text-muted">No events in the last 90 days yet. The feed reads EDGAR every ten minutes on weekdays.</p>}
      </Card>
      {(item4.data || item4.error || item4.busy) && (
        <Card title="Item 4: purpose of the transaction" className="lg:col-span-2">
          {item4.busy && <p className="text-[12px] text-muted">Reading…</p>}
          {item4.data && <><p className="text-[12.5px] text-fg"><b>{item4.data.reading.intent}.</b> {item4.data.reading.summary}</p><blockquote className="mt-2 border-l-2 border-line pl-2 text-[12px] italic text-muted">{item4.data.reading.quote}</blockquote><p className="mt-1 text-[11px] text-muted">{item4.data.reading.verified ? "The quote was found word for word in the filing." : "The quote could not be matched to the filing; read the filing itself."}</p></>}
          <ErrorNote error={item4.error} />
        </Card>
      )}
      <ErrorNote error={r.error} />
      <div className="lg:col-span-2"><Disclosures items={d?.disclosures} /></div>
    </div>
  );
}

function Company({ ticker }: { ticker: string }) {
  const call = useQuantCall();
  const r = useRun<CompanyResp>();
  useEffect(() => { void r.run(() => call(`/api/quant/insiders?ticker=${encodeURIComponent(ticker)}`)); }, [ticker, call]); // eslint-disable-line react-hooks/exhaustive-deps
  if (r.busy && !r.data) return <div className="shimmer h-40 rounded-md" />;
  const d = r.data;
  return (
    <div className="space-y-3">
      {d?.events.length ? <Card title={`${ticker}: events`}><ul className="space-y-2">{d.events.map((e) => <EventRow key={e.id} e={e} />)}</ul></Card> : null}
      <Card title={`${ticker}: insider trades`}>
        {d?.trades.length ? (
          <Table head={["Insider", "Date", "Code", "Shares", "Price", "Habit"]} rows={d.trades.slice(0, 60).map((t) => [
            <span key="n"><span className="text-fg">{t.ownerName}</span><span className="block text-[10.5px] text-muted">{t.title || (t.isDirector ? "Director" : t.isTenPct ? "10% owner" : "")}</span></span>,
            t.tradeDate, `${t.code}${t.acquired ? " (A)" : " (D)"}`, num(t.shares, 0), t.price === null ? "–" : usd(t.price), t.excluded ? `Left out: ${t.excluded}` : t.habit,
          ])} minWidth={520} />
        ) : <p className="text-[12px] text-muted">{r.error ? "" : "No open-market insider trades stored for this company yet."}</p>}
        <p className="mt-2 text-[11px] text-muted">Codes: P open-market purchase, S open-market sale (SEC Form 4). Routine insiders trade in the same month most years (Cohen, Malloy and Pomorski 2012); their trades carry little information.</p>
        <ErrorNote error={r.error} />
        <Disclosures items={d?.disclosures} />
      </Card>
    </div>
  );
}
