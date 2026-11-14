"use client";

/**
 * The pieces every Home is built from, whichever interface draws it (HomeDashboard for Classic, and
 * src/components/workspace/interfaces/homes for the others): the greeting, the question box, three
 * suggested questions, the Arrange and Customize controls, and a widget in its arrange slot. One source
 * for each, so an interface's Home rearranges and restyles them and never fetches anything twice.
 */
import Link from "next/link";
import { useState } from "react";
import { useNow } from "@/components/ui/useNow";
import { Icon } from "@/components/ui/Icon";
import type { BriefSeed } from "@/components/news/HomeBrief";
import type { WidgetPref } from "@/lib/desk/desk";
import { useWorkspace } from "../WorkspaceProvider";
import { Widget, type HomeFacts } from "./Widgets";
import { ArrangeBar, Slot } from "./Arrange";
import { useAsk } from "./ask";

export { useAsk };

/** By the browser's clock; "Hello" until the page is live, so the server's time zone never shows. */
export const greeting = (now: number | null) => { if (now === null) return "Hello"; const h = new Date(now).getHours(); return h < 5 ? "Late night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

/** The greeting, the first name, today's date and the clock (null until the page is live). */
export function useHello() {
  const { profile } = useWorkspace();
  const now = useNow(60_000);
  const first = profile.name ? profile.name.split(" ")[0] : "";
  const today = now === null ? " " : new Date(now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return { hello: greeting(now), first, name: first ? `, ${first}` : "", today, now };
}

/** Focus: three questions to start from, one click each (the role's prompt library). */
export function Suggestions({ className = "mt-2.5", chip = "rounded-full border border-line bg-panel px-2.5 py-1 text-[11.5px] text-muted hover:border-accent/50 hover:text-fg" }: { className?: string; chip?: string }) {
  const { prompts, href } = useAsk();
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {prompts.slice(0, 3).map((p) => <Link key={p} href={href(p)} className={`max-w-full truncate ${chip}`}>{p}</Link>)}
    </div>
  );
}

/**
 * The question box. `className` replaces the frame's look and `button` the Ask button's, so an interface
 * can draw it as a composer, a glowing pill or a plain line; what it does stays the same.
 */
export function AskBox({ big, className, inputClass, button, label = "Ask", icon = true, placeholder }: { big?: boolean; className?: string; inputClass?: string; button?: string; label?: string; icon?: boolean; placeholder?: string }) {
  const { ask, prompts } = useAsk();
  const [q, setQ] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); ask(q); }}
      className={className ?? `flex items-center gap-2 border border-line bg-panel focus-within:border-accent ${big ? "home-card px-4 py-3" : "panel px-3 py-2"}`}>
      {icon && <Icon name="Sparkles" className="h-4 w-4 shrink-0 text-accent" />}
      <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ask anything" name="ask" autoComplete="off"
        placeholder={placeholder ?? `Ask anything: a company, a deal, a number… e.g. “${prompts[0] ?? "What changed in the latest 10-Q?"}”`}
        className={inputClass ?? `min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-faint ${big ? "text-[15px]" : "text-[13px]"}`} />
      <button type="submit" disabled={!q.trim()} className={button ?? "ctl bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-50"}>{label}</button>
    </form>
  );
}

/** Arrange (move, resize, add and remove widgets right here) and Customize (Settings → My desk). */
export function HomeTools({ arranging, onArrange, className = "", item = "" }: { arranging: boolean; onArrange: () => void; className?: string; item?: string }) {
  const base = item || "ctl flex items-center gap-1 px-2 py-1 text-[11px] text-muted transition hover:text-fg";
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <button type="button" onClick={onArrange} aria-pressed={arranging} title="Move, add and remove widgets on this page"
        className={`${base} ${arranging ? "yb-on text-accent" : ""}`}><Icon name="LayoutGrid" className="h-3 w-3" />Arrange</button>
      <Link href="/app/settings?tab=desk" className={base} title="Choose features, widgets and their order"><Icon name="SlidersHorizontal" className="h-3 w-3" />Customize</Link>
    </div>
  );
}

/** What every interface's Home receives. */
export type HomeProps = { widgets: WidgetPref[]; facts: HomeFacts; brief?: BriefSeed; arranging: boolean; setArranging: (on: boolean) => void };

/** The bar shown while arranging (with the tray of widgets that are off), or the empty-Home line. */
export function ArrangeOrEmpty({ widgets, arranging, setArranging, className = "" }: Pick<HomeProps, "widgets" | "arranging" | "setArranging"> & { className?: string }) {
  if (arranging) return <div className={className}><ArrangeBar layout="home" onDone={() => setArranging(false)} /></div>;
  if (widgets.length) return null;
  return <p className={`text-[12.5px] text-muted ${className}`}>No widgets on. <button type="button" onClick={() => setArranging(true)} className="text-accent hover:underline">Add some</button>.</p>;
}

/** One widget, inside its arrange frame while arranging. */
export function WidgetIn({ w, facts, brief, roomy }: { w: WidgetPref; facts: HomeFacts; brief?: BriefSeed; roomy?: boolean }) {
  return <Slot w={w} layout="home"><Widget id={w.id} roomy={roomy} facts={facts} brief={brief} /></Slot>;
}
