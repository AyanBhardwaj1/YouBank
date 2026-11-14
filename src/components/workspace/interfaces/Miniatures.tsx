/**
 * The live miniatures in Settings → Style → Interface (InterfacePicker): each interface drawn small in
 * its own colours and, more to the point, its own structure (where the navigation is, what Home is) with
 * its signature moving: Classic's sliding tab, Bare's caret, Spectacle's aurora and orb, Prompt's messages
 * arriving, Canvas's board panning, Broadsheet's columns, Cockpit's radar sweep, Glass's dock swelling,
 * Swiss's red rule, Ledger's page turning, Blueprint's lines drawing in, Zen's breath, Bento's tiles
 * popping. Pure CSS and SVG, no script: they play while hovered or focused and for the one in use, and
 * hold still otherwise and under reduced motion (src/app/interfaces/base.css .ybm).
 */
import type { CSSProperties } from "react";
import { INTERFACE_META, type InterfaceId } from "@/lib/desk/interfaces";

const loop = (name: string, s: number, delay = 0, ease = "ease-in-out"): CSSProperties => ({ animation: `${name} ${s}s ${ease} ${delay}s infinite` });
const bar = (w: number | string, c: string, h = 3, o = 1): CSSProperties => ({ width: w, height: h, background: c, opacity: o, borderRadius: 2 });

function Lines({ n, c, w = [90, 72, 84, 60], h = 2, gap = 3 }: { n: number; c: string; w?: number[]; h?: number; gap?: number }) {
  return <div className="flex flex-col" style={{ gap }}>{Array.from({ length: n }, (_, i) => <span key={i} style={bar(`${w[i % w.length]}%`, c, h, 0.55)} />)}</div>;
}

export function Miniature({ id }: { id: InterfaceId }) {
  const p = INTERFACE_META[id].preview;
  const base: CSSProperties = { background: p.bg, color: p.fg, fontFamily: p.font };
  switch (id) {
    case "classic":
      return (
        <div className="ybm" style={base}>
          <div className="flex h-4 items-center gap-1.5 px-2" style={{ borderBottom: `1px solid ${p.line}` }}>
            <span style={bar(14, p.fg, 3, 0.8)} />
            <span className="relative ml-1 flex gap-1.5">
              <span className="absolute -inset-y-[3px] left-[-3px] w-[22px] rounded-[2px]" style={{ background: "rgba(245,166,35,.18)", ...loop("ybm-slide", 3.2), ["--ybm-x" as string]: "22px" }} />
              {[0, 1, 2, 3].map((i) => <span key={i} className="relative" style={bar(16, i === 0 ? p.accent : p.muted, 2, i === 0 ? 1 : 0.6)} />)}
            </span>
          </div>
          <div className="grid h-[108px] grid-cols-3 gap-1.5 p-2">
            <div className="col-span-2 flex flex-col gap-1.5">
              {[0, 1, 2].map((i) => <div key={i} className="flex-1 rounded-[2px] p-1.5" style={{ background: p.panel, border: `1px solid ${p.line}` }}><Lines n={2} c={i === 0 ? p.accent : p.muted} /></div>)}
            </div>
            <div className="flex flex-col gap-1.5">{[0, 1].map((i) => <div key={i} className="flex-1 rounded-[2px] p-1.5" style={{ background: p.panel, border: `1px solid ${p.line}` }}><Lines n={3} c={p.muted} /></div>)}</div>
          </div>
        </div>
      );
    case "bare":
      return (
        <div className="ybm px-3 py-2" style={{ ...base, fontSize: 8 }}>
          <div className="flex gap-2 pb-1" style={{ borderBottom: `1px solid ${p.fg}` }}>
            <b>youbank</b>{["home", "book", "terminal", "news"].map((t, i) => <span key={t} style={{ color: i === 0 ? p.fg : p.accent, textDecoration: i === 0 ? "none" : "underline", fontWeight: i === 0 ? 700 : 400 }}><span style={{ color: p.muted }}>{i + 1}</span> {t}</span>)}
          </div>
          <div className="mx-auto mt-2 w-[78%]">
            <div style={{ fontSize: 11, fontWeight: 700 }}>Good evening.<span style={{ ...loop("ybm-blink", 1, 0, "steps(1)"), color: p.accent }}>▍</span></div>
            <div className="mt-1" style={{ color: p.muted }}>3 waiting · next: 2:00 call</div>
            <div className="mt-2" style={{ color: p.muted }}>## Watchlist</div>
            <div className="mt-1"><Lines n={3} c={p.fg} w={[96, 80, 88]} /></div>
            <div className="mt-2" style={{ color: p.muted }}>## Coming up</div>
          </div>
        </div>
      );
    case "spectacle":
      return (
        <div className="ybm" style={base}>
          <div className="absolute -inset-[30%]" style={{ background: "radial-gradient(30% 35% at 30% 35%, rgba(139,92,246,.75), transparent 70%), radial-gradient(28% 30% at 72% 30%, rgba(34,211,238,.5), transparent 70%), radial-gradient(30% 30% at 55% 80%, rgba(236,72,153,.45), transparent 70%)", ...loop("ybm-aurora", 7) }} />
          <div className="relative px-3 pt-4">
            <div style={{ fontSize: 7, letterSpacing: "0.3em", color: p.muted }}>SATURDAY</div>
            <div className="mt-1 font-bold leading-[0.95]" style={{ fontSize: 21, letterSpacing: "-0.04em", background: "linear-gradient(100deg,#f0abfc,#c4b5fd,#7dd3fc,#6ee7b7)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Good<br />evening.</div>
            <div className="mt-2 flex gap-1.5">{[0, 1, 2].map((i) => <span key={i} className="h-7 w-11 rounded-[6px]" style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.18)", transform: `perspective(80px) rotateY(${(i - 1) * -10}deg)` }} />)}</div>
          </div>
          <span className="absolute bottom-2 left-1/2 -ml-[9px] h-[18px] w-[18px] rounded-full" style={{ background: "radial-gradient(circle at 32% 28%, #fff, #a78bfa 50%, #3b0764)", ["--ybm-glow" as string]: "rgba(167,139,250,.7)", ...loop("ybm-pulse", 2.4) }} />
        </div>
      );
    case "prompt":
      return (
        <div className="ybm flex flex-col px-3 pt-2" style={{ ...base, fontSize: 7.5 }}>
          <div className="mx-auto flex w-[82%] flex-1 flex-col gap-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-1.5" style={loop("ybm-rise", 4.5, i * 0.6)}>
                <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: "linear-gradient(140deg, #e8b974, #a8742c)" }} />
                <div className="flex-1 rounded-[6px] p-1.5" style={{ background: i === 0 ? "transparent" : p.panel }}>{i === 0 ? <span style={{ fontSize: 9 }}>Good evening. Here’s your day.</span> : <Lines n={2} c={i === 1 ? p.accent : p.muted} />}</div>
              </div>
            ))}
          </div>
          <div className="mx-auto mb-2 flex w-[86%] items-center gap-1 rounded-[8px] px-2 py-1" style={{ background: "#1c1b19", border: `1px solid ${p.accent}` }}>
            <span style={{ color: p.muted }}>Go anywhere or ask…</span><span style={{ ...loop("ybm-blink", 1, 0, "steps(1)"), color: p.accent }}>▍</span>
            <span className="ml-auto h-2.5 w-2.5 rounded-[3px]" style={{ background: p.accent }} />
          </div>
        </div>
      );
    case "canvas":
      return (
        <div className="ybm" style={{ ...base, backgroundImage: "radial-gradient(#c9c9c2 1px, transparent 1.2px)", backgroundSize: "8px 8px" }}>
          <div className="absolute left-1.5 top-2 flex flex-col gap-1 rounded-[5px] bg-white p-1 shadow-[0_0_0_1px_#e1e1dc]">{[0, 1, 2, 3].map((i) => <span key={i} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: i === 0 ? p.accent : "#e4e4e0" }} />)}</div>
          <div className="absolute left-9 top-3 w-[150%]" style={loop("ybm-pan", 6)}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "-0.03em" }}>Good evening.</div>
            <div className="mt-1.5 flex gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-[54px]">
                  <div style={{ fontSize: 5.5, color: i === 1 ? p.accent : p.muted }}>◇ Frame {i + 1}</div>
                  <div className="mt-0.5 rounded-[4px] bg-white p-1" style={{ height: 34 + i * 6, boxShadow: i === 1 ? `0 0 0 1px ${p.accent}` : `0 0 0 1px ${p.line}` }}><Lines n={3} c={p.muted} /></div>
                </div>
              ))}
              <div className="h-9 w-12 -rotate-2 rounded-[2px] p-1" style={{ background: "#fff4b8" }}><Lines n={2} c="#7a6a2a" /></div>
            </div>
          </div>
          <div className="absolute bottom-1.5 right-1.5 h-6 w-9 rounded-[3px] bg-white p-[2px] shadow-[0_0_0_1px_#e1e1dc]"><span className="block h-full w-1/2 rounded-[1px]" style={{ border: `1px solid ${p.accent}` }} /></div>
        </div>
      );
    case "broadsheet":
      return (
        <div className="ybm px-2.5 pt-1" style={base}>
          <div className="text-center leading-none" style={{ fontFamily: "var(--font-display-serif), Georgia, serif", fontSize: 17 }}>YouBank</div>
          <div className="mt-0.5 flex justify-center gap-2 py-[2px]" style={{ borderTop: `1px solid ${p.fg}`, borderBottom: `2px double ${p.fg}`, fontSize: 5, letterSpacing: "0.12em" }}>{["HOME", "BOOK", "MARKETS", "NEWS"].map((s, i) => <span key={s} style={{ color: i === 0 ? p.accent : p.fg }}>{s}</span>)}</div>
          <div className="mt-1.5 text-center" style={{ fontFamily: "var(--font-display-serif), Georgia, serif", fontSize: 14, lineHeight: 1 }}>Good evening, Avery.</div>
          <div className="mt-1.5 grid grid-cols-[7fr_5fr] gap-0" style={{ borderTop: `1px solid ${p.fg}` }}>
            <div className="flex gap-1 pr-1.5 pt-1"><span className="font-serif" style={{ fontSize: 15, lineHeight: 0.8, color: p.accent }}>T</span><Lines n={5} c={p.fg} /></div>
            <div className="pl-1.5 pt-1" style={{ borderLeft: `1px solid ${p.line}` }}><Lines n={5} c={p.fg} w={[80, 92, 70, 86]} /></div>
          </div>
        </div>
      );
    case "cockpit":
      return (
        <div className="ybm grid grid-cols-[1fr_1.1fr] gap-2 p-2" style={base}>
          <div className="relative aspect-square self-center rounded-full" style={{ border: `1px solid ${p.line}` }}>
            <span className="absolute inset-[3px] rounded-full" style={{ background: "conic-gradient(from 0deg, transparent 0 270deg, rgba(34,211,238,.45) 359deg, #22d3ee 360deg)", ...loop("ybm-spin", 2.6, 0, "linear") }} />
            <span className="absolute inset-[30%] rounded-full" style={{ border: `1px dashed ${p.line}` }} />
            {[[30, 25, "#4ade80"], [68, 40, "#fb7185"], [45, 72, "#4ade80"], [22, 60, "#4ade80"]].map(([x, y, c], i) => <span key={i} className="absolute h-1.5 w-1.5 rounded-full" style={{ left: `${x}%`, top: `${y}%`, background: c as string, boxShadow: `0 0 6px ${c}` }} />)}
          </div>
          <div className="flex flex-col justify-center gap-1.5" style={{ fontSize: 7 }}>
            <div style={{ fontSize: 17, fontWeight: 300, letterSpacing: "-0.02em", textShadow: "0 0 10px rgba(34,211,238,.5)" }}>18:42:07</div>
            {[0.7, 0.4, 0.85].map((w, i) => <div key={i} className="p-1" style={{ border: `1px solid ${p.line}` }}><span className="block" style={{ ...bar(`${w * 100}%`, i === 1 ? "#fb7185" : p.accent, 2), boxShadow: `0 0 6px ${p.accent}` }} /></div>)}
          </div>
        </div>
      );
    case "glass":
      return (
        <div className="ybm" style={{ ...base, background: "radial-gradient(45% 55% at 15% 20%, rgba(124,58,237,.85), transparent 70%), radial-gradient(40% 50% at 90% 10%, rgba(8,145,178,.8), transparent 70%), radial-gradient(50% 55% at 60% 100%, rgba(219,39,119,.6), transparent 70%), #120d26" }}>
          <div className="flex h-2.5 items-center gap-1.5 px-1.5" style={{ background: "rgba(18,13,38,.45)", fontSize: 5 }}><b>YouBank</b><span>Home</span><span>Book</span><span className="ml-auto">Sat 18:42</span></div>
          <div className="mx-auto mt-2 w-[74%] overflow-hidden rounded-[5px]" style={{ background: "rgba(36,28,76,.8)", border: "1px solid rgba(255,255,255,.18)", boxShadow: "0 10px 20px -8px rgba(0,0,0,.6)" }}>
            <div className="flex h-2.5 items-center gap-[2px] px-1" style={{ background: "rgba(255,255,255,.05)" }}>{["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} className="h-1 w-1 rounded-full" style={{ background: c }} />)}</div>
            <div className="p-1.5"><Lines n={4} c={p.fg} /></div>
          </div>
          <div className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-end gap-[3px] rounded-[6px] px-1 py-[3px]" style={{ background: "rgba(255,255,255,.14)", border: "1px solid rgba(255,255,255,.2)" }}>
            {[0, 1, 2, 3, 4].map((i) => <span key={i} className="h-3 w-3 origin-bottom rounded-[3px]" style={{ background: i === 2 ? "linear-gradient(160deg,#7dd3fc,#6366f1)" : "rgba(255,255,255,.3)", ...(i === 2 ? loop("ybm-mag", 2) : i === 1 || i === 3 ? loop("ybm-mag", 2, 0.05) : {}) }} />)}
          </div>
        </div>
      );
    case "swiss":
      return (
        <div className="ybm flex" style={base}>
          <div className="flex w-[22%] flex-col gap-1 py-2 pl-1.5 pr-1" style={{ borderRight: `2px solid ${p.fg}`, fontSize: 5.5, fontWeight: 700 }}>
            {["Home", "Book", "Terminal", "News"].map((t, i) => <span key={t} style={{ color: i === 0 ? p.accent : p.fg, borderBottom: `1px solid ${p.line}` }}><span style={{ color: i === 0 ? p.accent : p.muted }}>0{i + 1}</span> {t}</span>)}
          </div>
          <div className="flex-1 p-2">
            <div className="flex items-end gap-2">
              <span style={{ fontSize: 46, fontWeight: 800, letterSpacing: "-0.08em", lineHeight: 0.74 }}>14</span>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>Good<br />evening.</span>
            </div>
            <span className="mt-1.5 block h-1 origin-left" style={{ background: p.accent, ...loop("ybm-wipe", 3, 0, "cubic-bezier(.7,0,.2,1)") }} />
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">{[0, 1, 2].map((i) => <div key={i} className={i === 0 ? "col-span-2" : ""} style={{ borderTop: `2px solid ${p.fg}`, paddingTop: 2 }}><Lines n={2} c={p.fg} /></div>)}</div>
          </div>
        </div>
      );
    case "ledger":
      return (
        <div className="ybm p-2" style={{ ...base, background: "radial-gradient(120% 90% at 50% 30%, #4a3424, #2a1d14 70%)" }}>
          <div className="relative mx-auto grid h-full w-[86%] grid-cols-2 overflow-visible rounded-[2px]" style={{ background: "#f6f9ef", boxShadow: "0 8px 16px -6px rgba(0,0,0,.7)", perspective: 300 }}>
            {[0, 1].map((side) => (
              <div key={side} className="p-1.5" style={{ backgroundImage: "repeating-linear-gradient(180deg, transparent 0 5px, rgba(46,94,70,.18) 5px 6px)", boxShadow: side ? "inset 6px 0 6px -4px rgba(0,0,0,.25)" : "inset -6px 0 6px -4px rgba(0,0,0,.25)" }}>
                <div style={{ fontSize: 6, fontStyle: "italic", color: p.muted, borderBottom: `2px double ${p.muted}` }}>{side ? "Journal" : "Accounts"}</div>
              </div>
            ))}
            <div className="absolute inset-y-0 right-0 w-1/2 origin-left" style={{ background: "#eef3e4", boxShadow: "0 0 6px rgba(0,0,0,.25)", backfaceVisibility: "hidden", ...loop("ybm-turn", 4) }} />
            <div className="absolute -right-2 top-2 flex flex-col gap-[2px]">{["#8f2b2b", "#2e5e45", "#8a6418"].map((c) => <span key={c} className="h-3 w-2 rounded-r-[2px]" style={{ background: c }} />)}</div>
          </div>
        </div>
      );
    case "blueprint":
      return (
        <div className="ybm flex flex-col" style={{ ...base, backgroundImage: "linear-gradient(rgba(230,240,255,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(230,240,255,.12) 1px, transparent 1px)", backgroundSize: "10px 10px" }}>
          <svg className="flex-1" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden>
            <rect x="8" y="8" width="184" height="86" fill="none" stroke="rgba(230,240,255,.6)" strokeWidth="0.8" />
            {[[16, 18, 100, 40], [124, 18, 60, 40], [16, 64, 168, 24]].map(([x, y, w, h], i) => (
              <rect key={i} x={x} y={y} width={w} height={h} fill="none" stroke={i === 0 ? p.accent : "rgba(230,240,255,.75)"} strokeWidth="1" strokeDasharray="1" pathLength={1} style={loop("ybm-draw", 3.6, i * 0.3, "cubic-bezier(.6,0,.2,1)")} />
            ))}
            <line x1="16" x2="116" y1="13" y2="13" stroke="rgba(230,240,255,.5)" strokeWidth="0.5" />
          </svg>
          <div className="flex gap-0 px-1.5" style={{ fontSize: 5, borderTop: "1px solid rgba(230,240,255,.6)" }}>{["01 HOME", "02 BOOK", "03 TERM"].map((t, i) => <span key={t} className="px-1 py-[1px]" style={{ border: `1px ${i ? "dashed" : "solid"} ${i ? "rgba(230,240,255,.4)" : p.accent}`, borderTop: 0, color: i ? p.muted : p.accent }}>{t}</span>)}</div>
        </div>
      );
    case "zen":
      return (
        <div className="ybm flex flex-col items-center justify-center" style={base}>
          <span className="h-7 w-7 rounded-full" style={{ background: "radial-gradient(circle at 40% 35%, rgba(79,122,90,.45), rgba(79,122,90,.1) 70%)", ...loop("ybm-breathe", 4) }} />
          <div className="mt-2" style={{ fontSize: 13, fontFamily: "var(--font-newsreader), Georgia, serif" }}>Good evening.</div>
          <span className="mt-2" style={bar(90, p.muted, 1, 0.5)} />
          <div className="mt-3 w-[46%]"><Lines n={2} c={p.muted} /></div>
        </div>
      );
    case "bento":
      return (
        <div className="ybm grid grid-cols-4 grid-rows-3 gap-1 p-1.5" style={base}>
          {[
            { c: "linear-gradient(150deg,#ff7a59,#ff4d8d 60%,#a78bfa)", s: "col-span-2 row-span-2" },
            { c: "#60a5fa", s: "" }, { c: "#facc15", s: "" }, { c: "#4ade80", s: "" }, { c: "#a78bfa", s: "" },
            { c: "#1c1a22", s: "col-span-2" }, { c: "#24212c", s: "col-span-2" },
          ].map((t, i) => <span key={i} className={`rounded-[7px] ${t.s}`} style={{ background: t.c, ...loop("ybm-pop", 3, i * 0.12) }} />)}
        </div>
      );
  }
}
