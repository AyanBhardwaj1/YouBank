"use client";

import { useEffect, useRef, useState } from "react";
import type { CompanyData } from "@/lib/types";
import type { Command } from "@/lib/functions";
import type { AiStatus, OpenPanel } from "../Terminal";
import { Markdown, type Source } from "../Markdown";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

type ToolCall = { name: string; status: "start" | "end"; summary?: string };
type Msg = { role: "user" | "assistant"; content: string; tools?: ToolCall[]; sources?: Source[]; error?: string; streaming?: boolean };

export function AiScreen({ ticker, company, ai, openPanels, subject, prompts }: { ticker: string; company?: CompanyData; ai: AiStatus | null; openPanels: OpenPanel[]; onRun?: (c: Command) => void; subject?: string; prompts?: string[] }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const { config } = useWorkspace();
  const suggestions = prompts ?? config.suggestedPrompts(ticker);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages]);

  const patchLast = (f: (m: Msg) => Msg) => setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? f(m) : m)));

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const history = [...messages.filter((m) => !m.error), { role: "user" as const, content: q }];
    setMessages([...history, { role: "assistant", content: "", tools: [], sources: [], streaming: true }]);
    setDraft(""); setBusy(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })), context: { ticker, panels: openPanels.map((p) => `${p.ticker} ${p.fn}`), subject } }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "text") patchLast((m) => ({ ...m, content: m.content + ev.text }));
            else if (ev.type === "tool") patchLast((m) => {
              const tools = [...(m.tools ?? [])];
              if (ev.status === "start") tools.push({ name: ev.name, status: "start" });
              else { const k = tools.findLastIndex((t) => t.name === ev.name && t.status === "start"); if (k >= 0) tools[k] = { name: ev.name, status: "end", summary: ev.summary }; }
              return { ...m, tools };
            });
            else if (ev.type === "sources") patchLast((m) => ({ ...m, sources: ev.sources }));
            else if (ev.type === "error") patchLast((m) => ({ ...m, error: ev.message }));
          }
        }
      }
    } catch (e) {
      patchLast((m) => ({ ...m, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      patchLast((m) => ({ ...m, streaming: false }));
      setBusy(false);
    }
  };

  const online = ai?.configured ?? false;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px]">
        <span className="flex min-w-0 items-center gap-2"><span className="text-accent">✦</span> YouBank AI · scope <span className="num truncate text-fg">{subject || ticker}</span>{company ? <span className="truncate text-muted">· {company.name}</span> : null}</span>
        <span className={`flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[10px] ${online ? "text-muted" : "text-neg"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-pos" : "bg-neg"}`} />
          {ai ? (online ? `${ai.provider} · ${ai.model}` : `Offline · ${ai.reason ?? "no key"}`) : "checking…"}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {messages.length === 0 && (
          <>
            <div className="flex gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-accent-soft text-accent">✦</span>
              <div className="max-w-[560px] rounded-md border border-line bg-elevated/60 px-3 py-2 text-[12px] leading-relaxed">
                {subject
                  ? "I can search the startup directory, SEC Form D private-offering filings, public company financials, and the web. Ask about a company's funding history, how to reach its founders, competitors, or which companies in a space look fundable. Every claim cites its source."
                  : "I read the same SEC filings and XBRL facts this terminal runs on, plus FMP prices. Ask for a peer set, a footnote, an outlier explanation, or a number from a 10-K. Every figure cites its source, and I can search filing text for items outside XBRL such as net retention or customer counts."}
              </div>
            </div>
            <div className="pl-8">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">Suggested</div>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => (online ? send(s) : setDraft(s))}
                    className="rounded-full border border-line bg-panel px-2.5 py-1 text-left text-[11px] text-fg/90 hover:border-accent/50 hover:text-accent">{s}</button>
                ))}
              </div>
            </div>
          </>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role === "assistant" && <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-accent-soft text-accent">✦</span>}
            <div className={`max-w-[85%] rounded-md border px-3 py-2 ${m.role === "user" ? "border-accent/30 bg-accent-soft text-[12px]" : "border-line bg-elevated/60"}`}>
              {m.tools && m.tools.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {m.tools.map((t, j) => (
                    <span key={j} className={`num rounded border border-line px-1.5 py-px text-[10px] ${t.status === "start" ? "animate-pulse text-accent" : "text-muted"}`} title={t.summary}>
                      {t.status === "start" ? "⟳" : "✓"} {t.name}
                    </span>
                  ))}
                </div>
              )}
              {m.role === "user" ? <span>{m.content}</span> : <Markdown text={m.content || (m.streaming ? "…" : "")} sources={m.sources ?? []} />}
              {m.error && <div className="mt-1 text-[11px] text-neg">{m.error}</div>}
              {m.sources && m.sources.length > 0 && (
                <div className="mt-2 border-t border-line pt-1.5 text-[10.5px] text-muted">
                  <div className="mb-0.5 uppercase tracking-wider">Sources</div>
                  {m.sources.map((s) => (
                    <div key={s.id} className="flex gap-1.5"><span className="num text-accent">{s.id}</span><a href={s.url} target="_blank" rel="noreferrer" className="truncate hover:text-info hover:underline">{s.label}</a></div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form className="border-t border-line p-2" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
        <div className="flex items-end gap-2 rounded-md border border-line bg-bg px-2.5 py-1.5 focus-within:border-accent/60">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder={online ? `Ask about ${subject || ticker}…` : "Add OPENAI_API_KEY or ANTHROPIC_API_KEY to .env.local to enable"}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); } }}
            className="flex-1 resize-none bg-transparent text-[12px] text-fg placeholder:text-faint focus:outline-none" />
          <button type="submit" disabled={!online || busy || !draft.trim()}
            className="rounded bg-accent px-2.5 py-1 text-[11px] font-semibold text-bg disabled:opacity-40">{busy ? "…" : "Send"}</button>
        </div>
        <div className="mt-1 px-1 text-[10px] text-muted">Enter to send · Shift+Enter for a new line · answers cite SEC sources</div>
      </form>
    </div>
  );
}
