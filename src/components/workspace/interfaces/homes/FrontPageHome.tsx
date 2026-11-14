"use client";

/**
 * Broadsheet's Home: the front page. A banner headline (the greeting) with the day as its deck, the
 * morning brief as the lead story with a drop cap, a right-hand column of the shorter items and a
 * "letters" box for questions, then everything else set in ruled columns below a double rule
 * (broadsheet.css). Pages arrive like ink settling.
 */
import { isWide, type WidgetPref } from "@/lib/desk/desk";
import { ROLES } from "@/lib/roles";
import { useWorkspace } from "../../WorkspaceProvider";
import { DayLine } from "../../home/DayLine";
import { ArrangeOrEmpty, AskBox, HomeTools, useHello, WidgetIn, type HomeProps } from "../../home/Kit";

/** The lead story, the column beside it, and the rest. Pure. */
export function frontPage(widgets: WidgetPref[]): { lead: WidgetPref[]; side: WidgetPref[]; rest: WidgetPref[] } {
  const first = widgets.find((w) => w.id === "brief") ?? widgets.find(isWide) ?? widgets[0];
  // The lead story, and the next wide piece set under it, so the lead column carries the page.
  const lead = first ? [first, ...widgets.filter((w) => w !== first && isWide(w)).slice(0, 1)] : [];
  const others = widgets.filter((w) => !lead.includes(w));
  const side = others.filter((w) => !isWide(w)).slice(0, 3);
  return { lead, side, rest: others.filter((w) => !side.includes(w)) };
}

export default function FrontPageHome({ widgets, facts, brief, arranging, setArranging }: HomeProps) {
  const { hello, name, today } = useHello();
  const { profile } = useWorkspace();
  const { lead, side, rest } = frontPage(widgets);
  return (
    <div className="home-wall h-full overflow-auto">
      <div className="bs-front">
        <header className="bs-banner">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="bs-kicker">{ROLES[profile.role].label}{profile.firmName ? ` · ${profile.firmName}` : ""}</span>
            <HomeTools arranging={arranging} onArrange={() => setArranging(!arranging)} item="flex items-center gap-1 px-2 py-0.5 text-[12px] italic text-muted hover:text-accent" />
          </div>
          <h1 className="mt-3">{hello}{name}.</h1>
          <div className="bs-deck"><DayLine className="!text-[17px]" /></div>
          <p className="mt-1 text-[12px] uppercase tracking-[0.16em] text-muted">{today}</p>
        </header>
        <ArrangeOrEmpty widgets={widgets} arranging={arranging} setArranging={setArranging} className="mt-6" />
        {arranging ? (
          <div className="bs-cols">{widgets.map((w) => <div key={w.id}><WidgetIn w={w} facts={facts} brief={brief} /></div>)}</div>
        ) : (
          <>
            <div className="bs-grid">
              <div className="min-w-0 space-y-8">{lead.map((w, i) => <div key={w.id} className={i === 0 ? "bs-lead" : ""}><WidgetIn w={w} facts={facts} brief={brief} roomy={i === 0} /></div>)}</div>
              <aside className="min-w-0 space-y-6" aria-label="In brief">
                {side.map((w) => <WidgetIn key={w.id} w={w} facts={facts} brief={brief} />)}
                <section className="bs-letters" aria-label="Ask the desk">
                  <div className="bs-section-title"><h2>Letters to the desk</h2><span className="text-[12px] italic text-muted">answered with sources</span></div>
                  <AskBox className="flex items-center gap-2 py-1" icon={false} label="Send" placeholder="Your question…"
                    inputClass="min-w-0 flex-1 bg-transparent text-[15px] italic text-fg outline-none placeholder:text-faint" button="bg-accent px-3 py-1 text-accent-fg disabled:opacity-40" />
                </section>
              </aside>
            </div>
            {rest.length > 0 && <div className="bs-cols">{rest.map((w) => <div key={w.id}><WidgetIn w={w} facts={facts} brief={brief} /></div>)}</div>}
          </>
        )}
      </div>
    </div>
  );
}
