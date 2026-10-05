"use client";

/**
 * The sidebar: every feature and the workflows inside it, the tools picked for this person, and search
 * across all of it. The pin beside a feature keeps it in the top bar; "Customize the top bar" arranges
 * the bar (order, labels). It opens over the page, or docked beside it with "Keep open".
 *
 * On a phone it is the "More" sheet behind the tab bar: the same search, features and workflows, at
 * finger size, sliding up from the bottom. Pinning there chooses the tabs (the first four pins).
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, Reorder, useDragControls, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowUp, ChevronRight, GripVertical, PanelLeftClose, Pin, Plus, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import { defaultPinned, featureOf, type NavFeature, type NavId, type NavLink } from "@/lib/nav";
import { emitSubNav } from "@/lib/subnav";
import { catalogFor, type ToolMeta } from "@/lib/workflows/catalog";
import { useNav } from "./NavContext";
import { useWorkspace } from "./WorkspaceProvider";
import { Sheet } from "@/components/ui/Sheet";

const WIDTH = 276;

export function Sidebar() {
  const nav = useNav();
  const reduce = useReducedMotion();
  if (nav.phone) {
    return (
      <Sheet open={nav.open} onClose={() => nav.setOpen(false)} size="full" padded={false} label={nav.customizing ? "Arrange the tab bar" : "All features and workflows"}>
        <div className="flex h-full min-h-0 flex-col">{nav.customizing ? <Customize /> : <Browse />}</div>
      </Sheet>
    );
  }
  const docked = nav.prefs.dock;
  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 430, damping: 42, mass: 0.8 };
  return (
    <>
      <AnimatePresence>
        {nav.open && (
          <motion.button key="scrim" type="button" aria-label="Close the sidebar" tabIndex={-1} onClick={() => nav.setOpen(false)}
            className={`absolute inset-0 z-30 cursor-default bg-bg/45 backdrop-blur-[2px] ${docked ? "md:hidden" : ""}`}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {nav.open && (
          <motion.aside key="sidebar" aria-label="Features and workflows"
            className={`absolute inset-y-0 left-0 z-40 shrink-0 overflow-hidden border-r border-line bg-panel ${docked ? "md:relative md:z-auto" : "float"}`}
            initial={docked ? { width: 0 } : { x: -WIDTH - 12 }} animate={docked ? { width: WIDTH } : { x: 0 }} exit={docked ? { width: 0 } : { x: -WIDTH - 12 }}
            transition={spring} style={docked ? undefined : { width: WIDTH }}>
            <div className="flex h-full flex-col" style={{ width: WIDTH }}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={nav.customizing ? "customize" : "browse"} className="flex min-h-0 flex-1 flex-col"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, x: nav.customizing ? 16 : -16 }} animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, x: nav.customizing ? -16 : 16 }} transition={{ duration: 0.16 }}>
                  {nav.customizing ? <Customize /> : <Browse />}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

type Hit = { key: string; label: string; sub: string; href: string; icon: string; link?: NavLink };

const toolLink = (t: ToolMeta): NavLink => ({ label: t.title, href: `/app/tools/${t.id}` });

function Browse() {
  const nav = useNav();
  const path = usePathname();
  const router = useRouter();
  const { profile } = useWorkspace();
  const tools = useMemo(() => catalogFor(profile), [profile]);
  const current = featureOf(path, nav.features);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState<Set<NavId>>(() => new Set(current ? [current.id] : []));
  const pinned = new Set(nav.prefs.pinned);
  const bar = nav.phone ? "tab bar" : "top bar";

  const linksOf = (f: NavFeature): NavLink[] =>
    f.id === "tools" ? [...tools.slice(0, 6).map(toolLink), { label: "All tools", href: "/app/tools" }] : f.links ?? [];

  const needle = q.trim().toLowerCase();
  const hits: Hit[] = needle ? [
    ...nav.features.filter((f) => `${f.label} ${f.blurb}`.toLowerCase().includes(needle)).map((f) => ({ key: f.id, label: f.label, sub: f.blurb, href: f.href, icon: f.icon })),
    ...nav.features.flatMap((f) => (f.links ?? []).filter((l) => `${f.label} ${l.label} ${l.hint ?? ""}`.toLowerCase().includes(needle))
      .map((l) => ({ key: `${f.id}:${l.href}`, label: l.label, sub: l.hint ? `${f.label} · ${l.hint}` : f.label, href: l.href, icon: f.icon, link: l }))),
    ...tools.filter((t) => `${t.title} ${t.tagline}`.toLowerCase().includes(needle)).slice(0, 14)
      .map((t) => ({ key: `tool:${t.id}`, label: t.title, sub: t.kind === "ai" ? "AI workflow" : "Calculator", href: `/app/tools/${t.id}`, icon: t.icon })),
  ].slice(0, 32) : [];

  const done = () => { if (!nav.prefs.dock || nav.phone) nav.setOpen(false); };
  const follow = (e: ReactMouseEvent | null, link: NavLink) => {
    if (link.event && path === link.event.path) { e?.preventDefault(); emitSubNav(link.event); }
    else if (!e) router.push(link.href);
    done();
  };
  const togglePin = (id: NavId) => nav.update({ pinned: pinned.has(id) ? nav.prefs.pinned.filter((x) => x !== id) : [...nav.prefs.pinned, id] });
  const toggleOpen = (id: NavId) => setExpanded((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && hits[active]) { e.preventDefault(); const h = hits[active]; follow(null, h.link ?? { label: h.label, href: h.href }); }
    else if (e.key === "Escape" && q) { e.preventDefault(); e.stopPropagation(); setQ(""); setActive(0); }
  };

  return (
    <>
      <div className="flex items-center gap-1.5 border-b border-line p-2 max-md:px-3 max-md:pb-3 max-md:pt-1">
        <label className="flex min-w-0 flex-1 items-center gap-2 ctl border border-line bg-bg/60 px-2 py-1.5 focus-within:border-accent/60 max-md:min-h-11 max-md:px-3">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          <input value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onSearchKey} placeholder="Jump to a feature or tool"
            aria-label="Search features, workflows and tools" className="min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-faint" />
          {q ? <button type="button" onClick={() => { setQ(""); setActive(0); }} aria-label="Clear search" className="text-muted hover:text-fg"><X className="h-3 w-3" /></button>
            : <kbd className="hidden rounded border border-line px-1 font-mono text-[9.5px] text-faint sm:inline">⌘\</kbd>}
        </label>
        <button type="button" onClick={() => nav.setOpen(false)} title="Close (⌘\)" aria-label={nav.phone ? "Close" : "Close the sidebar"} className="ctl grid h-7 w-7 shrink-0 place-items-center text-muted hover:bg-elevated hover:text-fg max-md:h-11 max-md:w-11">
          {nav.phone ? <X className="h-5 w-5" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <div className="scroll-touch min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 text-[12px] max-md:px-3 max-md:text-[14px]">
        {needle ? (
          hits.length ? (
            <ul aria-label="Results">
              {hits.map((h, i) => (
                <li key={h.key}>
                  <Link href={h.href} onClick={(e) => follow(e, h.link ?? { label: h.label, href: h.href })} onMouseMove={() => setActive(i)}
                    className={`flex items-center gap-2.5 ctl px-2 py-1.5 max-md:min-h-12 max-md:py-2 ${i === active ? "bg-elevated text-fg" : "text-fg/85"}`}>
                    <Icon name={h.icon} className="h-3.5 w-3.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1"><span className="block truncate">{h.label}</span><span className="block truncate text-[10.5px] text-muted">{h.sub}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="px-2 py-6 text-center text-muted">Nothing matches “{q.trim()}”.</p>
        ) : (
          <>
            <SectionTitle>Features</SectionTitle>
            <ul className="space-y-px">
              {nav.features.map((f) => {
                const links = linksOf(f);
                const isOpen = expanded.has(f.id), isCurrent = current?.id === f.id, isPinned = pinned.has(f.id);
                return (
                  <li key={f.id}>
                    <div className={`group flex items-center ctl transition-colors ${isCurrent ? "bg-accent-soft" : "hover:bg-elevated"}`}>
                      {links.length ? (
                        <button type="button" onClick={() => toggleOpen(f.id)} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} ${f.label} workflows`}
                          className="grid h-7 w-6 shrink-0 place-items-center text-faint hover:text-fg max-md:h-12 max-md:w-10">
                          <ChevronRight className={`h-3 w-3 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
                        </button>
                      ) : <span className="w-6 shrink-0 max-md:w-10" />}
                      <Link href={f.href} onClick={done} title={f.blurb} className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 max-md:min-h-12 max-md:gap-3 ${isCurrent ? "font-medium text-accent" : "text-fg/90"}`}>
                        <Icon name={f.icon} className="h-3.5 w-3.5 shrink-0 max-md:h-5 max-md:w-5" />
                        <span className="truncate">{f.label}</span>
                      </Link>
                      <button type="button" onClick={() => togglePin(f.id)} aria-pressed={isPinned}
                        title={isPinned ? `In the ${bar}: click to remove` : `Pin to the ${bar}`} aria-label={isPinned ? `Remove ${f.label} from the ${bar}` : `Pin ${f.label} to the ${bar}`}
                        className={`mr-1 grid h-6 w-6 shrink-0 place-items-center ctl transition max-md:h-12 max-md:w-11 ${isPinned ? "text-accent" : "text-faint opacity-40 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-70"}`}>
                        <Pin className="h-3 w-3 max-md:h-4 max-md:w-4" fill={isPinned ? "currentColor" : "none"} />
                      </button>
                    </div>
                    <AnimatePresence initial={false}>
                      {isOpen && links.length > 0 && (
                        <motion.ul key="links" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }} className="overflow-hidden">
                          {links.map((l) => (
                            <li key={l.href + l.label}>
                              <Link href={l.href} onClick={(e) => follow(e, l)}
                                className="ml-[30px] mr-1 flex items-center gap-2 border-l border-line py-1 pl-2.5 pr-2 text-[11.5px] text-muted transition-colors hover:border-accent/60 hover:text-fg max-md:ml-[50px] max-md:min-h-11 max-md:pl-3.5 max-md:text-[14px]">
                                <span className="min-w-0 flex-1 truncate">{l.label}</span>
                                {l.hint && <span className="num text-[9.5px] tracking-wide text-faint">{l.hint}</span>}
                              </Link>
                            </li>
                          ))}
                        </motion.ul>
                      )}
                    </AnimatePresence>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <div className="space-y-0.5 border-t border-line px-2 py-2 text-[11.5px] max-md:px-3 max-md:pb-safe">
        <button type="button" onClick={() => nav.customize()} className="flex w-full items-center gap-2 ctl px-2 py-1.5 text-left text-muted hover:bg-elevated hover:text-fg max-md:min-h-12 max-md:text-[14px]">
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 max-md:h-4 max-md:w-4" /><span className="min-w-0 flex-1 truncate">{nav.phone ? "Arrange the tab bar" : "Customize the top bar"}</span>
          <span className="text-[10.5px] text-faint">{nav.phone ? `${Math.min(4, nav.prefs.pinned.length)} of 4 tabs` : `${nav.prefs.pinned.length} pinned`}</span>
        </button>
        {!nav.phone && <Toggle on={nav.prefs.dock} onChange={(v) => nav.update({ dock: v })} label="Keep the sidebar open beside the page" />}
      </div>
    </>
  );
}

function Customize() {
  const nav = useNav();
  const { profile } = useWorkspace();
  const byId = new Map(nav.features.map((f) => [f.id, f]));
  const pinned = nav.prefs.pinned.filter((id) => byId.has(id));
  const rest = nav.features.filter((f) => !pinned.includes(f.id));
  const move = (id: NavId, by: -1 | 1) => {
    const i = pinned.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= pinned.length) return;
    const next = [...pinned];
    [next[i], next[j]] = [next[j], next[i]];
    nav.update({ pinned: next });
  };
  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <SlidersHorizontal className="h-3.5 w-3.5 text-accent" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold max-md:text-[15px]">{nav.phone ? "Arrange the tab bar" : "Customize the top bar"}</h2>
        <button type="button" onClick={() => nav.customize(false)} className="ctl bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-accent-fg hover:brightness-110 max-md:min-h-10 max-md:px-4 max-md:text-[14px]">Done</button>
      </div>
      <div className="scroll-touch min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 text-[12px] max-md:px-3 max-md:text-[14px]">
        <p className="px-1.5 pb-2 text-[11px] leading-relaxed text-muted">{nav.phone
          ? "The first four are your tabs, in this order. Drag to reorder; the rest stay a tap away under More. The desktop top bar follows the same list."
          : "Keep the features you use every day in the bar. Everything else stays one click away in this sidebar."}</p>
        <SectionTitle right={`${pinned.length} of ${nav.features.length}`}>{nav.phone ? "Pinned" : "In the top bar"}</SectionTitle>
        {pinned.length ? (
          <Reorder.Group axis="y" values={pinned} onReorder={(ids: NavId[]) => nav.update({ pinned: ids }, { persist: false })} className="space-y-1">
            {pinned.map((id, i) => (
              <PinnedRow key={id} f={byId.get(id)!} first={i === 0} last={i === pinned.length - 1} onMove={(by) => move(id, by)} badge={nav.phone ? (i < 4 ? `Tab ${i + 1}` : "In More") : undefined}
                onRemove={() => nav.update({ pinned: pinned.filter((x) => x !== id) })} onDragEnd={nav.save} />
            ))}
          </Reorder.Group>
        ) : <p className="ctl border border-dashed border-line px-3 py-3 text-center text-[11px] text-muted">Nothing pinned. The bar keeps just the sidebar button.</p>}

        {rest.length > 0 && (
          <>
            <SectionTitle>More features</SectionTitle>
            <ul className="space-y-px">
              {rest.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => nav.update({ pinned: [...pinned, f.id] })}
                    className="group flex w-full items-center gap-2 ctl px-2 py-1.5 text-left text-fg/85 hover:bg-elevated max-md:min-h-12 max-md:gap-3">
                    <Icon name={f.icon} className="h-3.5 w-3.5 shrink-0 text-muted max-md:h-5 max-md:w-5" />
                    <span className="min-w-0 flex-1 truncate">{f.label}</span>
                    <span className="flex items-center gap-1 text-[10.5px] text-faint group-hover:text-accent"><Plus className="h-3 w-3" />Add</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {!nav.phone && <>
        <SectionTitle>The bar shows</SectionTitle>
        <div role="radiogroup" aria-label="Top bar labels" className="grid grid-cols-2 gap-1 ctl border border-line bg-bg/40 p-1">
          {([["full", "Icons and names"], ["icons", "Icons only"]] as const).map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={nav.prefs.labels === v} onClick={() => nav.update({ labels: v })}
              className={`relative ctl px-2 py-1.5 text-[11.5px] transition-colors ${nav.prefs.labels === v ? "text-fg" : "text-muted hover:text-fg"}`}>
              {nav.prefs.labels === v && <motion.span layoutId="nav-labels-pill" className="absolute inset-0 ctl border border-line-strong bg-elevated" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between px-1">
          <Toggle on={nav.prefs.dock} onChange={(v) => nav.update({ dock: v })} label="Keep the sidebar open" />
        </div>
        </>}
      </div>
      <div className="border-t border-line px-2 py-2 max-md:pb-safe">
        <button type="button" onClick={() => nav.update({ pinned: defaultPinned(profile.role), labels: "full" })}
          className="flex items-center gap-1.5 ctl px-2 py-1.5 text-[11.5px] text-muted hover:bg-elevated hover:text-fg max-md:min-h-11">
          <RotateCcw className="h-3.5 w-3.5" /> Reset to the default bar
        </button>
      </div>
    </>
  );
}

function PinnedRow({ f, first, last, onMove, onRemove, onDragEnd, badge }: { f: NavFeature; first: boolean; last: boolean; onMove: (by: -1 | 1) => void; onRemove: () => void; onDragEnd: () => void; badge?: string }) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={f.id} dragListener={false} dragControls={controls} onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.02, boxShadow: "var(--shadow-lg)", zIndex: 1 }}
      className="group relative flex items-center gap-2 ctl border border-line bg-elevated px-1.5 py-1.5 max-md:min-h-12">
      <button type="button" onPointerDown={(e) => controls.start(e)} aria-label={`Move ${f.label}: drag, or use the arrow keys`}
        onKeyDown={(e) => { if (e.key === "ArrowUp") { e.preventDefault(); onMove(-1); } else if (e.key === "ArrowDown") { e.preventDefault(); onMove(1); } }}
        className="grid h-6 w-5 shrink-0 cursor-grab touch-none place-items-center text-faint hover:text-fg active:cursor-grabbing max-md:h-11 max-md:w-9">
        <GripVertical className="h-3.5 w-3.5 max-md:h-5 max-md:w-5" />
      </button>
      <Icon name={f.icon} className="h-3.5 w-3.5 shrink-0 text-accent max-md:h-5 max-md:w-5" />
      <span className="min-w-0 flex-1 truncate text-fg">{f.label}</span>
      {badge && <span className={`num shrink-0 text-[10.5px] ${badge.startsWith("Tab") ? "text-accent" : "text-faint"}`}>{badge}</span>}
      <span className="hover-reveal flex items-center opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <button type="button" disabled={first} onClick={() => onMove(-1)} aria-label={`Move ${f.label} up`} className="grid h-6 w-5 place-items-center text-muted hover:text-fg disabled:opacity-30 max-md:h-11 max-md:w-9"><ArrowUp className="h-3 w-3 max-md:h-4 max-md:w-4" /></button>
        <button type="button" disabled={last} onClick={() => onMove(1)} aria-label={`Move ${f.label} down`} className="grid h-6 w-5 place-items-center text-muted hover:text-fg disabled:opacity-30 max-md:h-11 max-md:w-9"><ArrowDown className="h-3 w-3 max-md:h-4 max-md:w-4" /></button>
      </span>
      <button type="button" onClick={onRemove} aria-label={`Unpin ${f.label}`} title="Unpin"
        className="grid h-6 w-6 shrink-0 place-items-center ctl text-muted hover:bg-bg/60 hover:text-neg max-md:h-11 max-md:w-11"><X className="h-3.5 w-3.5 max-md:h-4 max-md:w-4" /></button>
    </Reorder.Item>
  );
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: string }) {
  return (
    <div className="flex items-baseline justify-between px-1.5 pb-1.5 pt-3 text-[10px] font-medium uppercase tracking-wider text-muted first:pt-1">
      <span>{children}</span>{right && <span className="normal-case tracking-normal text-faint">{right}</span>}
    </div>
  );
}

function Toggle({ on, onChange, label, title }: { on: boolean; onChange: (v: boolean) => void; label: string; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} title={title}
      className="flex shrink-0 items-center gap-2 ctl px-1.5 py-1 text-[11.5px] text-muted hover:text-fg">
      <span className={`relative h-[16px] w-[28px] rounded-full transition-colors ${on ? "bg-accent" : "bg-line-strong"}`}>
        <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 38 }} className={`absolute top-[2px] h-3 w-3 rounded-full bg-fg ${on ? "right-[2px]" : "left-[2px]"}`} />
      </span>
      {label}
    </button>
  );
}
