"use client";

/**
 * Swiss's Home: a poster on a twelve-column grid. The day of the month as a giant numeral beside the
 * month, weekday and greeting; a red rule wipes across under them; a line of facts on the grid; then each
 * widget as a numbered section, wide ones over eight columns and the rest over four (swiss.css).
 */
import { isWide, WIDGET_LABEL } from "@/lib/desk/desk";
import { ROLES } from "@/lib/roles";
import { useWorkspace } from "../../WorkspaceProvider";
import { DayLine } from "../../home/DayLine";
import { ArrangeOrEmpty, AskBox, HomeTools, useHello, WidgetIn, type HomeProps } from "../../home/Kit";

export default function PosterHome({ widgets, facts, brief, arranging, setArranging }: HomeProps) {
  const { hello, name, now } = useHello();
  const { profile, tools } = useWorkspace();
  const d = now === null ? null : new Date(now);
  return (
    <div className="home-wall h-full overflow-auto">
      <div className="sw-poster">
        <div className="sw-head">
          <div className="sw-num num" aria-hidden style={{ fontFamily: "inherit" }}>{d ? String(d.getDate()).padStart(2, "0") : <span className="invisible">00</span>}</div>
          <div className="sw-title">
            <div className="text-[15px] font-bold">{d ? d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) : " "}</div>
            <div className="text-[15px] font-bold text-accent">{d ? d.toLocaleDateString("en-US", { weekday: "long" }) : " "}</div>
            <h1 className="mt-5">{hello}{name}.</h1>
          </div>
        </div>
        <div className="sw-rule" aria-hidden />
        <div className="sw-meta">
          <span>{ROLES[profile.role].label}{profile.firmName ? `, ${profile.firmName}` : ""}</span>
          <DayLine className="!text-[13px] !text-fg [grid-column:span_6]" />
          <span className="text-right text-muted">{tools.length} tools</span>
        </div>
        <div className="mt-6 grid grid-cols-12 items-end gap-5">
          <AskBox className="col-span-12 flex items-center gap-3 border-b-[3px] border-fg pb-2 lg:col-span-8" icon={false} label="Ask →" placeholder="Ask anything."
            inputClass="min-w-0 flex-1 bg-transparent text-[22px] font-bold tracking-[-0.02em] text-fg outline-none placeholder:text-faint" button="bg-accent px-4 py-2 text-[13px] font-bold text-accent-fg disabled:opacity-40" />
          <HomeTools arranging={arranging} onArrange={() => setArranging(!arranging)} className="col-span-12 lg:col-span-4 lg:justify-end" item="flex items-center gap-1 px-2 py-1 text-[12px] font-bold text-fg hover:text-accent" />
        </div>
        <ArrangeOrEmpty widgets={widgets} arranging={arranging} setArranging={setArranging} className="mt-8" />
        <div className="sw-grid">
          {widgets.map((w) => (
            <section key={w.id} className={`sw-cell ${isWide(w) ? "sw-wide" : "yb-narrow"}`} aria-label={WIDGET_LABEL[w.id]}>
              <h2 className="sw-n">{WIDGET_LABEL[w.id]}</h2>
              <div className="sw-body"><WidgetIn w={w} facts={facts} brief={brief} /></div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
