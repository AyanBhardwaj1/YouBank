"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DEMO_ANSWERS } from "@/lib/demo";
import { Markdown } from "@/components/terminal/Markdown";

/** Replays a real assistant answer: tool calls appear, then the text types out, then the citations resolve. */
export function DemoAi({ height = 340 }: { height?: number }) {
  const [idx, setIdx] = useState(0);
  return (
    <div className="panel flex flex-col overflow-hidden" style={{ height }}>
      <div className="flex items-center gap-2 border-b border-line bg-elevated/50 px-3 py-2 text-[11px]">
        <span className="ctl bg-accent-soft px-1.5 py-0.5 font-semibold tracking-wider text-accent">AI</span>
        <span className="text-muted">Answers cite the filing they came from</span>
        <span className="ml-auto flex gap-1">
          {DEMO_ANSWERS.map((d, i) => <button key={d.id} type="button" aria-label={`Example ${i + 1}`} onClick={() => setIdx(i)} className={`h-1.5 w-1.5 rounded-full transition ${i === idx ? "bg-accent" : "bg-line-strong hover:bg-muted"}`} />)}
        </span>
      </div>
      <Player key={DEMO_ANSWERS[idx].id} answer={DEMO_ANSWERS[idx]} onNext={() => setIdx((i) => (i + 1) % DEMO_ANSWERS.length)} />
    </div>
  );
}

/** One scripted answer, remounted per example so its timeline starts clean. */
function Player({ answer: a, onNext }: { answer: (typeof DEMO_ANSWERS)[number]; onNext: () => void }) {
  const [phase, setPhase] = useState<"tools" | "typing" | "done">("tools");
  const [toolsShown, setToolsShown] = useState(0);
  const [chars, setChars] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Tool calls appear one by one.
  useEffect(() => {
    let n = 0;
    let hop: ReturnType<typeof setTimeout> | undefined;
    const id = setInterval(() => {
      n++; setToolsShown(n);
      if (n >= a.tools.length) { clearInterval(id); hop = setTimeout(() => setPhase("typing"), 420); }
    }, 520);
    return () => { clearInterval(id); if (hop) clearTimeout(hop); };
  }, [a]);

  // Then the answer types.
  useEffect(() => {
    if (phase !== "typing") return;
    const id = setInterval(() => {
      setChars((c) => {
        const next = c + 9;
        if (next >= a.answer.length) { clearInterval(id); setPhase("done"); return a.answer.length; }
        return next;
      });
    }, 16);
    return () => clearInterval(id);
  }, [phase, a]);

  // Advance to the next scripted answer.
  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(onNext, 6500);
    return () => clearTimeout(t);
  }, [phase, onNext]);

  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" }); }, [chars]);

  const text = useMemo(() => a.answer.slice(0, chars), [a, chars]);
  const sources = phase === "done" ? a.sources : a.sources.slice(0, Math.max(0, Math.floor((chars / a.answer.length) * a.sources.length)));

  return (
    <div ref={bodyRef} className="min-h-0 flex-1 space-y-2.5 overflow-auto p-3">
        <div className="flex justify-end">
          <div className="ctl max-w-[85%] border border-accent/30 bg-accent-soft px-3 py-2 text-[12px]">{a.question}</div>
        </div>
        <div className="flex gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center ctl bg-accent-soft text-accent">✦</span>
          <div className="ctl min-w-0 flex-1 border border-line bg-elevated/60 px-3 py-2">
            <div className="mb-1.5 flex flex-wrap gap-1">
              {a.tools.slice(0, toolsShown).map((t, i) => (
                <span key={i} className={`num rise rounded border border-line px-1.5 py-px text-[10px] ${phase === "tools" && i === toolsShown - 1 ? "animate-pulse text-accent" : "text-muted"}`}>
                  {phase === "tools" && i === toolsShown - 1 ? "⟳" : "✓"} {t.name} <span className="text-faint">{t.detail}</span>
                </span>
              ))}
            </div>
            {phase === "tools" ? (
              <span className="caret text-[12px] text-muted">reading filings</span>
            ) : (
              <div className="text-[12px]">
                <Markdown text={text} sources={a.sources} />
                {phase === "typing" && <span className="caret" />}
              </div>
            )}
            {sources.length > 0 && (
              <div className="mt-2 border-t border-line pt-1.5 text-[10.5px] text-muted">
                <div className="mb-0.5 uppercase tracking-wider">Sources</div>
                {sources.map((s) => (
                  <div key={s.id} className="fade-in flex gap-1.5"><span className="num text-accent">{s.id}</span><span className="truncate">{s.label}</span></div>
                ))}
              </div>
            )}
          </div>
      </div>
    </div>
  );
}
