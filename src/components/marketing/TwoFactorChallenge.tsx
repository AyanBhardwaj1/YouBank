"use client";

import Link from "next/link";
import { useState } from "react";
import { getAuthClient } from "@/lib/auth/client";
import { signInError } from "./SignInButton";

const FIELD = "w-full rounded-md border border-line bg-transparent px-3 py-2 text-[13px] text-fg outline-none placeholder:text-muted focus:border-line-strong";

/** What a refused code says. The plugin's own codes; anything else as sign-in errors read. */
function challengeError(e: unknown): { message: string; restart?: boolean } {
  const f = (e ?? {}) as { code?: unknown; status?: unknown };
  if (f.code === "INVALID_CODE" || f.code === "INVALID_BACKUP_CODE") return { message: "That code did not match. Check the time on your phone and try a new code." };
  if (f.code === "INVALID_TWO_FACTOR_COOKIE" || f.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE") return { message: "This sign-in has expired or had too many wrong codes. Sign in again.", restart: true };
  if (f.code === "ACCOUNT_TEMPORARILY_LOCKED") return { message: "Too many wrong codes. Two-factor sign-in is locked for 15 minutes." };
  if (f.status === 429) return { message: "Too many tries. Wait a few seconds and try again." };
  return { message: signInError(e) };
}

/**
 * The code step of a password sign-in: a 6-digit authenticator code, or a backup code when the phone is
 * not at hand, with "trust this device" (no code here for 30 days). Then a full load of `next`, so the
 * server renders the app with the new session cookie.
 */
export function TwoFactorChallenge({ next = "/app", className = "" }: { next?: string; className?: string }) {
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; restart?: boolean } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = mode === "totp" ? code.replace(/\s+/g, "") : code.trim();
    if (mode === "totp" && !/^\d{6}$/.test(c)) { setError({ message: "Enter the 6-digit code from your authenticator app." }); return; }
    if (mode === "backup" && !c) { setError({ message: "Enter one of your backup codes." }); return; }
    setBusy(true); setError(null);
    try {
      const client = await getAuthClient();
      const res = mode === "totp"
        ? await client.twoFactor.verifyTotp({ code: c, trustDevice: trust })
        : await client.twoFactor.verifyBackupCode({ code: c, trustDevice: trust });
      if (res?.error) { setError(challengeError(res.error)); setBusy(false); return; }
      window.location.assign(next);
    } catch (err) {
      setError(challengeError(err));
      setBusy(false);
    }
  };

  const restart = next === "/app" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`;
  return (
    <form onSubmit={submit} onPointerEnter={() => { void getAuthClient(); }} className={`space-y-2.5 ${className}`}>
      {mode === "totp"
        ? <input className={`${FIELD} num tracking-[0.3em]`} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required autoFocus
            placeholder="123456" aria-label="Authenticator code" value={code} onChange={(e) => setCode(e.target.value)} />
        : <input className={`${FIELD} num`} autoComplete="off" autoCapitalize="none" spellCheck={false} required autoFocus
            placeholder="Backup code" aria-label="Backup code" value={code} onChange={(e) => setCode(e.target.value)} />}
      <label className="flex items-center gap-2 text-[12px] text-muted">
        <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
        Trust this device for 30 days
      </label>
      <button type="submit" disabled={busy} className="w-full rounded-md bg-fg px-4 py-2.5 text-[13px] font-semibold text-bg transition hover:bg-white disabled:opacity-60">
        {busy ? "One moment…" : "Verify and sign in"}
      </button>
      {error && (
        <div role="alert" className="text-[11px] text-neg">
          {error.message}{error.restart && <> <Link href={restart} className="underline">Sign in again</Link></>}
        </div>
      )}
      <div className="text-[11.5px] text-muted">
        <button type="button" className="hover:text-fg" onClick={() => { setMode(mode === "totp" ? "backup" : "totp"); setCode(""); setError(null); }}>
          {mode === "totp" ? "Use a backup code instead" : "Use your authenticator app instead"}
        </button>
      </div>
      {mode === "backup" && <p className="text-[11px] leading-relaxed text-muted">Each backup code works once. When you are signed in, turn two-factor off and on again in Settings → Security to get a new set.</p>}
    </form>
  );
}
