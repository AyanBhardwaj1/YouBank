"use client";

/**
 * Home, in the layout the person chose (Settings → My desk, or the switch at the top of the page):
 * - Focus: one question box and the few widgets that need you, nothing else;
 * - Home: a calm, roomy page for the day, with larger type and cards;
 * - Desk: everything, dense, in two columns.
 * The widgets, their order and their width are the person's (src/lib/desk/desk.ts), arranged in Settings
 * → My desk or right here with Arrange (home/Arrange.tsx). These three layouts are Classic's; every other
 * interface (Settings → Style → Interface) composes Home its own way from the same widgets (HOMES below).
 */
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState, type ComponentType } from "react";
import { useNow } from "@/components/ui/useNow";
import { takeArrange } from "@/lib/client/arrange";
import { useWorkspace } from "./WorkspaceProvider";
import { ROLES } from "@/lib/roles";
import { Icon } from "@/components/ui/Icon";
import { Reveal } from "@/components/motion/Reveal";
import type { BriefSeed } from "@/components/news/HomeBrief";
import { LAYOUTS, isWide, type HomeLayout } from "@/lib/desk/desk";
import { Widget, type HomeFacts } from "./home/Widgets";
import { ArrangeBar, ArrangeProvider, Slot } from "./home/Arrange";
import { DayLine } from "./home/DayLine";
import { AskBox, greeting, Suggestions, type HomeProps } from "./home/Kit";
import { homeOf, type HomeComposition } from "@/lib/desk/interfaces";

/**
 * Every interface but Classic composes Home its own way (src/lib/desk/interfaces.ts `home`), from the same
 * widgets: a plain document, a cinematic reel, a conversation, a canvas, a front page, instruments, a
 * desktop, a poster, a book spread, a drawing sheet, one calm column, a bento box. Each is its own chunk,
 * loaded only by the people who use that interface.
 */
const HOMES: Record<Exclude<HomeComposition, "desk">, ComponentType<HomeProps>> = {
  document: dynamic(() => import("./interfaces/homes/DocumentHome")),
  cinema: dynamic(() => import("./interfaces/homes/CinemaHome")),
  thread: dynamic(() => import("./interfaces/homes/ThreadHome")),
  canvas: dynamic(() => import("./interfaces/homes/CanvasHome")),
  frontpage: dynamic(() => import("./interfaces/homes/FrontPageHome")),
  instruments: dynamic(() => import("./interfaces/homes/InstrumentsHome")),
  desktop: dynamic(() => import("./interfaces/homes/DesktopHome")),
  poster: dynamic(() => import("./interfaces/homes/PosterHome")),
  spread: dynamic(() => import("./interfaces/homes/SpreadHome")),
  drawing: dynamic(() => import("./interfaces/homes/DrawingHome")),
  calm: dynamic(() => import("./interfaces/homes/CalmHome")),
  bento: dynamic(() => import("./interfaces/homes/BentoHome")),
};

const LAYOUT_LABEL: Record<HomeLayout, string> = { focus: "Focus", home: "Home", desk: "Desk" };

function LayoutSwitch({ arranging, onArrange }: { arranging: boolean; onArrange: () => void }) {
  const { desk, setDesk } = useWorkspace();
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Home layout">
      {LAYOUTS.map((l) => (
        <button key={l} type="button" role="radio" aria-checked={desk.layout === l} onClick={() => setDesk({ layout: l })}
          className={`ctl px-2 py-1 text-[11px] transition ${desk.layout === l ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{LAYOUT_LABEL[l]}</button>
      ))}
      <button type="button" onClick={onArrange} aria-pressed={arranging} title="Move, resize, add and remove widgets on this page"
        className={`ctl ml-1 flex items-center gap-1 px-2 py-1 text-[11px] transition ${arranging ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}><Icon name="LayoutGrid" className="h-3 w-3" />Arrange</button>
      <Link href="/app/settings?tab=desk" className="ctl flex items-center gap-1 px-2 py-1 text-[11px] text-muted hover:text-fg" title="Choose features, widgets and their order"><Icon name="SlidersHorizontal" className="h-3 w-3" />Customize</Link>
    </div>
  );
}

export function HomeDashboard({ facts, brief }: { facts: HomeFacts; brief?: BriefSeed }) {
  const { profile, tools, desk, look } = useWorkspace();
  const on = desk.widgets.filter((w) => w.on);
  const [arranging, setArranging] = useState(false);
  // "Arrange" from elsewhere (What's new).
  useEffect(() => {
    const on = () => { if (takeArrange()) setArranging(true); };
    window.addEventListener("yb:arrange", on);
    // Asked for before Home was here (What's new, from another page).
    const t = window.setTimeout(on, 0);
    return () => { window.removeEventListener("yb:arrange", on); window.clearTimeout(t); };
  }, []);
  const sw = <LayoutSwitch arranging={arranging} onArrange={() => setArranging((a) => !a)} />;
  const bar = arranging && <ArrangeBar layout={desk.layout} onDone={() => setArranging(false)} />;
  const empty = on.length === 0 && !arranging && <p className="text-[12.5px] text-muted">No widgets on. <button type="button" onClick={() => setArranging(true)} className="text-accent hover:underline">Add some</button>.</p>;
  const name = profile.name ? `, ${profile.name.split(" ")[0]}` : "";
  const now = useNow(60_000);
  const today = now === null ? "\u00a0" : new Date(now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const composition = homeOf(look.ui);
  if (composition !== "desk") {
    const Composed = HOMES[composition];
    return <ArrangeProvider on={arranging}><Composed widgets={on} facts={facts} brief={brief} arranging={arranging} setArranging={setArranging} /></ArrangeProvider>;
  }

  if (desk.layout === "focus") {
    return (
      <ArrangeProvider on={arranging}><div className="home-wall h-full overflow-auto">
        <div className="mx-auto max-w-[760px] px-5 py-10">
          <Reveal eager>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[12px] text-muted">{today}</span>{sw}</div>
            <h1 className="mt-6 text-[28px] font-semibold tracking-tight">{greeting(now)}{name}.</h1>
            <p className="mt-1 text-[13px] text-muted">What do you need?</p>
            <DayLine className="mt-1" />
            <div className="mt-5"><AskBox big /></div>
            <Suggestions />
          </Reveal>
          <div className="mt-6 space-y-4">
            {bar}
            {on.map((w, i) => <Reveal key={w.id} eager delay={i * 40}><Slot w={w} layout="focus"><Widget id={w.id} facts={facts} brief={brief} /></Slot></Reveal>)}
            {empty}
          </div>
        </div>
      </div></ArrangeProvider>
    );
  }

  if (desk.layout === "home") {
    return (
      <ArrangeProvider on={arranging}><div className="home-wall h-full overflow-auto">
        <div className="mx-auto max-w-[1180px] px-5 py-6">
          <Reveal eager>
            <div className="home-hero home-card px-6 py-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[12px] text-muted">{today}</div>
                  <h1 className="mt-1 text-[30px] font-semibold tracking-tight">{greeting(now)}{name}.</h1>
                  <p className="mt-1 text-[13px] text-muted">{ROLES[profile.role].label}{profile.firmName ? ` · ${profile.firmName}` : ""}. Here is your day.</p>
                  <DayLine className="mt-1 text-fg/80" />
                </div>
                {sw}
              </div>
              <div className="mt-5"><AskBox big /></div>
            </div>
          </Reveal>
          <div className="mt-5">{bar}{empty}</div>
          <div className="grid grid-cols-1 gap-5 lg:grid-flow-row-dense lg:grid-cols-2">
            {on.map((w, i) => <Reveal key={w.id} eager delay={i * 40} className={isWide(w) ? "lg:col-span-2" : ""}><Slot w={w} layout="home"><Widget id={w.id} roomy facts={facts} brief={brief} /></Slot></Reveal>)}
          </div>
        </div>
      </div></ArrangeProvider>
    );
  }

  const main = on.filter((w) => isWide(w));
  const side = on.filter((w) => !isWide(w));
  const first = profile.firmTicker || undefined;
  return (
    <ArrangeProvider on={arranging}><div className="home-wall h-full overflow-auto">
      <div className="mx-auto max-w-[1280px] px-5 py-6">
        <Reveal eager>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight">{greeting(now)}{name}.</h1>
              <p className="mt-1 text-[12.5px] text-muted">{ROLES[profile.role].label}{profile.specialty ? ` · ${profile.specialty}` : ""}{profile.firmName ? ` · ${profile.firmName}` : ""}{profile.seniority ? ` · ${profile.seniority}` : ""} · <Link href="/app/profile" className="hover:text-fg">change</Link></p>
              <DayLine className="mt-0.5" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {sw}
              <Link href={`/app/terminal${first ? `?ticker=${first}` : ""}`} className="ctl flex items-center gap-1.5 bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-fg transition hover:brightness-110"><Icon name="Terminal" className="h-3.5 w-3.5" /> Open the terminal</Link>
              <Link href="/app/tools" className="ctl flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12.5px] text-fg transition hover:border-accent/50 hover:text-accent"><Icon name="Wand2" className="h-3.5 w-3.5" /> {tools.length} tools</Link>
            </div>
          </div>
        </Reveal>

        <div className="mt-6">{bar}{empty}</div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">{main.map((w) => <Reveal key={w.id} eager><Slot w={w} layout="desk"><Widget id={w.id} facts={facts} brief={brief} /></Slot></Reveal>)}</div>
          <div className="space-y-4">{side.map((w, i) => <Reveal key={w.id} eager delay={60 + i * 40}><Slot w={w} layout="desk"><Widget id={w.id} facts={facts} brief={brief} /></Slot></Reveal>)}</div>
        </div>
      </div>
    </div></ArrangeProvider>
  );
}
