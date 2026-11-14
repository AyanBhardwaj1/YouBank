"use client";

/**
 * Settings → Style → Interface: the whole frame of the app, nine ways (src/lib/desk/interfaces.ts). Each
 * card draws a small picture of that interface in its own colours and layout (where the navigation sits,
 * what a panel looks like), says who it suits, and applies at once on click. The one made for the
 * person's role is marked. Chosen here and nowhere else.
 */
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { interfacesFor, suggestedInterface, type InterfaceMeta } from "@/lib/desk/interfaces";

function Preview({ m }: { m: InterfaceMeta }) {
  const p = m.preview;
  const nav = m.chrome.nav;
  const r = Math.min(p.radius, 8);
  const panel = (extra: React.CSSProperties = {}) => {
    const base: React.CSSProperties = { background: p.panel, borderRadius: r };
    if (m.id === "broadsheet" || m.id === "swiss") return { ...base, background: "transparent", borderTop: `${m.id === "swiss" ? 2 : 1}px solid ${p.line}`, ...extra };
    if (m.id === "blueprint") return { ...base, border: `1px dashed ${p.line}`, ...extra };
    if (m.id === "cockpit") return { ...base, border: `1px solid ${p.line}`, boxShadow: `inset 3px 3px 0 -2px ${p.accent}, inset -3px -3px 0 -2px ${p.accent}`, ...extra };
    if (m.id === "zen") return { ...base, boxShadow: "0 4px 10px -6px rgba(60,50,30,.35)", ...extra };
    return { ...base, border: `1px solid ${p.line}`, ...extra };
  };
  const bento = ["#ff7a59", "#60a5fa", "#a78bfa", "#4ade80"];
  const bg: React.CSSProperties = { background: p.bg };
  if (p.pattern === "grid") { bg.backgroundImage = `linear-gradient(${p.line} 1px, transparent 1px), linear-gradient(90deg, ${p.line} 1px, transparent 1px)`; bg.backgroundSize = "10px 10px"; }
  if (p.pattern === "ruled") bg.backgroundImage = "linear-gradient(90deg, transparent 9px, rgba(163,38,42,.45) 9px 10px, transparent 10px), repeating-linear-gradient(180deg, transparent 0 6px, rgba(46,94,70,.16) 6px 7px)";
  if (p.pattern === "blobs") bg.backgroundImage = "radial-gradient(40% 60% at 15% 20%, rgba(124,58,237,.8), transparent 70%), radial-gradient(40% 60% at 90% 10%, rgba(8,145,178,.75), transparent 70%), radial-gradient(50% 60% at 60% 100%, rgba(219,39,119,.55), transparent 70%)";
  return (
    <div aria-hidden className="relative flex h-[104px] flex-col overflow-hidden rounded-[6px]" style={{ ...bg, color: p.fg, fontFamily: p.font }}>
      {nav === "masthead" ? (
        <div className="px-2 pt-1 text-center" style={{ borderBottom: `2px double ${p.fg}` }}>
          <div className="text-[11px] leading-none" style={{ fontFamily: "var(--font-display-serif), Georgia, serif" }}>YouBank</div>
          <div className="mt-0.5 flex justify-center gap-1.5 pb-0.5 text-[5.5px] uppercase tracking-wider" style={{ color: p.muted }}><span style={{ color: p.accent }}>Home</span><span>Book</span><span>Edge</span><span>News</span></div>
        </div>
      ) : nav !== "hidden" && nav !== "dock" ? (
        <div className="flex h-3.5 items-center gap-1 px-1.5" style={{ borderBottom: `${m.id === "swiss" ? 2 : 1}px solid ${m.id === "swiss" ? p.fg : p.line}` }}>
          <span className="h-1.5 w-5 rounded-[1px]" style={{ background: p.fg, opacity: 0.85 }} />
          {nav === "topbar" && [0, 1, 2, 3].map((i) => <span key={i} className="h-1 w-3 rounded-[1px]" style={{ background: i === 0 ? p.accent : p.muted, opacity: i === 0 ? 1 : 0.5 }} />)}
        </div>
      ) : m.id === "glass" ? (
        <div className="mx-1.5 mt-1 flex h-3 items-center gap-1 rounded-[5px] px-1.5" style={{ background: "rgba(255,255,255,.12)", border: `1px solid ${p.line}` }}><span className="h-1 w-5 rounded-full" style={{ background: p.fg }} /></div>
      ) : (
        <div className="flex h-3 items-center px-1.5"><span className="h-1 w-5 rounded-full" style={{ background: p.fg, opacity: 0.7 }} /></div>
      )}
      <div className="flex min-h-0 flex-1 gap-1 p-1.5">
        {nav === "rail" && (
          <div className="flex w-7 flex-col gap-[3px] pr-1" style={{ borderRight: `2px solid ${p.fg}` }}>
            {[0, 1, 2, 3, 4].map((i) => <span key={i} className="h-1 rounded-[1px]" style={{ background: i === 1 ? p.accent : p.fg, opacity: i === 1 ? 1 : 0.75 }} />)}
          </div>
        )}
        <div className={`grid min-w-0 flex-1 gap-1 ${m.chrome.centered ? "mx-auto max-w-[70%] grid-cols-1" : "grid-cols-3"}`}>
          {(m.chrome.centered ? [0, 1] : [0, 1, 2, 3, 4, 5]).map((i) => (
            <div key={i} className="flex flex-col justify-between p-1" style={panel(m.id === "bento" ? { background: `color-mix(in srgb, ${bento[i % 4]} 30%, ${p.panel})`, border: "none" } : i === 0 && !m.chrome.centered ? { gridColumn: "span 2" } : {})}>
              <span className="h-1 w-2/3 rounded-full" style={{ background: p.muted, opacity: 0.7 }} />
              <span className="h-1.5 w-1/2 rounded-[1px]" style={{ background: i === 0 ? p.accent : p.fg, opacity: i === 0 ? 1 : 0.55 }} />
            </div>
          ))}
        </div>
      </div>
      {nav === "dock" && (
        <div className="mx-auto mb-1 flex gap-[3px] rounded-[6px] p-[3px]" style={{ background: m.id === "glass" ? "rgba(255,255,255,.14)" : p.panel, border: `1px solid ${p.line}` }}>
          {[0, 1, 2, 3, 4].map((i) => <span key={i} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: i === 0 ? p.accent : p.muted, opacity: i === 0 ? 1 : 0.45 }} />)}
        </div>
      )}
      {m.chrome.statusStrip && (
        <div className="flex h-2.5 items-center gap-1.5 px-1.5" style={{ borderTop: `1px solid ${p.line}`, background: "rgba(0,0,0,.08)" }}>
          <span className="h-1 w-1 rounded-full" style={{ background: p.accent }} /><span className="h-[3px] w-6 rounded-full" style={{ background: p.muted, opacity: 0.6 }} /><span className="ml-auto h-[3px] w-4 rounded-full" style={{ background: p.muted, opacity: 0.6 }} />
        </div>
      )}
    </div>
  );
}

export function InterfacePicker() {
  const { look, setLook, profile } = useWorkspace();
  const suggested = suggestedInterface(profile.role);
  return (
    <div role="radiogroup" aria-label="Interface" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {interfacesFor(profile.role).map((m) => {
        const on = look.ui === m.id;
        return (
          <button key={m.id} type="button" role="radio" aria-checked={on} onClick={() => setLook({ ui: m.id })}
            className={`group ctl border p-2 text-left transition-[border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line hover:border-accent/50"}`}>
            <Preview m={m} />
            <div className="mt-2 flex items-center gap-2 px-0.5">
              <span className="text-[13px] font-semibold">{m.name}</span>
              {m.id === suggested && <span className="ctl bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">Made for your role</span>}
              {on && <span className="ml-auto text-[10.5px] font-semibold text-accent">In use</span>}
            </div>
            <p className="mt-0.5 px-0.5 text-[11.5px] leading-snug text-muted">{m.tagline}</p>
            <p className="mt-1 px-0.5 text-[10.5px] text-faint">Suits: {m.suits}</p>
          </button>
        );
      })}
    </div>
  );
}
