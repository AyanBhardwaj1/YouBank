"use client";

/**
 * Notarize a deal document or a Studio model's audit trail on Base, and check one later.
 *
 * The file is hashed here in the browser (SHA-256) and never uploaded. The person's own wallet sends
 * a zero-value transaction to their own address carrying the hash; they see it in the wallet and
 * approve or decline, and pay the fee (a fraction of a cent on Base). YouBank stores the transaction
 * hash and confirms it by reading it back from the chain.
 */
import { errorMessage } from "@/lib/client/errors";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Pill } from "@/components/terminal/kit";
import { shortAddress, txUrl } from "@/lib/crypto/chains";
import { sha256Hex } from "@/lib/crypto/notary";
import { connectEvm, discoverEvmWallets, sendNotary, walletMessage, type EvmWallet } from "./wallets";

type Record_ = { id: number; sha256: string; subject: string; kind: string; studioDocId: number | null; studioEventId: number | null; chain: string; txHash: string; fromAddress: string; status: string; reason: string; blockNumber: number | null; confirmedAt: string | null; createdAt: string };
type Subject = { sha256: string; subject: string; kind: "document" | "studio"; studioDocId?: number; studioEventId?: number };
type Doc = { id: number; title: string; mine: boolean };

async function hashFile(f: File): Promise<string> {
  if (f.size > 200 * 1024 * 1024) throw new Error("Files up to 200 MB can be hashed in the browser.");
  return sha256Hex(await f.arrayBuffer());
}

export function Notarize() {
  const [subject, setSubject] = useState<Subject | null>(null);
  const [hashing, setHashing] = useState(false);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [wallets, setWallets] = useState<EvmWallet[] | null>(null);
  const [wallet, setWallet] = useState<{ w: EvmWallet; address: string } | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<Record_[] | null>(null);

  const loadRecords = useCallback(async () => {
    const r = await fetch("/api/crypto/notary").then((x) => x.json()).catch(() => null);
    setRecords(r?.records ?? []);
  }, []);
  useEffect(() => {
    queueMicrotask(() => void loadRecords());
    void discoverEvmWallets().then(setWallets);
    fetch("/api/studio").then((r) => r.json()).then((d) => setDocs(d.docs ?? [])).catch(() => setDocs([]));
  }, [loadRecords]);

  const pickFile = async (f: File) => {
    setHashing(true); setError(null);
    try { setSubject({ sha256: await hashFile(f), subject: f.name.slice(0, 180), kind: "document" }); }
    catch (e) { setError(errorMessage(e)); } finally { setHashing(false); }
  };
  const pickModel = async (id: number) => {
    setHashing(true); setError(null);
    try {
      const res = await fetch(`/api/crypto/notary/studio/${id}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not read that model");
      setSubject({ sha256: await sha256Hex(j.text as string), subject: `Studio: ${j.title} (${j.events} changes${j.truncated ? ", latest 5,000" : ""})`, kind: "studio", studioDocId: id, studioEventId: j.lastEventId });
    } catch (e) { setError(errorMessage(e)); } finally { setHashing(false); }
  };

  const connect = async (w: EvmWallet) => {
    setError(null);
    try { setWallet({ w, address: await connectEvm(w) }); } catch (e) { setError(walletMessage(e)); }
  };

  const notarize = async () => {
    if (!subject || !wallet) return;
    setError(null);
    setStep("Approve the transaction in your wallet (it switches to Base first)…");
    let txHash: string;
    try { txHash = await sendNotary(wallet.w, wallet.address, subject.sha256); }
    catch (e) { setStep(null); setError(walletMessage(e)); return; }
    setStep("Recording and checking it on Base…");
    const res = await fetch("/api/crypto/notary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...subject, txHash, fromAddress: wallet.address, chain: "base" }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    setStep(null);
    if (!res?.ok) { setError(`${j.error ?? "It could not be recorded here just now"}. The transaction was sent; keep its hash: ${txHash}`); return; }
    setSubject(null);
    await loadRecords();
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <div className="ctl border border-line bg-panel p-3">
          <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold"><Icon name="ScrollText" className="h-4 w-4 text-accent" /> 1. What to notarize</h3>
          <p className="mt-1 text-[11.5px] text-muted">A file is hashed here in your browser and never uploaded. A Studio model&apos;s audit trail (every change, who made it and when) is hashed the same way.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="ctl cursor-pointer border border-line px-2.5 py-1 text-[12px] hover:border-accent/60">
              {hashing ? "Hashing…" : "Choose a file"}
              <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickFile(f); e.target.value = ""; }} />
            </label>
            <select disabled={!docs?.length} onChange={(e) => { const id = Number(e.target.value); if (id) void pickModel(id); e.target.value = ""; }} defaultValue="" className="ctl border border-line bg-bg px-2 py-1 text-[12px]">
              <option value="">{docs === null ? "Loading models…" : docs.length ? "Or a Studio model…" : "No Studio models yet"}</option>
              {(docs ?? []).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </div>
          {subject && (
            <div className="mt-2 rounded-md border border-line bg-elevated/40 px-2.5 py-1.5 text-[11.5px]">
              <div className="font-medium">{subject.subject}</div>
              <div className="num break-all text-[10.5px] text-muted">SHA-256 {subject.sha256}</div>
            </div>
          )}
        </div>

        <div className="ctl border border-line bg-panel p-3">
          <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold"><Icon name="Wallet" className="h-4 w-4 text-accent" /> 2. Record it on Base with your wallet</h3>
          <p className="mt-1 text-[11.5px] text-muted">Your wallet sends a transaction to your own address, moving no funds, with the hash written in it. You see it and approve it; the fee is a fraction of a cent, paid in ETH on Base. YouBank never holds a key.</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {wallet ? <span className="text-[12px]">Connected: <span className="num">{shortAddress(wallet.address)}</span> ({wallet.w.name})</span>
              : wallets === null ? <span className="text-[11px] text-faint">Looking for wallets…</span>
              : wallets.length ? wallets.map((w) => <button key={w.id} type="button" onClick={() => void connect(w)} className="ctl border border-line px-2.5 py-1 text-[12px] hover:border-accent/60">{w.name}</button>)
              : <span className="text-[11.5px] text-muted">No Ethereum wallet found in this browser. Install MetaMask or Coinbase Wallet to notarize.</span>}
          </div>
          <button type="button" disabled={!subject || !wallet || !!step} onClick={() => void notarize()} className="ctl mt-3 bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-bg disabled:opacity-40">Notarize on Base</button>
          {step && <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />{step}</p>}
          {error && <p className="mt-2 text-[11.5px] text-neg">{error}</p>}
        </div>

        <Verify records={records ?? []} />
      </div>

      <div className="ctl border border-line bg-panel p-3">
        <div className="flex items-center justify-between"><h3 className="text-[12.5px] font-semibold">Your notarizations</h3><button type="button" onClick={() => void loadRecords()} className="text-[11px] text-muted hover:text-fg">Re-check</button></div>
        {records === null ? <div className="shimmer mt-2 h-24 ctl" /> : !records.length ? <p className="mt-2 text-[11.5px] text-muted">None yet.</p> : (
          <ul className="mt-2 divide-y divide-line text-[11.5px]">
            {records.map((r) => (
              <li key={r.id} className="py-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium" title={r.subject}>{r.subject || "Document"}</span>
                  <Pill kind={r.status === "confirmed" ? "pos" : r.status === "failed" ? "neg" : "warn"}>{r.status}</Pill>
                  <a href={txUrl(r.chain === "base" ? "base" : "ethereum", r.txHash)} target="_blank" rel="noreferrer" className="text-info hover:underline">Basescan ↗</a>
                </div>
                <div className="num break-all text-[10px] text-faint">{r.sha256}</div>
                <div className="text-[10.5px] text-muted">From {shortAddress(r.fromAddress)}{r.blockNumber ? `, block ${r.blockNumber.toLocaleString("en-US")}` : ""}{r.confirmedAt ? `, confirmed ${r.confirmedAt.slice(0, 16).replace("T", " ")} UTC` : ""}{r.reason ? `. ${r.reason}` : ""}</div>
                {r.kind === "studio" && r.studioDocId && <StudioCheck record={r} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** For a notarized Studio model: is it unchanged since? Rebuilds the trail and compares hashes. */
function StudioCheck({ record }: { record: Record_ }) {
  const [result, setResult] = useState<string | null>(null);
  const check = async () => {
    setResult("Checking…");
    try {
      const res = await fetch(`/api/crypto/notary/studio/${record.studioDocId}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not read the model");
      const same = (await sha256Hex(j.text as string)) === record.sha256;
      setResult(same ? "Unchanged since it was notarized." : `Changed since it was notarized${j.lastEventId > (record.studioEventId ?? 0) ? " (edited after)" : ""}.`);
    } catch (e) { setResult(errorMessage(e)); }
  };
  return <div className="mt-0.5 text-[10.5px]"><button type="button" onClick={() => void check()} className="text-accent hover:underline">Is the model unchanged?</button>{result && <span className="ml-2 text-muted">{result}</span>}</div>;
}

/** Check a file against your records, or against any transaction. */
function Verify({ records }: { records: Record_[] }) {
  const [sha, setSha] = useState<{ sha256: string; name: string } | null>(null);
  const [tx, setTx] = useState("");
  const [out, setOut] = useState<string | null>(null);
  const mine = sha ? records.filter((r) => r.sha256 === sha.sha256) : [];
  const checkTx = async () => {
    if (!sha) return;
    setOut("Reading the transaction from Base…");
    const res = await fetch("/api/crypto/notary/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash: tx.trim(), sha256: sha.sha256 }) });
    const j = await res.json().catch(() => ({}));
    setOut(!res.ok ? j.error ?? "Could not check that transaction" : j.ok ? `Yes: this transaction, sent by ${shortAddress(j.from)}${j.blockNumber ? ` in block ${Number(j.blockNumber).toLocaleString("en-US")}` : ""}, records exactly this file.` : `No: ${j.reason}.`);
  };
  return (
    <div className="ctl border border-line bg-panel p-3">
      <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold"><Icon name="Shield" className="h-4 w-4 text-accent" /> Check a file</h3>
      <p className="mt-1 text-[11.5px] text-muted">Hash a file here and see whether it matches a notarization: yours, or anyone&apos;s transaction on Base.</p>
      <label className="ctl mt-2 inline-block cursor-pointer border border-line px-2.5 py-1 text-[12px] hover:border-accent/60">
        Choose the file to check
        <input type="file" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; try { setSha({ sha256: await hashFile(f), name: f.name }); setOut(null); } catch (err) { setOut(err instanceof Error ? err.message : "Could not read that file"); } }} />
      </label>
      {sha && (
        <div className="mt-2 space-y-1.5 text-[11.5px]">
          <div className="num break-all text-[10.5px] text-muted">{sha.name}: {sha.sha256}</div>
          <div>{mine.length ? <span className="text-pos">Matches {mine.length} of your notarizations ({mine.map((r) => r.status).join(", ")}).</span> : <span className="text-muted">Not among your notarizations.</span>}</div>
          <div className="flex gap-1.5">
            <input value={tx} onChange={(e) => setTx(e.target.value)} placeholder="Or a transaction hash (0x…)" className="ctl min-w-0 flex-1 border border-line bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent/60" />
            <button type="button" disabled={!/^0x[0-9a-fA-F]{64}$/.test(tx.trim())} onClick={() => void checkTx()} className="ctl border border-line px-2 py-1 text-[11.5px] hover:border-accent/60 disabled:opacity-40">Check</button>
          </div>
        </div>
      )}
      {out && <p className="mt-1.5 text-[11.5px]">{out}</p>}
    </div>
  );
}
