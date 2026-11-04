"use client";

/**
 * Editing the watchlist in place (Home's Watchlist widget): add names (several at once, "aapl, msft nvda"),
 * move them, take them off, or go back to the list the person's role suggests. Saved at once, and used
 * everywhere the app shows the watchlist (src/lib/desk/watchlist.ts).
 */
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useWorkspace } from "../WorkspaceProvider";
import { WATCHLIST_MAX, addTickers, moveTicker, parseTickers, removeTicker } from "@/lib/desk/watchlist";

export function WatchlistEditor({ onDone }: { onDone: () => void }) {
  const { config, ownWatchlist, setWatchlist } = useWorkspace();
  const list = config.watchlist;
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const add = () => {
    const { tickers, rejected } = parseTickers(text);
    if (!tickers.length) { setNote(rejected.length ? `“${rejected[0]}” is not a ticker.` : null); return; }
    const next = addTickers(list, tickers);
    setWatchlist(next);
    setText("");
    const dropped = tickers.length - (next.length - list.length) - tickers.filter((t) => list.includes(t)).length;
    setNote([rejected.length ? `Not tickers: ${rejected.join(", ")}.` : "", dropped > 0 ? `The watchlist holds ${WATCHLIST_MAX} names.` : ""].filter(Boolean).join(" ") || null);
  };
  const btn = "grid h-5 w-5 place-items-center rounded text-muted hover:bg-elevated hover:text-fg disabled:opacity-30";
  return (
    <div className="ctl border border-accent/40 bg-accent-soft/20 p-2.5">
      <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add tickers: AAPL, MSFT NVDA" aria-label="Add tickers" autoFocus
          className="num ctl min-w-0 flex-1 border border-line bg-panel px-2 py-1 text-[12px] uppercase text-fg outline-none placeholder:normal-case placeholder:text-faint focus:border-accent" />
        <button type="submit" disabled={!text.trim()} className="ctl bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-accent-fg disabled:opacity-50">Add</button>
        <button type="button" onClick={onDone} className="ctl border border-line px-2.5 py-1 text-[11.5px] text-muted hover:text-fg">Done</button>
      </form>
      {note && <p role="status" className="mt-1.5 text-[11px] text-muted">{note}</p>}
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Watchlist">
        {list.map((t, i) => (
          <li key={t} className="flex items-center gap-0.5 ctl border border-line bg-panel py-0.5 pl-2 pr-0.5">
            <span className="num mr-1 text-[12px] font-semibold">{t}</span>
            <button type="button" className={btn} disabled={i === 0} onClick={() => setWatchlist(moveTicker(list, t, -1))} aria-label={`Move ${t} earlier`}><Icon name="ChevronLeft" className="h-3 w-3" /></button>
            <button type="button" className={btn} disabled={i === list.length - 1} onClick={() => setWatchlist(moveTicker(list, t, 1))} aria-label={`Move ${t} later`}><Icon name="ChevronRight" className="h-3 w-3" /></button>
            <button type="button" className={btn} onClick={() => setWatchlist(removeTicker(list, t))} aria-label={`Remove ${t}`}><Icon name="X" className="h-3 w-3" /></button>
          </li>
        ))}
        {list.length === 0 && <li className="text-[11.5px] text-muted">No names. Add some above.</li>}
      </ul>
      {ownWatchlist && <button type="button" onClick={() => { setWatchlist(null); setNote("Back to the list your role suggests."); }} className="mt-2 text-[11px] text-muted hover:text-fg">Use my role&apos;s suggested list again</button>}
    </div>
  );
}
