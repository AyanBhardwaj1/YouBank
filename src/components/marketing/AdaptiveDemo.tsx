"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { ANGLES, TRUST, eStep, scoreSend, trustState, type Angle } from "@/lib/crm/engine-rules";
import { logGamma, probabilityBest, seededRng, thompson, type Posterior } from "@/lib/crm/learning-math";

/**
 * The adaptive engine, running live in the browser on the same code the product runs: the Beta
 * posterior behind earned autonomy, and Thompson sampling behind outreach experiments.
 */

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * A Beta density as an SVG path over [0, 1]. The height is scaled to the peak, but never to less than
 * `floor`, so a flat belief draws as a low band that rises as evidence arrives, not a full block.
 */
function densityPath(p: Posterior, w: number, h: number, floor = 1e-9): { d: string; peak: number } {
  const lnB = logGamma(p.alpha) + logGamma(p.beta) - logGamma(p.alpha + p.beta);
  const xs = Array.from({ length: 161 }, (_, i) => 0.0005 + (i / 160) * 0.999);
  const ys = xs.map((x) => Math.exp((p.alpha - 1) * Math.log(x) + (p.beta - 1) * Math.log(1 - x) - lnB));
  const peak = Math.max(...ys, floor);
  const pts = xs.map((x, i) => `${(x * w).toFixed(1)},${(h - (ys[i] / peak) * (h - 6)).toFixed(1)}`);
  return { d: `M0,${h} L${pts.join(" L")} L${w},${h} Z`, peak };
}

/* ---------------- Earned autonomy ---------------- */

type Outcome = "unchanged" | "light" | "rewrite";

type Counts = { good: number; bad: number; observations: number; eprocess: number };
const EMPTY: Counts = { good: 0, bad: 0, observations: 0, eprocess: 1 };

function EarnedAutonomy() {
  const [c, setC] = useState<Counts>(EMPTY);
  const [playing, setPlaying] = useState(false);
  const rng = useRef(seededRng(2026));

  const add = (o: Outcome) => {
    const s = scoreSend(o === "unchanged" ? 0 : o === "light" ? 0.15 : 0.7);
    setC((x) => ({ good: x.good + (s.good ? 1 : 0), bad: x.bad + (s.good ? 0 : 1), observations: x.observations + 1, eprocess: eStep(x.eprocess, !s.good) }));
  };
  const reset = () => { setC(EMPTY); setPlaying(false); rng.current = seededRng(2026); };

  // Autoplay: a person who sends 96% of these drafts unchanged, 3% lightly edited, 1% rewritten.
  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => {
      if (c.observations >= 40) { setPlaying(false); return; }
      const r = rng.current();
      add(r < 0.96 ? "unchanged" : r < 0.99 ? "light" : "rewrite");
    }, 320);
    return () => window.clearTimeout(id);
  });

  const n = c.observations, unchanged = c.good;
  const post: Posterior = { alpha: 1 + c.good, beta: 1 + c.bad };
  const t = trustState(c);
  const bar = 1 - TRUST.certifyBadRate;
  const W = 520, H = 150;
  const { d } = useMemo(() => densityPath(post, W, H, 6), [post.alpha, post.beta]); // eslint-disable-line react-hooks/exhaustive-deps
  const tone = t.state === "trusted" ? "var(--pos)" : t.state === "probation" ? "var(--neg)" : "var(--chart-1)";
  const label = t.state === "trusted" ? "Earned autopilot" : t.state === "probation" ? "On probation: autopilot hands these back" : "Learning";

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="panel p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-[13px] font-semibold">Replies to prospects the agent rates “high confidence”</h4>
          <span className="ctl px-2 py-0.5 text-[11px] font-semibold" style={{ color: tone, background: "color-mix(in srgb, currentColor 14%, transparent)" }}>{label}</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H + 22}`} className="mt-3 w-full" role="img" aria-label={`Posterior probability of sending unchanged: mean ${pct(t.mean)}, 90% interval ${pct(t.lower)} to ${pct(t.upper)}`}>
          <rect x={t.lower * W} y={0} width={Math.max(1, (t.upper - t.lower) * W)} height={H} fill="var(--chart-1)" opacity={0.1} />
          <path d={d} fill={tone} opacity={0.22} stroke={tone} strokeWidth={1.5} />
          <line x1={bar * W} x2={bar * W} y1={0} y2={H} stroke="var(--pos)" strokeDasharray="4 4" strokeWidth={1.2} />
          <text x={bar * W - 4} y={12} textAnchor="end" fontSize={10} fill="var(--pos)">autopilot bar: 90% sure ≥ 90% good</text>
          <line x1={t.mean * W} x2={t.mean * W} y1={0} y2={H} stroke="var(--fg)" strokeWidth={1.5} />
          {[0, 0.25, 0.5, 0.75, 1].map((x) => <text key={x} x={x * W} y={H + 16} textAnchor={x === 0 ? "start" : x === 1 ? "end" : "middle"} fontSize={10} fill="var(--muted)">{pct(x)}</text>)}
        </svg>
        <p className="mt-1 text-[11px] text-muted">The curve is the engine&apos;s belief about how often you would send this kind of draft exactly as written. It starts flat, since only your own decisions count, and narrows with every one you make.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => add("unchanged")} className="ctl bg-fg px-2.5 py-1 text-[11.5px] font-semibold text-bg">Sent unchanged</button>
          <button type="button" onClick={() => add("light")} className="ctl border border-line px-2.5 py-1 text-[11.5px]">Light edit</button>
          <button type="button" onClick={() => add("rewrite")} className="ctl border border-line px-2.5 py-1 text-[11.5px]">Rewrote it</button>
          <button type="button" onClick={() => setPlaying((p) => !p)} className="ctl border border-accent/60 px-2.5 py-1 text-[11.5px] text-accent">{playing ? "Pause" : "Simulate a person"}</button>
          <button type="button" onClick={reset} className="text-[11.5px] text-muted hover:text-fg">Reset</button>
        </div>
      </div>
      <div className="panel p-4 text-[12px]">
        <dl className="grid grid-cols-2 gap-y-2">
          <dt className="text-muted">Decisions</dt><dd className="num text-right">{n}</dd>
          <dt className="text-muted">Sent unchanged</dt><dd className="num text-right">{unchanged}</dd>
          <dt className="text-muted">Estimate</dt><dd className="num text-right">{pct(t.mean)}</dd>
          <dt className="text-muted">90% interval</dt><dd className="num text-right">{pct(t.lower)}–{pct(t.upper)}</dd>
          <dt className="text-muted">Would need edits</dt><dd className="num text-right">≤ {pct(t.certifiedBadRate)}</dd>
        </dl>
        <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-muted">
          Autopilot is offered only when, after at least {TRUST.certifyMin} of your own decisions, the engine is {pct(TRUST.certifyConfidence)} confident at most {pct(TRUST.certifyBadRate)} would need your edits: about 22 clean drafts in a row. A light edit counts against it, as does any change to a number, date or link. Stop three automatic sends in a row, or start editing more, and it hands that kind of email back.
        </p>
      </div>
    </div>
  );
}

/* ---------------- Outreach experiments ---------------- */

// A simulated audience. The engine never sees these rates; it only sees replies. ("Why now" is left
// out here: in the product it is only offered for leads with a fresh Form D.)
type DemoAngle = Exclude<Angle, "why_now">;
const TRUE_RATES: Record<DemoAngle, number> = { insight: 0.06, question: 0.11, outcome: 0.035, brief: 0.08 };
const flat = (): Record<DemoAngle, Posterior> => ({ insight: { alpha: 1, beta: 1 }, question: { alpha: 1, beta: 1 }, outcome: { alpha: 1, beta: 1 }, brief: { alpha: 1, beta: 1 } });
const zero = (): Record<DemoAngle, number> => ({ insight: 0, question: 0, outcome: 0, brief: 0 });

function Outreach() {
  const [posts, setPosts] = useState(flat);
  const [pulls, setPulls] = useState(zero);
  const [wins, setWins] = useState(zero);
  const [reveal, setReveal] = useState(false);
  const rng = useRef(seededRng(7));

  const send = (k: number) => {
    const p = { ...posts }, u = { ...pulls }, w = { ...wins };
    for (let i = 0; i < k; i++) {
      const { arm } = thompson(p, rng.current);
      const replied = rng.current() < TRUE_RATES[arm];
      p[arm] = { alpha: p[arm].alpha + (replied ? 1 : 0), beta: p[arm].beta + (replied ? 0 : 1) };
      u[arm]++; if (replied) w[arm]++;
    }
    setPosts(p); setPulls(u); setWins(w);
  };
  const reset = () => { setPosts(flat()); setPulls(zero()); setWins(zero()); setReveal(false); rng.current = seededRng(7); };

  const sent = Object.values(pulls).reduce((a, b) => a + b, 0);
  const replies = Object.values(wins).reduce((a, b) => a + b, 0);
  const even = sent * (Object.values(TRUE_RATES).reduce((a, b) => a + b, 0) / 4);
  const best = useMemo(() => probabilityBest(posts, 1500, seededRng(sent + 1)), [posts, sent]);
  const max = Math.max(1, ...Object.values(pulls));

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[13px] font-semibold">Four ways to open a cold email, one simulated audience</h4>
        <span className="num text-[11.5px] text-muted">{sent} sent · {replies} replies{sent ? ` · an even split would expect about ${even.toFixed(1)}` : ""}</span>
      </div>
      <table className="mt-3 w-full font-sans text-[12px]">
        <thead>
          <tr className="text-left text-[10.5px] text-muted">
            <th className="pb-1 font-normal">Opening</th><th className="pb-1 font-normal">Emails sent (Thompson sampling decides)</th>
            <th className="pb-1 text-right font-normal">Replies</th><th className="pb-1 text-right font-normal">Chance it is best</th>
            {reveal && <th className="pb-1 text-right font-normal">True rate</th>}
          </tr>
        </thead>
        <tbody>
          {(Object.keys(TRUE_RATES) as DemoAngle[]).map((a) => (
            <tr key={a} className="border-t border-line">
              <td className="py-2 pr-2">{ANGLES[a].label}</td>
              <td className="py-2 pr-3">
                <span className="flex items-center gap-2">
                  <span className="block h-2.5 flex-1 overflow-hidden rounded-sm bg-elevated">
                    <span className="block h-full rounded-r-[4px] transition-all duration-500" style={{ width: `${(pulls[a] / max) * 100}%`, background: best[a] > 0.5 ? "var(--chart-emphasis, var(--accent))" : "var(--chart-1)" }} />
                  </span>
                  <span className="num w-8 text-right text-[11px]">{pulls[a]}</span>
                </span>
              </td>
              <td className="num py-2 text-right">{wins[a]}</td>
              <td className="num py-2 text-right">{pct(best[a])}</td>
              {reveal && <td className="num py-2 text-right text-muted">{(TRUE_RATES[a] * 100).toFixed(1)}%</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => send(50)} className="ctl bg-fg px-2.5 py-1 text-[11.5px] font-semibold text-bg">Send 50 emails</button>
        <button type="button" onClick={() => send(500)} className="ctl border border-line px-2.5 py-1 text-[11.5px]">Send 500</button>
        <button type="button" onClick={() => setReveal((r) => !r)} className="ctl border border-accent/60 px-2.5 py-1 text-[11.5px] text-accent">{reveal ? "Hide" : "Reveal"} the true rates</button>
        <button type="button" onClick={reset} className="text-[11.5px] text-muted hover:text-fg">Reset</button>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Each email draws once from every opening&apos;s posterior and uses the highest draw. Openings that earn replies get more of the sends; uncertain ones still get tried. In the product, a new account&apos;s starting beliefs come from replies across YouBank, then its own audience takes over.
      </p>
    </div>
  );
}

/* ---------------- Lessons ---------------- */

function Lessons() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="panel p-4">
        <h4 className="text-[12px] font-semibold text-muted">The agent wrote</h4>
        <p className="mt-2 text-[12.5px] leading-relaxed">Thanks so much for reaching out! We would absolutely love to set up a call to discuss this further. Please let me know what times work best for you!</p>
        <h4 className="mt-4 text-[12px] font-semibold text-muted">You sent</h4>
        <p className="mt-2 text-[12.5px] leading-relaxed">Thanks, Dana. Tuesday 2pm PT works; I&apos;ll send an invite.</p>
      </div>
      <div className="panel p-4">
        <h4 className="flex items-center gap-1.5 text-[12px] font-semibold"><Icon name="Lightbulb" className="h-3.5 w-3.5 text-accent" />What the agent takes from it</h4>
        <ul className="mt-2 space-y-1.5 text-[12.5px]">
          <li>• Propose a specific day and time instead of asking for availability</li>
          <li>• Keep replies short and to the point</li>
          <li>• Do not use exclamation marks</li>
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          After every edited send, the model compares the two versions and names the durable preferences, not the one-off facts. Lessons that recur gain weight and are applied to the next draft of that kind. You can read and retire every one. Illustration; the product learns from your own edits.
        </p>
      </div>
    </div>
  );
}

export function AdaptiveDemo() {
  const [tab, setTab] = useState<"trust" | "outreach" | "lessons">("trust");
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {([["trust", "Earned autonomy"], ["outreach", "Outreach experiments"], ["lessons", "Lessons from edits"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`ctl px-3 py-1.5 text-[12px] transition ${tab === k ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{l}</button>
        ))}
      </div>
      <div className="mt-4">
        {tab === "trust" && <div className="rise"><EarnedAutonomy /></div>}
        {tab === "outreach" && <div className="rise"><Outreach /></div>}
        {tab === "lessons" && <div className="rise"><Lessons /></div>}
      </div>
    </div>
  );
}
