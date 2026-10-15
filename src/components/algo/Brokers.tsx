"use client";

/**
 * Broker connections: the built-in paper broker; Alpaca (sign in with Alpaca, or paper API keys);
 * Webull's OpenAPI (your own App Key and Secret); Robinhood's Crypto Trading API (crypto only); and
 * SnapTrade, shared with Fund copies, for the brokers it trades. Credentials are encrypted on the server
 * and never come back to the browser. Robinhood stocks and options have no public API for apps like this.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { confirmDialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { useAlgoConsent } from "./AlgoConsent";
import { call, json, when } from "./client";

type Conn = { ref: string; broker: string; env: string; label: string; status: string; createdAt: string | null; note: string | null };
type Setup = { encryption: boolean; alpacaOAuth: boolean; alpacaLiveKeys: boolean; webull: boolean; robinhoodCrypto: boolean; snaptrade: boolean };
const inputCls = "ctl w-full border border-line bg-panel px-2.5 py-2 text-[13px] text-fg outline-none focus:border-accent";

export function Brokers({ connected, reason }: { connected?: string | null; reason?: string | null }) {
  const ask = useAlgoConsent();
  const [data, setData] = useState<{ connections: Conn[]; setup: Setup } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<"alpaca" | "webull" | "robinhood_crypto" | null>(null);
  const [f, setF] = useState<Record<string, string>>({ env: "paper" });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fetchJson<{ connections: Conn[]; setup: Setup }>("/api/algo/connections").then(setData).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { void load(); }, [load]);
  const add = async () => {
    setBusy(true); setError(null);
    try { await call("/api/algo/connections", json("POST", { broker: form, ...f }), ask); setForm(null); setF({ env: "paper" }); await load(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const oauth = async (env: "paper" | "live") => {
    setError(null);
    try { const r = await call<{ url: string }>("/api/algo/connections/alpaca", json("POST", { env }), ask); window.location.href = r.url; }
    catch (e) { setError(errorMessage(e)); }
  };
  if (!data) return error ? <p className="text-[12px] text-neg">{error}</p> : <div className="shimmer h-40 rounded-md" />;
  const s = data.setup;
  return (
    <div className="space-y-3">
      {connected === "1" && <p className="rounded-md border border-pos/40 bg-pos/10 p-2.5 text-[12px] text-fg">Alpaca is connected.</p>}
      {connected === "0" && <p className="rounded-md border border-neg/40 bg-neg/10 p-2.5 text-[12px] text-neg">{reason || "Alpaca did not complete the connection."}</p>}
      <ul className="panel divide-y divide-line">
        {data.connections.map((c) => (
          <li key={c.ref} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <div className="min-w-0"><div className="text-[13px] font-semibold text-fg">{c.label} {c.env === "paper" && <span className="ml-1 rounded-full border border-line px-1.5 text-[10px] font-normal text-muted">paper</span>}</div><div className="text-[11px] text-muted">{c.note ?? (c.createdAt ? `Connected ${when(c.createdAt)}` : "")}</div></div>
            {c.ref.startsWith("conn:") && <button onClick={async () => { if (await confirmDialog({ title: `Disconnect ${c.label}?`, body: "Strategies using it pause and their unsent batches are canceled. Its stored keys are deleted.", confirmLabel: "Disconnect", tone: "danger" })) { try { await call("/api/algo/connections", json("DELETE", { ref: c.ref }), ask); await load(); } catch (e) { setError(errorMessage(e)); } } }} className="text-[12px] text-neg underline">Disconnect</button>}
            {c.ref === "snaptrade" && <Link href="/app/copy?tab=broker" className="text-[12px] text-accent underline">Manage in Fund copies</Link>}
          </li>
        ))}
      </ul>
      {!s.encryption && <p className="text-[12px] text-muted">Direct broker connections are not set up on this server yet (EMAIL_TOKEN_SECRET).</p>}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="panel p-3"><h3 className="text-[13px] font-semibold text-fg">Alpaca</h3><p className="mt-1 text-[11.5px] text-muted">Stocks, ETFs, options and crypto, with free paper trading.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{s.alpacaOAuth && <><button onClick={() => oauth("paper")} className="ctl border border-line px-2.5 py-1.5 text-[12px]">Sign in (paper)</button><button onClick={() => oauth("live")} className="ctl border border-line px-2.5 py-1.5 text-[12px]">Sign in (live)</button></>}<button onClick={() => { setForm("alpaca"); setF({ env: "paper" }); }} className="ctl border border-line px-2.5 py-1.5 text-[12px]">Paste paper keys</button></div></div>
        <div className="panel p-3"><h3 className="text-[13px] font-semibold text-fg">Webull</h3><p className="mt-1 text-[11.5px] text-muted">Webull&apos;s OpenAPI with your own App Key (apply in Webull&apos;s developer centre), or through SnapTrade.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{s.webull ? <button onClick={() => { setForm("webull"); setF({}); }} className="ctl border border-line px-2.5 py-1.5 text-[12px]">Add App Key</button> : <span className="text-[11.5px] text-muted">Direct Webull is not switched on here; use SnapTrade.</span>}</div></div>
        <div className="panel p-3"><h3 className="text-[13px] font-semibold text-fg">Robinhood Crypto</h3><p className="mt-1 text-[11.5px] text-muted">Robinhood&apos;s official Crypto Trading API: crypto only. Robinhood has no public API for stocks or options for apps like YouBank.</p>
          <div className="mt-2"><button onClick={() => { setForm("robinhood_crypto"); setF({}); }} className="ctl border border-line px-2.5 py-1.5 text-[12px]">Add API key</button></div></div>
        <div className="panel p-3"><h3 className="text-[13px] font-semibold text-fg">SnapTrade</h3><p className="mt-1 text-[11.5px] text-muted">Schwab, Fidelity, Webull, E*TRADE, Tradier and more, through Fund copies&apos; connection (Robinhood there is read-only).</p>
          <div className="mt-2"><Link href="/app/copy?tab=broker" className="ctl inline-block border border-line px-2.5 py-1.5 text-[12px]">{s.snaptrade ? "Connect in Fund copies" : "Not set up yet"}</Link></div></div>
      </div>
      {form && (
        <section className="panel space-y-2 p-3">
          <h3 className="text-[13px] font-semibold text-fg">{form === "alpaca" ? "Alpaca API keys" : form === "webull" ? "Webull App Key" : "Robinhood Crypto API key"}</h3>
          {form === "alpaca" && <>
            <select value={f.env} onChange={(e) => setF({ ...f, env: e.target.value })} className={inputCls}><option value="paper">Paper account</option>{s.alpacaLiveKeys && <option value="live">Live account</option>}</select>
            <input value={f.keyId ?? ""} onChange={(e) => setF({ ...f, keyId: e.target.value.trim() })} placeholder="API key id" className={inputCls} autoComplete="off" />
            <input value={f.secret ?? ""} onChange={(e) => setF({ ...f, secret: e.target.value.trim() })} placeholder="API secret" type="password" className={inputCls} autoComplete="off" />
          </>}
          {form === "webull" && <>
            <input value={f.appKey ?? ""} onChange={(e) => setF({ ...f, appKey: e.target.value.trim() })} placeholder="App Key" className={inputCls} autoComplete="off" />
            <input value={f.appSecret ?? ""} onChange={(e) => setF({ ...f, appSecret: e.target.value.trim() })} placeholder="App Secret" type="password" className={inputCls} autoComplete="off" />
          </>}
          {form === "robinhood_crypto" && <>
            <input value={f.apiKey ?? ""} onChange={(e) => setF({ ...f, apiKey: e.target.value.trim() })} placeholder="API key" className={inputCls} autoComplete="off" />
            <input value={f.privateKey ?? ""} onChange={(e) => setF({ ...f, privateKey: e.target.value.trim() })} placeholder="Private key (base64)" type="password" className={inputCls} autoComplete="off" />
            <p className="text-[11px] text-muted">Create the key in Robinhood&apos;s web app (crypto account settings), registering the matching public key, and choose only the permissions you want.</p>
          </>}
          <p className="flex gap-1.5 text-[11px] text-muted"><Icon name="Lock" className="mt-0.5 h-3 w-3 shrink-0" />Checked with a read call, then stored encrypted. Never shown again, never logged.</p>
          {error && <p className="text-[12px] text-neg">{error}</p>}
          <div className="flex justify-end gap-2"><button onClick={() => setForm(null)} className="ctl border border-line px-3 py-2 text-[12.5px] text-muted">Cancel</button><button onClick={add} disabled={busy} className="ctl bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-60">{busy ? "Checking…" : "Connect"}</button></div>
        </section>
      )}
      {!form && error && <p className="text-[12px] text-neg">{error}</p>}
    </div>
  );
}
