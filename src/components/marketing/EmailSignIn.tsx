"use client";

import Link from "next/link";
import { useState } from "react";
import { RecoveryKeyReveal } from "@/components/settings/RecoveryKeyReveal";
import { getAuthClient } from "@/lib/auth/client";
import { signInError } from "./SignInButton";

const FIELD = "w-full rounded-md border border-line bg-transparent px-3 py-2 text-[13px] text-fg outline-none placeholder:text-muted focus:border-line-strong";

/**
 * Email and password sign-in, and account creation. A returning person lands on `next`; a new one sees
 * their recovery key once (src/lib/auth/recovery.ts), then goes on to onboarding. "Forgot your password?"
 * opens /sign-in/reset.
 */
export function EmailSignIn({ next = "/app", className = "" }: { next?: string; className?: string }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const client = await getAuthClient();
      const res = mode === "in"
        ? await client.signIn.email({ email: email.trim(), password })
        : await client.signUp.email({ name: name.trim() || email.trim().split("@")[0], email: email.trim(), password });
      if (res?.error) { setError(signInError(res.error)); setBusy(false); return; }
      // Two-factor is on: the auth client is already taking the browser to the code page, and there is
      // no session yet, so going to `next` here would only bounce back to sign-in.
      if (res?.data && "twoFactorRedirect" in res.data && res.data.twoFactorRedirect) return;
      // A full load, so the server renders the signed-in app with the new session cookie.
      // A new account goes through onboarding first, then on to where it was headed (an invitation link).
      const dest = mode === "in" ? next : next === "/app" ? "/onboarding" : `/onboarding?next=${encodeURIComponent(next)}`;
      if (mode === "up") {
        // Its recovery key, shown once, before anything else: the way back in if the password is forgotten.
        const r = await fetch("/api/account/recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
        const k = r?.ok ? ((await r.json().catch(() => ({}))) as { key?: string }).key : undefined;
        if (k) { setRecoveryKey(k); setAfter(dest); setBusy(false); return; }
      }
      window.location.assign(dest);
    } catch (err) {
      setError(signInError(err));
      setBusy(false);
    }
  };

  if (recoveryKey) {
    return (
      <div className={`space-y-3 ${className}`}>
        <p className="text-[13px] font-semibold text-fg">Your account is ready. Save your recovery key.</p>
        <p className="text-[12px] leading-relaxed text-muted">If you ever forget your password, your email and this key let you set a new one. It is shown only now; keep it apart from your password, in a password manager or on paper. You can make a new one in Settings.</p>
        <RecoveryKeyReveal value={recoveryKey} />
        <button type="button" onClick={() => window.location.assign(after ?? "/onboarding")} className="w-full rounded-md bg-fg px-4 py-2.5 text-[13px] font-semibold text-bg transition hover:bg-white">I have saved it. Continue</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} onPointerEnter={() => { void getAuthClient(); }} className={`space-y-2.5 ${className}`}>
      {mode === "up" && <input className={FIELD} placeholder="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
      <input className={FIELD} type="email" required placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className={FIELD} type="password" required minLength={mode === "up" ? 10 : undefined} placeholder={mode === "up" ? "Password (10+ characters)" : "Password"}
        autoComplete={mode === "up" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit" disabled={busy} className="w-full rounded-md bg-fg px-4 py-2.5 text-[13px] font-semibold text-bg transition hover:bg-white disabled:opacity-60">
        {busy ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}
      </button>
      {error && <div className="text-[11px] text-neg">{error}</div>}
      <div className="flex items-center justify-between text-[11.5px] text-muted">
        <button type="button" className="hover:text-fg" onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(null); }}>
          {mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}
        </button>
        {mode === "in" && <Link href="/sign-in/reset" className="hover:text-fg">Forgot your password?</Link>}
      </div>
    </form>
  );
}
