"use client";

/**
 * Settings → Security: two-factor authentication with an authenticator app (Better Auth's twoFactor
 * plugin). Turning it on gives an otpauth:// link (opens the authenticator app on a phone) and the same
 * secret to type in by hand; there is no QR code, as no QR library ships with the app. The first code
 * entered finishes turning it on, and the ten backup codes are shown once, then. Turning it off asks for
 * the password when the account has one, and (as any change while it is on) a fresh code.
 *
 * Once it is on: password sign-in asks for a code, and connecting brokers or mailboxes and live trading
 * ask for a fresh one whatever the sign-in method (src/lib/auth/step-up).
 */
import { useEffect, useState } from "react";
import { getAuthClient } from "@/lib/auth/client";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { ensureStepUp, totpSecret } from "@/lib/client/step-up";
import { signInError } from "@/components/marketing/SignInButton";
import { Icon } from "@/components/ui/Icon";

type Status = { enabled: boolean; hasPassword: boolean };
type AuthFailure = { code?: string; status?: number; message?: string; error?: string } | null | undefined;

const input = "ctl w-full border border-line bg-panel px-2.5 py-2 text-[13px] text-fg outline-none focus:border-accent";
const primary = "ctl bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-60";
const ghost = "ctl border border-line px-3 py-2 text-[12.5px] text-muted hover:text-fg disabled:opacity-60";

/** What a refused auth call says: the plugin's codes in plain words, else as sign-in errors read. */
function failure(e: AuthFailure): string {
  if (e?.code === "INVALID_PASSWORD") return "That password is not right.";
  if (e?.code === "INVALID_CODE") return "That code did not match. Check the time on your phone and try a new code.";
  if ((e?.code === "two_factor_required" || e?.code === "reauth_required") && e.error) return e.error;
  if (e?.status === 429) return "Too many tries. Wait a few seconds and try again.";
  return signInError(e);
}

/**
 * An auth client call that, refused for want of a fresh code (any 2FA change while it is on), asks for
 * one and tries once more. Null when the person closed the code dialog.
 */
async function withCode<T extends { error?: AuthFailure }>(fn: () => Promise<T>): Promise<T | null> {
  const r = await fn();
  if (r.error?.code !== "two_factor_required") return r;
  return (await ensureStepUp()) ? fn() : null;
}

export function SecuritySettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Enrolment in progress: the link and the backup codes from turning it on, until the first code is checked.
  const [enrol, setEnrol] = useState<{ uri: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState("");
  // Shown once, right after the first code is accepted.
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { fetchJson<Status>("/api/security/two-factor").then(setStatus, (e) => setError(errorMessage(e))); }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(signInError(e)); } finally { setBusy(false); }
  };

  const turnOn = () => run(async () => {
    if (status?.hasPassword && !password) { setError("Enter your password to turn on two-factor."); return; }
    const client = await getAuthClient();
    const res = await withCode(() => client.twoFactor.enable({ password: status?.hasPassword ? password : undefined }));
    if (!res) return;
    if (res.error || !res.data) { setError(failure(res.error)); return; }
    setPassword(""); setCode("");
    setEnrol({ uri: res.data.totpURI, backupCodes: res.data.backupCodes });
  });

  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const c = code.replace(/\s+/g, "");
      if (!/^\d{6}$/.test(c)) { setError("Enter the 6-digit code from your authenticator app."); return; }
      const client = await getAuthClient();
      const res = await client.twoFactor.verifyTotp({ code: c });
      if (res.error) { setError(failure(res.error)); setCode(""); return; }
      setCodes(enrol?.backupCodes ?? []); setEnrol(null); setCode("");
      setStatus((s) => (s ? { ...s, enabled: true } : s));
    });
  };

  const turnOff = () => run(async () => {
    if (status?.hasPassword && !password) { setError("Enter your password to turn off two-factor."); return; }
    const client = await getAuthClient();
    const res = await withCode(() => client.twoFactor.disable({ password: status?.hasPassword ? password : undefined }));
    if (!res) return;
    if (res.error) { setError(failure(res.error)); return; }
    setPassword(""); setCodes(null);
    setStatus((s) => (s ? { ...s, enabled: false } : s));
  });

  const copy = async () => {
    try { await navigator.clipboard.writeText((codes ?? []).join("\n")); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError("Could not copy. Select the codes and copy them by hand."); }
  };

  const passwordField = status?.hasPassword && (
    <label className="block max-w-xs">
      <span className="text-[11.5px] text-muted">Your password</span>
      <input className={`${input} mt-1`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
    </label>
  );

  return (
    <section className="mt-5 rise space-y-4" aria-labelledby="sec-title">
      <div className="max-w-[80ch]">
        <h2 id="sec-title" className="text-[14px] font-semibold">Security</h2>
        <p className="mt-1 text-[12px] text-muted">Two-factor authentication asks for a code from an authenticator app (Google Authenticator, 1Password, Authy, Microsoft Authenticator and the like) when you sign in with your password, and before anyone can connect a broker or a mailbox or turn on live trading from your account, however they signed in.</p>
      </div>
      {error && <p role="alert" className="text-[12px] text-neg">{error}</p>}
      {!status && !error && <div className="shimmer h-32 ctl" aria-busy="true" />}

      {status && (
        <div className="panel p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Icon name="Shield" className={`h-4 w-4 ${status.enabled ? "text-pos" : "text-muted"}`} />
            <h3 className="text-[13px] font-semibold">Two-factor authentication</h3>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${status.enabled ? "border-pos/40 bg-pos/10 text-pos" : "border-line text-muted"}`}>{status.enabled ? "On" : enrol ? "Finishing" : "Off"}</span>
          </div>

          {codes && (
            <div className="mt-3 rounded-md border border-accent/40 bg-accent-soft p-3">
              <p className="text-[12px] text-fg">Two-factor is on. Save these backup codes somewhere safe, such as your password manager. Each works once, in place of a code, if you lose your phone. They are not shown again.</p>
              <ul className="num mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px] text-fg sm:grid-cols-5">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={copy} className={ghost}><Icon name={copied ? "Check" : "Copy"} className="mr-1 inline h-3.5 w-3.5" />{copied ? "Copied" : "Copy codes"}</button>
                <button type="button" onClick={() => setCodes(null)} className={primary}>I have saved them</button>
              </div>
            </div>
          )}

          {!status.enabled && !enrol && (
            <div className="mt-3 space-y-3">
              <p className="text-[12px] text-muted">It is off. Turn it on to protect sign-in and the riskier parts of YouBank.{status.hasPassword ? "" : " Your account signs in with Google, so no password is needed here."}</p>
              {passwordField}
              <button type="button" onClick={turnOn} disabled={busy} className={primary}>{busy ? "One moment…" : "Turn on two-factor"}</button>
            </div>
          )}

          {enrol && (
            <form onSubmit={verify} className="mt-3 space-y-3">
              <ol className="list-decimal space-y-2 pl-5 text-[12px] text-muted">
                <li>
                  On your phone, <a href={enrol.uri} className="text-accent underline">open this link in your authenticator app</a>. On a computer, add an account in the app by hand with this key:
                  <div className="num mt-1.5 select-all break-all rounded-md border border-line bg-elevated px-2.5 py-1.5 text-[13px] tracking-wider text-fg">{totpSecret(enrol.uri)}</div>
                  <span className="mt-1 block text-[11px]">Time-based, 6 digits, every 30 seconds. Keep this key private: anyone with it can make your codes.</span>
                </li>
                <li>Enter the 6-digit code the app shows to finish.</li>
              </ol>
              <div className="flex flex-wrap items-end gap-2">
                <input className={`${input} num max-w-[10rem] tracking-[0.3em]`} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7}
                  placeholder="123456" aria-label="Authenticator code" value={code} onChange={(e) => setCode(e.target.value)} />
                <button type="submit" disabled={busy} className={primary}>{busy ? "Checking…" : "Verify and turn on"}</button>
                <button type="button" onClick={() => { setEnrol(null); setCode(""); setError(null); }} className={ghost}>Cancel</button>
              </div>
            </form>
          )}

          {status.enabled && !codes && (
            <div className="mt-3 space-y-3">
              <p className="text-[12px] text-muted">It is on. Password sign-in asks for a code (or a backup code), and risky actions ask for a fresh code every ten minutes. To get new backup codes, turn it off and on again.</p>
              {passwordField}
              <button type="button" onClick={turnOff} disabled={busy} className={ghost}>{busy ? "One moment…" : "Turn off two-factor"}</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
