"use client";

/**
 * Blueprint's Home: a general-arrangement drawing. A title row (sheet number, the greeting, the drawing's
 * notes), a dimension line, then each widget as a detail on the sheet: its outline draws itself in, one
 * after another, and a lettered callout names it underneath (DETAIL A · THE BOOK). Wide widgets take two
 * of the three columns (blueprint.css).
 */
import { isWide, WIDGET_LABEL } from "@/lib/desk/desk";
import { DayLine } from "../../home/DayLine";
import { ArrangeOrEmpty, AskBox, HomeTools, useHello, WidgetIn, type HomeProps } from "../../home/Kit";

/** A, B, … Z, AA, AB… for detail callouts. Pure. */
export const detailLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : detailLetter(Math.floor(i / 26) - 1) + detailLetter(i % 26));

export default function DrawingHome({ widgets, facts, brief, arranging, setArranging }: HomeProps) {
  const { hello, name, today } = useHello();
  return (
    <div className="home-wall h-full overflow-auto">
      <div className="bp-sheet">
        <div className="bp-title">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.2em] text-muted">Sheet 01 · General arrangement · {today}</div>
            <h1 className="mt-2">{hello}{name}</h1>
            <DayLine className="mt-2 uppercase tracking-[0.06em]" />
          </div>
          <div className="w-[min(520px,100%)]">
            <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted">Note 1 · Query</div>
            <AskBox className="flex items-center gap-2 border border-dashed border-line-strong px-3 py-2 focus-within:border-solid focus-within:border-accent" icon={false} label="Run"
              placeholder="Ask about a company, a deal, a number…" inputClass="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint" />
            <HomeTools arranging={arranging} onArrange={() => setArranging(!arranging)} className="mt-1 -ml-2" item="flex items-center gap-1 px-2 py-1 text-[10.5px] uppercase tracking-[0.12em] text-muted hover:text-accent" />
          </div>
        </div>
        <div className="bp-dims" aria-hidden><span>{widgets.length} details · scale 1:1 · all figures live</span></div>
        <ArrangeOrEmpty widgets={widgets} arranging={arranging} setArranging={setArranging} className="mb-6" />
        <div className="bp-details">
          {widgets.map((w, i) => (
            <section key={w.id} className={`bp-detail ${isWide(w) ? "bp-wide" : "yb-narrow"}`} aria-label={`Detail ${detailLetter(i)}: ${WIDGET_LABEL[w.id]}`} style={{ "--d": `${Math.min(i, 8) * 110}ms` } as React.CSSProperties}>
              <svg className="bp-outline" aria-hidden preserveAspectRatio="none"><rect x="0.5" y="0.5" width="100%" height="100%" pathLength={1} /></svg>
              <div className="bp-body"><WidgetIn w={w} facts={facts} brief={brief} /></div>
              <div className="bp-callout"><b>{detailLetter(i)}</b>Detail {detailLetter(i)} · {WIDGET_LABEL[w.id]}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
