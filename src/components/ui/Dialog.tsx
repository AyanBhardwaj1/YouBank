"use client";

/**
 * The app's confirmation and text-entry dialogs, in place of window.confirm and window.prompt:
 * `await confirmDialog({ title, body })` and `await promptDialog({ title, defaultValue })` from any
 * client code, shown by the one <DialogHost> in the root layout. One dialog at a time; the next waits
 * its turn. Escape or the backdrop cancels, Enter confirms (Cmd/Ctrl+Enter in a multi-line box), focus
 * stays inside the dialog and returns to where it was, and keys never reach the page behind it.
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, CircleHelp, PenLine } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" colours the action red and puts focus on Cancel, for what cannot be undone. */
  tone?: "default" | "danger";
};

export type PromptOptions = ConfirmOptions & {
  /** A label above the text box. */
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  multiline?: boolean;
  /** The text must be typed exactly to continue, e.g. a team's name before deleting it. */
  match?: string;
};

type Request = { id: number; kind: "confirm" | "prompt"; opts: PromptOptions; resolve: (v: boolean | string | null) => void };

let queue: Request[] = [];
let nextId = 1;
let hosts = 0;
const listeners = new Set<() => void>();
const EMPTY: Request[] = [];
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const emit = () => listeners.forEach((l) => l());

function enqueue(kind: Request["kind"], opts: PromptOptions) {
  return new Promise<boolean | string | null>((resolve) => { queue = [...queue, { id: nextId++, kind, opts, resolve }]; emit(); });
}

function settle(id: number, value: boolean | string | null) {
  const r = queue.find((x) => x.id === id);
  queue = queue.filter((x) => x.id !== id);
  emit();
  r?.resolve(value);
}

const plain = (o: ConfirmOptions) => [o.title, typeof o.body === "string" ? o.body : ""].filter(Boolean).join("\n\n");

/** Ask a yes-or-no question. Resolves true when confirmed. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (!hosts) return Promise.resolve(window.confirm(plain(opts)));
  return enqueue("confirm", opts) as Promise<boolean>;
}

/** Ask for a line (or lines) of text. Resolves the text, or null when cancelled. */
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  if (!hosts) return Promise.resolve(window.prompt(plain(opts), opts.defaultValue ?? ""));
  return enqueue("prompt", opts) as Promise<string | null>;
}

/** Mount once, in the root layout. */
export function DialogHost() {
  const q = useSyncExternalStore(subscribe, () => queue, () => EMPTY);
  useEffect(() => {
    hosts++;
    return () => { hosts--; };
  }, []);
  const current = q[0];
  return <AnimatePresence mode="wait">{current && <DialogView key={current.id} req={current} />}</AnimatePresence>;
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

function DialogView({ req }: { req: Request }) {
  const { kind, opts } = req;
  const danger = opts.tone === "danger";
  const [text, setText] = useState(opts.defaultValue ?? "");
  const reduce = useReducedMotion();
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
    <motion.div className="fixed inset-0 z-[90] grid place-items-center p-4" onKeyDown={onKey}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
      <div className="absolute inset-0 bg-bg/65 backdrop-blur-[3px]" aria-hidden onMouseDown={() => finish(false)} />
      <motion.div ref={panelRef} role={kind === "confirm" ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={`${uid}-t`} aria-describedby={opts.body ? `${uid}-b` : undefined}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 520, damping: 36, mass: 0.7 }}
        className="float relative w-full max-w-[440px] overflow-hidden ctl border border-line-strong bg-raised">
        <div className={`h-0.5 w-full ${danger ? "bg-neg" : "bg-accent"}`} aria-hidden />
        <div className="flex gap-3.5 p-5">
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
                {opts.multiline && <span className="mt-1 block text-right text-[10.5px] text-faint">⌘/Ctrl + Enter to {(opts.confirmLabel ?? "save").toLowerCase()}</span>}
              </label>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line bg-elevated/40 px-5 py-3">
          <button ref={cancelRef} type="button" onClick={() => finish(false)}
            className="ctl border border-line px-3 py-1.5 text-[12px] text-muted outline-none transition hover:border-line-strong hover:text-fg focus-visible:ring-1 focus-visible:ring-accent/70">
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button ref={okRef} type="button" disabled={!ok} onClick={() => finish(true)}
            className={`ctl px-3.5 py-1.5 text-[12px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-raised disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "bg-neg text-white hover:brightness-110 focus-visible:ring-neg/60" : "bg-accent text-accent-fg hover:brightness-110 focus-visible:ring-accent/60"}`}>
            {opts.confirmLabel ?? (kind === "prompt" ? "Save" : "Confirm")}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
