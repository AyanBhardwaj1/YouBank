"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Field, ago, api, btn, input, type PanelCtx } from "./shared";

export type Account = { id: number; address: string; provider: string; status: string; lastSyncAt: string | null; lastError: string; host: string };
export type MailboxInfo = {
  accounts: Account[]; configurable: boolean; oauth: boolean;
  presets: Record<string, { label: string; appPasswordUrl: string; note: string }>;
};
type SyncResult = { fetched: number; triaged: number; skipped: number; drafted: number; scheduled: number; sent: number; youReplied: number; errors: string[] };

const BLANK = { preset: "gmail", email: "", password: "", name: "", imapHost: "", imapPort: "993", smtpHost: "", smtpPort: "465" };

/**
 * The connected mailboxes and the two ways to add one: Google sign-in (when the server has an OAuth
 * client), or an app password over IMAP/SMTP, which works with Gmail and most providers and needs no
 * developer setup at all.
 */
export function MailboxBar({ ctx, info, autoSync }: { ctx: PanelCtx; info: MailboxInfo | null; autoSync: boolean }) {
  const [connecting, setConnecting] = useState<typeof BLANK | null>(null);
  const accounts = info?.accounts ?? [];
  const preset = connecting && info?.presets[connecting.preset];

  const connect = () => ctx.run("connect", async () => {
    if (!connecting) return;
    const body = connecting.preset === "custom"
      ? { ...connecting, preset: undefined, imapPort: Number(connecting.imapPort), smtpPort: Number(connecting.smtpPort) }
      : { preset: connecting.preset, email: connecting.email, password: connecting.password, name: connecting.name };
    const a = await api<Account>("/api/crm/accounts", { method: "POST", body: JSON.stringify(body) });
    setConnecting(null);
    ctx.say(`Connected ${a.address}. Signed in to both mail servers. ${autoSync ? "The agent reads new mail every few minutes; press Sync to start now." : "Press Sync to read it."}`);
    ctx.refresh();
  });
  const sync = (id: number) => ctx.run("sync", async () => {
    const r = await api<SyncResult>("/api/crm/gmail/sync", { method: "POST", body: JSON.stringify({ accountId: id, max: 15 }) });
    ctx.say([
      `Read ${r.triaged} new ${r.triaged === 1 ? "thread" : "threads"}`,
      r.drafted ? `drafted ${r.drafted} ${r.drafted === 1 ? "reply" : "replies"}` : "",
      r.scheduled ? `${r.scheduled} scheduled on autopilot` : "",
      r.sent ? `sent ${r.sent}` : "",
      r.youReplied ? `${r.youReplied} withdrawn because you had replied` : "",
    ].filter(Boolean).join(", ") + `.${r.errors.length ? ` ${r.errors.length} failed: ${r.errors[0]}` : ""}`);
    ctx.refresh();
  });
  const disconnect = (a: Account) => ctx.run(`dc-${a.id}`, async () => {
    if (!window.confirm(`Disconnect ${a.address}? Its stored ${a.provider === "imap" ? "password is" : "tokens are"} deleted. Threads already read stay in your CRM.`)) return;
    await api(`/api/crm/accounts/${a.id}`, { method: "DELETE" });
    ctx.say(`Disconnected ${a.address}`); ctx.refresh();
  });

  return (
    <div className="mt-4 ctl border border-line bg-elevated/30 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {accounts.length === 0 ? (
          <span className="text-[11.5px] text-muted"><Icon name="Mail" className="mr-1.5 inline h-3.5 w-3.5" />No mailbox connected. The agent can still read anything you paste in.</span>
        ) : (
          <div className="flex min-w-0 flex-col gap-1">
            {accounts.map((a) => (
              <span key={a.id} className="flex min-w-0 flex-wrap items-center gap-2 text-[11.5px]">
                <Icon name="Mail" className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{a.address}</span>
                <span className="text-muted">
                  {a.provider === "imap" ? "app password" : "Google sign-in"} · {a.status === "needs_reauth" ? "needs reconnecting" : `last read ${ago(a.lastSyncAt)}`}
                  {autoSync && a.status === "connected" ? " · reads every few minutes" : ""}
                </span>
                {a.lastError && <span className="truncate text-neg" title={a.lastError}>· {a.lastError.slice(0, 80)}</span>}
                {a.status === "needs_reauth"
                  ? (a.provider === "imap"
                    ? <button type="button" onClick={() => setConnecting({ ...BLANK, email: a.address })} className={btn.primary}>Reconnect</button>
                    : <a href="/api/crm/gmail/connect" className={btn.primary}>Reconnect</a>)
                  : <button type="button" onClick={() => sync(a.id)} disabled={!!ctx.busy} className={btn.primary}>{ctx.busy === "sync" ? "Reading…" : "Sync now"}</button>}
                <button type="button" onClick={() => disconnect(a)} disabled={!!ctx.busy} className={btn.danger}>Disconnect</button>
              </span>
            ))}
          </div>
        )}
        <span className="flex items-center gap-2">
          {info?.oauth && <a href="/api/crm/gmail/connect" className={btn.ghost}>Sign in with Google</a>}
          {info?.configurable
            ? <button type="button" onClick={() => setConnecting(connecting ? null : BLANK)} className={accounts.length ? btn.ghost : btn.primary}>{accounts.length ? "Add a mailbox" : "Connect a mailbox"}</button>
            : <span className="text-[11px] text-muted">Connecting a mailbox needs EMAIL_TOKEN_SECRET on the server.</span>}
        </span>
      </div>

      {connecting && info && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Provider">
              <select value={connecting.preset} onChange={(e) => setConnecting({ ...connecting, preset: e.target.value })} className={input}>
                {Object.entries(info.presets).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                <option value="custom">Other (enter servers)</option>
              </select>
            </Field>
            <Field label="Email address"><input value={connecting.email} onChange={(e) => setConnecting({ ...connecting, email: e.target.value })} placeholder="you@company.com" className={input} /></Field>
            <Field label="App password" hint="Not your normal password.">
              <input type="password" autoComplete="off" value={connecting.password} onChange={(e) => setConnecting({ ...connecting, password: e.target.value })} placeholder="abcd efgh ijkl mnop" className={input} />
            </Field>
            <Field label="Your name, as recipients see it"><input value={connecting.name} onChange={(e) => setConnecting({ ...connecting, name: e.target.value })} placeholder="Ayan Bhardwaj" className={input} /></Field>
          </div>
          {connecting.preset === "custom" && (
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <Field label="IMAP server"><input value={connecting.imapHost} onChange={(e) => setConnecting({ ...connecting, imapHost: e.target.value })} placeholder="imap.example.com" className={input} /></Field>
              <Field label="IMAP port"><input value={connecting.imapPort} onChange={(e) => setConnecting({ ...connecting, imapPort: e.target.value })} className={input} /></Field>
              <Field label="SMTP server"><input value={connecting.smtpHost} onChange={(e) => setConnecting({ ...connecting, smtpHost: e.target.value })} placeholder="smtp.example.com" className={input} /></Field>
              <Field label="SMTP port"><input value={connecting.smtpPort} onChange={(e) => setConnecting({ ...connecting, smtpPort: e.target.value })} className={input} /></Field>
            </div>
          )}
          {preset && (
            <p className="mt-2 text-[11px] text-muted">
              {preset.note} <a href={preset.appPasswordUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">Create an app password →</a>
            </p>
          )}
          <p className="mt-1 text-[10.5px] text-muted">YouBank signs in to both servers before saving anything. The password is encrypted (AES-256-GCM) and never shown again; disconnecting deletes it.</p>
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={connect} disabled={!!ctx.busy || !connecting.email.trim() || !connecting.password.trim()} className={btn.primary}>{ctx.busy === "connect" ? "Signing in…" : "Connect"}</button>
            <button type="button" onClick={() => setConnecting(null)} className={btn.link}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
