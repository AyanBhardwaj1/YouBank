"use client";

import { forwardRef, useEffect, useMemo, useState } from "react";
import { FUNCTIONS, FUNCTION_CODES, isFunctionCode, parseCommand, type Command, type FunctionCode } from "@/lib/functions";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { getCached } from "@/lib/client/companies";
import type { TickerRow } from "@/lib/types";
import { toolsFor } from "@/lib/workflows/registry";

type Props = { activeTicker: string; onRun: (command: Command) => void };
type Suggestion = { text: string; label: string; hint: string; command: Command };

const fnSuggestions = (ticker: string, prefix = ""): Suggestion[] =>
  FUNCTION_CODES.filter((f) => f.startsWith(prefix)).map((f) => ({
    text: `${ticker} ${f}`, label: `${ticker} ${f}`, hint: FUNCTIONS[f].hint, command: { ticker, fn: f as FunctionCode },
  }));

export const CommandBar = forwardRef<HTMLInputElement, Props>(function CommandBar({ activeTicker, onRun }, ref) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [remote, setRemote] = useState<TickerRow[]>([]);
  const { config, profile } = useWorkspace();
  const watchlist = config.watchlist;

  const tokens = value.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const first = tokens[0] ?? "";
  const wantsSearch = tokens.length === 1 && !isFunctionCode(first) && first.length >= 1;

  // Server-side ticker search (SEC company list), debounced.
  useEffect(() => {
    if (!wantsSearch) { setRemote([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(first)}`, { signal: ctrl.signal })
        .then((r) => r.json()).then((rows: TickerRow[]) => setRemote(rows)).catch(() => {});
    }, 120);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [first, wantsSearch]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (tokens.length === 0) return fnSuggestions(activeTicker);
    if (tokens.length === 1) {
      const local = watchlist.filter((t) => t.startsWith(first)).map((t) => ({ ticker: t, name: getCached(t)?.name ?? "", cik: "" }));
      const seen = new Set(local.map((l) => l.ticker));
      const tickers = [...local, ...remote.filter((r) => !seen.has(r.ticker))].slice(0, 6)
        .map((r) => ({ text: `${r.ticker} `, label: r.ticker, hint: r.name || "SEC registrant", command: { ticker: r.ticker, fn: "DES" as FunctionCode } }));
      return [...tickers, ...fnSuggestions(activeTicker, first)].slice(0, 9);
    }
    const [tk, second] = tokens;
    const toolArg = value.trim().split(/\s+/).slice(isFunctionCode(tk) ? 1 : 2).join(" ").toLowerCase();
    const tickerForTool = isFunctionCode(tk) ? activeTicker : tk;
    if ((tk === "TOOL" && tokens.length >= 1) || (second === "TOOL")) {
      return toolsFor(profile).filter((t) => !toolArg || t.id.includes(toolArg) || t.title.toLowerCase().includes(toolArg)).slice(0, 9)
        .map((t) => ({ text: `${tickerForTool} TOOL ${t.id}`, label: t.id, hint: t.title, command: { ticker: tickerForTool, fn: "TOOL" as FunctionCode, arg: t.id } }));
    }
    return isFunctionCode(tk) ? [] : fnSuggestions(tk, second ?? "");
  }, [tokens.length, first, remote, activeTicker, value, watchlist, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setIndex(0), [suggestions.length, value]);

  const choose = (s: Suggestion) => {
    if (s.text.endsWith(" ")) { setValue(s.text); return; }
    onRun(s.command); setValue(""); setError(null); setOpen(false);
  };
  const submit = () => {
    const result = parseCommand(value, activeTicker);
    if (result.ok) { onRun(result.command); setValue(""); setError(null); setOpen(false); }
    else setError(result.error);
  };

  return (
    <div className="relative flex flex-1 items-center">
      <span className="pointer-events-none absolute left-2.5 text-accent">›</span>
      <input
        ref={ref}
        value={value}
        onChange={(e) => { setValue(e.target.value); setOpen(true); if (error) setError(null); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, suggestions.length - 1)); setOpen(true); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Tab" && suggestions[index]) { e.preventDefault(); setValue(suggestions[index].text); }
          else if (e.key === "Enter") { if (open && suggestions[index] && (tokens.length < 2 || suggestions[index].command.fn === "TOOL") && suggestions[index].label !== first) choose(suggestions[index]); else submit(); }
          else if (e.key === "Escape") { setOpen(false); (e.target as HTMLInputElement).blur(); }
        }}
        placeholder={`${activeTicker} COMPS  ·  any US ticker + function`}
        spellCheck={false}
        autoComplete="off"
        className="num w-full rounded-md border border-line bg-bg py-1.5 pl-7 pr-2 uppercase tracking-wide text-fg placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      {error && <span className="absolute right-2 text-[11px] text-neg" role="alert">{error}</span>}
      {open && suggestions.length > 0 && (
        <ul className="rise float absolute left-0 top-full z-50 mt-1 w-[460px] overflow-hidden ctl border border-line-strong bg-raised" role="listbox">
          {suggestions.map((s, i) => (
            <li key={s.text} role="option" aria-selected={i === index}
              onMouseDown={(e) => { e.preventDefault(); choose(s); }} onMouseEnter={() => setIndex(i)}
              className={`flex cursor-pointer items-center justify-between px-3 py-1.5 ${i === index ? "bg-accent-soft text-fg" : "text-fg/90"}`}>
              <span className="num font-semibold">{s.label}</span>
              <span className="truncate pl-4 text-[11px] text-muted">{s.hint}</span>
            </li>
          ))}
          <li className="flex justify-between border-t border-line px-3 py-1 text-[10px] text-muted">
            <span>↑↓ navigate · Tab complete · Enter run</span><span>Esc close</span>
          </li>
        </ul>
      )}
    </div>
  );
});
