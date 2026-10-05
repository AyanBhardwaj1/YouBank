"use client";

/**
 * The app's dropdown, in place of the browser's <select>. It takes the same <option> and <optgroup>
 * children and calls onChange with the chosen value (a string, as a native select gives). The menu is
 * themed, animates, opens upward when there is no room below, and renders in a portal so a panel that
 * clips its overflow cannot cut it off. Keyboard: arrows, Page Up/Down, Home/End, Enter, Escape, and
 * type-ahead; lists longer than ten get a search box.
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Children, Fragment, isValidElement, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type SelectItem = { value: string; label: string; disabled: boolean; group: string };

/** The text of an option's children: "Apple (12)" from {name} ({n}). */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** The options in <option> and <optgroup> children, in order. An option without a value uses its text, as the DOM does. */
export function itemsOf(children: ReactNode, group = ""): SelectItem[] {
  const out: SelectItem[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const p = child.props as { value?: string | number; label?: string; disabled?: boolean; children?: ReactNode };
    if (child.type === "option") {
      const label = textOf(p.children);
      out.push({ value: p.value === undefined ? label : String(p.value), label, disabled: !!p.disabled, group });
    } else if (child.type === "optgroup") out.push(...itemsOf(p.children, p.label ?? ""));
    else if (child.type === Fragment) out.push(...itemsOf(p.children, group));
  });
  return out;
}

type Pos = { left?: number; right?: number; minWidth: number; maxWidth: number; top?: number; bottom?: number; maxHeight: number; up: boolean };

/** Where the menu goes: under the button (or over it when there is no room below), as wide as its longest option within bounds. */
function place(trigger: HTMLElement, align: "start" | "end", minWidth: number): Pos {
  const r = trigger.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const min = Math.min(Math.max(r.width, minWidth), vw - 16);
  const edge = align === "end"
    ? { right: Math.max(8, vw - r.right), maxWidth: Math.max(min, Math.min(420, r.right - 8)) }
    : { left: Math.max(8, Math.min(r.left, vw - min - 8)), maxWidth: Math.max(min, Math.min(420, vw - Math.max(8, Math.min(r.left, vw - min - 8)) - 8)) };
  const below = vh - r.bottom - 8, above = r.top - 8;
  const up = below < 220 && above > below;
  const maxHeight = Math.max(120, Math.min(360, (up ? above : below) - 4));
  return { ...edge, minWidth: min, maxHeight, up, ...(up ? { bottom: vh - r.top + 4 } : { top: r.bottom + 4 }) };
}

const firstEnabled = (xs: SelectItem[]) => Math.max(0, xs.findIndex((x) => !x.disabled));
const DEFAULT_TRIGGER = "ctl border border-line bg-elevated px-2 py-1 text-fg hover:border-line-strong";

type Props = {
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  children: ReactNode;
  /** Classes for the button: size, border, background. */
  className?: string;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  /** A search box at the top of the menu; on by default for lists longer than ten. */
  searchable?: boolean;
  /** Called as the menu opens, e.g. to load its options. */
  onOpen?: () => void;
  align?: "start" | "end";
  /** The menu is at least this wide (px), never narrower than the button, and grows to its longest option up to 420px. */
  menuWidth?: number;
};

export function Select({ value, onChange, children, className, disabled, title, searchable, onOpen, align = "start", menuWidth = 180, ...rest }: Props) {
  const items = itemsOf(children);
  const current = String(value ?? "");
  const label = items.find((i) => i.value === current)?.label ?? items[0]?.label ?? "";
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const id = useId();
  const reduce = useReducedMotion();
  const withSearch = searchable ?? items.length > 10;
  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((i) => i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q)) : items;
  const ariaLabel = rest["aria-label"] ?? title;

  const openMenu = () => {
    if (disabled || !triggerRef.current) return;
    setPos(place(triggerRef.current, align, menuWidth));
    setQuery("");
    const i = items.findIndex((x) => x.value === current && !x.disabled);
    setActive(i >= 0 ? i : firstEnabled(items));
    setOpen(true);
    onOpen?.();
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const choose = (it: SelectItem | undefined) => {
    if (!it || it.disabled) return;
    close();
    if (it.value !== current) onChange(it.value);
  };

  useEffect(() => {
    if (!open) return;
    (withSearch ? searchRef.current : listRef.current)?.focus({ preventScroll: true });
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    const onMove = (e: Event) => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      if (triggerRef.current) setPos(place(triggerRef.current, align, menuWidth));
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, withSearch, align, menuWidth]);

  useEffect(() => {
    if (open) listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, active, query]);

  const move = (to: number | "first" | "last") => {
    const enabled = shown.flatMap((x, i) => (x.disabled ? [] : [i]));
    if (!enabled.length) return;
    if (to === "first") return setActive(enabled[0]);
    if (to === "last") return setActive(enabled[enabled.length - 1]);
    const at = enabled.indexOf(active);
    setActive(at < 0 ? enabled[0] : enabled[Math.max(0, Math.min(enabled.length - 1, at + to))]);
  };

  // Keys inside the menu stay inside it: the terminal and the deck editor listen on the window.
  const onMenuKey = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); move(1); return;
      case "ArrowUp": e.preventDefault(); move(-1); return;
      case "PageDown": e.preventDefault(); move(8); return;
      case "PageUp": e.preventDefault(); move(-8); return;
      case "Home": if (!withSearch) { e.preventDefault(); move("first"); } return;
      case "End": if (!withSearch) { e.preventDefault(); move("last"); } return;
      case "Enter": e.preventDefault(); choose(shown[active]); return;
      case " ": if (!withSearch) { e.preventDefault(); choose(shown[active]); } return;
      case "Escape": e.preventDefault(); close(); return;
      case "Tab": e.preventDefault(); close(); return;
    }
    if (withSearch || e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey || !shown.length) return;
    // Type-ahead: letters typed within 600ms spell the start of a label.
    const t = typed.current;
    t.text = e.timeStamp - t.at > 600 ? e.key.toLowerCase() : t.text + e.key.toLowerCase();
    t.at = e.timeStamp;
    const start = t.text.length === 1 ? active + 1 : active;
    for (let k = 0; k < shown.length; k++) {
      const i = (start + k) % shown.length;
      if (!shown[i].disabled && shown[i].label.toLowerCase().startsWith(t.text)) { setActive(i); return; }
    }
  };

  const onTriggerKey = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") { e.preventDefault(); openMenu(); }
  };

  return (
    <>
      <button ref={triggerRef} type="button" disabled={disabled} title={title} aria-label={rest["aria-label"]}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
        onClick={() => (open ? close(false) : openMenu())} onKeyDown={onTriggerKey}
        className={`inline-flex min-w-0 items-center gap-1.5 text-left outline-none transition focus-visible:ring-1 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-50 ${className ?? DEFAULT_TRIGGER}`}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown aria-hidden className={`size-[1.05em] shrink-0 opacity-60 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div ref={menuRef} key="menu" onKeyDown={onMenuKey}
              // React bubbles portal events to the Select's parents; a click in the menu is not a click on the row it sits in.
              onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
              style={{ position: "fixed", left: pos.left, right: pos.right, top: pos.top, bottom: pos.bottom, width: "max-content", minWidth: pos.minWidth, maxWidth: pos.maxWidth, transformOrigin: pos.up ? "bottom center" : "top center" }}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: pos.up ? 6 : -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: pos.up ? 4 : -4, scale: 0.98 }}
              transition={{ duration: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
              className="float z-[100] overflow-hidden ctl border border-line-strong bg-raised text-[12px] text-fg">
              {withSearch && (
                <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-2">
                  <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <input ref={searchRef} value={query} placeholder="Search" aria-label={`Search ${ariaLabel ?? "options"}`}
                    aria-controls={`${id}-list`} aria-activedescendant={shown[active] ? `${id}-o${active}` : undefined}
                    onChange={(e) => {
                      const v = e.target.value, lq = v.trim().toLowerCase();
                      setQuery(v);
                      setActive(firstEnabled(lq ? items.filter((i) => i.label.toLowerCase().includes(lq) || i.group.toLowerCase().includes(lq)) : items));
                    }}
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-faint" />
                </div>
              )}
              <ul ref={listRef} id={`${id}-list`} role="listbox" tabIndex={-1} aria-label={ariaLabel}
                aria-activedescendant={!withSearch && shown[active] ? `${id}-o${active}` : undefined}
                className="overflow-y-auto overscroll-contain p-1 outline-none" style={{ maxHeight: pos.maxHeight - (withSearch ? 38 : 0) }}>
                {shown.length === 0 && <li className="px-2 py-2 text-muted">No matches</li>}
                {shown.map((it, i) => {
                  const header = it.group && (i === 0 || shown[i - 1].group !== it.group);
                  const selected = it.value === current;
                  return (
                    <Fragment key={`${i}:${it.value}`}>
                      {header && <li role="presentation" className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted">{it.group}</li>}
                      <li id={`${id}-o${i}`} role="option" aria-selected={selected} aria-disabled={it.disabled || undefined} data-active={i === active}
                        onMouseMove={() => { if (i !== active && !it.disabled) setActive(i); }}
                        onMouseDown={(e) => e.preventDefault()} onClick={() => choose(it)}
                        className={`ctl flex select-none items-center gap-2 px-2 py-1.5 transition-colors duration-100 max-md:min-h-11 max-md:text-[14px] ${it.disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"} ${i === active ? "bg-elevated" : ""} ${selected ? "font-medium text-accent" : ""}`}>
                        <Check aria-hidden className={`h-3.5 w-3.5 shrink-0 ${selected ? "opacity-100" : "opacity-0"}`} />
                        <span className="min-w-0 flex-1 truncate" title={it.label.length > 36 ? it.label : undefined}>{it.label}</span>
                      </li>
                    </Fragment>
                  );
                })}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
