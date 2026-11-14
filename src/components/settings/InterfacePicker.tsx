"use client";

/**
 * Settings → Style → Interface: the whole frame of the app, thirteen ways (src/lib/desk/interfaces.ts).
 * Each card is a live miniature of that interface (its structure and its signature moving, in its own
 * colours; interfaces/Miniatures.tsx), what it is like, where its navigation lives, what its Home is, and
 * its one memorable detail. A click applies it at once; arrow keys move between cards as in any radio
 * group. The one made for the person's role is marked. Chosen here and nowhere else.
 */
import { useRef } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { Miniature } from "@/components/workspace/interfaces/Miniatures";
import { interfacesFor, suggestedInterface, type HomeComposition, type NavPlacement } from "@/lib/desk/interfaces";

const NAV: Record<NavPlacement, string> = {
  topbar: "Top bar", textline: "A line of numbered links", orb: "A glowing orb", command: "A composer, no menus", toolbar: "A tool rail",
  masthead: "A masthead", menubar: "A menu bar and a dock", rail: "A numbered index", thumbtabs: "Thumb tabs on the book", sheets: "Sheet tabs", hidden: "None (⌘K)", dock: "A dock",
};
const HOME: Record<HomeComposition, string> = {
  desk: "Focus, Home or Desk", document: "A plain document", cinema: "A title sequence and a reel", thread: "A conversation", canvas: "A board to pan and zoom",
  frontpage: "A front page", instruments: "A radar and gauges", desktop: "A desktop of windows", poster: "A typographic poster", spread: "An open book",
  drawing: "A drawing with details", calm: "One calm column", bento: "A box of tiles",
};

export function InterfacePicker() {
  const { look, setLook, profile } = useWorkspace();
  const suggested = suggestedInterface(profile.role);
  const list = interfacesFor(profile.role);
  const group = useRef<HTMLDivElement>(null);
  const move = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = list[(i + d + list.length) % list.length];
    setLook({ ui: next.id });
    group.current?.querySelector<HTMLButtonElement>(`[data-ui-card="${next.id}"]`)?.focus();
  };
  return (
    <div ref={group} role="radiogroup" aria-label="Interface" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {list.map((m, i) => {
        const on = look.ui === m.id;
        return (
          <button key={m.id} type="button" role="radio" aria-checked={on} data-ui-card={m.id} tabIndex={on ? 0 : -1}
            onClick={() => setLook({ ui: m.id })} onKeyDown={(e) => move(e, i)}
            className={`group ctl flex flex-col border p-2 text-left transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? "ybm-live border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line hover:border-accent/50"}`}>
            <div aria-hidden><Miniature id={m.id} /></div>
            <div className="mt-2.5 flex items-center gap-2 px-0.5">
              <span className="text-[14px] font-semibold">{m.name}</span>
              {m.id === suggested && <span className="ctl bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">Made for your role</span>}
              <span className="ml-auto text-[10.5px] text-muted">{m.mode === "light" ? "Light" : "Dark"}</span>
              {on && <span className="text-[10.5px] font-semibold text-accent">In use</span>}
            </div>
            <p className="mt-1 px-0.5 text-[12px] leading-snug text-fg/85">{m.tagline}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 px-0.5 text-[11px]">
              <dt className="text-muted">Navigation</dt><dd className="text-fg/85">{NAV[m.chrome.nav]}</dd>
              <dt className="text-muted">Home</dt><dd className="text-fg/85">{HOME[m.home]}</dd>
              <dt className="text-muted">Signature</dt><dd className="text-fg/85">{m.signature}</dd>
            </dl>
            <p className="mt-auto px-0.5 pt-2 text-[10.5px] text-muted">Suits: {m.suits}</p>
          </button>
        );
      })}
    </div>
  );
}
