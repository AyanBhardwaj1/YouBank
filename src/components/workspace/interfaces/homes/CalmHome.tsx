"use client";

/**
 * Zen's Home: one calm column. A circle breathing slowly (eight seconds in and out), the date, the
 * greeting set large in a book face, the day in one line and a single question drawn as a line to write
 * on. Then the widgets one at a time, far apart, each named in italics and fading in only as it scrolls
 * into view (zen.css).
 */
import { WIDGET_LABEL } from "@/lib/desk/desk";
import { Reveal } from "@/components/motion/Reveal";
import { DayLine } from "../../home/DayLine";
import { ArrangeOrEmpty, AskBox, HomeTools, Suggestions, useHello, WidgetIn, type HomeProps } from "../../home/Kit";

export default function CalmHome({ widgets, facts, brief, arranging, setArranging }: HomeProps) {
  const { hello, name, today } = useHello();
  return (
    <div className="home-wall h-full overflow-auto">
      <div className="zn-col">
        <Reveal eager>
          <div className="zn-breath" aria-hidden />
          <p className="mt-8 text-[13px] text-muted">{today}</p>
          <h1 className="mt-2">{hello}{name}.</h1>
          <DayLine className="mt-3 !text-[15px] leading-relaxed" />
          <AskBox className="zn-ask mt-10" icon={false} label="Ask" placeholder="What would you like to know?"
            inputClass="min-w-0 flex-1 bg-transparent font-[family-name:var(--font-newsreader)] text-[19px] text-fg outline-none placeholder:text-faint" button="rounded-full px-3 py-1 text-[13px] text-accent hover:bg-accent-soft disabled:text-faint" />
          <Suggestions className="mt-4" chip="rounded-full px-3 py-1 text-[12.5px] text-muted hover:bg-accent-soft hover:text-fg" />
          <HomeTools arranging={arranging} onArrange={() => setArranging(!arranging)} className="mt-6 -ml-2 opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100" />
        </Reveal>
        <ArrangeOrEmpty widgets={widgets} arranging={arranging} setArranging={setArranging} className="mt-10" />
        {widgets.map((w) => (
          <Reveal key={w.id} as="section" className="zn-item">
            <h2 className="zn-label">{WIDGET_LABEL[w.id]}</h2>
            <div className="zn-body"><WidgetIn w={w} facts={facts} brief={brief} roomy /></div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
