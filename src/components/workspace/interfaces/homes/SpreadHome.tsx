"use client";

/**
 * Ledger's Home: the book lies open. The left page is the accounts (the figures: the book, the watchlist,
 * movers, markets, saved work, the calculator), headed with the date and the greeting; the right page is
 * the journal (the brief, what is coming up and waiting, notes, runs and the rest), headed with the folio.
 * Each entry is written under an italic heading ruled out to the margin, and a gutter shadow runs down
 * the middle (ledger.css). On a narrow screen the pages follow one another.
 */
import type { WidgetId, WidgetPref } from "@/lib/desk/desk";
import { WIDGET_LABEL } from "@/lib/desk/desk";
import { DayLine } from "../../home/DayLine";
import { ArrangeOrEmpty, AskBox, HomeTools, useHello, WidgetIn, type HomeProps } from "../../home/Kit";
import { dayOfYear } from "../../InterfaceChrome";

const FIGURES = new Set<WidgetId>(["book", "watchlist", "movers", "markets", "saved", "calc", "private"]);

/** Which page each widget is written on: figures on the left, the journal on the right. Pure. */
export function pages(widgets: WidgetPref[]): { accounts: WidgetPref[]; journal: WidgetPref[] } {
  return { accounts: widgets.filter((w) => FIGURES.has(w.id)), journal: widgets.filter((w) => !FIGURES.has(w.id)) };
}

export default function SpreadHome({ widgets, facts, brief, arranging, setArranging }: HomeProps) {
  const { hello, name, today, now } = useHello();
  const { accounts, journal } = pages(widgets);
  const entry = (w: WidgetPref) => (
    <section key={w.id} className="ld-entry yb-narrow" aria-label={WIDGET_LABEL[w.id]}>
      <h2 className="ld-label">{WIDGET_LABEL[w.id]}</h2>
      <div className="ld-body"><WidgetIn w={w} facts={facts} brief={brief} /></div>
    </section>
  );
  return (
    <div className="home-wall h-full overflow-auto">
      <div className="ld-spread">
        <div className="ld-page">
          <div className="ld-head"><span>Accounts</span><span>{today}</span></div>
          <h1>{hello}{name}.</h1>
          <DayLine className="mt-2 !text-[14px] italic" />
          <AskBox className="mt-4 flex items-center gap-2 border-b border-line-strong py-1" icon={false} label="Enter" placeholder="Write a question to look up…"
            inputClass="min-w-0 flex-1 bg-transparent text-[15px] italic text-fg outline-none placeholder:text-faint" button="bg-accent px-3 py-1 text-[12.5px] text-accent-fg disabled:opacity-40" />
          <HomeTools arranging={arranging} onArrange={() => setArranging(!arranging)} className="mb-6 mt-2 -ml-2" item="flex items-center gap-1 px-2 py-0.5 text-[12.5px] italic text-muted hover:text-accent" />
          <ArrangeOrEmpty widgets={widgets} arranging={arranging} setArranging={setArranging} className="mb-6" />
          {arranging ? widgets.map(entry) : accounts.map(entry)}
        </div>
        {!arranging && (
          <div className="ld-page">
            <div className="ld-head"><span>Journal</span><span>Folio {now === null ? " " : dayOfYear(new Date(now))}</span></div>
            {journal.map(entry)}
          </div>
        )}
      </div>
    </div>
  );
}
