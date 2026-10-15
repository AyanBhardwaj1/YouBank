"use client";

/**
 * Q14 DRILL: calibration drills (90% intervals and true-or-false with a confidence), expected-value problems,
 * the Kelly coin, and the person's own scored calls. Virtual and educational: no money, no prizes. The coin is
 * played in the browser from a seed, so the flips can be checked.
 */
import { useEffect, useMemo, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { PremiumBadge } from "@/components/billing/Premium";
import { COIN, coinFlips, playCoin, type CoinBet } from "@/lib/quant/drills/games";
import type { DrillSet } from "@/lib/quant/drills/run";
import { Button, Card, Disclosures, ErrorNote, Field, inputCls, json, num, pct, Table, useQuantCall, useRun } from "./ui";

const VIEWS = [{ id: "calibration", label: "Calibration" }, { id: "ev", label: "Expected value" }, { id: "coin", label: "Kelly coin" }, { id: "calls", label: "My calls" }] as const;

export function DrillsTab() {
  const [view, setView] = useState<(typeof VIEWS)[number]["id"]>("calibration");
  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-[12.5px] text-muted">The habits that interviews at trading desks test: knowing how sure you are, thinking in expected value, and sizing bets so a bad run cannot end the game. Virtual and educational: no money, no prizes.</p>
      <div className="flex gap-1 overflow-x-auto">{VIEWS.map((v) => <button key={v.id} onClick={() => setView(v.id)} className={`ctl shrink-0 px-3 py-1.5 text-[12px] ${view === v.id ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}>{v.label}</button>)}</div>
      {view === "calibration" && <Calibration />}
      {view === "ev" && <Ev />}
      {view === "coin" && <Coin />}
      {view === "calls" && <Calls />}
    </div>
  );
}

type SetResp = { set: DrillSet; ev: { id: string; question: string; unit: string }[] };
type Scored = { intervals: { hitRate: number; n: number; read: string }; probabilities: { brier: number; overconfidence: number; n: number; read: string }; answers: { id: string; question: string; answer: string | number; unit: string; yours: string; hit: boolean; source: { label: string; url: string }; explanation?: string }[]; disclosure: string };

function Calibration() {
  const call = useQuantCall();
  const s = useRun<SetResp>();
  const score = useRun<Scored>();
  const [iv, setIv] = useState<Record<string, { lo: string; hi: string }>>({});
  const [tf, setTf] = useState<Record<string, { answer: boolean; confidence: number }>>({});
  const fresh = () => { setIv({}); setTf({}); score.setData(null); void s.run(() => call("/api/quant/drills")); };
  useEffect(() => { void s.run(() => call("/api/quant/drills")); }, [call]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = () => s.data && score.run(() => call("/api/quant/drills", json("POST", { action: "submit", seed: s.data!.set.seed, intervals: Object.fromEntries(Object.entries(iv).map(([k, v]) => [k, { lo: Number(v.lo), hi: Number(v.hi) }])), truefalse: tf })));
  if (!s.data) return s.error ? <ErrorNote error={s.error} /> : <div className="shimmer h-40 rounded-md" />;
  const d = s.data.set;
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
      <Card title="Give a range you are 90% sure of">
        <ul className="space-y-3">
          {d.intervals.map((q) => (
            <li key={q.id}>
              <p className="text-[12.5px] text-fg">{q.question} <span className="text-muted">({q.unit})</span></p>
              <div className="mt-1 grid grid-cols-2 gap-2 sm:max-w-sm">
                <input inputMode="decimal" placeholder="Low" value={iv[q.id]?.lo ?? ""} onChange={(e) => setIv({ ...iv, [q.id]: { lo: e.target.value, hi: iv[q.id]?.hi ?? "" } })} className={inputCls} aria-label="Low" />
                <input inputMode="decimal" placeholder="High" value={iv[q.id]?.hi ?? ""} onChange={(e) => setIv({ ...iv, [q.id]: { lo: iv[q.id]?.lo ?? "", hi: e.target.value } })} className={inputCls} aria-label="High" />
              </div>
            </li>
          ))}
        </ul>
        <h4 className="mt-4 text-[12.5px] font-semibold text-fg">True or false, and how sure</h4>
        <ul className="mt-2 space-y-3">
          {d.truefalse.map((q) => (
            <li key={q.id}>
              <p className="text-[12.5px] text-fg">{q.statement}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {[true, false].map((a) => <button key={String(a)} onClick={() => setTf({ ...tf, [q.id]: { answer: a, confidence: tf[q.id]?.confidence ?? 0.7 } })} className={`ctl px-3 py-1 text-[12px] ${tf[q.id]?.answer === a ? "bg-accent-soft font-semibold text-accent" : "border border-line text-muted"}`}>{a ? "True" : "False"}</button>)}
                <label className="flex items-center gap-2 text-[11.5px] text-muted">Sure: <input type="range" min={50} max={100} step={5} value={Math.round((tf[q.id]?.confidence ?? 0.7) * 100)} onChange={(e) => setTf({ ...tf, [q.id]: { answer: tf[q.id]?.answer ?? true, confidence: Number(e.target.value) / 100 } })} />{Math.round((tf[q.id]?.confidence ?? 0.7) * 100)}%</label>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2"><Button onClick={() => void submit()} busy={score.busy}>Score</Button><Button kind="ghost" onClick={fresh}>New set</Button></div>
        <ErrorNote error={score.error} />
      </Card>
      <Card title="Your calibration">
        {score.data ? (
          <>
            <p className="text-[12.5px] text-fg">{score.data.intervals.read}</p>
            {score.data.probabilities.n > 0 && <p className="mt-1 text-[12.5px] text-fg">{score.data.probabilities.read} Brier score {num(score.data.probabilities.brier, 3)} (lower is better; always saying 50% scores 0.25).</p>}
            <ul className="mt-3 space-y-2">{score.data.answers.map((a) => <li key={a.id} className="text-[11.5px]"><span className={a.hit ? "text-pos" : "text-neg"}>{a.hit ? "Hit" : "Miss"}</span> <span className="text-fg">{a.question}</span> <span className="text-muted">Answer {typeof a.answer === "number" ? num(a.answer, 2) : a.answer}{a.unit ? ` ${a.unit}` : ""}; yours {a.yours}. {a.explanation ?? ""} <a href={a.source.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{a.source.label}</a></span></li>)}</ul>
            <Disclosures items={[score.data.disclosure]} />
          </>
        ) : <p className="text-[12px] text-muted">A well-calibrated 90% range catches the answer nine times in ten. Most people catch it about half the time.</p>}
        <p className="mt-3 text-[11px] text-muted">Private team leaderboards: <PremiumBadge feature="quant.drills-teams" /></p>
      </Card>
    </div>
  );
}

function Ev() {
  const call = useQuantCall();
  const s = useRun<SetResp>();
  const r = useRun<{ results: { id: string; yours: number; answer: number; unit: string; close: boolean; worked: string }[] }>();
  const [a, setA] = useState<Record<string, string>>({});
  useEffect(() => { void s.run(() => call("/api/quant/drills")); }, [call]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card title="Expected-value problems">
      <ul className="space-y-3">
        {s.data?.ev.map((p) => {
          const res = r.data?.results.find((x) => x.id === p.id);
          return (
            <li key={p.id}>
              <p className="text-[12.5px] text-fg">{p.question}</p>
              <div className="mt-1 flex items-center gap-2 sm:max-w-xs"><input inputMode="decimal" value={a[p.id] ?? ""} onChange={(e) => setA({ ...a, [p.id]: e.target.value })} className={inputCls} aria-label="Your answer" /><span className="text-[11.5px] text-muted">{p.unit}</span></div>
              {res && <p className={`mt-1 text-[12px] ${res.close ? "text-pos" : "text-neg"}`}>{res.close ? "Right." : `The answer is ${num(res.answer, 4)}.`} <span className="text-muted">{res.worked}</span></p>}
            </li>
          );
        })}
      </ul>
      <div className="mt-3"><Button busy={r.busy} onClick={() => void r.run(() => call("/api/quant/drills", json("POST", { action: "ev", answers: Object.fromEntries(Object.entries(a).filter(([, v]) => v.trim()).map(([k, v]) => [k, Number(v)])) })))}>Check</Button></div>
      <ErrorNote error={r.error ?? s.error} />
    </Card>
  );
}

function Coin() {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [bets, setBets] = useState<CoinBet[]>([]);
  const [amount, setAmount] = useState("5");
  const [saved, setSaved] = useState(false);
  const call = useQuantCall();
  const flips = useMemo(() => coinFlips(seed), [seed]);
  const res = playCoin(flips, bets);
  const over = res.busted || res.capped || res.flipsPlayed >= COIN.flips;
  const bet = (side: "heads" | "tails") => {
    const next = [...bets, { side, amount: Math.max(0, Math.min(Number(amount) || 0, res.final)) }];
    setBets(next);
    const r = playCoin(flips, next);
    if (!saved && (r.busted || r.capped || r.flipsPlayed >= COIN.flips)) {
      setSaved(true);
      void call("/api/quant/drills", json("POST", { action: "game", game: "kelly_coin", result: { seed, final: r.final, kellyFinal: r.kellyFinal, busted: r.busted, capped: r.capped, flips: r.flipsPlayed, maxBetShare: r.maxBetShare } })).catch(() => null);
    }
  };
  const last = res.flipsPlayed > 0 ? flips[res.flipsPlayed - 1] : null;
  return (
    <Card title="The Kelly coin" right={<span className="text-[11px] text-muted">Haghani and Dewey (2016)</span>}>
      <p className="text-[12.5px] text-muted">You have ${COIN.start}. The coin lands heads {pct(COIN.p, 0)} of the time. Bet any amount on each of up to {COIN.flips} flips; winnings stop at ${COIN.cap}. In the original experiment, a third of finance students and professionals went broke.</p>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:max-w-md">
        <div className="rounded-md border border-line bg-elevated p-2 text-center"><div className="text-[10.5px] uppercase text-muted">You</div><div className="text-[18px] font-semibold text-fg">${num(res.final, 2)}</div></div>
        <div className="rounded-md border border-line bg-elevated p-2 text-center"><div className="text-[10.5px] uppercase text-muted">Flip</div><div className="text-[18px] font-semibold text-fg">{res.flipsPlayed}</div></div>
        <div className="rounded-md border border-line bg-elevated p-2 text-center"><div className="text-[10.5px] uppercase text-muted">Last</div><div className="text-[18px] font-semibold text-fg">{last === null ? "–" : last ? "Heads" : "Tails"}</div></div>
      </div>
      {!over ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Bet ($)"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputCls} w-28`} /></Field>
          <Button onClick={() => bet("heads")}>Heads</Button>
          <Button kind="ghost" onClick={() => bet("tails")}>Tails</Button>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-[12.5px] text-fg">{res.busted ? "Broke." : res.capped ? `You reached the $${COIN.cap} cap.` : "Out of flips."} Betting 20% of your wealth on heads each flip (Kelly) would have ended at ${num(res.kellyFinal, 2)} on the same flips.{res.betTails ? ` You bet on tails ${res.betTails} times, against a 60% edge.` : ""}</p>
          <div className="mt-2"><LineChart title="Your wealth and Kelly's" series={[{ name: "You", points: res.path.map((v, i) => ({ x: String(i), y: v })) }, { name: "Kelly (20%)", points: res.kellyPath.map((v, i) => ({ x: String(i), y: v })) }]} format={(v) => `$${v.toFixed(0)}`} height={170} /></div>
          <div className="mt-2"><Button onClick={() => { setSeed(Math.floor(Math.random() * 1e9)); setBets([]); setSaved(false); }}>Play again</Button></div>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted">Virtual money; seed {seed}. The sizing maths is in Sizing.</p>
    </Card>
  );
}

type Me = { sessions: { at: string; hitRate?: number; brier?: number }[]; calls: { id: number; question: string; probability: number; closesAt: string; outcome: string | null; resolvedAt: string | null }[]; skill: { n: number; verdict: string | null } | null; disclosures: string[] };

function Calls() {
  const call = useQuantCall();
  const me = useRun<Me>();
  const add = useRun<unknown>();
  const [f, setF] = useState({ symbol: "AAPL", benchmark: "SPY", months: "3", probability: "0.6", direction: "beats" });
  const load = () => me.run(() => call("/api/quant/drills?me=1"));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => { if (await add.run(() => call("/api/quant/drills", json("POST", { action: "call", ...f, months: Number(f.months), probability: Number(f.probability) })))) void load(); };
  return (
    <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
      <Card title="Log a call">
        <p className="text-[12px] text-muted">Your own forecast, scored when it closes from daily prices. The score is yours alone.</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="Stock"><input value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} className={inputCls} /></Field>
          <Field label="Against"><input value={f.benchmark} onChange={(e) => setF({ ...f, benchmark: e.target.value.toUpperCase() })} className={inputCls} /></Field>
          <Field label="It"><select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })} className={inputCls}><option value="beats">beats it</option><option value="trails">trails it</option></select></Field>
          <Field label="Over (months)"><select value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} className={inputCls}>{[1, 3, 6, 12].map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
          <Field label="Chance (0.5 to 0.99)"><input inputMode="decimal" value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value })} className={inputCls} /></Field>
        </div>
        <div className="mt-2"><Button busy={add.busy} onClick={() => void submit()}>Log it</Button></div>
        <ErrorNote error={add.error} />
      </Card>
      <Card title="Your record">
        {me.data?.skill?.verdict && <p className="mb-2 text-[12.5px] text-fg">{me.data.skill.verdict}</p>}
        {me.data?.calls.length ? <Table head={["Call", "Chance", "Closes", "Outcome"]} rows={me.data.calls.map((c) => [c.question, pct(c.probability, 0), c.closesAt.slice(0, 10), c.outcome ?? "open"])} minWidth={420} /> : <p className="text-[12px] text-muted">{me.busy ? "Loading…" : "No calls yet."}</p>}
        {me.data && me.data.sessions.length > 0 && <p className="mt-2 text-[11.5px] text-muted">{me.data.sessions.length} calibration sessions; latest interval hit rate {pct(me.data.sessions[0].hitRate ?? null, 0)}.</p>}
        <ErrorNote error={me.error} />
        <Disclosures items={me.data?.disclosures} />
      </Card>
    </div>
  );
}
