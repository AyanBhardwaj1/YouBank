"use client";

/**
 * Settings → Data and privacy → Delete my account. Says what will go (how many items, in how many places) and
 * anything that must be done first (a team with other people in it, a paid plan still renewing), then asks for
 * the account's email typed out and the password (an account with no password needs a recent sign-in; with
 * two-factor on, a code is asked for as for any risky action). Deleting signs out and lands on the home page.
 */
import { useEffect, useState } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { ApiError, errorMessage, fetchJson } from "@/lib/client/errors";
import { retryAfterStepUp } from "@/lib/client/step-up";
import { clearAiHistory } from "@/lib/client/ai-history";

type Summary = { items: number; places: number; blocked: string | null };

export function DeleteAccount({ email }: { email: string }) {
  useWorkspace();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchJson<Summary>("/api/account/delete").then(setSummary).catch((e) => setError(errorMessage(e)));
  }, [open]);

  const matches = confirm.trim().toLowerCase() === email.toLowerCase();
  const send = async (): Promise<void> => {
    setBusy(true); setError(null);
    try {
      await fetchJson("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm, password }) });
      clearAiHistory();
      window.location.replace("/?deleted=1");
    } catch (e) {
      if (await retryAfterStepUp(e)) return send();
      if (e instanceof ApiError && e.body && typeof e.body === "object" && "needsPassword" in e.body) setNeedsPassword(!!(e.body as { needsPassword?: unknown }).needsPassword);
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-[var(--radius)] border border-neg/40 p-4">
      <h3 className="text-[13.5px] font-semibold text-neg">Delete my account</h3>
      <p className="mt-1 max-w-[70ch] text-[12px] text-muted">Removes your account and everything in it for good: your book, theses, watchlists, saved work, mail and calendar connections, AI history and settings. It cannot be undone.</p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="mt-3 ctl border border-neg/50 px-3 py-1.5 text-[12px] font-medium text-neg transition-colors hover:bg-neg/10 focus-visible:outline-2 focus-visible:outline-neg">Delete my account…</button>
      ) : (
        <form className="mt-3 max-w-[460px] space-y-2.5" onSubmit={(e) => { e.preventDefault(); if (matches && !busy) void send(); }}>
          {summary && <p className="text-[12px] text-muted" aria-live="polite">{summary.items.toLocaleString()} items in {summary.places} places will be deleted, then the account.</p>}
          {summary?.blocked && <p role="alert" className="text-[12px] text-neg">{summary.blocked}</p>}
          <label className="block text-[12px]">Type <span className="font-semibold text-fg" translate="no">{email}</span> to confirm
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} type="email" autoComplete="off" spellCheck={false} name="confirm-email"
              className="mt-1 w-full ctl border border-line bg-transparent px-3 py-2 text-[13px] text-fg outline-none focus:border-neg" />
          </label>
          {needsPassword && (
            <label className="block text-[12px]">Your password
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" name="password"
                className="mt-1 w-full ctl border border-line bg-transparent px-3 py-2 text-[13px] text-fg outline-none focus:border-neg" />
            </label>
          )}
          {error && <p role="alert" className="text-[12px] text-neg">{error}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" disabled={!matches || busy || !!summary?.blocked} className="ctl bg-neg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">{busy ? "Deleting…" : "Delete my account for good"}</button>
            <button type="button" onClick={() => { setOpen(false); setConfirm(""); setPassword(""); setError(null); }} className="ctl border border-line px-3 py-1.5 text-[12px] text-muted hover:text-fg">Keep my account</button>
          </div>
        </form>
      )}
    </div>
  );
}
