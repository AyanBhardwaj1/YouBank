"use client";

import { forwardRef, useEffect, useMemo, useState } from "react";
import { EDGE_CODES, FUNCTIONS, FUNCTION_CODES, isCommandCode, needsTicker, parseCommand, type Command, type FunctionCode } from "@/lib/functions";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { getCached } from "@/lib/client/companies";
import type { TickerRow } from "@/lib/types";
import { catalogFor } from "@/lib/workflows/catalog";

type Props = { activeTicker: string; onRun: (command: Command) => void };
type Suggestion = { text: string; label: string; hint: string; command: Command };

/** Function suggestions: company functions carry the ticker, market ones stand alone. Codes that take words (EQS, PORT, ASK) complete to the code and a space. Edge's only with its beta on. */
const fnSuggestions = (ticker: string, prefix: string, edge: boolean): Suggestion[] =>
  FUNCTION_CODES.filter((f) => f.startsWith(prefix) && f !== "TOOL" && (edge || !EDGE_CODES.has(f))).map((f) => {
    const own = needsTicker(f);
    const words = f === "EQS" || f === "PORT";
    const text = own ? `${ticker} ${f}${f === "ASK" ? " " : ""}` : words ? `${f} ` : f;
    return { text, label: own ? `${ticker} ${f}` : f, hint: FUNCTIONS[f].hint, command: { ticker: own ? ticker : "", fn: f as FunctionCode } };
  });

export const CommandBar = forwardRef<HTMLInputElement, Props>(function CommandBar({ activeTicker, onRun }, ref) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [remote, setRemote] = useState<TickerRow[]>([]);
  const { config, profile, edge } = useWorkspace();
  const watchlist = config.watchlist;
  const isCode = (s: string) => isCommandCode(s, edge);

  const tokens = value.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const first = tokens[0] ?? "";
  const wantsSearch = tokens.length === 1 && !isCode(first) && first.length >= 1;

  // Server-side ticker search (SEC company list), debounced.
  useEffect(() => {
    if (!wantsSearch) { setRemote([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(first)}`, { signal: ctrl.signal })
        // Suggestions are a convenience: a failed search (signed out, rate limited) just offers none.
        .then((r) => (r.ok ? r.json() : [])).then((rows: unknown) => setRemote(Array.isArray(rows) ? (rows as TickerRow[]) : [])).catch(() => {});
    }, 120);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [first, wantsSearch]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (tokens.length === 0) return fnSuggestions(activeTicker, "", edge);
    if (tokens.length === 1) {
      const local = watchlist.filter((t) => t.startsWith(first)).map((t) => ({ ticker: t, name: getCached(t)?.name ?? "", cik: "" }));
      const seen = new Set(local.map((l) => l.ticker));
      const tickers = [...local, ...remote.filter((r) => !seen.has(r.ticker))].slice(0, 6)
        .map((r) => ({ text: `${r.ticker} `, label: r.ticker, hint: r.name || "SEC registrant", command: { ticker: r.ticker, fn: "DES" as FunctionCode } }));
      return [...tickers, ...fnSuggestions(activeTicker, first, edge)].slice(0, 9);
    }
    const [tk, second] = tokens;
    const toolArg = value.trim().split(/\s+/).slice(isCode(tk) ? 1 : 2).join(" ").toLowerCase();
    const tickerForTool = isCode(tk) ? activeTicker : tk;
    if ((tk === "TOOL" && tokens.length >= 1) || (second === "TOOL")) {
      return catalogFor(profile).filter((t) => !toolArg || t.id.includes(toolArg) || t.title.toLowerCase().includes(toolArg)).slice(0, 9)
        .map((t) => ({ text: `${tickerForTool} TOOL ${t.id}`, label: t.id, hint: t.title, command: { ticker: tickerForTool, fn: "TOOL" as FunctionCode, arg: t.id } }));
    }
    return isCode(tk) ? [] : fnSuggestions(tk, second ?? "", edge);
  }, [tokens.length, first, remote, activeTicker, value, watchlist, profile, edge]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setIndex(0), [suggestions.length, value]);

  const choose = (s: Suggestion) => {
    if (s.text.endsWith(" ")) { setValue(s.text); return; }
    onRun({ ...s.command, via: "click" }); setValue(""); setError(null); setOpen(false);
  };
  const submit = () => {
    const result = parseCommand(value, activeTicker, edge);
    if (result.ok) { onRun({ ...result.command, via: "typed" }); setValue(""); setError(null); setOpen(false); }
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
          else if (e.key === "Enter") {
            // Complete a partial ticker or tool id from the list; a complete command runs as typed.
            const s0 = suggestions[index];
            if (open && s0 && s0.label !== first && ((tokens.length < 2 && !isCode(first)) || s0.command.fn === "TOOL")) choose(s0); else submit();
          }
          else if (e.key === "Escape") { setOpen(false); (e.target as HTMLInputElement).blur(); }
        }}
        placeholder={`${activeTicker} COMPS  ·  ${activeTicker} WACC  ·  ECO  ·  EQS in plain English`}
        spellCheck={false}
        autoComplete="off"
        className="num w-full rounded-md border border-line bg-bg py-1.5 pl-7 pr-2 uppercase tracking-wide text-fg placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      {error && <span className="absolute right-2 text-[11px] text-neg" role="alert">{error}</span>}
      {open && suggestions.length > 0 && (
        <ul className="rise float absolute left-0 top-full z-50 mt-1 w-[460px] max-w-[calc(100vw-16px)] overflow-hidden ctl border border-line-strong bg-raised max-md:fixed max-md:inset-x-2 max-md:top-full max-md:mt-1 max-md:w-auto max-md:max-w-none" role="listbox">
          {suggestions.map((s, i) => (
            <li key={s.text} role="option" aria-selected={i === index}
              onMouseDown={(e) => { e.preventDefault(); choose(s); }} onMouseEnter={() => setIndex(i)}
              className={`flex cursor-pointer items-center justify-between px-3 py-1.5 max-md:min-h-11 ${i === index ? "bg-accent-soft text-fg" : "text-fg/90"}`}>
              <span className="num font-semibold">{s.label}</span>
              <span className="truncate pl-4 text-[11px] text-muted">{s.hint}</span>
            </li>
          ))}
          <li className="flex justify-between border-t border-line px-3 py-1 text-[10px] text-muted max-md:hidden">
            <span>↑↓ navigate · Tab complete · Enter run</span><span>Esc close</span>
          </li>
        </ul>
      )}
    </div>
  );
});
