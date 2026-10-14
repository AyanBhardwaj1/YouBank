"use client";

/**
 * Calibrated Claims on screen (E2). Each claim carries a dot: green from 0.9, amber from 0.6, red below,
 * and its percentage beside it in text so colour is never the only signal. Hover (or focus) says why
 * ("92% supported: quote exact, numbers match"); a tap opens a sheet with the reasons, the passages and
 * "This claim is wrong". The sheet is a bottom sheet on a phone and a small dialog on wider screens.
 */
import { Flag, X } from "lucide-react";
import { useEffect, useState } from "react";
import { post } from "@/components/news/client";
import type { ClaimSupport, VerifierInfo } from "@/lib/edge/claims/types";

const TONE: Record<ClaimSupport["dot"], { dot: string; text: string; stroke: string; label: string }> = {
  high: { dot: "bg-pos", text: "text-pos", stroke: "var(--pos)", label: "well supported" },
  mid: { dot: "bg-accent", text: "text-accent", stroke: "var(--accent)", label: "partly supported" },
  low: { dot: "bg-neg", text: "text-neg", stroke: "var(--neg)", label: "weakly supported" },
};
export const supportStroke = (s?: ClaimSupport) => (s ? TONE[s.dot].stroke : undefined);
const pct = (p: number) => `${Math.round(p * 100)}%`;
export const supportTitle = (s: ClaimSupport) => `${pct(s.p)} supported: ${s.reasons.join(", ")}${s.crosscheck ? `; second provider: ${s.crosscheck.verdict}` : ""}`;

export function SupportDot({ s, onOpen }: { s: ClaimSupport; onOpen?: () => void }) {
  const t = TONE[s.dot];
  return (
    <button type="button" onClick={onOpen} title={supportTitle(s)} aria-label={`${pct(s.p)} supported, ${t.label}. Show why.`}
      className={`ml-1 inline-flex items-center gap-1 rounded-full border border-line px-1.5 align-[1px] text-[10px] ${t.text} hover:border-line-strong`}>
      <span className={`h-2 w-2 rounded-full ${t.dot}`} aria-hidden />
      <span className="num">{pct(s.p)}</span>
      {s.crosscheck && <span className="text-muted">· {s.crosscheck.verdict === "supported" ? "2nd ✓" : s.crosscheck.verdict === "unsupported" ? "2nd ✗" : "2nd ?"}</span>}
    </button>
  );
}

const REASONS: { id: string; label: string }[] = [
  { id: "wrong-number", label: "A number is wrong" }, { id: "wrong-period", label: "Wrong period" }, { id: "wrong-company", label: "Wrong company" },
  { id: "not-in-source", label: "The source does not say this" }, { id: "misleading", label: "Misleading" }, { id: "other", label: "Something else" },
];

/** The reasons behind one claim's support, its passages, and a report form. */
export function SupportSheet({ claim, s, passages, report, onClose }: { claim: string; s: ClaimSupport; passages: { n: number; title: string; quote: string }[]; report?: { answerId: number; index: number; held: boolean }; onClose: () => void }) {
  const [reason, setReason] = useState("not-in-source");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<"idle" | "sending" | "done" | string>("idle");
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const send = () => {
    if (!report) return;
    setSent("sending");
    post(`/api/edge/answers/${report.answerId}/report`, { claim: report.index, held: report.held, reason, note }).then(() => setSent("done")).catch((e) => setSent(e instanceof Error ? e.message : String(e)));
  };
  const t = TONE[s.dot];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={onClose} role="dialog" aria-modal="true" aria-label="Why this support">
      <div className="rise max-h-[80vh] w-full overflow-auto rounded-t-xl border border-line bg-panel p-4 shadow-float md:max-w-[520px] md:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className={`flex items-center gap-1.5 text-[12px] font-semibold ${t.text}`}><span className={`h-2.5 w-2.5 rounded-full ${t.dot}`} />{pct(s.p)} supported ({t.label})</div>
            <p className="mt-1 text-[13px] leading-relaxed">{claim}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ctl p-1 text-muted hover:text-fg"><X className="h-4 w-4" /></button>
        </div>
        <ul className="mt-3 space-y-1 text-[12px] text-muted">{s.reasons.map((r, i) => <li key={i}>· {r}</li>)}</ul>
        {s.crosscheck && <p className="mt-2 rounded-md border border-line bg-elevated/50 px-2 py-1.5 text-[12px]">Second provider ({s.crosscheck.model}): <span className="font-medium">{s.crosscheck.verdict}</span>. {s.crosscheck.note}</p>}
        {passages.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {passages.map((p) => <li key={p.n} className="rounded-md border border-line px-2 py-1.5 text-[12px]"><div className="text-[10.5px] text-muted"><span className="num">[{p.n}]</span> {p.title}</div>{p.quote && <div className="mt-0.5">“{p.quote}”</div>}</li>)}
          </ul>
        )}
        <p className="mt-3 text-[10.5px] leading-snug text-faint">The percentage is a calibrated probability that the cited passages support the claim, from the quote check, the passage&apos;s rank, the number check, and whether company and period match. It is an estimate with a measured error rate, not a guarantee.</p>
        {report && (
          <div className="mt-3 border-t border-line pt-3">
            {sent === "done" ? <p className="text-[12px] text-pos">Thank you. It will be reviewed before it changes the calibration set.</p> : (
              <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                <Flag className="h-3.5 w-3.5 text-muted" />
                <select value={reason} onChange={(e) => setReason(e.target.value)} className="ctl border border-line bg-bg px-1.5 py-1 text-fg">{REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is wrong (optional)" className="ctl min-w-0 flex-1 border border-line bg-bg px-2 py-1 text-fg placeholder:text-faint" />
                <button type="button" onClick={send} disabled={sent === "sending"} className="ctl border border-line px-2 py-1 text-muted hover:text-fg disabled:opacity-50">This claim is wrong</button>
                {sent !== "idle" && sent !== "sending" && <span className="w-full text-neg">{sent}</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The verifier's account of itself under an answer or memo: Strict's target and what it achieved. */
export function VerifierFooter({ v }: { v: VerifierInfo }) {
  return (
    <p className="border-t border-line pt-2 text-[10.5px] leading-snug text-faint">
      {v.footer}{v.nli ? "" : " The NLI checker is not in this verifier yet."}{v.crosscheck ? ` Cross-checked by ${v.crosscheck}.` : ""}{v.note ? ` ${v.note}` : ""} Verifier {v.version}.
    </p>
  );
}
