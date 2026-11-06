"use client";

/**
 * The LP letter editor: the draft YouBank wrote from the book, editable, with the compliance pass
 * (src/lib/book/letter.ts lintLetter) re-read as the PM types. Copy takes the text as Markdown; nothing
 * is sent anywhere. The draft is kept in this browser until reset.
 */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { lintLetter } from "@/lib/book/letter";

const TONE = { high: "border-neg/50 bg-neg/10 text-neg", medium: "border-accent/50 bg-accent-soft text-accent", info: "border-line text-muted" } as const;

export function LetterEditor({ draft, ledgerOn, storageKey, label = "Letter" }: { draft: string; ledgerOn: boolean; storageKey: string; /** The text box's name for screen readers. */ label?: string }) {
  const [text, setText] = useState(draft);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    // A draft the PM was editing comes back (this browser only); a new period starts from the fresh draft.
    try { const saved = localStorage.getItem(storageKey); if (saved && saved !== draft) setTimeout(() => setText(saved), 0); } catch { /* storage unavailable */ }
  }, [storageKey, draft]);
  useEffect(() => { try { localStorage.setItem(storageKey, text); } catch { /* storage unavailable */ } }, [storageKey, text]);
  const findings = useMemo(() => lintLetter(text, { ledgerOn }), [text, ledgerOn]);
  const serious = findings.filter((f) => f.severity !== "info").length;
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } };
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-2">
        <textarea aria-label={label} value={text} onChange={(e) => setText(e.target.value)} spellCheck className="ctl min-h-[60vh] w-full border border-line bg-bg p-3 font-mono text-[12.5px] leading-relaxed focus:border-accent/60 focus:outline-none" />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void copy()} className="ctl flex items-center gap-1.5 bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg"><Icon name="Copy" className="h-3.5 w-3.5" />{copied ? "Copied" : "Copy as Markdown"}</button>
          <button type="button" onClick={() => setText(draft)} className="ctl border border-line px-3 py-1.5 text-[12px] text-muted hover:text-fg">Start again from the draft</button>
        </div>
      </div>
      <aside aria-label="Compliance pass" className="space-y-2">
        <h2 className="text-[13px] font-semibold">Compliance pass</h2>
        <p className="text-[11.5px] text-muted">Re-read as you type against what the SEC&apos;s Marketing Rule and its exam staff look for. A first read, not legal advice: your compliance officer signs off.</p>
        {serious === 0 && <p role="status" className="ctl border border-pos/40 bg-pos/10 p-2 text-[12px] text-pos">Nothing flagged.</p>}
        <ul className="space-y-2">
          {findings.map((f, i) => (
            <li key={i} className={`ctl border p-2 text-[12px] ${TONE[f.severity]}`}>
              <div className="font-semibold">{f.rule}</div>
              <div className="mt-0.5 italic text-fg">&ldquo;{f.excerpt}&rdquo;</div>
              <div className="mt-0.5 text-[11.5px] text-muted">{f.why}</div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
