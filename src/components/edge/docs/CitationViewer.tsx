"use client";

/**
 * The source viewer: a side panel that opens any cited passage where it lives. A PDF opens at the
 * cited page with the quoted words highlighted; a recording plays from the quoted moment, with the
 * transcript around it and the speaker's hedging and tone; anything else shows the passage and its
 * neighbours with the quote marked. Quotes in other languages show their translation.
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ExternalLink, FileText, Languages, Mic, X } from "lucide-react";
import { lazy, Suspense, useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useApi } from "@/components/news/client";
import { clockOf, locateQuote } from "@/lib/edge/docs/text";
import { SOURCE_LABEL, type PassageView, type ViewTarget } from "./client";

const PdfPage = lazy(() => import("./PdfPage").then((m) => ({ default: m.PdfPage })));

/** Text with the quoted words marked. */
export function Marked({ text, quote }: { text: string; quote?: string }) {
  const tokens = text.split(/(\s+)/);
  const hit = new Set(quote ? locateQuote(tokens, quote) : []);
  if (!hit.size) return <>{text}</>;
  const first = Math.min(...hit), last = Math.max(...hit);
  return (
    <>
      {tokens.slice(0, first).join("")}
      <mark className="rounded-[2px] bg-yellow-300/40 px-0.5 text-fg">{tokens.slice(first, last + 1).join("")}</mark>
      {tokens.slice(last + 1).join("")}
    </>
  );
}

function Meter({ label, value, min, max, hint }: { label: string; value: number; min: number; max: number; hint: string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div title={hint}>
      <div className="flex justify-between text-[10.5px] text-muted"><span>{label}</span><span className="num">{value >= 0 && min < 0 ? "+" : ""}{value.toFixed(2)}</span></div>
      <div className="relative mt-0.5 h-1.5 rounded-full bg-line-strong">
        {min < 0 && <span className="absolute left-1/2 top-[-2px] h-[10px] w-px bg-faint" />}
        <span className="absolute top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-accent" style={{ left: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}

function Recording({ v, quote }: { v: PassageView; quote?: string }) {
  const media = useRef<HTMLMediaElement | null>(null);
  const start = v.passage.tStart ?? 0;
  useEffect(() => {
    const m = media.current;
    if (!m) return;
    const go = () => { m.currentTime = start; void m.play().catch(() => undefined); };
    if (m.readyState >= 1) go(); else m.addEventListener("loadedmetadata", go, { once: true });
    return () => m.removeEventListener("loadedmetadata", go);
  }, [start]);
  const seek = (t: number | null) => { if (media.current && t !== null) { media.current.currentTime = t; void media.current.play().catch(() => undefined); } };
  const video = /^video\//.test(v.doc.mime);
  return (
    <div className="space-y-3">
      {v.raw && (video
        ? <video ref={(el) => { media.current = el; }} src={v.raw} controls preload="metadata" className="w-full rounded-md border border-line bg-black" />
        : <audio ref={(el) => { media.current = el; }} src={v.raw} controls preload="metadata" className="w-full" />)}
      <ol className="space-y-1.5">
        {v.around.map((p) => {
          const current = p.id === v.passage.id;
          return (
            <li key={p.id} className={`rounded-md border px-2.5 py-2 text-[12.5px] leading-relaxed ${current ? "border-accent/50 bg-accent-soft/40" : "border-line text-muted"}`}>
              <button type="button" onClick={() => seek(p.tStart)} className="mb-0.5 flex items-center gap-1.5 text-[10.5px] text-accent hover:underline">
                <Mic className="h-3 w-3" /><span className="num">{p.tStart !== null ? clockOf(p.tStart) : ""}</span>{p.speaker && <span className="text-muted">· {p.speaker}</span>}
              </button>
              <div>{current ? <Marked text={p.text} quote={quote} /> : p.text}</div>
            </li>
          );
        })}
      </ol>
      {v.tone && (
        <div className="rounded-md border border-line p-2.5">
          <div className="text-[11.5px] font-semibold">Hedging and tone</div>
          {v.tone.turn && (
            <div className="mt-1.5 grid grid-cols-2 gap-3">
              <Meter label={`Hedging here (${v.tone.turn.speaker || "speaker"})`} value={v.tone.turn.hedging} min={0} max={1} hint="0 is plain statements; 1 is heavily qualified (may, could, subject to)" />
              <Meter label="Tone here" value={v.tone.turn.tone} min={-1} max={1} hint="-1 negative, +1 positive" />
              {v.tone.turn.note && <p className="col-span-2 text-[11px] text-muted">{v.tone.turn.note}</p>}
            </div>
          )}
          <div className="table-scroll"><table className="mt-2 w-full text-[11px]">
            <thead><tr className="text-left text-muted"><th className="font-normal">Speaker</th><th className="text-right font-normal">Turns</th><th className="text-right font-normal">Hedging</th><th className="text-right font-normal">Tone</th></tr></thead>
            <tbody>{v.tone.speakers.map((s) => <tr key={s.speaker} className="border-t border-line"><td className="py-0.5 font-sans">{s.speaker}</td><td className="text-right">{s.turns}</td><td className="text-right">{s.hedging.toFixed(2)}</td><td className={`text-right ${s.tone > 0.15 ? "text-pos" : s.tone < -0.15 ? "text-neg" : ""}`}>{s.tone >= 0 ? "+" : ""}{s.tone.toFixed(2)}</td></tr>)}</tbody>
          </table></div>
          <p className="mt-1 text-[10.5px] text-faint">Scored per speaker turn by a language model; a guide to where to listen, not a measurement.</p>
        </div>
      )}
    </div>
  );
}

function Passages({ v, quote }: { v: PassageView; quote?: string }) {
  return (
    <ol className="space-y-1.5">
      {v.around.map((p) => {
        const current = p.id === v.passage.id;
        return (
          <li key={p.id} className={`whitespace-pre-line rounded-md border px-2.5 py-2 text-[12.5px] leading-relaxed ${current ? "border-accent/50 bg-accent-soft/30" : "border-line text-muted"}`}>
            {p.page ? <div className="num mb-0.5 text-[10.5px] text-faint">Page {p.page}</div> : null}
            {current ? <Marked text={p.text} quote={quote} /> : p.text}
          </li>
        );
      })}
    </ol>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, audio[controls], video[controls], [tabindex]:not([tabindex="-1"])';

/**
 * A modal panel: focus moves into it on open and back to whatever opened it on close, Tab and Shift+Tab
 * stay inside it, and Escape (or the backdrop) closes it.
 */
export function CitationViewer({ target, onClose }: { target: ViewTarget | null; onClose: () => void }) {
  const reduce = useReducedMotion();
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  const open = !!target;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [open]);
  // Escape normally arrives through the panel (below); this catches it if focus ever ends up elsewhere.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    // preventDefault keeps the app shell's own Escape (closing the navigation) from firing too.
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key !== "Tab" || !panel.current) return;
    const f = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    const at = document.activeElement;
    if (!f.length) e.preventDefault();
    else if (e.shiftKey && (at === f[0] || at === panel.current)) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && at === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  };
  return (
    <AnimatePresence>
      {target && (
        <>
          <motion.div key="backdrop" className="fixed inset-0 z-40 bg-black/30 lg:bg-black/10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside ref={panel} key="panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown} className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[640px] flex-col border-l border-line bg-panel shadow-2xl outline-none"
            initial={reduce ? { opacity: 0 } : { x: 40, opacity: 0 }} animate={reduce ? { opacity: 1 } : { x: 0, opacity: 1 }} exit={reduce ? { opacity: 0 } : { x: 40, opacity: 0 }} transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}>
            <Body key={target.chunkId} target={target} onClose={onClose} titleId={titleId} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Body({ target, onClose, titleId }: { target: ViewTarget; onClose: () => void; titleId: string }) {
  const { data: v, error, reload } = useApi<PassageView>(`/api/edge/passage?chunk=${target.chunkId}`);
  const quote = target.quote ?? target.cite?.quote;
  const pdf = !!v?.raw && v.doc.mime === "application/pdf" && v.passage.page > 0;
  const media = !!v && /^(audio|video)\//.test(v.doc.mime);
  const original = v?.doc.url && /^https?:/.test(v.doc.url) ? v.doc.url : v?.raw ?? null;
  return (
    <>
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
        {media ? <Mic className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> : <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent" />}
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-[13px] font-semibold">{v?.doc.title ?? target.cite?.title ?? "Source"}</h2>
          {v && (
            <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted">
              <span>{SOURCE_LABEL[v.doc.source] ?? v.doc.source}{v.doc.form ? ` · ${v.doc.form}` : ""}{v.doc.ticker ? ` · ${v.doc.ticker}` : ""}</span>
              {v.doc.transcription && <span>{v.doc.transcription}</span>}
              {v.passage.section && <span>· {v.passage.section}</span>}
              {v.passage.page > 0 && <span className="num">· page {v.passage.page}{v.doc.pages ? ` of ${v.doc.pages}` : ""}</span>}
              {v.passage.tStart !== null && <span className="num">· {clockOf(v.passage.tStart)}{v.doc.durationSec ? ` of ${clockOf(v.doc.durationSec)}` : ""}</span>}
              {v.doc.lang && !/^en/i.test(v.doc.lang) && <span>· {v.doc.lang.toUpperCase()}</span>}
            </div>
          )}
        </div>
        {original && <a href={original} target="_blank" rel="noreferrer" className="ctl flex shrink-0 items-center gap-1 border border-line px-2 py-1 text-[11px] text-muted hover:text-fg"><ExternalLink className="h-3 w-3" />Original</a>}
        <button type="button" onClick={onClose} aria-label="Close" className="ctl shrink-0 p-1 text-muted hover:text-fg"><X className="h-4 w-4" /></button>
      </header>
      <div data-viewer-scroll className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {quote && (
          <blockquote className="rounded-md border-l-2 border-accent bg-elevated/50 px-3 py-2 text-[12.5px] leading-relaxed">
            “{quote}”
            {target.cite?.translation && <div className="mt-1.5 flex gap-1.5 border-t border-line pt-1.5 text-[12px] text-muted"><Languages className="mt-0.5 h-3.5 w-3.5 shrink-0" />{target.cite.translation}</div>}
          </blockquote>
        )}
        {error && <p className="text-[12.5px] text-neg">{error} <button type="button" onClick={reload} className="text-accent hover:underline">Try again</button></p>}
        {!v && !error && <div className="h-64 animate-pulse rounded-md bg-elevated/50" />}
        {v && (pdf
          ? <Suspense fallback={<div className="h-64 animate-pulse rounded-md bg-elevated/50" />}><PdfPage url={v.raw!} page={v.passage.page} quote={quote} /></Suspense>
          : media ? <Recording v={v} quote={quote} /> : <Passages v={v} quote={quote} />)}
        {pdf && v && (
          <details className="text-[12px]">
            <summary className="cursor-pointer text-muted hover:text-fg">The passage as text</summary>
            <div className="mt-2"><Passages v={v} quote={quote} /></div>
          </details>
        )}
      </div>
    </>
  );
}
