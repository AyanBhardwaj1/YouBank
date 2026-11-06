"use client";

/**
 * Settings → Research ledger (src/lib/ledger): an append-only, hash-chained record of what the AI was asked
 * and answered for this person, with the sources and model, plus calls from their AI apps over MCP. A
 * firm's books-and-records and AI-governance rules ask for exactly this (prompts and outputs kept, with
 * human review); the chain makes a later edit show. Here: turn it on or off, read entries, sign one off
 * (approved, rejected or noted, written as its own entry), check the whole chain, and export it.
 */
import { useCallback, useEffect, useState } from "react";
import { Markdown } from "@/components/terminal/Markdown";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { connectEvm, discoverEvmWallets, sendNotary, walletMessage, type EvmWallet } from "@/components/crypto/wallets";
import type { LedgerEntry, LedgerKind } from "@/lib/ledger/chain";

type Head = { seq: number; hash: string; at: string; line: string };
type Settings = { on: boolean; since: string | null; anchorEmail: boolean; complianceEmail: string; lastAnchor: { seq: number; hash: string; at: string; to: string[] } | null };
type Page = { available: boolean; settings: Settings; entries: LedgerEntry[]; total: number; reviewed: Record<number, { decision: string; reviewer: string; at: string }>; head: Head | null };
type Anchor = { seq: number | null; hash: string; source: string; state: "matches" | "differs" | "missing"; detail: string };
type Check = { ok: boolean; checked: number; firstBad: number | null; problem: string; at: string; anchors?: Anchor[] };

const KIND: Record<LedgerKind, string> = { chat: "AI answer", workflow: "Workflow", red_team: "Red team", mcp: "AI app (MCP)", signoff: "Review", note: "Recording" };
const primary = "ctl bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-60";
const ghost = "ctl border border-line px-3 py-1.5 text-[12px] text-muted hover:text-fg disabled:opacity-60";
/** An MCP result as stored (the tool's JSON, then its sources) with the JSON indented for reading. */
const pretty = (out: string) => { const i = out.indexOf("\n\nSources"); const head = i < 0 ? out : out.slice(0, i); try { return JSON.stringify(JSON.parse(head), null, 2) + (i < 0 ? "" : out.slice(i)); } catch { return out; } };
const stamp = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

function Entry({ e, review, onSigned }: { e: LedgerEntry; review?: Page["reviewed"][number]; onSigned: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sign = async (decision: "approved" | "rejected" | "noted") => {
    setBusy(true); setErr("");
    try { await fetchJson("/api/ledger/signoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seq: e.seq, decision, note }) }); setNote(""); onSigned(); }
    catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  };
  return (
    <li className="border-t border-line/60 first:border-t-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-left text-[12px]">
        <span className="num w-10 text-muted">#{e.seq}</span>
        <span className="ctl bg-elevated px-1.5 text-[10.5px] font-semibold text-muted">{KIND[e.kind] ?? e.kind}</span>
        <span className="min-w-0 flex-1 truncate">{e.subject || "(no subject)"}</span>
        {review && <span className={`text-[11px] font-semibold ${review.decision === "approved" ? "text-pos" : review.decision === "rejected" ? "text-neg" : "text-accent"}`}>{review.decision}</span>}
        <span className="num text-[11px] text-muted">{stamp(e.at)}</span>
      </button>
      {open && (
        <div className="space-y-2 pb-3 pl-12 text-[12px]">
          {e.kind === "note" ? <p className="text-muted">{e.output}</p> : e.kind === "signoff" ? (
            <p>{String(e.meta.reviewer ?? "")} marked entry #{String(e.meta.ref)} <b>{String(e.meta.decision)}</b>{e.output ? `: “${e.output}”` : "."}</p>
          ) : (
            <>
              {e.prompt && <div><div className="text-[10.5px] uppercase tracking-wider text-muted">Asked</div><p className="whitespace-pre-wrap">{e.prompt.length > 1500 ? `${e.prompt.slice(0, 1500)}…` : e.prompt}</p></div>}
              <div><div className="text-[10.5px] uppercase tracking-wider text-muted">{e.kind === "mcp" ? "Returned" : "Answered"}{e.model ? ` · ${e.model}` : ""}</div>
                {e.kind === "mcp" ? <pre tabIndex={0} aria-label="What the tool returned" className="ctl max-h-64 overflow-auto whitespace-pre-wrap break-words border border-line bg-bg p-2 text-[11px]">{pretty(e.output).slice(0, 6000)}</pre> : <div className="max-h-80 overflow-auto"><Markdown text={e.output} sources={e.sources} /></div>}
              </div>
              {e.meta.figures != null && typeof e.meta.figures === "object" && (() => { const f = e.meta.figures as Record<string, number>; return <p className="text-[11px] text-muted">Figure check: {f.matched} of {f.checkable} figures matched a cited source{f.computed ? `, ${f.computed} computed` : ""}{f.noMatch ? `, ${f.noMatch} did not match` : ""}{f.uncited ? `, ${f.uncited} uncited` : ""}.</p>; })()}
            </>
          )}
          <p className="num break-all text-[10.5px] text-faint">hash {e.hash} · follows {e.prev ? e.prev.slice(0, 16) + "…" : "(first entry)"}</p>
          {e.kind !== "signoff" && e.kind !== "note" && (
            <div className="flex flex-wrap items-center gap-1.5">
              <input value={note} onChange={(x) => setNote(x.target.value)} maxLength={2000} placeholder="Review note (optional)" aria-label="Review note" className="ctl min-w-[200px] flex-1 border border-line bg-panel px-2 py-1.5 text-[12px] outline-none focus:border-accent" />
              <button type="button" disabled={busy} onClick={() => sign("approved")} className={ghost}>Approve</button>
              <button type="button" disabled={busy} onClick={() => sign("rejected")} className={ghost}>Reject</button>
              <button type="button" disabled={busy} onClick={() => sign("noted")} className={ghost}>Note</button>
            </div>
          )}
          {err && <p role="alert" className="text-neg">{err}</p>}
        </div>
      )}
    </li>
  );
}

/**
 * Anchoring the chain outside YouBank: the head line to keep where YouBank cannot change it, a box to
 * check saved lines against the chain, and (with a wallet) a notarization of the head on Base. Any of
 * these proves the entries up to that head were not rewritten afterwards, even by someone with access
 * to YouBank's database.
 */
function Anchors({ head, settings, onCheck, onSaved }: { head: Head; settings: Settings; onCheck: (c: Check) => void; onSaved: () => void }) {
  const [compliance, setCompliance] = useState(settings.complianceEmail);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [wallets, setWallets] = useState<EvmWallet[] | null>(null);
  const [done, setDone] = useState("");
  const [result, setResult] = useState<Check | null>(null);
  useEffect(() => { void discoverEvmWallets().then(setWallets); }, []);
  const save = async (change: { anchorEmail?: boolean; complianceEmail?: string }) => {
    setBusy("save"); setErr("");
    try { await fetchJson("/api/ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) }); onSaved(); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(""); }
  };
  const sendNow = async () => {
    setBusy("send"); setErr(""); setDone("");
    try { const r = await fetchJson<{ sent: boolean }>("/api/ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anchorNow: true }) }); setDone(r.sent ? `Entry ${head.seq}'s head line was emailed.` : settings.anchorEmail ? "The head has not moved since the last anchor." : "Turn on daily anchors first."); onSaved(); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(""); }
  };
  const checkSaved = async () => {
    setBusy("check"); setErr("");
    try { const c = await fetchJson<Check>("/api/ledger/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }); setResult(c); onCheck(c); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(""); }
  };
  const anchor = async (w: EvmWallet) => {
    setBusy("anchor"); setErr(""); setDone("");
    try {
      const address = await connectEvm(w);
      const txHash = await sendNotary(w, address, head.hash);
      await fetchJson("/api/crypto/notary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sha256: head.hash, txHash, fromAddress: address, subject: `Research ledger, entry ${head.seq}`, kind: "ledger", chain: "base" }) });
      setDone(`Entry ${head.seq} anchored on Base (transaction ${txHash.slice(0, 10)}…). "Check the chain" now checks it too.`);
    } catch (e) { setErr(walletMessage(e)); } finally { setBusy(""); }
  };
  return (
    <section className="panel space-y-3 p-4">
      <div className="flex items-center gap-2"><Icon name="Lock" className="h-4 w-4 text-accent" /><h3 className="text-[13px] font-semibold">Anchor it outside YouBank</h3></div>
      <p className="text-[12px] text-muted">The chain shows any edit to one entry. To show that nobody rewrote the whole ledger either, keep its latest hash somewhere YouBank cannot reach: your compliance file, an email to yourself, or a notarization on chain. Pasting it back later proves every entry up to it is exactly as it was.</p>
      <div className="ctl border border-line bg-bg p-2.5">
        <div className="flex items-center justify-between gap-2"><span className="text-[11px] uppercase tracking-wider text-muted">Latest head · entry {head.seq}</span>
          <button type="button" className="text-[11.5px] text-accent" onClick={() => { void navigator.clipboard?.writeText(head.line).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? "Copied" : "Copy the line"}</button>
        </div>
        <code className="num mt-1 block break-all text-[11px]">{head.line}</code>
      </div>
      <div className="space-y-1.5">
        <label className="block text-[12px] text-muted" htmlFor="ledger-anchors">Check lines you saved earlier</label>
        <textarea id="ledger-anchors" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder="Paste one or more saved head lines" className="ctl num min-h-[64px] w-full border border-line bg-panel px-2.5 py-2 text-[11.5px] outline-none focus:border-accent" />
        <button type="button" disabled={!!busy || !text.trim()} onClick={checkSaved} className={ghost}>{busy === "check" ? "Checking…" : "Check saved lines"}</button>
        {result?.anchors && (
          <ul role="status" className="space-y-1 text-[12px]">
            {!result.ok && <li className="text-neg">The chain itself is broken at entry {result.firstBad}: {result.problem}</li>}
            {result.anchors.map((a, i) => <li key={i} className={`ctl px-2 py-1.5 ${a.state === "matches" ? "bg-pos/10 text-pos" : "bg-neg/10 text-neg"}`}><b>{a.state === "matches" ? "Holds" : "Broken"}</b> ({a.source}{a.seq ? `, entry ${a.seq}` : ""}): {a.detail}</li>)}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <span className="text-muted">Or anchor the head on Base with your wallet (a self-transaction, no funds moved, a fraction of a cent):</span>
        {wallets === null ? <span className="text-faint">looking for wallets…</span> : wallets.length ? wallets.map((w) => <button key={w.id} type="button" disabled={!!busy} onClick={() => void anchor(w)} className={ghost}>{busy === "anchor" ? "Approve in your wallet…" : `Anchor with ${w.name}`}</button>) : <span className="text-faint">no Ethereum wallet in this browser.</span>}
      </div>
      <div className="space-y-1.5 border-t border-line pt-3">
        <label className="flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={settings.anchorEmail} disabled={!!busy} onChange={(e) => void save({ anchorEmail: e.target.checked })} />
          Email the head to me every day it changes, so a copy always sits outside YouBank
        </label>
        <div className="flex flex-wrap items-center gap-1.5 pl-6">
          <input value={compliance} onChange={(e) => setCompliance(e.target.value)} type="email" aria-label="Compliance address" placeholder="Also send to (optional): compliance@yourfund.com" className="ctl min-w-[240px] flex-1 border border-line bg-panel px-2 py-1.5 text-[12px] outline-none focus:border-accent" />
          <button type="button" disabled={!!busy || compliance.trim() === settings.complianceEmail} onClick={() => void save({ complianceEmail: compliance })} className={ghost}>Save</button>
          <button type="button" disabled={!!busy} onClick={() => void sendNow()} className={ghost}>{busy === "send" ? "Sending…" : "Send one now"}</button>
        </div>
        <p className="pl-6 text-[11px] text-muted">{settings.lastAnchor ? `Last anchored: entry ${settings.lastAnchor.seq}, ${stamp(settings.lastAnchor.at)}, to ${settings.lastAnchor.to.join(" and ")}.` : "Sent from your own connected mailbox (Relationships), after the day's last answers."}</p>
      </div>
      {done && <p role="status" className="text-[12px] text-pos">{done}</p>}
      {err && <p role="alert" className="text-[12px] text-neg">{err}</p>}
    </section>
  );
}

export function LedgerSettings() {
  const [page, setPage] = useState<Page | null>(null);
  const [more, setMore] = useState<LedgerEntry[]>([]);
  const [kind, setKind] = useState<LedgerKind | "">("");
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    fetchJson<Page>(`/api/ledger${kind ? `?kind=${kind}` : ""}`).then((p) => { setPage(p); setMore([]); }).catch((e) => setErr(errorMessage(e)));
  }, [kind]);
  useEffect(() => { load(); }, [load]);
  const toggle = async () => {
    if (!page) return;
    setBusy("toggle"); setErr("");
    try { await fetchJson("/api/ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: !page.settings.on }) }); load(); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(""); }
  };
  const verify = async () => {
    setBusy("verify"); setErr("");
    try { setCheck(await fetchJson<Check>("/api/ledger/verify")); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(""); }
  };
  const older = async () => {
    const all = [...(page?.entries ?? []), ...more];
    const before = all[all.length - 1]?.seq;
    if (!before) return;
    try { const p = await fetchJson<Page>(`/api/ledger?before=${before}${kind ? `&kind=${kind}` : ""}`); setMore((m) => [...m, ...p.entries]); } catch (e) { setErr(errorMessage(e)); }
  };
  const entries = [...(page?.entries ?? []), ...more];
  return (
    <div className="mt-5 max-w-3xl space-y-5">
      <section className="panel p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Icon name="ScrollText" className="h-4 w-4 text-accent" />
          <h2 className="text-[14px] font-semibold">Research ledger</h2>
          {page && <span className={`ctl px-1.5 py-0.5 text-[10.5px] font-semibold ${page.settings.on ? "bg-pos/15 text-pos" : "bg-elevated text-muted"}`}>{page.settings.on ? "Recording" : "Off"}</span>}
          {page?.available !== false && <button type="button" disabled={!page || !!busy} onClick={toggle} className={`ml-auto ${page?.settings.on ? ghost : primary}`}>{page?.settings.on ? "Stop recording" : "Start recording"}</button>}
        </div>
        <p className="mt-1.5 text-[12.5px] text-muted">
          A tamper-evident record of what the AI was asked and answered for you: every assistant answer, deep research run, workflow and red team, and every call your AI apps make over MCP, with the model, the sources and how many figures matched them. Each entry&apos;s hash covers the one before it, so changing any past entry shows. Review entries here and export the whole chain for your compliance team; the export says how to check it without YouBank.
        </p>
        {page?.settings.on && page.settings.since && <p className="mt-1 text-[11.5px] text-muted">Recording since {stamp(page.settings.since)}. Stopping keeps what is recorded.</p>}
        {page?.available === false && <p className="mt-2 text-[12px] text-neg">The ledger is not set up on this server yet (migration 0033).</p>}
      </section>

      {page?.available !== false && (
        <section className="panel space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold">{page ? `${page.total.toLocaleString()} entries` : "Entries"}</h3>
            <select aria-label="Filter by kind" value={kind} onChange={(e) => setKind(e.target.value as LedgerKind | "")} className="ctl border border-line bg-panel px-2 py-1 text-[12px]">
              <option value="">Everything</option>{(Object.keys(KIND) as LedgerKind[]).filter((k) => k !== "note").map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
            </select>
            <div className="ml-auto flex gap-1.5">
              <button type="button" disabled={!!busy || !page?.total} onClick={verify} className={ghost}>{busy === "verify" ? "Checking…" : "Check the chain"}</button>
              <a href="/api/ledger/export" className={`${ghost} ${page?.total ? "" : "pointer-events-none opacity-60"}`} download>Export (JSONL)</a>
            </div>
          </div>
          {check && (
            <div role="status" className={`ctl p-2.5 text-[12px] ${check.ok && (check.anchors ?? []).every((a) => a.state === "matches") ? "bg-pos/10 text-pos" : "bg-neg/10 text-neg"}`}>
              {check.ok ? `Intact: all ${check.checked.toLocaleString()} entries recomputed and every hash matches.` : `Broken at entry ${check.firstBad}: ${check.problem}`} <span className="text-muted">({stamp(check.at)})</span>
              {!!check.anchors?.length && (
                <ul className="mt-1.5 space-y-0.5 border-t border-current/20 pt-1.5">
                  {check.anchors.map((a, i) => <li key={i} className={a.state === "matches" ? "text-pos" : "text-neg"}>{a.state === "matches" ? "Anchor holds" : "Anchor broken"} ({a.source}{a.seq ? `, entry ${a.seq}` : ""}): {a.detail}</li>)}
                </ul>
              )}
            </div>
          )}
          {!page && !err && <div className="shimmer h-24 ctl" />}
          {page && entries.length === 0 && <p className="text-[12px] text-muted">{page.settings.on ? "Nothing recorded yet. Ask the assistant something and it appears here." : "Nothing recorded. Start recording to keep a record from now on."}</p>}
          {entries.length > 0 && <ul>{entries.map((e) => <Entry key={e.seq} e={e} review={page?.reviewed[e.seq]} onSigned={load} />)}</ul>}
          {page && entries.length > 0 && entries[entries.length - 1].seq > 1 && entries.length < page.total && <button type="button" onClick={older} className="text-[12px] text-accent">Older entries</button>}
        </section>
      )}
      {page?.available !== false && page?.head && <Anchors head={page.head} settings={page.settings} onCheck={setCheck} onSaved={load} />}
      {err && <p role="alert" className="text-[12px] text-neg">{err}</p>}
    </div>
  );
}
