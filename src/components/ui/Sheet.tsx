"use client";

/**
 * A bottom sheet, the phone's version of a side panel or popover: it slides up from the bottom edge,
 * drags down (by its handle or header) to close, rides above the on-screen keyboard (`--kb`, see
 * MobileViewport) and keeps clear of the home bar. Escape and the backdrop close it too.
 *
 * `modal={false}` leaves the page behind it usable (no backdrop, focus stays put), for panels you
 * watch while working, like the Studio agent beside the sheet it is writing. `size` sets how tall it
 * opens: "auto" fits the content, "half" and "full" are fixed shares of the screen; the handle toggles
 * between half and full when `expandable`.
 */
import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type SheetSize = "auto" | "half" | "full";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Shown at the right of the header, before the close button. */
  actions?: ReactNode;
  children: ReactNode;
  /** Pinned under the scrolling body (a composer, a primary action). */
  footer?: ReactNode;
  size?: SheetSize;
  expandable?: boolean;
  modal?: boolean;
  /** Padding inside the scrolling body; off for lists that run edge to edge. */
  padded?: boolean;
  className?: string;
  /** Accessible name when `title` is not plain text. */
  label?: string;
};

const noop = () => () => {};

const HEIGHT: Record<SheetSize, string> = {
  auto: "auto",
  half: "min(58dvh, calc(100dvh - var(--kb) - var(--safe-t) - 24px))",
  full: "calc(100dvh - var(--kb) - var(--safe-t) - 24px)",
};

export function Sheet({ open, onClose, title, actions, children, footer, size = "auto", expandable = false, modal = true, padded = true, className = "", label }: Props) {
  // Portals need document.body, which exists only after hydration.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && <SheetBody key="sheet" {...{ onClose, title, actions, children, footer, size, expandable, modal, padded, className, label }} />}
    </AnimatePresence>,
    document.body,
  );
}

function SheetBody({ onClose, title, actions, children, footer, size, expandable, modal, padded, className, label }: Omit<Props, "open"> & { size: SheetSize }) {
  const drag = useDragControls();
  const uid = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(size === "full");
  const height = HEIGHT[tall ? "full" : size];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A modal sheet takes focus (and gives it back); a docked one leaves it where the person is working.
  useEffect(() => {
    if (!modal) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    return () => { if (before?.isConnected) before.focus({ preventScroll: true }); };
  }, [modal]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 90 || info.velocity.y > 600) onClose();
    else if (expandable && info.offset.y < -60) setTall(true);
  };

  return (
    <div className={`fixed inset-0 z-[80] ${modal ? "" : "pointer-events-none"}`}>
      {modal && (
        <motion.div aria-hidden className="absolute inset-0 bg-bg/60 backdrop-blur-[2px]" onClick={onClose}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
      )}
      <motion.div ref={panel} role="dialog" aria-modal={modal || undefined} aria-labelledby={title ? `${uid}-t` : undefined} aria-label={title ? undefined : label} tabIndex={-1}
        drag="y" dragListener={false} dragControls={drag} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.08, bottom: 0.7 }} onDragEnd={onDragEnd}
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 420, damping: 40, mass: 0.8 }}
        style={{ bottom: "var(--kb)", height, maxHeight: HEIGHT.full }}
        className={`pointer-events-auto absolute inset-x-0 flex flex-col overflow-hidden rounded-t-[14px] border border-b-0 border-line-strong bg-panel shadow-[0_-12px_40px_rgba(0,0,0,.35)] outline-none px-safe ${className}`}>
        <div className="shrink-0 touch-none select-none" onPointerDown={(e) => drag.start(e)}>
          <button type="button" aria-label={expandable ? (tall ? "Make the panel shorter" : "Make the panel taller") : "Drag down to close"} tabIndex={expandable ? 0 : -1}
            onClick={() => expandable && setTall((t) => !t)} className="flex h-6 w-full items-center justify-center">
            <span className="sheet-handle" />
          </button>
          {(title || actions) && (
            <div className="flex min-h-11 items-center gap-2 border-b border-line px-4 pb-2">
              <div id={`${uid}-t`} className="min-w-0 flex-1 truncate text-[15px] font-semibold text-fg">{title}</div>
              {actions}
              <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 grid h-11 w-11 shrink-0 place-items-center ctl text-muted hover:text-fg">
                <X className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
        <div className={`scroll-touch min-h-0 flex-1 overflow-y-auto ${padded ? "px-4 pt-3" : ""}`}
          style={{ paddingBottom: footer ? (padded ? 12 : 0) : `calc(var(--safe-b) + ${padded ? 12 : 0}px)` }}>{children}</div>
        {footer && <div className="shrink-0 border-t border-line bg-panel pb-safe">{footer}</div>}
      </motion.div>
    </div>
  );
}
