"use client";

/**
 * The step-up dialog (src/lib/client/step-up): mounted once in the app shell, opened by ensureStepUp()
 * before a risky action. With 2FA on it asks for the authenticator code and resolves true once the server
 * accepted it; with 2FA off it says so and links to Settings → Security. Esc, the backdrop or Cancel
 * resolve false. It opens over the consent modals (z-index above theirs), and keeps its keys to itself
 * so Esc never also closes the modal underneath.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { registerStepUp, type StepUpState } from "@/lib/client/step-up";

type Open = { enabled: boolean; resolve: (ok: boolean) => void };

export function StepUpHost() {
  const [open, setOpen] = useState<Open | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => registerStepUp((s: StepUpState) => new Promise<boolean>((resolve) => {
    setCode(""); setError(null); setBusy(false);
    // A second request while one is open answers the first as cancelled.
    setOpen((prev) => { prev?.resolve(false); return { enabled: s.enabled, resolve }; });
  })), []);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    return () => { if (before?.isConnected) before.focus?.(); };
  }, [open]);

  const close = (ok: boolean) => { open?.resolve(ok); setOpen(null); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(c)) { setError("Enter the 6-digit code from your authenticator app."); return; }
    setBusy(true); setError(null);
    try {
      await fetchJson("/api/security/step-up", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: c }) });
      close(true);
    } catch (err) {
      setError(errorMessage(err)); setCode("");
    } finally { setBusy(false); }
  };

  if (!open) return null;
  const title = open.enabled ? "Confirm it is you" : "Two-factor authentication needed";
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget) close(false); }}
      onKeyDown={(e) => {
        // Kept here: the consent modal underneath listens on the document for Esc and Tab.
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); close(false); return; }
        if (e.key !== "Tab" || !panel.current) return;
        const f = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])')];
        if (!f.length) return;
        const i = f.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        f[e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1)].focus();
      }}>
      <div ref={panel} tabIndex={-1} className="panel float w-full rounded-b-none p-4 outline-none sm:max-w-sm sm:rounded-[var(--radius)]" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <div className="mb-2 flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg"><Icon name="Shield" className="h-4 w-4 text-accent" />{title}</h2>
          <button type="button" onClick={() => close(false)} className="ctl -mr-1 -mt-1 p-1.5 text-muted hover:bg-elevated hover:text-fg" aria-label="Close"><Icon name="X" /></button>
        </div>
        {open.enabled ? (
          <form onSubmit={submit} className="space-y-2.5">
            <p className="text-[12.5px] leading-relaxed text-muted">Enter your authenticator code to continue. One code covers risky changes on this browser for ten minutes.</p>
            <input className="ctl num w-full border border-line bg-panel px-3 py-2 text-[15px] tracking-[0.3em] text-fg outline-none focus:border-accent"
              inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} autoFocus placeholder="123456" aria-label="Authenticator code"
              value={code} onChange={(e) => setCode(e.target.value)} />
            {error && <p role="alert" className="text-[12px] text-neg">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => close(false)} className="ctl border border-line px-3 py-2 text-[12.5px] text-muted hover:text-fg">Cancel</button>
              <button type="submit" disabled={busy} className="ctl bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-60">{busy ? "Checking…" : "Continue"}</button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-[12.5px] leading-relaxed text-muted">Turn on two-factor authentication in Settings → Security first. Connecting brokers and mailboxes, and live trading, need a code from an authenticator app each time.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => close(false)} className="ctl border border-line px-3 py-2 text-[12.5px] text-muted hover:text-fg">Not now</button>
              <Link href="/app/settings?tab=security" onClick={() => close(false)} className="ctl bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg">Open Settings → Security</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
