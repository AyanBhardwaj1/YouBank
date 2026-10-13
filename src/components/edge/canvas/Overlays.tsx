"use client";

/**
 * Panels over the canvas editor. Modal holds the side-by-side comparison and behaves like the app's
 * dialogs (ui/Dialog, whose shell is not exported and is sized for a question): Escape or the backdrop
 * closes it, focus moves in and goes back where it was, Tab stays inside, and no key reaches the canvas
 * behind it (Backspace deletes a block there). Sheet is the inspector below the lg breakpoint: a panel
 * from the bottom that leaves the canvas above it usable; its button or Escape hides it.
 */
import { ChevronDown, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

/** Focus the panel when it opens and, when it closes, whatever had focus before. */
function useFocusIn(panel: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    return () => { if (before?.isConnected) before.focus({ preventScroll: true }); };
  }, [panel]);
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const uid = useId();
  useFocusIn(panel);
  const onKey = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key !== "Tab" || !panel.current) return;
    const f = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    f[e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1)].focus();
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onKeyDown={onKey}>
      <div className="fade-in absolute inset-0 bg-bg/65 backdrop-blur-[3px]" aria-hidden onMouseDown={onClose} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`} tabIndex={-1}
        className="rise float relative flex max-h-[85vh] w-full max-w-[1100px] flex-col overflow-hidden ctl border border-line-strong bg-raised outline-none">
        <div className="h-0.5 w-full shrink-0 bg-accent" aria-hidden />
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 id={`${uid}-t`} className="text-[15px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted outline-none hover:text-fg focus-visible:ring-1 focus-visible:ring-accent/70"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function Sheet({ id, label, onClose, children }: { id: string; label: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useFocusIn(panel);
  // A field saves when it loses focus, so let go of it before the sheet goes.
  const hide = useCallback(() => {
    const a = document.activeElement;
    if (a instanceof HTMLElement && panel.current?.contains(a)) a.blur();
    onClose();
  }, [onClose]);
  // Escape hides it from anywhere a menu or a dialog has not already used it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); hide(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hide]);
  return (
    <div ref={panel} id={id} role="dialog" aria-label={label} tabIndex={-1}
      className="rise fixed inset-x-0 bottom-0 z-[70] flex max-h-[72dvh] flex-col rounded-t-xl border-t border-line-strong bg-panel pb-[env(safe-area-inset-bottom)] shadow-[0_-16px_40px_-12px_rgba(0,0,0,0.45)] outline-none lg:hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line py-1 pl-3 pr-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</span>
        <button type="button" onClick={hide} className="flex items-center gap-1 rounded px-1.5 py-1 text-[11.5px] text-muted outline-none hover:text-fg focus-visible:ring-1 focus-visible:ring-accent/70"><ChevronDown className="h-4 w-4" />Hide</button>
      </div>
      {children}
    </div>
  );
}
