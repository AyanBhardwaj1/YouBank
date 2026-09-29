"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CommandBar } from "./CommandBar";
import { Panel } from "./Panel";
import { Rail } from "./Rail";
import { Tape } from "./Tape";
import { FUNCTIONS, functionsForProfile, isFunctionCode, needsTicker, type Command, type FunctionCode } from "@/lib/functions";
import { useCompany } from "@/lib/client/companies";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { useAiSettings } from "@/components/ai/ModelPicker";
import { HelpOverlay } from "./HelpOverlay";
import { prefetchFunction, recordSkill } from "./kit";
import { useSubNav } from "@/lib/subnav";

export type OpenPanel = Command & { id: number; openedAt?: number };
export type AiStatus = { configured: boolean; provider: string; model: string; reason?: string; label?: string };

const MAX_PANELS = 4;
/** Event-time helpers (kept outside the component: they read the clock). */
const stamp = () => Date.now();
const openedRecently = (openedAt?: number) => !!openedAt && Date.now() - openedAt < 4000;
const sameCmd = (a: Command, b: Command) => a.ticker === b.ticker && a.fn === b.fn && (a.arg ?? "") === (b.arg ?? "");

export function Terminal({ initial }: { initial?: { ticker?: string; fn?: string; arg?: string } }) {
  const { config, profile } = useWorkspace();
  const fns = functionsForProfile(profile);
  const startTicker = initial?.ticker || config.initialPanels[0]?.ticker || config.watchlist[0] || "SNOW";
  const [activeTicker, setActiveTicker] = useState(startTicker);
  const [panels, setPanels] = useState<OpenPanel[]>(() => {
    const base: OpenPanel[] = config.initialPanels.filter((p) => isFunctionCode(p.fn)).map((p, i) => ({ id: i + 1, ticker: needsTicker(p.fn as FunctionCode) ? p.ticker : "", fn: p.fn as FunctionCode }));
    if (initial?.ticker || initial?.fn) {
      const fn = initial.fn && isFunctionCode(initial.fn.toUpperCase()) ? (initial.fn.toUpperCase() as FunctionCode) : "DES";
      const extra: OpenPanel = { id: 99, ticker: needsTicker(fn) ? startTicker : "", fn, arg: initial.arg };
      return [...base.filter((p) => !sameCmd(p, extra)).map((p) => ({ ...p, ticker: initial.ticker ? startTicker : p.ticker })), extra].slice(-MAX_PANELS);
    }
    return base;
  });
  const [maximized, setMaximized] = useState<number | null>(null);
  const [clock, setClock] = useState("");
  const [help, setHelp] = useState(false);
  const { status } = useAiSettings();
  const nextId = useRef(100);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: active } = useCompany(activeTicker);

  const run = (command: Command) => {
    // Market and workspace functions carry no ticker; company functions fall back to the active one.
    const ticker = needsTicker(command.fn) ? (command.ticker || activeTicker).toUpperCase() : "";
    const cmd = { ...command, ticker };
    if (ticker) setActiveTicker(ticker);
    setMaximized(null);
    // Knowledge tracing: a typed command is strong evidence of knowing the function, a click weaker.
    recordSkill(cmd.fn, true, cmd.via === "typed" ? "typed" : "click");
    const id = nextId.current++;
    setPanels((prev) => {
      if (prev.some((p) => sameCmd(p, cmd))) return prev;
      const next = [...prev, { ...cmd, id, openedAt: stamp() }];
      return next.length > MAX_PANELS ? next.slice(next.length - MAX_PANELS) : next;
    });
  };

  const close = (id: number) => {
    const p = panels.find((x) => x.id === id);
    // Closing a panel within seconds of opening it reads as "not what I wanted": evidence against.
    if (p && openedRecently(p.openedAt)) recordSkill(p.fn, false, p.via === "typed" ? "typed" : "click");
    setPanels((prev) => prev.filter((x) => x.id !== id));
    setMaximized((m) => (m === id ? null : m));
  };

  const openFn = (fn: FunctionCode) => run({ ticker: activeTicker, fn, via: "click" });

  // The sidebar's terminal workflows open here as panels, beside the ones already open.
  useSubNav("/app/terminal", (code) => { if (isFunctionCode(code)) run({ ticker: "", fn: code, via: "click" }); });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); }
      else if (e.key === "/" && !typing) { e.preventDefault(); inputRef.current?.focus(); }
      else if (e.key === "?" && !typing) { e.preventDefault(); setHelp(true); }
      else if (e.key === "Escape" && !typing) { setHelp(false); setMaximized(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-US", { hour12: false, timeZone: "America/New_York" }) + " ET");
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const ai: AiStatus | null = status ? { configured: status.configured, provider: status.provider, model: status.model, label: status.label } : null;
  const chg = active?.price?.changePct ?? null;
  const shown = maximized === null ? panels : panels.filter((p) => p.id === maximized);
  const aiLabel = ai ? (ai.configured ? `AI · ${ai.label ?? ai.model}` : `AI offline`) : "AI · checking";

  return (
    <div className="flex h-full text-fg">
      <Rail activeTicker={activeTicker} panels={panels} onRun={run} aiLabel={aiLabel} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
          <CommandBar ref={inputRef} activeTicker={activeTicker} onRun={run} />
          <div className="num hidden items-center gap-3 text-[11px] text-muted md:flex">
            <span className="flex items-center gap-1.5"><span className="pulse-ring h-1.5 w-1.5 rounded-full bg-pos" /> Live</span>
            <span suppressHydrationWarning>{clock}</span>
            <button type="button" onClick={() => setHelp(true)} title="Commands and keys (?)" className="ctl border border-line px-1.5 py-0.5 font-sans hover:border-accent/50 hover:text-fg">?</button>
          </div>
        </header>

        <nav className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-panel/80 px-3">
          <div className="mr-3 flex items-center gap-2 border-r border-line pr-3">
            <span className="num text-[13px] font-semibold text-accent">{activeTicker}</span>
            {active && <span className="hidden max-w-[220px] truncate text-muted lg:inline">{active.name}</span>}
            {active?.price && (
              <>
                <span className="num text-fg">{active.price.last.toFixed(2)}</span>
                {chg !== null && (
                  <span className={`num rounded px-1 py-px text-[10.5px] ${chg >= 0 ? "bg-pos/15 text-pos" : "bg-neg/15 text-neg"}`}>
                    {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
                  </span>
                )}
              </>
            )}
          </div>
          {fns.map((code) => {
            const isOpen = panels.some((p) => p.fn === code && (!needsTicker(code) || p.ticker === activeTicker));
            return (
              <button key={code} type="button" title={FUNCTIONS[code].hint} onClick={() => openFn(code)} onMouseEnter={() => prefetchFunction(code, activeTicker)}
                className={`num ctl px-2 py-1 text-[11px] font-semibold tracking-wider transition-colors focus:outline-none focus:ring-1 focus:ring-accent ${
                  isOpen ? "bg-accent-soft text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}>
                {code}
              </button>
            );
          })}
          <span className="ml-auto whitespace-nowrap text-[11px] text-muted">
            {panels.length}/{MAX_PANELS} panels{maximized !== null ? " · maximized (Esc to restore)" : ""}
          </span>
        </nav>

        <main className="min-h-0 flex-1 overflow-auto p-2 lg:overflow-hidden">
          {shown.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 ctl border border-dashed border-line text-muted">
              <div className="text-[13px] text-fg">No panels open</div>
              <div>Press <kbd className="rounded border border-line bg-elevated px-1.5 py-0.5 text-fg">/</kbd> and type <span className="num text-accent">{config.watchlist[0] ?? "SNOW"} COMPS</span></div>
            </div>
          ) : (
            <div className={`grid gap-2 lg:h-full ${shown.length === 1 ? "grid-cols-1 auto-rows-[minmax(420px,1fr)] lg:grid-rows-1" : shown.length === 2 ? "grid-cols-1 auto-rows-[minmax(360px,1fr)] lg:grid-cols-2 lg:grid-rows-1" : "grid-cols-1 auto-rows-[minmax(320px,1fr)] lg:grid-cols-2 lg:grid-rows-2"}`}>
              <AnimatePresence initial={false}>
                {shown.map((p) => (
                  <motion.div key={p.id} layout initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }} transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.6 }} className="min-h-0 min-w-0">
                    <Panel panel={p} maximized={maximized === p.id} onClose={() => close(p.id)} onToggleMax={() => setMaximized((m) => (m === p.id ? null : p.id))} onRun={run} ai={ai} openPanels={panels} activeTicker={activeTicker} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </main>

        <Tape />
      </div>
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
    </div>
  );
}
