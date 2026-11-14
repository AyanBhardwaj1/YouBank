"use client";

/**
 * Cockpit's Home: an instrument cluster. On the left a radar with a blip for each name on the watchlist,
 * placed round the dial in the list's order and out from the centre by how far it moved today (up green,
 * down red); each blip flares as the sweep passes it. On the right the time in large digits, the session
 * and the greeting, and four gauges (names reporting, advancers against decliners, the biggest move,
 * decisions waiting). Below, the widgets as numbered channels. The data is the same the widgets use
 * (the shared company store, the inbox count), so nothing is fetched twice.
 */
import { useMemo } from "react";
import { useCompanies } from "@/lib/client/companies";
import { useWaiting } from "@/lib/client/waiting";
import { biggestMover } from "@/lib/desk/day-line";
import { isWide } from "@/lib/desk/desk";
import { EXCHANGES, marketStatus, until } from "@/lib/desk/markets";
import { fmtChange } from "@/lib/market/units";
import { useWorkspace } from "../../WorkspaceProvider";
import { DayLine } from "../../home/DayLine";
import { ArrangeOrEmpty, AskBox, HomeTools, useHello, WidgetIn, type HomeProps } from "../../home/Kit";
import { useClock } from "../shared";

const NYSE = EXCHANGES.find((e) => e.id === "nyse")!;
const SWEEP_S = 4;

/** Where a name sits on the radar: round the dial by its place in the list, out by its move (5% is the rim). Pure. */
export function blip(i: number, n: number, changePct: number): { x: number; y: number; delay: number } {
  const theta = (i / Math.max(1, n)) * 2 * Math.PI + 0.3;
  const r = 14 + Math.min(1, Math.abs(changePct) / 5) * 70;
  return { x: Math.sin(theta) * r, y: -Math.cos(theta) * r, delay: ((theta / (2 * Math.PI)) % 1) * SWEEP_S };
}

function Radar() {
  const { config } = useWorkspace();
  const { data } = useCompanies(config.watchlist);
  const names = config.watchlist.map((t) => ({ t, c: data[t]?.price?.changePct })).filter((r): r is { t: string; c: number } => typeof r.c === "number");
  return (
    <div className="ck-radar" role="img" aria-label={names.length ? `Radar of today's moves: ${names.map((r) => `${r.t} ${fmtChange(r.c)}`).join(", ")}` : "Radar: waiting for prices"}>
      <div className="ck-sweep" aria-hidden />
      <svg viewBox="-100 -100 200 200" className="absolute inset-0 h-full w-full" aria-hidden>
        {[30, 55, 84].map((r) => <circle key={r} r={r} fill="none" stroke="var(--line-strong)" strokeWidth={0.6} strokeDasharray={r === 84 ? undefined : "2 3"} />)}
        <line x1={-92} x2={92} y1={0} y2={0} stroke="var(--line)" strokeWidth={0.5} />
        <line y1={-92} y2={92} x1={0} x2={0} stroke="var(--line)" strokeWidth={0.5} />
        {[0, 1, 2, 3].map((q) => <text key={q} x={[0, 88, 0, -88][q]} y={[-88, 2, 94, 2][q]} fontSize={6} fill="var(--muted)" textAnchor="middle">{["0%", "", "5%", ""][q]}</text>)}
        {names.map((r, i) => {
          const b = blip(i, names.length, r.c);
          const tone = r.c >= 0 ? "var(--pos)" : "var(--neg)";
          return (
            <g key={r.t}>
              <circle cx={b.x} cy={b.y} r={3.2} fill={tone} className="ck-blip" style={{ animationDelay: `${b.delay}s` }} />
              <text x={b.x + 5} y={b.y + 2} fontSize={6.5} fill="var(--fg)" fontFamily="var(--font-mono)">{r.t}</text>
            </g>
          );
        })}
        <circle r={2} fill="var(--accent)" />
      </svg>
    </div>
  );
}

function Gauges() {
  const { config } = useWorkspace();
  const { data } = useCompanies(config.watchlist);
  const waiting = useWaiting();
  const g = useMemo(() => {
    const moves = config.watchlist.map((t) => data[t]?.price?.changePct).filter((v): v is number => typeof v === "number");
    const up = moves.filter((v) => v > 0).length;
    const mover = biggestMover(config.watchlist.map((t) => ({ ticker: t, changePct: data[t]?.price?.changePct })));
    return { names: config.watchlist.length, live: moves.length, up, down: moves.length - up, mover };
  }, [config.watchlist, data]);
  const cell = (label: string, value: string, fill: number, tone = "var(--accent)") => (
    <div className="ck-gauge">
      <span>{label}</span>
      <b className="num">{value}</b>
      <div className="ck-bar"><i style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, fill))})`, background: tone }} /></div>
    </div>
  );
  return (
    <div className="ck-gauges">
      {cell("Names live", `${g.live}/${g.names}`, g.names ? g.live / g.names : 0)}
      {cell("Adv / dec", `${g.up}/${g.down}`, g.live ? g.up / g.live : 0.5, g.up >= g.down ? "var(--pos)" : "var(--neg)")}
      {cell("Max move", g.mover ? `${g.mover.ticker} ${fmtChange(g.mover.changePct)}` : "—", g.mover ? Math.abs(g.mover.changePct) / 5 : 0, g.mover && g.mover.changePct < 0 ? "var(--neg)" : "var(--pos)")}
      {cell("Waiting", waiting === null ? "—" : String(waiting), waiting ? Math.min(1, waiting / 10) : 0, "var(--info)")}
    </div>
  );
}

export default function InstrumentsHome({ widgets, facts, brief, arranging, setArranging }: HomeProps) {
  const { hello, name, today } = useHello();
  const now = useClock(1000);
  const s = now ? marketStatus(NYSE, now) : null;
  return (
    <div className="home-wall h-full overflow-auto">
      <div className="ck-hud">
        <div className="ck-top">
          <Radar />
          <div className="flex min-w-0 flex-col justify-between gap-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[10.5px] uppercase tracking-[0.2em] text-muted">{today} · local</div>
                <div className="ck-readout num" aria-live="off">{now ? now.toLocaleTimeString("en-US", { hour12: false }) : "--:--:--"}</div>
                <div className="mt-2 text-[11px] uppercase tracking-[0.14em]">
                  <span className={s?.state === "open" ? "text-pos" : "text-muted"}>● NYSE {s ? (s.state === "open" ? "open" : "closed") : "…"}</span>
                  {s?.next && now && <span className="text-muted"> · {s.nextIs} in {until(s.next, now)}</span>}
                </div>
              </div>
              <HomeTools arranging={arranging} onArrange={() => setArranging(!arranging)} item="flex items-center gap-1 border border-line px-2 py-1 text-[10.5px] uppercase tracking-[0.12em] text-muted hover:border-accent hover:text-accent" />
            </div>
            <div>
              <h1>{hello}{name}</h1>
              <DayLine className="mt-1 uppercase tracking-[0.06em]" />
            </div>
            <Gauges />
            <AskBox className="flex items-center gap-2 border border-line-strong bg-panel px-3 py-2 focus-within:border-accent focus-within:shadow-[var(--glow)]" placeholder="QUERY> a company, a deal, a number…"
              inputClass="min-w-0 flex-1 bg-transparent text-[13px] uppercase tracking-[0.04em] text-fg outline-none placeholder:text-faint" label="Exec" />
          </div>
        </div>
        <ArrangeOrEmpty widgets={widgets} arranging={arranging} setArranging={setArranging} className="mt-5" />
        <div className="ck-channels">
          {widgets.map((w) => <div key={w.id} className={`ck-ch ${isWide(w) ? "ck-wide" : "yb-narrow"}`}><WidgetIn w={w} facts={facts} brief={brief} /></div>)}
        </div>
      </div>
    </div>
  );
}
