"use client";

/**
 * The trading agent's chat (Pro). Each reply lists what the agent did, with each tool call's reason and
 * whether its gate allowed it; a change that loosens a limit comes back as a card the person applies.
 * Messages count against the AI allowance.
 */
import { useEffect, useRef, useState } from "react";
import { PremiumGate } from "@/components/billing/Premium";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { useAlgoConsent } from "./AlgoConsent";
import { call, json, when } from "./client";

type CallView = { tool: string; why: string; allowed: boolean; reason: string; summary: string; confirm: { strategyId: number; spec: Record<string, unknown> } | null };
type Msg = { id: number | string; role: string; content: string; calls?: CallView[]; at?: string };

const EXAMPLES = ["Build me a low-volatility momentum strategy with sector ETFs", "Why did my trend strategy sell QQQ?", "Backtest my newest strategy", "Pause everything"];

export function AgentChat({ onChanged }: { onChanged: () => void }) {
  return <PremiumGate feature="algo.agent"><Chat onChanged={onChanged} /></PremiumGate>;
}

function Chat({ onChanged }: { onChanged: () => void }) {
  const ask = useAlgoConsent();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { fetchJson<{ messages: Msg[] }>("/api/algo/agent").then((r) => setMsgs(r.messages)).catch((e) => setError(errorMessage(e))); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);
  const send = async (m: string) => {
    if (!m.trim() || busy) return;
    setBusy(true); setError(null); setText("");
    setMsgs((x) => [...x, { id: `u${Date.now()}`, role: "user", content: m }]);
    try {
      const r = await call<{ reply: string; calls: CallView[] }>("/api/algo/agent", json("POST", { message: m }), ask);
      setMsgs((x) => [...x, { id: `a${Date.now()}`, role: "agent", content: r.reply, calls: r.calls }]);
      if (r.calls.some((c) => c.allowed && c.tool !== "get_status" && c.tool !== "explain" && c.tool !== "read_news")) onChanged();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const apply = async (c: NonNullable<CallView["confirm"]>) => {
    try { await call(`/api/algo/strategies/${c.strategyId}`, json("PATCH", { spec: c.spec }), ask); setMsgs((x) => [...x, { id: `s${Date.now()}`, role: "agent", content: "Applied. Review and save the risk limits again before live trading." }]); onChanged(); }
    catch (e) { setError(errorMessage(e)); }
  };
  return (
    <div className="panel flex h-[70dvh] min-h-[420px] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {!msgs.length && (
          <div className="text-[12.5px] text-muted">
            <p>Ask the agent to build, test, explain or pause strategies. It never places an order you did not ask for in your own words, never trades on news, and cannot switch anything to live.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">{EXAMPLES.map((e) => <button key={e} onClick={() => send(e)} className="ctl border border-line px-2.5 py-1.5 text-[12px] text-fg hover:bg-elevated">{e}</button>)}</div>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={m.role === "user" ? "ml-auto max-w-[85%] rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-fg" : "max-w-[92%] text-[13px] text-fg"}>
            <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
            {!!m.calls?.length && (
              <ul className="mt-2 space-y-1 border-l-2 border-line pl-2 text-[11.5px]">
                {m.calls.map((c, i) => (
                  <li key={i} className={c.allowed ? "text-muted" : "text-neg"}>
                    <Icon name={c.allowed ? "Check" : "X"} className="mr-1 inline h-3 w-3" /><span className="font-semibold">{c.tool}</span>: {c.why} {c.allowed ? "" : `(refused: ${c.reason})`}
                    {c.confirm && <button onClick={() => apply(c.confirm!)} className="ctl ml-2 border border-accent/50 px-2 py-0.5 text-[11px] text-accent">Apply this change</button>}
                  </li>
                ))}
              </ul>
            )}
            {m.at && <div className="mt-1 text-[10.5px] text-muted">{when(m.at)}</div>}
          </div>
        ))}
        {busy && <p className="text-[12px] text-muted"><Icon name="Loader" className="mr-1 inline h-3.5 w-3.5 animate-spin" />Thinking…</p>}
        <div ref={end} />
      </div>
      {error && <p className="px-3 text-[12px] text-neg">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="flex gap-2 border-t border-line p-2" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the trading agent" maxLength={2000} className="ctl min-w-0 flex-1 border border-line bg-panel px-3 py-2 text-[13px] outline-none focus:border-accent" />
        <button disabled={busy || !text.trim()} className="ctl bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50" aria-label="Send"><Icon name="ArrowUpRight" className="h-4 w-4" /></button>
      </form>
    </div>
  );
}
