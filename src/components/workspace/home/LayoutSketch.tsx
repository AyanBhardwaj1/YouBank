import type { HomeLayout } from "@/lib/desk/desk";

/** The three Home layouts, named and drawn small (Settings → My desk, and onboarding). */
export const LAYOUT_INFO: Record<HomeLayout, { name: string; icon: string; blurb: string }> = {
  focus: { name: "Focus", icon: "Focus", blurb: "One question box and only what needs you. Quiet." },
  home: { name: "Home", icon: "Sofa", blurb: "A calm, roomy page for the day: larger type, cards, your agenda first." },
  desk: { name: "Desk", icon: "LayoutGrid", blurb: "Everything at once, dense, in two columns." },
};

export function LayoutSketch({ layout }: { layout: HomeLayout }) {
  const bar = "rounded-sm bg-line";
  if (layout === "focus") return <div className="flex h-14 flex-col items-center gap-1 p-2"><div className={`${bar} h-2 w-1/2`} /><div className="h-2.5 w-3/4 rounded-sm bg-accent/40" /><div className={`${bar} h-2 w-3/4`} /><div className={`${bar} h-2 w-3/4`} /></div>;
  if (layout === "home") return <div className="flex h-14 flex-col gap-1 p-2"><div className="h-4 rounded-sm bg-accent/30" /><div className="grid flex-1 grid-cols-2 gap-1"><div className={bar} /><div className={bar} /></div></div>;
  return <div className="grid h-14 grid-cols-[2fr_1fr] gap-1 p-2"><div className="flex flex-col gap-1"><div className={`${bar} h-3`} /><div className={`${bar} flex-1`} /></div><div className="flex flex-col gap-1"><div className={`${bar} h-2`} /><div className={`${bar} h-2`} /><div className={`${bar} h-2`} /></div></div>;
}
