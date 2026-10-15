"use client";

/**
 * Q3 BTX, the backtest integrity check: "Check a claim" from typed numbers (free, no data), "Grade my
 * returns" from an uploaded series (each upload is a trial of the named strategy), and the person's logged
 * strategy families with their grade and the live gate's typed override for a D or F.
 */
import { useEffect, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { PremiumBadge } from "@/components/billing/Premium";
import { Icon } from "@/components/ui/Icon";
import type { IntegrityReport } from "@/lib/quant/contracts";
import type { Assessment } from "@/lib/quant/integrity/assess";
import type { ClaimResult } from "@/lib/quant/integrity/claim";
import { Button, Card, Disclosures, ErrorNote, Field, GradeBadge, inputCls, json, num, pct, Stat, Table, useQuantCall, useRun } from "./ui";

type Gate = { allowed: boolean; needsOverride: boolean; phrase: string | null; reason: string };
type Graded = Partial<Assessment> & { report: IntegrityReport; rule: string; locked: boolean; gate?: Gate; family?: string; warnings?: string[]; whatWouldChange?: string[]; disclosures?: string[] };

const MODES = [
  { id: "claim", label: "Check a claim", icon: "Search" },
  { id: "upload", label: "Grade my returns", icon: "Upload" },
  { id: "families", label: "My strategies", icon: "ListChecks" },
] as const;

export type ClaimArgs = { sharpe?: number; months?: number; trials?: number };

export function IntegrityTab({ initialClaim }: { initialClaim?: ClaimArgs }) {
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("claim");
  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-[12.5px] text-muted">Most backtests look better than the strategy will be: the best of many tries looks good by luck. This grades a backtest by how many variants were tried, how long it ran, its costs and whether it could have known what it used when it used it.</p>
      <div className="flex gap-1 overflow-x-auto">
        {MODES.map((m) => <button key={m.id} onClick={() => setMode(m.id)} className={`ctl flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-[12px] ${mode === m.id ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}><Icon name={m.icon} className="h-3.5 w-3.5" />{m.label}</button>)}
      </div>
      {mode === "claim" && <Claim initial={initialClaim} />}
      {mode === "upload" && <Upload />}
      {mode === "families" && <Families />}
    </div>
  );
}

function Claim({ initial }: { initial?: ClaimArgs }) {
  const [f, setF] = useState({ sharpe: String(initial?.sharpe ?? 2), months: String(initial?.months ?? 18), frequency: "daily", trials: String(initial?.trials ?? 30) });
  const call = useQuantCall();
  const r = useRun<{ claim: ClaimResult; disclosures: string[] }>();
  const go = () => r.run(() => call("/api/quant/integrity", json("POST", { mode: "claim", ...f })));
  useEffect(() => { if (initial?.sharpe !== undefined) void go(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const c = r.data?.claim;
  return (
    <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
      <Card title="The claim">
        <form onSubmit={(e) => { e.preventDefault(); void go(); }} className="grid grid-cols-2 gap-2">
          <Field label="Sharpe ratio (annual)"><input inputMode="decimal" value={f.sharpe} onChange={(e) => setF({ ...f, sharpe: e.target.value })} className={inputCls} /></Field>
          <Field label="Months of history"><input inputMode="numeric" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} className={inputCls} /></Field>
          <Field label="Trades or rebalances"><select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} className={inputCls}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></Field>
          <Field label="Variants tried" hint="Your best guess if unsure"><input inputMode="numeric" value={f.trials} onChange={(e) => setF({ ...f, trials: e.target.value })} className={inputCls} /></Field>
          <div className="col-span-2"><Button type="submit" busy={r.busy}>Check</Button></div>
        </form>
        <ErrorNote error={r.error} />
      </Card>
      {c ? (
        <Card title="What the numbers say" right={<span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.verdict === "strong" ? "bg-pos/15 text-pos" : c.verdict === "plausible" ? "bg-accent-soft text-accent" : "bg-neg/10 text-neg"}`}>{c.verdict}</span>}>
          <p className="text-[13px] leading-relaxed text-fg">{c.sentence}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Deflated Sharpe" value={num(c.dsr, 2)} hint="Chance the true Sharpe is above zero after the variants" />
            <Stat label="Probabilistic Sharpe" value={num(c.psr, 2)} hint="Same, ignoring the variants" />
            <Stat label="Luck alone" value={num(c.srStarAnnual, 2)} hint={`Expected best Sharpe of ${c.input.trials} zero-skill variants`} />
            <Stat label="Track record needed" value={c.minTrlYears === null ? "never" : `${num(c.minTrlYears, 1)} yrs`} hint={`It has ${num(c.years, 1)} years`} />
          </div>
          {c.haircut && <p className="mt-2 text-[12px] text-muted">Harvey and Liu haircut: a Sharpe of {num(c.input.sharpe, 2)} is worth about {num(c.haircut.sharpe, 2)} after multiple testing ({pct(c.haircut.share, 0)} off). {c.t3 ? "It clears the t > 3 bar." : "It does not clear the t > 3 bar."}</p>}
          <div className="mt-3"><LineChart title="Best Sharpe from luck alone, by variants tried" series={[{ name: "Luck alone", points: c.curve.map((p) => ({ x: String(p.trials), y: p.sharpe })) }, { name: "Claimed", points: c.curve.map((p) => ({ x: String(p.trials), y: c.input.sharpe })) }]} format={(v) => v.toFixed(2)} height={170} /></div>
          <Disclosures items={r.data?.disclosures} />
        </Card>
      ) : <Card><p className="text-[12.5px] text-muted">Type the numbers from a backtest you saw: its Sharpe ratio, how long it ran and how many versions were tried before this one.</p></Card>}
    </div>
  );
}

function Upload() {
  const [f, setF] = useState({ name: "my strategy", csv: "", periodsPerYear: "252", turnover: "", costBps: "", declaredTrials: "", percent: false, survivorshipSafe: false, llmInputs: false });
  const call = useQuantCall();
  const r = useRun<Graded>();
  const go = () => r.run(() => call("/api/quant/integrity", json("POST", { mode: "upload", ...f, periodsPerYear: Number(f.periodsPerYear) })));
  return (
    <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
      <Card title="Your returns">
        <div className="space-y-2">
          <Field label="Strategy name" hint="Every upload under one name counts as another try"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} /></Field>
          <Field label="Returns CSV" hint="date,return per line (or one column per variant). Decimals, or tick percent.">
            <textarea value={f.csv} onChange={(e) => setF({ ...f, csv: e.target.value })} rows={6} className={`${inputCls} font-mono text-[11.5px]`} placeholder={"date,return\n2024-01-02,0.0031\n2024-01-03,-0.0012"} />
          </Field>
          <input type="file" accept=".csv,text/csv" className="text-[11.5px] text-muted" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setF({ ...f, csv: await file.text() }); }} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Periods a year"><select value={f.periodsPerYear} onChange={(e) => setF({ ...f, periodsPerYear: e.target.value })} className={inputCls}><option value="252">Daily (252)</option><option value="52">Weekly (52)</option><option value="12">Monthly (12)</option></select></Field>
            <Field label="Variants tried"><input inputMode="numeric" value={f.declaredTrials} onChange={(e) => setF({ ...f, declaredTrials: e.target.value })} className={inputCls} /></Field>
            <Field label="Turnover a year" hint="1 = 100%"><input inputMode="decimal" value={f.turnover} onChange={(e) => setF({ ...f, turnover: e.target.value })} className={inputCls} /></Field>
            <Field label="Costs assumed (bp)"><input inputMode="decimal" value={f.costBps} onChange={(e) => setF({ ...f, costBps: e.target.value })} className={inputCls} /></Field>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-muted"><input type="checkbox" checked={f.percent} onChange={(e) => setF({ ...f, percent: e.target.checked })} />Returns are in percent</label>
          <label className="flex items-center gap-2 text-[12px] text-muted"><input type="checkbox" checked={f.survivorshipSafe} onChange={(e) => setF({ ...f, survivorshipSafe: e.target.checked })} />The universe included delisted stocks</label>
          <label className="flex items-center gap-2 text-[12px] text-muted"><input type="checkbox" checked={f.llmInputs} onChange={(e) => setF({ ...f, llmInputs: e.target.checked })} />It used a language model&apos;s output</label>
          <Button onClick={() => void go()} busy={r.busy} disabled={!f.csv.trim()}>Grade it</Button>
        </div>
        <ErrorNote error={r.error} />
      </Card>
      {r.data ? <Report a={r.data} /> : <Card><p className="text-[12.5px] text-muted">Upload a backtest&apos;s daily, weekly or monthly returns. One series is free; several variants at once (for the probability of overfitting and the Reality Check) are part of <PremiumBadge feature="quant.integrity-pro" />.</p></Card>}
    </div>
  );
}

function Families() {
  const call = useQuantCall();
  const list = useRun<{ families: { family: string; trials: number; lastAt: string; bestSharpe: number | null }[] }>();
  const r = useRun<Graded>();
  useEffect(() => { void list.run(() => call("/api/quant/trials")); }, [call]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
      <Card title="Strategy families">
        {list.data?.families.length ? (
          <ul className="space-y-1">
            {list.data.families.map((f) => (
              <li key={f.family}><button onClick={() => void r.run(() => call("/api/quant/integrity", json("POST", { mode: "family", family: f.family })))} className="w-full rounded-md border border-line px-2.5 py-2 text-left hover:border-line-strong">
                <div className="truncate font-mono text-[11.5px] text-fg">{f.family}</div>
                <div className="text-[11px] text-muted">{f.trials} trials · best Sharpe {num(f.bestSharpe, 2)} · {f.lastAt.slice(0, 10)}</div>
              </button></li>
            ))}
          </ul>
        ) : <p className="text-[12px] text-muted">{list.busy ? "Loading…" : "No strategies logged yet. Uploads, the algo engine and the trials API log them here."}</p>}
        <ErrorNote error={list.error} />
      </Card>
      {r.data ? <Report a={r.data} /> : r.busy ? <div className="shimmer h-48 rounded-md" /> : <ErrorNote error={r.error} />}
    </div>
  );
}

const STATUS_ICON: Record<string, { icon: string; cls: string }> = { pass: { icon: "Check", cls: "text-pos" }, warn: { icon: "AlertTriangle", cls: "text-accent" }, fail: { icon: "X", cls: "text-neg" }, info: { icon: "Info", cls: "text-muted" } };

export function Report({ a }: { a: Graded }) {
  const s = a.stats;
  return (
    <Card title={<span className="flex items-center gap-2"><GradeBadge report={a.report} large />{a.family && <span className="truncate font-mono text-[11px] font-normal text-muted">{a.family}</span>}</span>}>
      <p className="text-[12.5px] leading-relaxed text-fg">{a.rule}</p>
      {s && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Sharpe" value={num(s.sharpe, 2)} hint={`95%: ${num(s.sharpeLow, 2)} to ${num(s.sharpeHigh, 2)}`} />
          <Stat label="Deflated Sharpe" value={num(s.dsrEffective ?? s.dsrRaw, 2)} hint={`${s.trials} trials, ${num(s.effectiveTrials, 1)} effective`} />
          <Stat label="Overfitting (PBO)" value={s.pbo ? pct(s.pbo.pbo, 0) : "–"} hint={s.pbo ? `${s.pbo.splits} splits` : "Needs several variants"} />
          <Stat label="Years" value={num(s.years, 1)} hint={s.minTrlYears === null ? "No track record long enough" : `Needs ${num(s.minTrlYears, 1)}`} />
        </div>
      )}
      {a.checks && (
        <ul className="mt-3 space-y-1.5">
          {a.checks.map((c) => { const st = STATUS_ICON[c.status] ?? STATUS_ICON.info; return <li key={c.id} className="flex gap-2 text-[12px]"><Icon name={st.icon} className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${st.cls}`} /><span><b className="text-fg">{c.label}.</b> <span className="text-muted">{c.detail}</span></span></li>; })}
        </ul>
      )}
      {!a.checks && a.warnings?.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-[12px] text-muted">{a.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
      {a.costs && <div className="mt-3"><Table head={["Round-trip cost", "Sharpe"]} rows={a.costs.map((c) => [`${c.bps} bp`, num(c.sharpe, 2)])} minWidth={240} />{a.breakevenBps !== null && a.breakevenBps !== undefined && <p className="mt-1 text-[11.5px] text-muted">Costs above about {Math.round(a.breakevenBps)} bp a round trip would erase the gross return.</p>}</div>}
      {a.years?.length ? <div className="mt-3"><Table head={["Year", "Sharpe", "Periods"]} rows={a.years.map((y) => [y.year, num(y.sharpe, 2), String(y.n)])} minWidth={240} /></div> : null}
      {a.whatWouldChange?.length ? <div className="mt-3 text-[12px]"><b className="text-fg">What would change the grade</b><ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">{a.whatWouldChange.map((w) => <li key={w}>{w}</li>)}</ul></div> : null}
      {a.locked && <p className="mt-3 text-[12px] text-muted">The full report (every check, the cost curve, PBO and the Reality Check) is part of <PremiumBadge feature="quant.integrity-pro" />.</p>}
      {a.gate?.needsOverride && a.family && <Override family={a.family} gate={a.gate} />}
      <Disclosures items={a.disclosures} />
    </Card>
  );
}

function Override({ family, gate }: { family: string; gate: Gate }) {
  const [typed, setTyped] = useState("");
  const call = useQuantCall();
  const r = useRun<{ ok: boolean; overrideId: number; grade: string }>();
  return (
    <div className="mt-3 rounded-md border border-neg/40 bg-neg/5 p-2.5 text-[12px]">
      <p className="text-fg">{gate.reason} To run it live anyway, type exactly: <code className="rounded bg-elevated px-1 font-mono text-[11.5px]">{gate.phrase}</code></p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input value={typed} onChange={(e) => setTyped(e.target.value)} className={inputCls} aria-label="Override phrase" />
        <Button kind="ghost" busy={r.busy} disabled={typed !== gate.phrase} onClick={() => void r.run(() => call("/api/quant/integrity/override", json("POST", { family, typed })))}>Log override</Button>
      </div>
      {r.data && <p className="mt-1.5 text-muted">Logged (record {r.data.overrideId}). The algo engine records it in its own audit trail too.</p>}
      <ErrorNote error={r.error} />
    </div>
  );
}
