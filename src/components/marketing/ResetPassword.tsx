"use client";

import Link from "next/link";
import { useState } from "react";
import { RecoveryKeyReveal } from "@/components/settings/RecoveryKeyReveal";

const FIELD = "w-full rounded-md border border-line bg-transparent px-3 py-2 text-[13px] text-fg outline-none placeholder:text-muted focus:border-line-strong";
const BUTTON = "w-full rounded-md bg-fg px-4 py-2.5 text-[13px] font-semibold text-bg transition hover:bg-white disabled:opacity-60";

async function post(path: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}
const messageOf = (d: Record<string, unknown>, fallback: string) => (typeof d.error === "string" ? d.error : typeof d.message === "string" ? d.message : fallback);

/**
 * The ways back into an account: the recovery key (always), and a link by email when the site has a mail
 * sender. An emailed link lands back here with a token, and the form becomes "choose a new password".
 */
export function ResetPassword({ emailReset, token, expired }: { emailReset: boolean; token: string | null; expired: boolean }) {
  const [mode, setMode] = useState<"key" | "email">("key");
  const [email, setEmail] = useState("");
  const [key, setKey] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== password;

  if (newKey) {
    return (
      <div className="mt-4 space-y-3">
        <p role="status" className="text-[12.5px] text-pos">Your password is changed, and every other device is signed out.</p>
        <p className="text-[12.5px] text-muted">That recovery key is now used up. This is your new one: save it somewhere safe, away from your password.</p>
        <RecoveryKeyReveal value={newKey} />
        <Link href="/sign-in" className="block w-full rounded-md bg-fg px-4 py-2.5 text-center text-[13px] font-semibold text-bg">I have saved it. Sign in</Link>
      </div>
    );
  }
  if (done) {
    return (
      <div className="mt-4 space-y-3">
        <p role="status" className="text-[12.5px] text-pos">Your password is changed, and every other device is signed out.</p>
        <Link href="/sign-in" className="block w-full rounded-md bg-fg px-4 py-2.5 text-center text-[13px] font-semibold text-bg">Sign in</Link>
      </div>
    );
  }

  // Back from the emailed link: choose the new password.
  if (token) {
    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (mismatch) return;
      setBusy(true); setError(null);
      const r = await post("/api/auth/reset-password", { token, newPassword: password }).catch(() => ({ ok: false, data: {} as Record<string, unknown> }));
      setBusy(false);
      if (r.ok) setDone(true); else setError(messageOf(r.data, "That link has expired or was already used. Ask for a new one."));
    };
    return (
      <form onSubmit={submit} className="mt-4 space-y-2.5">
        <p className="text-[12.5px] text-muted">Choose a new password for your account.</p>
        <input className={FIELD} type="password" required minLength={10} maxLength={128} placeholder="New password (10+ characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <input className={FIELD} type="password" required placeholder="The same password again" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {mismatch && <div className="text-[11px] text-neg">The two passwords are not the same.</div>}
        <button type="submit" disabled={busy || mismatch} className={BUTTON}>{busy ? "One moment…" : "Set the new password"}</button>
        {error && <div role="alert" className="text-[11px] text-neg">{error}</div>}
      </form>
    );
  }

  const withKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true); setError(null);
    const r = await post("/api/account/recovery/reset", { email: email.trim(), key, password }).catch(() => ({ ok: false, data: {} as Record<string, unknown> }));
    setBusy(false);
    if (r.ok && typeof r.data.newKey === "string") setNewKey(r.data.newKey);
    else setError(messageOf(r.data, "That did not work just now. Try again in a minute."));
  };
  const byEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await post("/api/auth/request-password-reset", { email: email.trim(), redirectTo: "/sign-in/reset" }).catch(() => ({ ok: false, data: {} as Record<string, unknown> }));
    setBusy(false);
    // The same answer whether or not the email has an account.
    if (r.ok) setSent(true); else setError(messageOf(r.data, "That did not work just now. Try again in a minute."));
  };

  return (
    <div className="mt-2">
      {expired && <p role="alert" className="mt-2 text-[12px] text-neg">That reset link has expired or was already used. Ask for a new one, or use your recovery key.</p>}
      {emailReset && (
        <div className="mt-3 inline-flex rounded-lg border border-line p-0.5 text-[12px]" role="tablist" aria-label="How to reset">
          {([["key", "Recovery key"], ["email", "Email me a link"]] as const).map(([m, label]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(null); }}
              className={`rounded-md px-3 py-1.5 ${mode === m ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:text-fg"}`}>{label}</button>
          ))}
        </div>
      )}
      {mode === "email" && emailReset ? (
        sent ? (
          <p role="status" className="mt-4 text-[12.5px] text-muted">If that email has a YouBank account, a link to choose a new password is on its way. It works for an hour. Check your spam folder if it has not arrived in a few minutes.</p>
        ) : (
          <form onSubmit={byEmail} className="mt-4 space-y-2.5">
            <input className={FIELD} type="email" required placeholder="Your account's email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" disabled={busy} className={BUTTON}>{busy ? "One moment…" : "Email me a link"}</button>
            {error && <div role="alert" className="text-[11px] text-neg">{error}</div>}
          </form>
        )
      ) : (
        <form onSubmit={withKey} className="mt-4 space-y-2.5">
          <p className="text-[12.5px] text-muted">Enter your email, the recovery key you saved when you made your account (or last made in Settings), and a new password.</p>
          <input className={FIELD} type="email" required placeholder="Your account's email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={`${FIELD} font-mono uppercase tracking-wider`} required placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
          <input className={FIELD} type="password" required minLength={10} maxLength={128} placeholder="New password (10+ characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input className={FIELD} type="password" required placeholder="The same password again" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {mismatch && <div className="text-[11px] text-neg">The two passwords are not the same.</div>}
          <button type="submit" disabled={busy || mismatch} className={BUTTON}>{busy ? "One moment…" : "Set the new password"}</button>
          {error && <div role="alert" className="text-[11px] text-neg">{error}</div>}
          <p className="text-[11px] leading-relaxed text-muted">No recovery key? {emailReset ? "Use “Email me a link” above, or ask" : "Ask"} the person who runs YouBank for your team to reset it.</p>
        </form>
      )}
    </div>
  );
}
