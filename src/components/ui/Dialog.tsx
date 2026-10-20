"use client";

/**
 * The app's confirmation and text-entry dialogs, in place of window.confirm and window.prompt:
 * `await confirmDialog({ title, body })` and `await promptDialog({ title, defaultValue })` from any
 * client code, shown by the one <DialogHost> in the root layout. One dialog at a time; the next waits
 * its turn. Escape or the backdrop cancels, Enter confirms (Cmd/Ctrl+Enter in a multi-line box), focus
 * stays inside the dialog and returns to where it was, and keys never reach the page behind it.
 *
 * On a phone the dialog is a bottom sheet: full width, anchored to the bottom edge where the thumb is,
 * riding above the on-screen keyboard while a text box is focused (`--kb`), with finger-sized buttons
 * and the home bar kept clear. It never grows taller than the screen; a long body scrolls inside it.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

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

export type DialogRequest = { id: number; kind: "confirm" | "prompt"; opts: PromptOptions; resolve: (v: boolean | string | null) => void };
type Request = DialogRequest;

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

// Loaded without next/dynamic: a Suspense boundary resolving outside a transition holds the reveal back
// (several hundred ms here), and a dialog must answer its click at once.
type Layer = typeof import("./DialogLayer").default;
let layer: Layer | null = null;
let layerLoad: Promise<Layer> | null = null;
// A failed load is not remembered: the next dialog (or warm-up) fetches it afresh.
const loadLayer = () => (layerLoad ??= import("./DialogLayer").then((m) => (layer = m.default), (e: unknown) => { layerLoad = null; throw e; }));

/**
 * The browser's own dialog, for when the dialog's code cannot be loaded (offline, or a deploy removed it):
 * the question is still asked and still blocks, and a prompt keeps its rules (not empty, `match`).
 */
function answerNatively(r: Request) {
  if (r.kind === "confirm") { settle(r.id, window.confirm(plain(r.opts))); return; }
  const v = window.prompt(plain(r.opts), r.opts.defaultValue ?? "");
  const ok = v !== null && (r.opts.match !== undefined ? v.trim() === r.opts.match.trim() : v.trim().length > 0);
  settle(r.id, ok ? v : null);
}

/** Mount once, in the root layout. */
export function DialogHost() {
  const q = useSyncExternalStore(subscribe, () => queue, () => EMPTY);
  const [Layer, setLayer] = useState<Layer | null>(() => layer);
  useEffect(() => {
    hosts++;
    // Warm the dialog's code before it is needed: at the first press of a pointer or key (a click that
    // opens a dialog starts with one), or once the page has been idle a few seconds.
    const warm = () => { loadLayer().catch(() => undefined); };
    const t = setTimeout(warm, 4000);
    window.addEventListener("pointerdown", warm, { once: true, capture: true, passive: true });
    window.addEventListener("keydown", warm, { once: true, capture: true });
    return () => { hosts--; clearTimeout(t); window.removeEventListener("pointerdown", warm, { capture: true }); window.removeEventListener("keydown", warm, { capture: true }); };
  }, []);
  const current = q[0];
  // The layer mounts with the first dialog and stays, so a closing dialog still animates out.
  useEffect(() => {
    if (current && !Layer) loadLayer().then((l) => setLayer(() => l), () => { for (const r of queue.slice()) if (queue.includes(r)) answerNatively(r); });
  }, [current, Layer]);
  return Layer ? <Layer current={current} settle={settle} /> : null;
}
