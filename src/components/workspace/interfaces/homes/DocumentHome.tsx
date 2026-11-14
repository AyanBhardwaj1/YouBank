"use client";

/**
 * Bare's Home: a plain document. The date, the greeting, the day in one line, a table of contents that
 * jumps to each widget, a question box drawn as an underlined line, the keys, then every widget in order
 * under its own heading. No boxes, no icons, no motion (bare.css).
 */
import { WIDGET_LABEL } from "@/lib/desk/desk";
import { DayLine } from "../../home/DayLine";
import { ArrangeOrEmpty, AskBox, HomeTools, useHello, WidgetIn, type HomeProps } from "../../home/Kit";

export default function DocumentHome({ widgets, facts, brief, arranging, setArranging }: HomeProps) {
  const { hello, name, today } = useHello();
  return (
    <div className="home-wall h-full overflow-auto">
      <article className="bare-doc">
        <p className="text-[13px] text-muted">{today}</p>
        <h1>{hello}{name}.</h1>
        <DayLine className="mt-1 text-[14px]" />
        {widgets.length > 0 && (
          <nav aria-label="On this page" className="bare-toc mt-5 text-[14px]">
            <span className="text-muted">On this page: </span>
            {widgets.map((w, i) => <span key={w.id}>{i > 0 && <span className="text-muted"> · </span>}<a href={`#w-${w.id}`}>{WIDGET_LABEL[w.id]}</a></span>)}
          </nav>
        )}
        <AskBox className="bare-ask mt-6" icon={false} label="Ask ↵" placeholder="Ask anything…"
          inputClass="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-faint" button="text-[13px] text-[#0000ee] underline underline-offset-2 disabled:text-faint disabled:no-underline" />
        <p className="mt-3 text-[13px] text-muted">Keys: <kbd>1</kbd>–<kbd>9</kbd> open the pinned pages, <kbd>/</kbd> searches, <kbd>G</kbd> then a letter goes anywhere, <kbd>?</kbd> lists them all.</p>
        <HomeTools arranging={arranging} onArrange={() => setArranging(!arranging)} className="mt-2 -ml-2" item="flex items-center gap-1 px-2 py-0.5 text-[13px] text-[#0000ee] underline underline-offset-2" />
        <ArrangeOrEmpty widgets={widgets} arranging={arranging} setArranging={setArranging} className="mt-6" />
        {widgets.map((w) => (
          <section key={w.id} id={`w-${w.id}`} className="bare-section mt-9 scroll-mt-4">
            <WidgetIn w={w} facts={facts} brief={brief} roomy />
          </section>
        ))}
      </article>
    </div>
  );
}
