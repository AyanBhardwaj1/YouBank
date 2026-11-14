"use client";

/**
 * Prompt's Home: a conversation. YouBank greets you, says the day in a sentence, then brings each of your
 * widgets as a message of its own, one after another behind a typing indicator (CSS, from the first
 * paint; prompt.css). It ends with questions you could ask, one click each; on a phone, where the
 * composer is not shown, with a question box of its own.
 */
import Link from "next/link";
import { LogoMark } from "@/components/brand/Logo";
import type { WidgetId } from "@/lib/desk/desk";
import { DayLine } from "../../home/DayLine";
import { ArrangeOrEmpty, AskBox, HomeTools, useAsk, useHello, WidgetIn, type HomeProps } from "../../home/Kit";

const SAYS: Record<WidgetId, string> = {
  checklist: "A few steps that make YouBank yours:", brief: "This morning’s brief for your desk:", agenda: "Here’s what’s coming up in the next day:",
  waiting: "These are waiting for you:", watchlist: "Your names, as of now:", movers: "These moved the most:", start: "Tools picked for your role, if you want to start one:",
  ask: "A few things you could ask me:", runs: "Where you left off:", notes: "Your notes, as you left them:", private: "In private markets:", saved: "Your saved work:",
  markets: "Which markets are trading:", calc: "A calculator, if you need one:", recent: "Jump back in where you were:", book: "How the theses in your book are holding:",
};

function Avatar({ id }: { id: string }) {
  return <span className="pr-avatar" aria-hidden><LogoMark size={16} id={`thread-${id}`} /></span>;
}

export default function ThreadHome({ widgets, facts, brief, arranging, setArranging }: HomeProps) {
  const { hello, first, today } = useHello();
  const { prompts, href } = useAsk();
  const gap = 240;
  return (
    <div className="home-wall h-full overflow-auto">
      <div className="pr-thread" role="log" aria-label="Your day, from YouBank">
        <p className="text-center font-mono text-[10.5px] text-faint">{today}</p>
        <div className="pr-msg" style={{ "--d": "0ms" } as React.CSSProperties}>
          <Avatar id="hello" />
          <div className="pr-meta"><b>YouBank</b> · now</div>
          <span className="pr-typing" aria-hidden><i /><i /><i /></span>
          <div className="pr-body">
            <h1 className="pr-bubble text-[22px]">{hello}{first ? `, ${first}` : ""}. Here’s your day.</h1>
            <DayLine className="pr-bubble mt-1 !text-[15px] !text-muted" />
            <HomeTools arranging={arranging} onArrange={() => setArranging(!arranging)} className="mt-2 -ml-2" />
          </div>
        </div>
        <ArrangeOrEmpty widgets={widgets} arranging={arranging} setArranging={setArranging} className="mt-6" />
        {widgets.map((w, i) => (
          <div key={w.id} className="pr-msg" style={{ "--d": `${Math.min(i + 1, 7) * gap}ms` } as React.CSSProperties}>
            <Avatar id={w.id} />
            <div className="pr-meta"><b>YouBank</b> · {SAYS[w.id]}</div>
            <span className="pr-typing" aria-hidden><i /><i /><i /></span>
            <div className="pr-body pr-widget">
              <WidgetIn w={w} facts={facts} brief={brief} />
            </div>
          </div>
        ))}
        <div className="pr-msg" style={{ "--d": `${Math.min(widgets.length + 1, 8) * gap}ms` } as React.CSSProperties}>
          <Avatar id="end" />
          <div className="pr-meta"><b>YouBank</b> · anything else?</div>
          <span className="pr-typing" aria-hidden><i /><i /><i /></span>
          <div className="pr-body">
            <p className="pr-bubble">Ask me anything below, or type a page’s name to go there.</p>
            <div className="pr-quick">
              {prompts.slice(0, 3).map((p) => <Link key={p} href={href(p)} className="max-w-full truncate">{p}</Link>)}
            </div>
            <div className="mt-4 md:hidden">
              <AskBox className="flex items-center gap-2 rounded-[18px] bg-panel px-4 py-2.5" icon={false} button="rounded-full bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-40" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
