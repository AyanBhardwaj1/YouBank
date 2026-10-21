"use client";

/**
 * The dialog itself, for <DialogHost> (./Dialog.tsx): loaded the first time a dialog opens (and warmed when
 * the page is idle), so the animation library and the dialog's markup stay out of the root layout that
 * every page, the sign-in and legal pages included, loads.
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, CircleHelp, PenLine } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { usePhone } from "./useMedia";
import type { DialogRequest } from "./Dialog";

type Settle = (id: number, value: boolean | string | null) => void;

export default function DialogLayer({ current, settle }: { current: DialogRequest | undefined; settle: Settle }) {
  return <AnimatePresence mode="wait">{current && <DialogView key={current.id} req={current} settle={settle} />}</AnimatePresence>;
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

function DialogView({ req, settle }: { req: DialogRequest; settle: Settle }) {
  const { kind, opts } = req;
  const danger = opts.tone === "danger";
  const [text, setText] = useState(opts.defaultValue ?? "");
  const reduce = useReducedMotion();
  const phone = usePhone();
  const uid = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const ok = kind === "confirm" || (opts.match !== undefined ? text.trim() === opts.match.trim() : text.trim().length > 0);
  const finish = (yes: boolean) => settle(req.id, kind === "confirm" ? yes : yes ? text : null);

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = inputRef.current ?? areaRef.current;
    const target = kind === "prompt" ? box : danger ? cancelRef.current : okRef.current;
    target?.focus({ preventScroll: true });
    if (box && box.value && opts.match === undefined) box.select();
    return () => { if (before?.isConnected) before.focus({ preventScroll: true }); };
  }, [kind, danger, opts.match]);

  const onKey = (e: ReactKeyboardEvent) => {
    // The dialog is modal: no key reaches the page behind it (the deck editor deletes on Backspace).
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    const el = e.target as HTMLElement;
    if (e.key === "Escape") { e.preventDefault(); finish(false); return; }
    if (e.key === "Enter") {
      if (el.tagName === "TEXTAREA" && !(e.metaKey || e.ctrlKey)) return;
      if (el.tagName === "BUTTON" && el !== okRef.current) return;
      e.preventDefault();
      if (ok) finish(true);
      return;
    }
    if (e.key === "Tab" && panelRef.current) {
      const f = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
      e.preventDefault();
      f[next].focus();
    }
  };

  const Glyph = danger ? AlertTriangle : kind === "prompt" ? PenLine : CircleHelp;
  const field = "ctl w-full border border-line bg-bg/70 px-2.5 py-2 text-[13px] text-fg outline-none transition placeholder:text-faint focus:border-accent/70";

  return (
    <motion.div className="fixed inset-x-0 top-0 z-[90] grid place-items-center p-4 max-md:place-items-end max-md:p-0" style={{ bottom: "var(--kb)" }} onKeyDown={onKey}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
      <div className="absolute inset-0 bg-bg/65 backdrop-blur-[3px]" aria-hidden onMouseDown={() => finish(false)} />
      <motion.div ref={panelRef} role={kind === "confirm" ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={`${uid}-t`} aria-describedby={opts.body ? `${uid}-b` : undefined}
        initial={reduce ? { opacity: 0 } : phone ? { y: "100%" } : { opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduce ? { opacity: 0 } : phone ? { y: "100%" } : { opacity: 0, y: 6, scale: 0.98 }}
        transition={phone ? { type: "spring", stiffness: 420, damping: 40, mass: 0.8 } : { type: "spring", stiffness: 520, damping: 36, mass: 0.7 }}
        className="float relative flex max-h-[calc(100dvh-var(--kb)-32px)] w-full max-w-[440px] flex-col overflow-hidden ctl border border-line-strong bg-raised max-md:max-w-none max-md:rounded-b-none max-md:rounded-t-[14px] max-md:border-b-0">
        <div className={`h-0.5 w-full ${danger ? "bg-neg" : "bg-accent"}`} aria-hidden />
        <div className="scroll-touch flex min-h-0 gap-3.5 overflow-y-auto p-5">
          <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${danger ? "bg-neg/15 text-neg" : "bg-accent-soft text-accent"}`}><Glyph className="h-[18px] w-[18px]" aria-hidden /></div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id={`${uid}-t`} className="text-[14.5px] font-semibold leading-snug text-fg">{opts.title}</h2>
            {opts.body && <div id={`${uid}-b`} className="mt-1.5 whitespace-pre-line text-[12.5px] leading-relaxed text-muted">{opts.body}</div>}
            {kind === "prompt" && (
              <label className="mt-3.5 block">
                {(opts.label || opts.match !== undefined) && (
                  <span className="mb-1.5 block text-[11.5px] text-muted">
                    {opts.label ?? "Type to confirm"}{opts.match !== undefined && <> <code className="ctl bg-elevated px-1 py-px font-mono text-[11px] text-fg">{opts.match}</code></>}
                  </span>
                )}
                {opts.multiline
                  ? <textarea ref={areaRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={opts.placeholder} rows={4} className={`${field} resize-y leading-relaxed`} />
                  : <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={opts.placeholder} autoComplete="off" spellCheck={opts.match === undefined} className={field} />}
                {opts.multiline && <span className="mt-1 block text-right text-[10.5px] text-faint max-md:hidden">⌘/Ctrl + Enter to {(opts.confirmLabel ?? "save").toLowerCase()}</span>}
              </label>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-elevated/40 px-5 py-3 max-md:gap-3 max-md:px-4 max-md:pb-[calc(12px+var(--safe-b))]">
          <button ref={cancelRef} type="button" onClick={() => finish(false)}
            className="ctl border border-line px-3 py-1.5 text-[12px] text-muted outline-none transition hover:border-line-strong hover:text-fg focus-visible:ring-1 focus-visible:ring-accent/70 max-md:min-h-11 max-md:flex-1 max-md:text-[14px]">
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button ref={okRef} type="button" disabled={!ok} onClick={() => finish(true)}
            className={`ctl px-3.5 py-1.5 text-[12px] font-semibold outline-none transition max-md:min-h-11 max-md:flex-1 max-md:text-[14px] focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-raised disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "bg-neg text-white hover:brightness-110 focus-visible:ring-neg/60" : "bg-accent text-accent-fg hover:brightness-110 focus-visible:ring-accent/60"}`}>
            {opts.confirmLabel ?? (kind === "prompt" ? "Save" : "Confirm")}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
