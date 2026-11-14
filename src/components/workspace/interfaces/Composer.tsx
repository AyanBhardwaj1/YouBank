"use client";

/**
 * Prompt's navigation: one composer along the bottom of every page. Type a page's name (or part of it,
 * or a workflow inside it) and Enter goes there; type anything else and Enter asks the assistant. As you
 * type, what Enter would do is listed above it, best first; ↑ and ↓ choose, Escape clears. "/" from
 * anywhere puts the cursor in it. Home's thread can hand it a question ("yb:compose"). A combobox, so a
 * screen reader hears the choices. Desktop only: on a phone the tab bar does this job.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { matchFeature } from "@/lib/desk/interfaces";
import { useNav } from "../NavContext";
import { useAsk } from "../home/ask";
import { typingIn, usePinned } from "./shared";

type Option = { key: string; label: string; hint: string; icon: string; go: () => void };

export default function Composer() {
  const nav = useNav();
  const router = useRouter();
  const { ask } = useAsk();
  const { items } = usePinned(4, 6);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "/" && !e.metaKey && !e.ctrlKey && !typingIn(e)) { e.preventDefault(); input.current?.focus(); } };
    const onCompose = (e: Event) => { const t = (e as CustomEvent<string>).detail; if (typeof t === "string") { setQ(t); input.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    window.addEventListener("yb:compose", onCompose);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("yb:compose", onCompose); };
  }, []);

  const options = useMemo<Option[]>(() => {
    const text = q.trim();
    const go = (href: string) => () => { setQ(""); router.push(href); };
    if (text === "/" || (!text && focused)) {
      return items.map((f) => ({ key: f.id, label: f.label, hint: "go", icon: f.icon, go: go(f.href) }));
    }
    if (!text) return [];
    const s = text.toLowerCase().replace(/^\//, "");
    const out: Option[] = [];
    const best = matchFeature(text, nav.features);
    if (best) out.push({ key: best.id, label: best.label, hint: "go", icon: best.icon, go: go(best.href) });
    for (const f of nav.features) {
      if (out.length >= 4) break;
      if (f.id !== best?.id && s.length >= 2 && f.label.toLowerCase().includes(s)) out.push({ key: f.id, label: f.label, hint: "go", icon: f.icon, go: go(f.href) });
      for (const l of f.links ?? []) {
        if (out.length >= 4) break;
        if (s.length >= 3 && l.label.toLowerCase().includes(s)) out.push({ key: `${f.id}:${l.href}`, label: `${f.label} › ${l.label}`, hint: "go", icon: f.icon, go: go(l.href) });
      }
    }
    if (!text.startsWith("/")) out.push({ key: "ask", label: text, hint: "ask", icon: "Sparkles", go: () => { setQ(""); ask(text); } });
    return out;
  }, [q, focused, items, nav.features, router, ask]);

  const active = Math.min(sel, Math.max(0, options.length - 1));
  const shown = focused && options.length > 0;
  return (
    <div className="yb-composer">
      {shown && (
        <ul id="yb-composer-list" role="listbox" aria-label="What Enter does" className="yb-composer-list">
          {options.map((o, i) => (
            <li key={o.key} id={`yb-opt-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); o.go(); }}>
              <Icon name={o.icon} className="h-4 w-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate">{o.hint === "ask" ? <>Ask: <span className="text-fg">“{o.label}”</span></> : o.label}</span>
              <span className="num shrink-0 text-[10.5px] text-faint">{o.hint === "ask" ? "assistant" : "page"}{i === active ? " ↵" : ""}</span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => { e.preventDefault(); options[active]?.go(); }}>
        <Icon name="Command" className="h-4 w-4 shrink-0 text-faint" />
        <input ref={input} value={q} name="compose" autoComplete="off" spellCheck={false}
          role="combobox" aria-expanded={shown} aria-controls="yb-composer-list" aria-autocomplete="list" aria-activedescendant={shown ? `yb-opt-${active}` : undefined}
          aria-label="Go to a page or ask the assistant" placeholder="Go anywhere or ask anything…  try “book”, “news” or a question"
          onChange={(e) => { setQ(e.target.value); setSel(0); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((active + 1) % Math.max(1, options.length)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((active - 1 + options.length) % Math.max(1, options.length)); }
            else if (e.key === "Escape") { if (q) setQ(""); else input.current?.blur(); }
          }} />
        <button type="submit" className="yb-composer-go" disabled={!options.length} aria-label="Go"><Icon name="ArrowUp" className="h-4 w-4" strokeWidth={2.2} /></button>
      </form>
      <div className="yb-composer-hint" aria-hidden><span><kbd>/</kbd> focus</span><span><kbd>↑↓</kbd> choose</span><span><kbd>↵</kbd> go or ask</span><span><kbd>⌘K</kbd> everything</span></div>
    </div>
  );
}
