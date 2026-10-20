"use client";

import { useState } from "react";
import { getAuthClient } from "@/lib/auth/client";
import { signInError } from "./SignInButton";

const FIELD = "w-full rounded-md border border-line bg-transparent px-3 py-2 text-[13px] text-fg outline-none placeholder:text-muted focus:border-line-strong";

/**
 * Email and password sign-in, and account creation. A returning person lands on `next`; a new one on
 * onboarding. There is no emailed reset yet (no mail sender): the form says to ask for one.
 */
export function EmailSignIn({ next = "/app", className = "" }: { next?: string; className?: string }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const client = await getAuthClient();
      const res = mode === "in"
        ? await client.signIn.email({ email: email.trim(), password })
        : await client.signUp.email({ name: name.trim() || email.trim().split("@")[0], email: email.trim(), password });
      if (res?.error) { setError(signInError(res.error)); setBusy(false); return; }
      // A full load, so the server renders the signed-in app with the new session cookie.
      // A new account goes through onboarding first, then on to where it was headed (an invitation link).
      window.location.assign(mode === "in" ? next : next === "/app" ? "/onboarding" : `/onboarding?next=${encodeURIComponent(next)}`);
    } catch (err) {
      setError(signInError(err));
      setBusy(false);
    }
  };

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
        {mode === "in" && <button type="button" className="hover:text-fg" aria-expanded={forgot} onClick={() => setForgot(!forgot)}>Forgot your password?</button>}
      </div>
      {/* No emailed reset yet (no mail sender): a hover title would be invisible on a phone, so it is said in place. */}
      {mode === "in" && forgot && (
        <p role="status" className="rounded-md border border-line px-3 py-2 text-[11.5px] leading-relaxed text-muted">
          Password resets are done by the YouBank team for now. Contact the person who invited you, or whoever runs YouBank for your team, and they will reset it for you.
        </p>
      )}
    </form>
  );
}
