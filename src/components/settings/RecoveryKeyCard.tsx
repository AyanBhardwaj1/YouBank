"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { RecoveryKeyReveal } from "./RecoveryKeyReveal";

const input = "ctl w-full max-w-[22rem] border border-line bg-panel px-2.5 py-2 text-[13px] text-fg outline-none focus:border-accent";

/** Settings → Security: whether there is a recovery key, and making a new one (shown once). */
export function RecoveryKeyCard() {
  const [status, setStatus] = useState<{ has: boolean; createdAt: string | null } | null>(null);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/account/recovery").then((r) => (r.ok ? r.json() : null)).then((s) => setStatus(s ?? { has: false, createdAt: null })).catch(() => setStatus({ has: false, createdAt: null }));
  }, []);

  const make = async () => {
    setBusy(true); setError(null);
    const res = await fetch("/api/account/recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }).catch(() => null);
    const data = (await res?.json().catch(() => ({}))) as { key?: string; error?: string; needsPassword?: boolean } | undefined;
    setBusy(false);
    if (res?.ok && data?.key) { setKey(data.key); setPassword(""); setStatus({ has: true, createdAt: new Date().toISOString() }); return; }
    if (data?.needsPassword) setNeedsPassword(true);
    setError(data?.error ?? "That did not work just now. Try again in a minute.");
  };

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="Lock" className={`h-4 w-4 ${status?.has ? "text-pos" : "text-muted"}`} />
        <h3 className="text-[13px] font-semibold">Recovery key</h3>
        {status && <span className={`rounded-full border px-2 py-0.5 text-[11px] ${status.has ? "border-pos/40 bg-pos/10 text-pos" : "border-line text-muted"}`}>{status.has ? "Saved" : "None yet"}</span>}
      </div>
      <p className="mt-2 max-w-[80ch] text-[12px] text-muted">
        If you forget your password, your email and this key set a new one at <span className="text-fg">Forgot your password?</span> on the sign-in page. Keep it apart from your password, in a password manager or on paper. Making a new key replaces the old one.
        {status?.createdAt ? ` Your current key was made on ${new Date(status.createdAt).toLocaleDateString()}.` : ""}
      </p>
      {key ? (
        <div className="mt-3 max-w-[30rem] space-y-2">
          <p className="text-[12px] text-fg">Your new recovery key. It is not shown again.</p>
          <RecoveryKeyReveal value={key} />
          <button type="button" onClick={() => setKey(null)} className="ctl bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg">I have saved it</button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {(needsPassword || status?.has) && (
            <input className={input} type="password" autoComplete="current-password" placeholder="Your password (if your account has one)" value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
          <button type="button" onClick={make} disabled={busy || !status} className="ctl border border-line px-3 py-1.5 text-[12px] text-fg hover:border-accent/50">{busy ? "One moment…" : status?.has ? "Make a new recovery key" : "Make a recovery key"}</button>
          {error && <p role="alert" className="text-[12px] text-neg">{error}</p>}
        </div>
      )}
    </div>
  );
}
