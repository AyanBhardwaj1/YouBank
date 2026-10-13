"use client";

/**
 * The phone's main navigation: a tab bar along the bottom edge, where a thumb reaches. The first four
 * features this person pinned are the tabs (the same list as the desktop top bar, in the same order, so
 * arranging one arranges the other); "More" opens everything else as a sheet, with search, workflows
 * and the arrangement controls; it lights up while you are on a page that is not a tab (the top bar
 * names the page). The bar steps aside while the keyboard is up and keeps clear of the home bar.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { LayoutGrid } from "lucide-react";
import { featureOf, type NavFeature } from "@/lib/nav";
import { Icon } from "@/components/ui/Icon";
import { useNav } from "./NavContext";

const TABS = 4;

export function MobileTabBar() {
  const nav = useNav();
  const path = usePathname();
  const byId = new Map(nav.features.map((f) => [f.id, f]));
  const pinned = nav.prefs.pinned.flatMap((id) => byId.get(id) ?? []);
  // Fewer than four pinned: fill from the sidebar order so the bar never looks half empty.
  const tabs: NavFeature[] = [...pinned, ...nav.features.filter((f) => !pinned.includes(f))].slice(0, TABS);
  const current = featureOf(path, nav.features);
  const inTabs = !!current && tabs.some((t) => t.id === current.id);
  const moreActive = nav.open || (!!current && !inTabs);

  return (
    <nav aria-label="Main" className="hide-on-kb glass relative z-50 shrink-0 border-t border-line bg-bg/92 pb-safe px-safe md:hidden">
      <ul className="grid h-14 grid-cols-5">
        {tabs.map((f) => {
          const active = !nav.open && current?.id === f.id;
          return (
            <li key={f.id} className="min-w-0">
              <Link href={f.href} aria-current={active ? "page" : undefined} onClick={() => nav.setOpen(false)}
                className={`relative flex h-full flex-col items-center justify-center gap-1 transition-colors active:bg-elevated/60 ${active ? "text-accent" : "text-muted"}`}>
                {active && <motion.span layoutId="tab-active" className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" transition={{ type: "spring", stiffness: 520, damping: 42 }} />}
                <Icon name={f.icon} className="h-[22px] w-[22px]" strokeWidth={active ? 2.1 : 1.75} />
                <span className="max-w-full truncate px-1 text-[11px] font-medium leading-none">{short(f)}</span>
              </Link>
            </li>
          );
        })}
        <li className="min-w-0">
          <button type="button" onClick={() => nav.setOpen(!nav.open)} aria-expanded={nav.open} aria-haspopup="dialog"
            className={`relative flex h-full w-full flex-col items-center justify-center gap-1 transition-colors active:bg-elevated/60 ${moreActive ? "text-accent" : "text-muted"}`}>
            {moreActive && <motion.span layoutId="tab-active" className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" transition={{ type: "spring", stiffness: 520, damping: 42 }} />}
            <LayoutGrid className="h-[22px] w-[22px]" strokeWidth={moreActive ? 2.1 : 1.75} />
            <span className="max-w-full truncate px-1 text-[11px] font-medium leading-none">More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

/** Tab labels have about 70px: the long names get their everyday short form. */
function short(f: NavFeature): string {
  return ({ crm: "People", vc: "Private", news: "News", settings: "Settings", collab: "Together" } as Record<string, string>)[f.id] ?? f.label;
}
