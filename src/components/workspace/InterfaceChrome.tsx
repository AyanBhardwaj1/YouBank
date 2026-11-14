"use client";

/**
 * The frame each interface draws around the page (src/lib/desk/interfaces.ts, styled by src/app/interfaces):
 * - ChromeTop, under the top bar: Broadsheet's edition line.
 * - ChromeInBar, inside the top bar: Glass's menu-bar clock.
 * - ChromeSide, left of the page: Swiss's numbered index rail, Canvas's tool rail.
 * - ChromeFloat, over the page: the dock (Glass, Bento), Spectacle's orb, Prompt's composer, Ledger's
 *   thumb tabs.
 * - ChromeBottom, under the page: the status strip (Cockpit's instruments, Ledger's folio, Blueprint's
 *   title block) and Blueprint's sheet tabs.
 * - ChromeEffects: how pages arrive, and each interface's behaviour (interfaces/Effects.tsx).
 * The larger pieces live in src/components/workspace/interfaces and load only for the interface that uses
 * them. All of it is desktop furniture: on a phone every interface keeps the bottom tab bar, in its own
 * style. Times render only after mount, so the server's HTML and the browser's first render agree.
 */
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { chromeOf, INTERFACE_META, type InterfaceId } from "@/lib/desk/interfaces";
import { EXCHANGES, marketStatus, until } from "@/lib/desk/markets";
import { useTheme } from "@/components/theme/ThemeProvider";
import { themeById } from "@/lib/themes";
import { useNav } from "./NavContext";
import { useWorkspace } from "./WorkspaceProvider";
import { useClock, usePinned } from "./interfaces/shared";

const Dock = dynamic(() => import("./interfaces/Dock"));
const Orb = dynamic(() => import("./interfaces/Orb"));
const Composer = dynamic(() => import("./interfaces/Composer"));
const ToolRail = dynamic(() => import("./interfaces/ToolRail"));
const ThumbTabs = dynamic(() => import("./interfaces/ThumbTabs"));
const SheetTabs = dynamic(() => import("./interfaces/SheetTabs"));
const Effects = dynamic(() => import("./interfaces/Effects"), { ssr: false });

const NYSE = EXCHANGES.find((e) => e.id === "nyse")!;

export function useInterface(): InterfaceId {
  return useWorkspace().look.ui;
}

function IndexRail() {
  const { items, current } = usePinned();
  const nav = useNav();
  return (
    <nav aria-label="Pinned features" className="yb-rail">
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
  const now = useClock();
  const { current } = usePinned();
  const page = current?.label ?? "YouBank";
  if (kind === "folio") {
    return (
      <div className="yb-strip" role="contentinfo" aria-label="Status">
        {now && <span>Folio {dayOfYear(now)}</span>}
        <span>{page}</span>
        {now && <span>{longDate(now)}</span>}
        {now && <span className="ml-auto"><Session now={now} /></span>}
      </div>
    );
  }
  if (kind === "titleblock") {
    return (
      <div className="yb-strip" role="contentinfo" aria-label="Status">
        <span>Sheet · {page}</span>
        <span>Dwg YB-{current ? current.id.toUpperCase() : "HOME"}</span>
        {now && <span>{new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }).format(now)}</span>}
        <span>Scale 1:1</span>
        <span id="yb-coords" className="num" aria-hidden>X ----  Y ----</span>
        {now && <span className="ml-auto"><Session now={now} /></span>}
      </div>
    );
  }
  return (
    <div className="yb-strip" role="contentinfo" aria-label="Status">
      <span style={{ color: "var(--accent)" }}>● {INTERFACE_META[ui].name}</span>
      <span>{page}</span>
      {now && <span><Session now={now} /></span>}
      {now && <span className="ml-auto num">{time(now)}</span>}
    </div>
  );
}

function EditionLine() {
  const now = useClock();
  return (
    <div className="yb-edition">
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

/** What goes inside the top bar, before search: Glass's menu-bar clock. */
export function ChromeInBar() {
  const ui = useInterface();
  const now = useClock(15_000);
  if (chromeOf(ui).nav !== "menubar") return null;
  return <span className="yb-clock" aria-hidden>{now ? new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(now) : ""}</span>;
}

/** What goes beside the page, on the left. */
export function ChromeSide() {
  const nav = chromeOf(useInterface()).nav;
  if (nav === "rail") return <IndexRail />;
  if (nav === "toolbar") return <ToolRail />;
  return null;
}

/** What floats over the page. */
export function ChromeFloat() {
  const ui = useInterface();
  const c = chromeOf(ui);
  return (
    <>
      {c.dock && <Dock magnify={ui === "glass"} />}
      {c.nav === "orb" && <Orb />}
      {c.nav === "command" && <Composer />}
      {c.nav === "thumbtabs" && <ThumbTabs />}
    </>
  );
}

/** What goes under the page row: the sheet tabs and the status strip. */
export function ChromeBottom() {
  const ui = useInterface();
  const c = chromeOf(ui);
  return (
    <>
      {c.nav === "sheets" && <SheetTabs />}
      {c.statusStrip && <StatusStrip kind={c.statusStrip} ui={ui} />}
    </>
  );
}

/** How pages arrive, and the interface's own behaviour (keys, pointer light, crosshair, window title). */
export function ChromeEffects() {
  const ui = useInterface();
  return ui === "classic" ? null : <Effects ui={ui} />;
}
