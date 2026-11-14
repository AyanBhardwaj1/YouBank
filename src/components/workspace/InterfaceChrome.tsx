"use client";

/**
 * The pieces of frame some interfaces add (src/lib/desk/interfaces.ts, drawn by src/app/interfaces.css):
 * - Dock (Glass, Bento): the pinned features as big buttons floating along the bottom, names on hover.
 * - IndexRail (Swiss): the pinned features as a numbered index down the left side.
 * - StatusStrip (Cockpit, Blueprint, Ledger): a line along the bottom with the clock, the New York session,
 *   the page, and the interface's own furniture (a title block, a folio).
 * - EditionLine (Broadsheet): the date and the edition under the masthead.
 * All of them are desktop furniture: on a phone every interface keeps the bottom tab bar (MobileTabBar).
 * Times render only after mount, so the server's HTML and the browser's first render agree.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { featureOf, type NavFeature } from "@/lib/nav";
import { chromeOf, INTERFACE_META, type InterfaceId } from "@/lib/desk/interfaces";
import { EXCHANGES, marketStatus, until } from "@/lib/desk/markets";
import { Icon } from "@/components/ui/Icon";
import { useTheme } from "@/components/theme/ThemeProvider";
import { themeById } from "@/lib/themes";
import { useNav } from "./NavContext";
import { useWorkspace } from "./WorkspaceProvider";

const NYSE = EXCHANGES.find((e) => e.id === "nyse")!;

export function useInterface(): InterfaceId {
  return useWorkspace().look.ui;
}

/** The pinned features, in the person's order, falling back to the first features so the piece is never empty. */
function usePinned(): { items: NavFeature[]; current: NavFeature | undefined } {
  const nav = useNav();
  const path = usePathname();
  const byId = new Map(nav.features.map((f) => [f.id, f]));
  const pinned = nav.prefs.pinned.flatMap((id) => byId.get(id) ?? []);
  const items = pinned.length >= 3 ? pinned : [...pinned, ...nav.features.filter((f) => !pinned.includes(f))].slice(0, 8);
  return { items, current: featureOf(path, nav.features) };
}

/** A clock that ticks every 20 seconds once mounted (null on the server and the first render). */
function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 20_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Dock() {
  const { items, current } = usePinned();
  const nav = useNav();
  return (
    <nav aria-label="Pinned features" className="yb-dock max-md:hidden">
      {items.map((f) => (
        <Link key={f.id} href={f.href} aria-current={current?.id === f.id ? "page" : undefined} aria-label={f.label}>
          <Icon name={f.icon} className="h-5 w-5" />
          <span className="yb-dock-tip" aria-hidden>{f.label}</span>
        </Link>
      ))}
      <button type="button" onClick={() => nav.setOpen(!nav.open)} aria-expanded={nav.open} aria-label="All features and workflows"
        className="relative grid h-[46px] w-[46px] place-items-center rounded-[14px] text-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">
        <Icon name="LayoutGrid" className="h-5 w-5" />
      </button>
    </nav>
  );
}

function IndexRail() {
  const { items, current } = usePinned();
  const nav = useNav();
  return (
    <nav aria-label="Pinned features" className="yb-rail max-md:hidden">
      {items.map((f, i) => (
        <Link key={f.id} href={f.href} aria-current={current?.id === f.id ? "page" : undefined}>
          <span className="yb-rail-n">{String(i + 1).padStart(2, "0")}</span><span className="truncate">{f.label}</span>
        </Link>
      ))}
      <button type="button" onClick={() => nav.setOpen(!nav.open)} aria-expanded={nav.open}
        className="mt-4 text-left text-[12px] font-bold uppercase tracking-[0.06em] text-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">
        Everything else →
      </button>
    </nav>
  );
}

function Session({ now }: { now: Date }) {
  const s = marketStatus(NYSE, now);
  const open = s.state === "open";
  return (
    <span title="Regular session, weekdays; exchange holidays are not counted">
      <span className="yb-dot" style={{ background: open ? "var(--pos)" : "var(--faint)" }} aria-hidden />
      New York {open ? "open" : "closed"}{s.next ? ` · ${s.nextIs} in ${until(s.next, now)}` : ""}
    </span>
  );
}

const time = (now: Date) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(now);
const longDate = (now: Date) => new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);

/** Day of the year, for the Ledger's folio number. Pure. */
export function dayOfYear(d: Date): number {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86_400_000);
}

function StatusStrip({ kind, ui }: { kind: "instrument" | "titleblock" | "folio"; ui: InterfaceId }) {
  const now = useNow();
  const { current } = usePinned();
  const page = current?.label ?? "YouBank";
  if (kind === "folio") {
    return (
      <div className="yb-strip max-md:hidden" role="contentinfo" aria-label="Status">
        {now && <span>Folio {dayOfYear(now)}</span>}
        <span>{page}</span>
        {now && <span>{longDate(now)}</span>}
        {now && <span className="ml-auto"><Session now={now} /></span>}
      </div>
    );
  }
  if (kind === "titleblock") {
    return (
      <div className="yb-strip max-md:hidden" role="contentinfo" aria-label="Status">
        <span>Sheet · {page}</span>
        <span>Dwg YB-{current ? current.id.toUpperCase() : "HOME"}</span>
        {now && <span>{new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }).format(now)}</span>}
        <span>Scale 1:1</span>
        {now && <span className="ml-auto"><Session now={now} /></span>}
      </div>
    );
  }
  return (
    <div className="yb-strip max-md:hidden" role="contentinfo" aria-label="Status">
      <span style={{ color: "var(--accent)" }}>● {INTERFACE_META[ui].name}</span>
      <span>{page}</span>
      {now && <span><Session now={now} /></span>}
      {now && <span className="ml-auto num">{time(now)}</span>}
    </div>
  );
}

function EditionLine() {
  const now = useNow();
  return (
    <div className="yb-edition max-md:hidden">
      <span>{now ? longDate(now) : " "}</span>
      <span className="not-italic tracking-[0.18em] uppercase text-[10px]">Markets edition</span>
      <span>{now ? <Session now={now} /> : " "}</span>
    </div>
  );
}

/** What goes above the page row (under the top bar). Also keeps the phone's browser bar in the interface's colour. */
export function ChromeTop() {
  const ui = useInterface();
  const { themeId } = useTheme();
  useEffect(() => {
    // Classic leaves the bar to the theme (ThemeProvider); an interface brings its own background.
    const meta = document.querySelector('meta[name="theme-color"]');
    const bg = ui === "classic" ? themeById(themeId).vars.bg : getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if (meta && bg) meta.setAttribute("content", bg);
  }, [ui, themeId]);
  return chromeOf(ui).editionLine ? <EditionLine /> : null;
}

/** What goes beside the page, on the left. */
export function ChromeSide() {
  const ui = useInterface();
  return chromeOf(ui).nav === "rail" ? <IndexRail /> : null;
}

/** What floats over the page (the dock). */
export function ChromeFloat() {
  const ui = useInterface();
  return chromeOf(ui).nav === "dock" ? <Dock /> : null;
}

/** What goes under the page row (the status strip). */
export function ChromeBottom() {
  const ui = useInterface();
  const strip = chromeOf(ui).statusStrip;
  return strip ? <StatusStrip kind={strip} ui={ui} /> : null;
}
