"use client";

/** The command palette itself (CommandPalette.tsx opens it), loaded on first use. */
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { FEATURES } from "@/lib/nav";
import { emitSubNav } from "@/lib/subnav";
import { requestCrmSearch } from "@/lib/client/crm-query";
import { asComparison, asTicker, pushRecent, rank, score, type PaletteItem } from "@/lib/palette";
import { CORE_FEATURES, LAYOUTS } from "@/lib/desk/desk";
import { useNav } from "./NavContext";
import { useWorkspace } from "./WorkspaceProvider";

type Command = PaletteItem & { run?: () => void; event?: { path: string; value: string } };

const RECENT_KEY = "yb-palette-recent";
const readRecent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };
const writeRecent = (ids: string[]) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(ids)); } catch { /* private window: no memory, still works */ } };

const SETTINGS: { id: string; label: string; icon: string; keywords: string }[] = [
  { id: "style", label: "Style", icon: "Palette", keywords: "theme appearance colours look size font" },
  { id: "ai", label: "AI model", icon: "Cpu", keywords: "model reasoning openai anthropic claude" },
  { id: "news", label: "News and alerts", icon: "Newspaper", keywords: "notifications push brief" },
  { id: "desk", label: "My desk", icon: "Layout", keywords: "features widgets layout setup customize" },
  { id: "calendar", label: "Calendar", icon: "Calendar", keywords: "google outlook meetings" },
  { id: "plan", label: "Plan", icon: "CreditCard", keywords: "billing pro upgrade subscription" },
  { id: "sources", label: "Data sources", icon: "Server", keywords: "api keys fmp connectors" },
  { id: "security", label: "Security", icon: "Shield", keywords: "two-factor 2fa authenticator password" },
  { id: "data", label: "Data and privacy", icon: "Database", keywords: "export delete account" },
  { id: "labs", label: "Labs", icon: "FlaskConical", keywords: "beta experiments" },
  { id: "desktop", label: "Desktop app", icon: "Download", keywords: "mac windows install" },
];
const LAYOUT_NAME = { focus: "Focus", home: "Home", desk: "Desk" } as const;

export function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const path = usePathname();
  const nav = useNav();
  const { tools, desk, setDesk, config, profile, setWatchlist } = useWorkspace();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(readRecent);
  // The person's own contacts and deals matching what is typed (Relationships), fetched after a pause.
  const [crm, setCrm] = useState<{ q: string; contacts: { id: number; name: string; email: string; company: string }[]; deals: { id: number; name: string; stage: string }[] } | null>(null);
  const hasCrm = nav.features.some((f) => f.id === "crm");
  useEffect(() => {
    const query = q.trim();
    if (!hasCrm || query.length < 2) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      fetch(`/api/crm/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) setCrm({ q: query, contacts: d.contacts ?? [], deals: d.deals ?? [] }); })
        .catch(() => undefined);
    }, 180);
    return () => { window.clearTimeout(t); ctrl.abort(); };
  }, [q, hasCrm]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const back = useRef<Element | null>(null);

  useEffect(() => {
    back.current = document.activeElement;
    input.current?.focus();
    return () => { if (back.current instanceof HTMLElement) back.current.focus(); };
  }, []);

  const first = config.watchlist[0] ?? "AAPL";
  const commands = useMemo<Command[]>(() => {
    const c: Command[] = [];
    for (const f of nav.features) {
      c.push({ id: `go:${f.id}`, label: f.label, group: "Go to", icon: f.icon, hint: f.blurb, href: f.href });
      for (const l of f.links ?? []) if (l.href !== f.href) c.push({ id: `page:${l.href}`, label: l.label, group: "Pages", icon: f.icon, hint: f.label, keywords: l.hint, href: l.href, event: l.event });
    }
    for (const t of tools) c.push({ id: `tool:${t.id}`, label: t.title, group: "Tools", icon: t.icon, hint: t.kind === "ai" ? "AI workflow" : "Calculator", keywords: `${t.tagline} ${(t.tags ?? []).join(" ")} ${t.category}`, href: `/app/tools/${t.id}` });
    for (const l of LAYOUTS) c.push({ id: `layout:${l}`, label: `Home layout: ${LAYOUT_NAME[l]}`, group: "Home", icon: l === "focus" ? "Focus" : l === "home" ? "Sofa" : "LayoutGrid", on: desk.layout === l, keywords: "dashboard view switch", run: () => { setDesk({ layout: l }); if (path !== "/app") router.push("/app"); } });
    for (const f of FEATURES) {
      if (CORE_FEATURES.includes(f.id) || (f.roles && !f.roles.includes(profile.role))) continue;
      const hidden = desk.hidden.includes(f.id);
      c.push({ id: `feature:${f.id}`, label: `${hidden ? "Show" : "Hide"} ${f.label} in the navigation`, group: "Features", icon: f.icon, keywords: "feature turn on off switch", run: () => setDesk({ hidden: hidden ? desk.hidden.filter((x) => x !== f.id) : [...desk.hidden, f.id] }) });
    }
    for (const s of SETTINGS) c.push({ id: `settings:${s.id}`, label: `Settings: ${s.label}`, group: "Settings", icon: s.icon, keywords: s.keywords, href: `/app/settings?tab=${s.id}`, event: { path: "/app/settings", value: s.id } });
    c.push({ id: "app:sidebar", label: nav.open ? "Close the sidebar" : "Open the sidebar", group: "App", icon: "PanelLeft", hint: "⌘\\", run: () => nav.setOpen(!nav.open) });
    c.push({ id: "app:new", label: "What's new", group: "App", icon: "Sparkles", keywords: "changelog release features", run: () => window.dispatchEvent(new Event("yb:whats-new")) });
    c.push({ id: "app:keys", label: "Keyboard shortcuts", group: "App", icon: "Keyboard", hint: "?", keywords: "keys hotkeys", run: () => window.dispatchEvent(new Event("yb:shortcuts")) });
    c.push({ id: "app:bar", label: "Customize the top bar", group: "App", icon: "SlidersHorizontal", keywords: "pin reorder", run: () => nav.customize() });
    c.push({ id: "app:setup", label: "Set up my desk for me", group: "App", icon: "Wand2", keywords: "personalize auto recommend", href: "/app/settings?tab=desk", event: { path: "/app/settings", value: "desk" } });
    return c;
  }, [nav, tools, desk, setDesk, path, router, profile.role]);

  const results = useMemo<Command[]>(() => {
    const query = q.trim();
    if (!query) {
      const byId = new Map(commands.map((c) => [c.id, c]));
      const rec = recent.map((id) => byId.get(id)).filter((c): c is Command => !!c).map((c) => ({ ...c, group: "Recent" as const }));
      const seen = new Set(rec.map((c) => c.id));
      return [...rec, ...commands.filter((c) => c.group === "Go to" && !seen.has(c.id)), ...commands.filter((c) => c.group === "Home")];
    }
    const out: Command[] = [];
    const t = asTicker(query);
    const ranked = rank(commands, query, 40);
    out.push(...ranked);
    if (t) {
      // Typed in capitals, or nothing else fits well: the ticker first. "dcf" in lower case finds the DCF tool first.
      const open: Command = { id: `ticker:${t}`, label: `Open ${t} in the terminal`, group: "Go to", icon: "Terminal", hint: "quote, filings, comps, news", href: `/app/terminal?ticker=${encodeURIComponent(t)}` };
      const strong = ranked.filter((c) => score(c, query) >= 60).length;
      const at = query === query.toUpperCase() ? 0 : Math.min(strong, 3);
      const watched = config.watchlist.includes(t);
      const watch: Command = watched
        ? { id: `unwatch:${t}`, label: `Remove ${t} from the watchlist`, group: "Home", icon: "X", run: () => setWatchlist(config.watchlist.filter((x) => x !== t)) }
        : { id: `watch:${t}`, label: `Add ${t} to the watchlist`, group: "Home", icon: "Star", hint: "Home, the terminal and your news", run: () => setWatchlist([...config.watchlist, t]) };
      // The public page (/c/TICKER): SEC fundamentals and filings anyone can open, to share.
      const share: Command = { id: `share:${t}`, label: `Copy ${t}'s public page link`, group: "Go to", icon: "Share2", hint: "SEC fundamentals and filings, for anyone", run: () => { void navigator.clipboard?.writeText(`${window.location.origin}/c/${encodeURIComponent(t)}`).catch(() => undefined); } };
      out.splice(at, 0, open, watch);
      out.push(share);
    }
    // "SNOW vs MDB": compare them side by side with the AI (growth, margins, valuation, with sources), first.
    const cmp = asComparison(query);
    if (cmp) {
      const question = `Compare ${cmp.slice(0, -1).join(", ")} and ${cmp[cmp.length - 1]} side by side: revenue growth, margins, free cash flow and valuation, in a table, with sources.`;
      out.unshift({ id: `compare:${cmp.join("-")}`, label: `Compare ${cmp.join(" vs ")}`, group: "Ask", icon: "Scale", hint: "growth, margins and valuation, in a table", href: `/app/terminal?ticker=${encodeURIComponent(cmp[0])}&fn=AI&arg=${encodeURIComponent(question)}` });
    }
    // People and deals, only for the query they were fetched for (an older answer never shows under a newer query).
    if (crm && crm.q === query) {
      for (const p of crm.contacts) {
        const term = p.email || p.name;
        // Already in Relationships: switch to Contacts and search there (the page reads ?q= only on first render).
        const run = path === "/app/crm" ? () => { requestCrmSearch(term); emitSubNav({ path: "/app/crm", value: "contacts" }); } : undefined;
        out.push({ id: `person:${p.id}`, label: p.name || p.email, group: "People", icon: "Users", hint: [p.company, p.name ? p.email : ""].filter(Boolean).join(" · "), href: `/app/crm?tab=contacts&q=${encodeURIComponent(term)}`, run });
      }
      for (const d of crm.deals) out.push({ id: `deal:${d.id}`, label: d.name, group: "Deals", icon: "Handshake", hint: d.stage, href: `/app/crm?tab=pipeline`, event: { path: "/app/crm", value: "pipeline" } });
    }
    const ask: Command = { id: "ask", label: `Ask: “${query.length > 70 ? `${query.slice(0, 70)}…` : query}”`, group: "Ask", icon: "Sparkles", hint: "AI, with sources", href: `/app/terminal?ticker=${encodeURIComponent(t ?? first)}&fn=AI&arg=${encodeURIComponent(query)}` };
    // A question goes to the AI first; a word or two that matches something goes there first.
    if (query.split(/\s+/).length >= 4 || /\?$/.test(query) || (ranked.length === 0 && !t)) out.unshift(ask); else out.push(ask);
    return out;
  }, [q, commands, recent, first, config.watchlist, setWatchlist, crm, path]);

  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  const run = useCallback((c: Command) => {
    if (c.id !== "ask" && !/^(ticker|watch|unwatch|share|person|deal|compare):/.test(c.id)) { const next = pushRecent(recent, c.id); setRecent(next); writeRecent(next); }
    onClose();
    if (c.run) { c.run(); return; }
    if (!c.href) return;
    if (c.event && path === c.event.path) emitSubNav(c.event);
    // Already in the terminal: hand it the command (a ticker, the AI with a question) and keep the URL in
    // step, so it opens even when the URL would not change (the same ticker after its panel was closed).
    else if (path === "/app/terminal" && c.href.startsWith("/app/terminal?")) {
      const q = new URLSearchParams(c.href.slice("/app/terminal?".length));
      window.dispatchEvent(new CustomEvent("yb:terminal-run", { detail: { ticker: q.get("ticker") ?? "", fn: q.get("fn") ?? "", arg: q.get("arg") ?? undefined } }));
      // null state, so Next takes the address as its own (src/lib/subnav.ts says why).
      window.history.replaceState(null, "", c.href);
    } else router.push(c.href);
  }, [recent, onClose, path, router]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && results[active]) { e.preventDefault(); run(results[active]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === "Tab") e.preventDefault();
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-bg/55 px-3 pt-[12vh] backdrop-blur-[3px] max-md:pt-[calc(var(--safe-t,0px)+12px)]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}
        className="rise float flex max-h-[70vh] w-full max-w-[620px] flex-col overflow-hidden ctl border border-line-strong bg-raised shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-3">
          <Icon name="Search" className="h-4 w-4 shrink-0 text-muted" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }}
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={results[active] ? `palette-${active}` : undefined}
            placeholder="Go anywhere, open a ticker, change the look, or ask a question…" aria-label="Search or ask"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-faint" />
          <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint">esc</kbd>
        </div>
        <ul ref={list} id="palette-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
          {results.length === 0 && <li className="px-3 py-6 text-center text-[12.5px] text-muted">Nothing matches. Press Enter to ask the AI.</li>}
          {results.map((c, i) => {
            const head = !q.trim() && c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={`${c.group}:${c.id}`} role="presentation">
                {head && <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">{head === "Home" ? "Home layout" : head}</div>}
                <div id={`palette-${i}`} data-i={i} role="option" aria-selected={i === active} onMouseMove={() => active !== i && setActive(i)} onClick={() => run(c)}
                  className={`flex cursor-pointer items-center gap-2.5 ctl px-2.5 py-2 text-[13px] ${i === active ? "bg-accent-soft text-fg" : "text-fg/90"}`}>
                  <Icon name={c.icon} className={`h-4 w-4 shrink-0 ${i === active ? "text-accent" : "text-muted"}`} />
                  <span className="min-w-0 flex-1 truncate">{c.label}{c.hint && <span className="ml-2 text-[11.5px] text-muted max-sm:hidden">{c.hint}</span>}</span>
                  {c.on && <Icon name="Check" className="h-3.5 w-3.5 shrink-0 text-accent" />}
                  {q.trim() && <span className="shrink-0 text-[10.5px] text-faint">{c.group}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-3 border-t border-line px-3.5 py-2 text-[10.5px] text-faint max-sm:hidden">
          <span><kbd className="font-mono">↑↓</kbd> move</span><span><kbd className="font-mono">↵</kbd> open</span><span><kbd className="font-mono">⌘K</kbd> toggle</span>
          <span className="ml-auto">Type a ticker to open it, or a question to ask it</span>
        </div>
      </div>
    </div>
  );
}
