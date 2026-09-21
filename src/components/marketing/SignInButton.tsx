"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";

export function SignInButton({ label = "Continue with Google", next = "/app", className = "" }: { label?: string; next?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setError(null);
    try {
      await authClient.signIn.social({ provider: "google", callbackURL: `${window.location.origin}${next}`, newUserCallbackURL: `${window.location.origin}/onboarding` });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <div className={className}>
      <button type="button" onClick={go} disabled={busy}
        className="flex items-center gap-3 rounded-md bg-fg px-4 py-2.5 text-[13px] font-semibold text-bg transition hover:bg-white disabled:opacity-60">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.5 13.3l7.9 6.1C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.4 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.5 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
        {busy ? "Redirecting…" : label}
      </button>
      {error && <div className="mt-2 text-[11px] text-neg">{error}</div>}
    </div>
  );
}
