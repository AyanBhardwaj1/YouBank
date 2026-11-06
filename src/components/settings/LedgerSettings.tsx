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
import type { LedgerEntry, LedgerKind } from "@/lib/ledger/chain";

type Page = { available: boolean; settings: { on: boolean; since: string | null }; entries: LedgerEntry[]; total: number; reviewed: Record<number, { decision: string; reviewer: string; at: string }> };
type Check = { ok: boolean; checked: number; firstBad: number | null; problem: string; at: string };

const KIND: Record<LedgerKind, string> = { chat: "AI answer", workflow: "Workflow", red_team: "Red team", mcp: "AI app (MCP)", signoff: "Review", note: "Note" };
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
          {e.kind === "signoff" ? (
            <p>{String(e.meta.reviewer ?? "")} marked entry #{String(e.meta.ref)} <b>{String(e.meta.decision)}</b>{e.output ? `: “${e.output}”` : "."}</p>
          ) : (
            <>
              {e.prompt && <div><div className="text-[10.5px] uppercase tracking-wider text-muted">Asked</div><p className="whitespace-pre-wrap">{e.prompt.length > 1500 ? `${e.prompt.slice(0, 1500)}…` : e.prompt}</p></div>}
              <div><div className="text-[10.5px] uppercase tracking-wider text-muted">{e.kind === "mcp" ? "Returned" : "Answered"}{e.model ? ` · ${e.model}` : ""}</div>
                {e.kind === "mcp" ? <pre className="ctl max-h-64 overflow-auto whitespace-pre-wrap break-words border border-line bg-bg p-2 text-[11px]">{pretty(e.output).slice(0, 6000)}</pre> : <div className="max-h-80 overflow-auto"><Markdown text={e.output} sources={e.sources} /></div>}
              </div>
              {e.meta.figures != null && typeof e.meta.figures === "object" && (() => { const f = e.meta.figures as Record<string, number>; return <p className="text-[11px] text-muted">Figure check: {f.matched} of {f.checkable} figures matched a cited source{f.computed ? `, ${f.computed} computed` : ""}{f.noMatch ? `, ${f.noMatch} did not match` : ""}{f.uncited ? `, ${f.uncited} uncited` : ""}.</p>; })()}
            </>
          )}
          <p className="num break-all text-[10.5px] text-faint">hash {e.hash} · follows {e.prev ? e.prev.slice(0, 16) + "…" : "(first entry)"}</p>
          {e.kind !== "signoff" && (
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
            <div role="status" className={`ctl p-2.5 text-[12px] ${check.ok ? "bg-pos/10 text-pos" : "bg-neg/10 text-neg"}`}>
              {check.ok ? `Intact: all ${check.checked.toLocaleString()} entries recomputed and every hash matches.` : `Broken at entry ${check.firstBad}: ${check.problem}`} <span className="text-muted">({stamp(check.at)})</span>
            </div>
          )}
          {!page && !err && <div className="shimmer h-24 ctl" />}
          {page && entries.length === 0 && <p className="text-[12px] text-muted">{page.settings.on ? "Nothing recorded yet. Ask the assistant something and it appears here." : "Nothing recorded. Start recording to keep a record from now on."}</p>}
          {entries.length > 0 && <ul>{entries.map((e) => <Entry key={e.seq} e={e} review={page?.reviewed[e.seq]} onSigned={load} />)}</ul>}
          {page && entries.length > 0 && entries[entries.length - 1].seq > 1 && entries.length < page.total && <button type="button" onClick={older} className="text-[12px] text-accent">Older entries</button>}
        </section>
      )}
      {err && <p role="alert" className="text-[12px] text-neg">{err}</p>}
    </div>
  );
}
