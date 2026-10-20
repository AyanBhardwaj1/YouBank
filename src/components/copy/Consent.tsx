"use client";

/**
 * The consents copy trading asks for at first use, stored with the text's version (and audited) by
 * /api/copy/consent: "how copies work" before the first copy or connection, and "the risks of real
 * orders" before the first approval. `useConsent()` returns `ask(kind)`, which resolves true once the
 * person accepted, false if they closed it.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { CONSENTS, type ConsentKind } from "@/lib/copytrade/disclosures";
import { json } from "./client";

type Ask = (kind: ConsentKind) => Promise<boolean>;
const Ctx = createContext<Ask>(async () => false);
export const useConsent = () => useContext(Ctx);

/** Open modals, innermost last: only the top one answers Esc and Tab (the consent opens over the copy editor). */
const stack: object[] = [];

/**
 * A centred panel over a dim backdrop (a bottom sheet on phones). It takes focus when it opens (these
 * often open on their own, after a 428), so Esc and Tab work at once; Esc closes it wherever focus is,
 * Tab stays inside it, and focus goes back where it was on close.
 */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const me = {};
    stack.push(me);
    // A field inside that took focus itself (autoFocus) keeps it.
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me) return;
      if (e.key === "Escape") { e.preventDefault(); close.current(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const f = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')];
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      f[e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1)].focus();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); stack.splice(stack.indexOf(me), 1); if (before?.isConnected) before.focus?.(); };
  }, []);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} tabIndex={-1} className={`panel float max-h-[92dvh] w-full overflow-y-auto rounded-b-none p-4 outline-none sm:rounded-[var(--radius)] ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`} style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
          <button onClick={onClose} className="ctl -mr-1 -mt-1 p-1.5 text-muted hover:bg-elevated hover:text-fg" aria-label="Close"><Icon name="X" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<ConsentKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const ask = useCallback<Ask>((k) => new Promise((resolve) => { resolver.current = resolve; setError(null); setKind(k); }), []);
  const close = (ok: boolean) => { resolver.current?.(ok); resolver.current = null; setKind(null); };
  const accept = async () => {
    if (!kind) return;
    setBusy(true); setError(null);
    try { await fetchJson("/api/copy/consent", json("POST", { kind })); close(true); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const c = kind ? CONSENTS[kind] : null;
  return (
    <Ctx.Provider value={ask}>
      {children}
      {c && (
        <Modal title={c.title} onClose={() => close(false)}>
          <ul className="space-y-2 text-[12.5px] leading-relaxed text-fg">
            {c.points.map((p) => <li key={p} className="flex gap-2"><Icon name="Shield" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />{p}</li>)}
          </ul>
          <p className="mt-3 text-[11px] text-muted">Version {c.version}. We keep a record that you accepted this text, and when.</p>
          {error && <p className="mt-2 text-[12px] text-neg">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => close(false)} className="ctl border border-line px-3 py-2 text-[12.5px] text-muted hover:text-fg">Not now</button>
            <button onClick={accept} disabled={busy} className="ctl bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-60">{busy ? "Saving…" : "I understand"}</button>
          </div>
        </Modal>
      )}
    </Ctx.Provider>
  );
}
