"use client";

/**
 * The library: what Edge can read for this person. Uploads (a data room's PDFs, Word, Excel and
 * PowerPoint files, scans, email threads) and recordings are private to the uploader unless shared
 * with a team, kept until deleted, and counted against the beta quota shown at the top. Filings,
 * recordings by link and the person's workspace can be read in from here too. Premium readers
 * (LlamaParse for hard PDFs, speaker labels for recordings) are chosen per upload or per document, with
 * their plan badges; nothing goes to them unless the person picks them.
 */
import { AlertCircle, FileAudio, FileText, Globe, Link2, Loader2, Mail, RotateCcw, Search, Trash2, Upload, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { confirmDialog } from "@/components/ui/Dialog";
import { PremiumBadge } from "@/components/billing/Premium";
import { isPlanError, PlanNotice } from "@/components/billing/PlanNotice";
import { Select } from "@/components/ui/Select";
import { ago, api, post, useApi, useNow } from "@/components/news/client";
import { clockOf } from "@/lib/edge/docs/text";
import { errorText, fmtBytes, FORM_OPTIONS, poll, READING, SOURCE_LABEL, uploadFile, type Library as LibraryData, type LibDoc } from "./client";

/** What the reader handles. Word, Excel and PowerPoint in their current formats (not the pre-2007 .doc, .xls and .ppt). */
const ACCEPT = ".pdf,.docx,.xlsx,.xlsm,.pptx,.csv,.txt,.md,.html,.htm,.json,.eml,.msg,.png,.jpg,.jpeg,.tif,.tiff,.mp3,.m4a,.wav,.aac,.ogg,.flac,.mp4,.mov,.webm";
const MAX_BYTES = 200 * 1024 * 1024;

type Team = { id: number; name: string };
type Upload = { key: string; name: string; bytes: number; progress: number; error?: string; plan?: boolean; done?: boolean; note?: string };

const isAudio = (d: Pick<LibDoc, "source" | "mime">) => d.source === "audio" || /^(audio|video)\//.test(d.mime);
const isParseable = (d: Pick<LibDoc, "mime" | "title">) => /^(application\/pdf|image\/|application\/vnd\.openxmlformats-officedocument\.)/.test(d.mime) || /\.(pdf|png|jpe?g|tiff?|docx|pptx|xlsx)$/i.test(d.title);

const STATUS_TEXT: Record<string, string> = { queued: "Waiting to be read", parsing: "Reading", indexing: "Indexing passages", failed: "Could not be read" };

function DocIcon({ d }: { d: LibDoc }) {
  const cls = "h-4 w-4 shrink-0 text-muted";
  if (d.source === "audio" || /^(audio|video)\//.test(d.mime)) return <FileAudio className={cls} />;
  if (d.source === "web" || d.source === "newsroom") return <Globe className={cls} />;
  if (/rfc822|outlook/.test(d.mime)) return <Mail className={cls} />;
  return <FileText className={cls} />;
}

function details(d: LibDoc): string {
  return [
    d.source === "sec" ? [d.ticker, d.form].filter(Boolean).join(" ") : SOURCE_LABEL[d.source] ?? d.source,
    d.durationSec ? clockOf(d.durationSec) : d.pages ? `${d.pages} page${d.pages === 1 ? "" : "s"}` : "",
    d.chunks ? `${d.chunks} passages` : "",
    d.lang && !/^en/i.test(d.lang) ? d.lang.toUpperCase() : "",
  ].filter(Boolean).join(" · ");
}

export function Library({ onAsk }: { onAsk: (docIds: number[], label: string) => void }) {
  const now = useNow();
  const [lib, setLib] = useState<LibraryData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const teams = useApi<Team[]>("/api/teams");
  const [shareWith, setShareWith] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; tone: "ok" | "err"; error?: unknown } | null>(null);
  const [readers, setReaders] = useState({ pdf: false, audio: false });
  const [speakers, setSpeakers] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioTitle, setAudioTitle] = useState("");
  const [secTickers, setSecTickers] = useState("");
  const [secForms, setSecForms] = useState<string[]>(["10-K", "10-Q", "8-K"]);
  const input = useRef<HTMLInputElement>(null);
  const reload = () => setNonce((n) => n + 1);

  // The library, checked again every few seconds while anything is still being read: paused while the
  // tab is hidden, and a failed check is retried later rather than ending the refreshes.
  useEffect(() => poll((signal) => api<LibraryData>("/api/edge/docs", { signal }), (d) => {
    setLib(d); setLoadError(null);
    return d.docs.some((x) => READING.has(x.status));
  }, { onError: (e) => setLoadError(errorText(e)) }), [nonce]);

  const send = async (files: File[]) => {
    const teamId = shareWith ? Number(shareWith) : null;
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`;
      const set = (patch: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
      setUploads((u) => [...u, { key, name: file.name, bytes: file.size, progress: 0 }]);
      if (file.size > MAX_BYTES) { set({ error: "Over 200 MB; split it or compress it first." }); continue; }
      try {
        const r = await uploadFile(file, { teamId, onProgress: (p) => set({ progress: p }), premium: { ...(readers.pdf ? { pdf: "llamaparse" as const } : {}), ...(readers.audio ? { audio: "diarize" as const } : {}) } });
        set({ progress: 1, done: !r.note, note: r.note });
        reload();
      } catch (e) { set({ error: errorText(e), plan: isPlanError(e) }); }
    }
    setTimeout(() => setUploads((u) => u.filter((x) => !x.done)), 2500);
  };

  const act = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key); setNote(null);
    try { const msg = await fn(); if (msg) setNote({ text: msg, tone: "ok" }); reload(); }
    catch (e) { setNote({ text: errorText(e), tone: "err", error: e }); }
    finally { setBusy(null); }
  };

  const remove = async (d: LibDoc) => {
    const ok = await confirmDialog({ title: `Delete “${d.title}”?`, body: "Its file, passages, transcript and search index are removed for good. Answers you already have keep their quotes.", confirmLabel: "Delete", tone: "danger" });
    if (ok) await act(`del-${d.id}`, async () => { await api(`/api/edge/docs/${d.id}`, { method: "DELETE" }); });
  };

  const reread = (d: LibDoc, method: "llamaparse" | "diarize") => act(`read-${d.id}`, async () => {
    await post(`/api/edge/docs/${d.id}`, { with: method });
    return method === "llamaparse" ? `Reading “${d.title}” again with LlamaParse.` : `Transcribing “${d.title}” again with speaker labels.`;
  });

  const share = (d: LibDoc, value: string) => act(`share-${d.id}`, async () => {
    await api(`/api/edge/docs/${d.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ teamId: value ? Number(value) : null }) });
  });

  const usage = lib?.usage;
  const pctBytes = usage ? Math.min(100, (usage.bytes / usage.quotaBytes) * 100) : 0;
  const pctFiles = usage ? Math.min(100, (usage.files / usage.quotaFiles) * 100) : 0;
  const teamList = teams.data ?? [];
  const mine = (lib?.docs ?? []);

  return (
    <div className="space-y-4">
      <section className="panel space-y-3 p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-[220px] flex-1">
            <div className="flex justify-between text-[11.5px]"><span className="font-semibold">Your uploads</span><span className="num text-muted">{usage ? `${fmtBytes(usage.bytes)} of ${fmtBytes(usage.quotaBytes)} · ${usage.files} of ${usage.quotaFiles} files` : "…"}</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-line-strong" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(pctBytes, pctFiles))} aria-label="Upload quota used">
              <div className={`h-full rounded-full ${Math.max(pctBytes, pctFiles) > 90 ? "bg-neg" : "bg-accent"}`} style={{ width: `${Math.max(pctBytes, pctFiles)}%` }} />
            </div>
            <p className="mt-1 text-[10.5px] text-faint">Beta quota. Uploads stay private unless shared with a team, and are kept until you delete them.</p>
          </div>
          {teamList.length > 0 && (
            <label className="flex items-center gap-1.5 text-[11.5px] text-muted">New uploads are
              <Select value={shareWith} onChange={setShareWith} aria-label="Share new uploads with" className="ctl border border-line bg-bg px-2 py-1 text-left text-[11.5px] text-fg">
                <option value="">private to me</option>
                {teamList.map((t) => <option key={t.id} value={String(t.id)}>shared with {t.name}</option>)}
              </Select>
            </label>
          )}
        </div>

        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void send([...e.dataTransfer.files]); }}
          className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${drag ? "border-accent bg-accent-soft/40" : "border-line"}`}>
          <Upload className="h-5 w-5 text-accent" />
          <div className="text-[12.5px] font-medium">Drop a data room here, or <button type="button" onClick={() => input.current?.click()} className="text-accent hover:underline">choose files</button></div>
          <div className="text-[11px] text-muted">PDF (scans and images too), Word, Excel and PowerPoint (.docx, .xlsx, .pptx), email (.eml, .msg), text and CSV; calls and recordings (MP3, M4A, WAV, MP4). Up to 200 MB each.</div>
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; void send(f); }} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px]">
          <span className="text-muted">Premium readers for new uploads</span>
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={readers.pdf} onChange={(e) => setReaders((r) => ({ ...r, pdf: e.target.checked }))} className="accent-[var(--accent)]" />Read PDFs and scans with LlamaParse <PremiumBadge feature="edge.parse-llamaparse" /></label>
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={readers.audio} onChange={(e) => setReaders((r) => ({ ...r, audio: e.target.checked }))} className="accent-[var(--accent)]" />Speaker labels for recordings <PremiumBadge feature="edge.transcribe-diarize" /></label>
        </div>
        {uploads.length > 0 && (
          <ul className="space-y-1">
            {uploads.map((u) => (
              <li key={u.key} className="text-[11.5px]">
                <div className="flex justify-between gap-2"><span className="truncate">{u.name}</span><span className={`num shrink-0 ${u.error ? "text-neg" : "text-muted"}`}>{u.error ? "failed" : u.done ? "uploaded, reading…" : `${Math.round(u.progress * 100)}% of ${fmtBytes(u.bytes)}`}</span></div>
                {u.error ? (u.plan ? <PlanNotice error={Object.assign(new Error(u.error), { status: 402 })} className="mt-0.5" /> : <p className="text-[11px] text-neg">{u.error}</p>) : <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-line-strong"><div className="h-full bg-accent transition-all" style={{ width: `${u.progress * 100}%` }} /></div>}
                {u.note && <p className="mt-0.5 text-[11px] text-muted">{u.note}</p>}
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-3 border-t border-line pt-3 lg:grid-cols-3">
          <form onSubmit={(e) => { e.preventDefault(); if (audioUrl.trim()) void act("audio", async () => { const r = await post<{ note?: string }>("/api/edge/audio", { url: audioUrl.trim(), title: audioTitle.trim(), ...(speakers ? { speakers: true } : {}) }); setAudioUrl(""); setAudioTitle(""); return r.note ?? (speakers ? "Importing the recording; it is transcribed with speaker labels and timestamps." : "Importing the recording; it is transcribed with speakers and timestamps."); }); }} className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold"><Link2 className="h-3.5 w-3.5 text-accent" />A recording by link</div>
            <input value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} placeholder="Direct link to an MP3 or MP4 (a webcast, a podcast episode)" className="ctl w-full border border-line bg-bg px-2 py-1 text-[12px] outline-none placeholder:text-faint focus:border-accent/60" aria-label="Recording link" />
            <div className="flex gap-1.5">
              <input value={audioTitle} onChange={(e) => setAudioTitle(e.target.value)} placeholder="Title (optional)" className="ctl min-w-0 flex-1 border border-line bg-bg px-2 py-1 text-[12px] outline-none placeholder:text-faint focus:border-accent/60" aria-label="Recording title" />
              <button type="submit" disabled={!audioUrl.trim() || !!busy} className="ctl flex items-center gap-1 bg-accent px-2.5 py-1 text-[12px] font-semibold text-accent-fg disabled:opacity-50">{busy === "audio" && <Loader2 className="h-3 w-3 animate-spin" />}Import</button>
            </div>
            <label className="flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={speakers} onChange={(e) => setSpeakers(e.target.checked)} className="accent-[var(--accent)]" />With speaker labels <PremiumBadge feature="edge.transcribe-diarize" /></label>
            <p className="text-[10.5px] text-faint">YouTube does not allow downloads; upload the file instead.</p>
          </form>
          <form onSubmit={(e) => { e.preventDefault(); const t = secTickers.toUpperCase().split(/[\s,;]+/).filter(Boolean); if (t.length) void act("sec", async () => { const r = await post<{ results: { indexed?: number; name?: string; error?: string }[] }>("/api/edge/docs", { kind: "sec", tickers: t, forms: secForms, months: 12 }); setSecTickers(""); return r.results.map((x, i) => (x.error ? `${t[i]}: ${x.error}` : `${x.name ?? t[i]}: ${x.indexed ?? 0} passages ready`)).join(" · "); }); }} className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold"><FileText className="h-3.5 w-3.5 text-accent" />Company filings</div>
            <div className="flex gap-1.5">
              <input value={secTickers} onChange={(e) => setSecTickers(e.target.value)} placeholder="Tickers, e.g. ET, TRGP" className="ctl min-w-0 flex-1 border border-line bg-bg px-2 py-1 text-[12px] uppercase outline-none placeholder:normal-case placeholder:text-faint focus:border-accent/60" aria-label="Tickers" />
              <button type="submit" disabled={!secTickers.trim() || !!busy} className="ctl flex items-center gap-1 bg-accent px-2.5 py-1 text-[12px] font-semibold text-accent-fg disabled:opacity-50">{busy === "sec" && <Loader2 className="h-3 w-3 animate-spin" />}Read</button>
            </div>
            <div className="flex flex-wrap gap-1">{FORM_OPTIONS.map((f) => <button key={f} type="button" aria-pressed={secForms.includes(f)} onClick={() => setSecForms((c) => (c.includes(f) ? c.filter((x) => x !== f) : [...c, f]))} className={`rounded-full border px-1.5 py-px text-[10.5px] ${secForms.includes(f) ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-muted"}`}>{f === "DEF 14A" ? "Proxy" : f}</button>)}</div>
            <p className="text-[10.5px] text-faint">The last year of filings, with 8-K press releases. Shared by everyone, read once.</p>
          </form>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold"><Users className="h-3.5 w-3.5 text-accent" />Your workspace</div>
            <p className="text-[11.5px] text-muted">Your CRM mail and notes, Studio models and decks, tool runs and saved Newsroom stories, searchable only by you.</p>
            <button type="button" disabled={!!busy} onClick={() => void act("ws", async () => { const r = await post<{ indexed: number; docIds: number[] }>("/api/edge/docs", { kind: "workspace" }); return `${r.docIds.length} workspace items read (${r.indexed} passages).`; })} className="ctl flex items-center gap-1 border border-line px-2.5 py-1 text-[12px] hover:border-accent/50 disabled:opacity-50">{busy === "ws" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}Read my workspace</button>
          </div>
        </div>
        {note && (note.tone === "err" ? <PlanNotice error={note.error ?? note.text} /> : <p className="text-[12px] text-pos">{note.text}</p>)}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[12.5px] font-semibold">Your documents</h2>
          {mine.filter((d) => d.status === "ready").length > 1 && <button type="button" onClick={() => { const ready = mine.filter((d) => d.status === "ready"); onAsk(ready.map((d) => d.id), `${ready.length} documents`); }} className="flex items-center gap-1 text-[11.5px] text-accent hover:underline"><Search className="h-3 w-3" />Ask across all of them</button>}
        </div>
        {loadError && <p className="mb-2 text-[12px] text-neg">{lib ? "Could not refresh the library: " : ""}{loadError} <button type="button" onClick={reload} className="text-accent hover:underline">Try again</button></p>}
        {!lib ? (loadError ? null : <div className="h-32 animate-pulse rounded-lg bg-elevated/40" />) : !mine.length ? <p className="text-[12px] text-muted">Nothing yet. Upload a data room, import a call, or read your workspace above.</p> : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {mine.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <DocIcon d={d} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium" title={d.title}>{d.title}</div>
                  <div className="text-[11px] text-muted">
                    {READING.has(d.status) ? <span className="inline-flex items-center gap-1 text-accent"><Loader2 className="h-3 w-3 animate-spin" />{STATUS_TEXT[d.status]}</span>
                      : d.status === "failed" ? <span className="inline-flex items-center gap-1 text-neg"><AlertCircle className="h-3 w-3" />{d.error || STATUS_TEXT.failed}</span>
                        : details(d)}
                    {now ? <span className="text-faint"> · {ago(d.createdAt, now)}</span> : null}
                    {!d.mine && <span className="text-faint"> · shared with you</span>}
                    {d.readBy && d.status === "ready" && <span className="text-faint"> · {d.readBy}</span>}
                  </div>
                  {d.premiumNote && <div className="text-[10.5px] text-faint">{d.premiumNote}</div>}
                </div>
                {d.mine && teamList.length > 0 && (d.source === "upload" || d.source === "audio") && (
                  <Select value={d.teamId ? String(d.teamId) : ""} onChange={(v) => void share(d, v)} aria-label="Sharing" className="ctl border border-line bg-bg px-2 py-0.5 text-left text-[11px]">
                    <option value="">Private</option>
                    {teamList.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
                  </Select>
                )}
                {d.status === "ready" && <button type="button" onClick={() => onAsk([d.id], d.title)} className="ctl flex items-center gap-1 border border-line px-2 py-0.5 text-[11.5px] hover:border-accent/50"><Search className="h-3 w-3" />Ask</button>}
                {d.mine && d.fileId && (d.status === "ready" || d.status === "failed") && (isAudio(d) || isParseable(d)) && (
                  <button type="button" disabled={!!busy} onClick={() => void reread(d, isAudio(d) ? "diarize" : "llamaparse")} title={isAudio(d) ? "Transcribe again with speaker labels (OpenAI)" : "Read again with LlamaParse, for scans and tables"} className="ctl flex items-center gap-1 border border-line px-2 py-0.5 text-[11.5px] hover:border-accent/50">
                    {busy === `read-${d.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{isAudio(d) ? "Speaker labels" : "LlamaParse"} <PremiumBadge feature={isAudio(d) ? "edge.transcribe-diarize" : "edge.parse-llamaparse"} />
                  </button>
                )}
                {d.status === "failed" && d.mine && d.fileId && <button type="button" disabled={!!busy} onClick={() => void act(`retry-${d.id}`, async () => { await post(`/api/edge/docs/${d.id}`, {}); })} className="ctl flex items-center gap-1 border border-line px-2 py-0.5 text-[11.5px] hover:border-accent/50"><RotateCcw className="h-3 w-3" />Try again</button>}
                {d.mine && <button type="button" disabled={!!busy} onClick={() => void remove(d)} aria-label={`Delete ${d.title}`} className="ctl p-1 text-muted hover:text-neg">{busy === `del-${d.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!!lib?.filings.length && (
        <details className="group">
          <summary className="cursor-pointer text-[12.5px] font-semibold">Filings already read <span className="font-normal text-muted">({lib.filings.length} most recent, shared by everyone)</span></summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
            {lib.filings.map((d) => (
              <li key={d.id} className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1"><div className="truncate text-[12px]" title={d.title}>{d.title}</div><div className="num text-[10.5px] text-muted">{[d.ticker, d.form, d.createdAt.slice(0, 10)].filter(Boolean).join(" · ")}</div></div>
                {d.status === "ready" && <button type="button" onClick={() => onAsk([d.id], d.title)} className="text-[11px] text-accent hover:underline">Ask</button>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
