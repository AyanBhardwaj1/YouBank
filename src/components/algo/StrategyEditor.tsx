"use client";

/**
 * The strategy builder: start from a template or a blank, then edit the parts (universe, signal, sizing,
 * schedule, capital, risk limits, execution) in a form, or the whole thing as JSON. The server validates
 * with the same schema (lib/algo/strategy.ts) and its messages name the field. Saving the risk limits with
 * "I reviewed these limits" ticked is what live trading requires.
 */
import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { parseStrategy } from "@/lib/algo/strategy";
import { errorMessage } from "@/lib/client/errors";
import { useAlgoConsent } from "./AlgoConsent";
import { call, json, SIGNAL_LABEL, type Template } from "./client";

type Spec = Record<string, unknown> & { signal: Record<string, unknown>; risk?: Record<string, unknown>; sizing?: Record<string, unknown>; rebalance?: Record<string, unknown>; execution?: Record<string, unknown> };

const DEFAULT_SIGNALS: Record<string, Record<string, unknown>> = {
  trend: { type: "trend", fast: 50, slow: 200 },
  momentum: { type: "momentum", lookback: 252, skip: 21, top: 2, absolute: true },
  meanReversion: { type: "meanReversion", indicator: "rsi", lookback: 2, entry: 10, exit: 60, trendFilter: 200 },
  pairs: { type: "pairs", a: "GDX", b: "GLD", lookback: 120, entryZ: 2, exitZ: 0.5, maxHalfLife: 40, requireCointegration: "10%" },
  rebalance: { type: "rebalance", weights: { VTI: 0.6, BND: 0.4 } },
  copy13f: { type: "copy13f", cik: "1067983", top: 15 },
  income: { type: "income", kind: "covered_call", underlying: "SPY", delta: 0.3, dte: 30, ivPremium: 0.1 },
  external: { type: "external", producer: "quant.example", topN: 10, minConfidence: 0.3 },
  target: { type: "target", key: "" },
};

const BLANK: Spec = { version: 1, name: "My strategy", description: "", assetClass: "equity", universe: ["SPY", "TLT"], benchmark: "SPY", signal: DEFAULT_SIGNALS.trend, capitalUsd: 10_000 };

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block text-[11.5px] text-muted" title={hint}><span className="mb-1 block">{label}</span>{children}</label>;
}
const inputCls = "ctl w-full border border-line bg-panel px-2.5 py-2 text-[13px] text-fg outline-none focus:border-accent";

function Num({ value, onChange, pct, step = 1, min, max }: { value: unknown; onChange: (v: number) => void; pct?: boolean; step?: number; min?: number; max?: number }) {
  const v = typeof value === "number" ? (pct ? Math.round(value * 10_000) / 100 : value) : "";
  return <input type="number" inputMode="decimal" step={pct ? 0.1 : step} min={min} max={max} value={v} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(pct ? n / 100 : n); }} className={`${inputCls} num`} />;
}

export function StrategyEditor({ templates, initial, strategyId, riskConfirmed, onSaved, onCancel }: { templates: Template[]; initial?: Spec | null; strategyId?: number; riskConfirmed?: boolean; onSaved: (id: number) => void; onCancel: () => void }) {
  const ask = useAlgoConsent();
  const [spec, setSpec] = useState<Spec>(initial ?? BLANK);
  const [mode, setMode] = useState<"form" | "json">("form");
  const [text, setText] = useState(() => JSON.stringify(initial ?? BLANK, null, 2));
  const [reviewed, setReviewed] = useState(!!riskConfirmed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const local = useMemo(() => parseStrategy(spec), [spec]);
  const set = (patch: Partial<Spec>) => setSpec((s) => ({ ...s, ...patch }));
  const setIn = (part: "signal" | "risk" | "sizing" | "rebalance" | "execution", k: string, v: unknown) => setSpec((s) => ({ ...s, [part]: { ...((s[part] as Record<string, unknown>) ?? {}), [k]: v } }));
  const resolved = local.ok ? local.spec : null;
  const risk = (spec.risk ?? {}) as Record<string, unknown>;
  const riskOf = (k: string) => risk[k] ?? (resolved?.risk as Record<string, unknown> | undefined)?.[k];
  const sizing = { ...(resolved?.sizing ?? {}), ...(spec.sizing ?? {}) } as Record<string, unknown>;
  const reb = { ...(resolved?.rebalance ?? {}), ...(spec.rebalance ?? {}) } as Record<string, unknown>;
  const exe = { ...(resolved?.execution ?? {}), ...(spec.execution ?? {}) } as Record<string, unknown>;

  const pickTemplate = (t: Template) => { const s = t.spec as Spec; setSpec(s); setText(JSON.stringify(s, null, 2)); setPicked(t.id); };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      let body: Spec = spec;
      if (mode === "json") { try { body = JSON.parse(text) as Spec; } catch { throw new Error("The JSON does not parse. Check commas and quotes."); } }
      if (strategyId) {
        await call(`/api/algo/strategies/${strategyId}`, json("PATCH", { spec: body, riskConfirmed: reviewed }), ask);
        onSaved(strategyId);
      } else {
        const r = await call<{ id: number }>("/api/algo/strategies", json("POST", { spec: body }), ask);
        if (reviewed) await call(`/api/algo/strategies/${r.id}`, json("PATCH", { riskConfirmed: true }), ask);
        onSaved(r.id);
      }
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const sig = spec.signal;

  return (
    <div className="space-y-3">
      {!strategyId && (
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-fg">Start from a template</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {templates.map((t) => (
              <button key={t.id} onClick={() => pickTemplate(t)} className={`panel p-2.5 text-left transition hover:border-line-strong ${picked === t.id ? "border-accent" : ""}`}>
                <div className="text-[12.5px] font-semibold text-fg">{t.name}</div>
                <div className="mt-1 line-clamp-3 text-[11px] text-muted">{t.blurb}</div>
              </button>
            ))}
          </div>
          {picked && (() => { const t = templates.find((x) => x.id === picked)!; return <div className="mt-2 rounded-md border border-line bg-elevated p-2.5 text-[11.5px] leading-relaxed text-muted"><p><span className="font-semibold text-fg">How it works. </span>{t.how}</p><p className="mt-1"><span className="font-semibold text-fg">How it fails. </span>{t.risks}</p></div>; })()}
        </section>
      )}
      <div className="flex items-center gap-1">
        {(["form", "json"] as const).map((m) => <button key={m} onClick={() => { if (m === "json") setText(JSON.stringify(spec, null, 2)); else { try { setSpec(JSON.parse(text)); } catch { /* keep the form */ } } setMode(m); }} className={`ctl px-3 py-1.5 text-[12px] ${mode === m ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-elevated"}`}>{m === "form" ? "Form" : "JSON"}</button>)}
      </div>
      {mode === "json" ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={22} className={`${inputCls} font-mono text-[12px]`} aria-label="Strategy JSON" />
      ) : (
        <div className="space-y-3">
          <section className="panel grid gap-2 p-3 sm:grid-cols-2">
            <Field label="Name"><input value={String(spec.name ?? "")} onChange={(e) => set({ name: e.target.value })} className={inputCls} /></Field>
            <Field label="Asset class"><select value={String(spec.assetClass ?? "equity")} onChange={(e) => set({ assetClass: e.target.value })} className={inputCls}><option value="equity">Stocks and ETFs</option><option value="crypto">Crypto</option><option value="options">Options (income)</option></select></Field>
            <Field label="Universe (tickers, comma-separated)"><input value={(spec.universe as string[] ?? []).join(", ")} onChange={(e) => set({ universe: e.target.value.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean) })} className={inputCls} /></Field>
            <Field label="Benchmark"><input value={String(spec.benchmark ?? "SPY")} onChange={(e) => set({ benchmark: e.target.value.trim().toUpperCase() })} className={inputCls} /></Field>
            <Field label="Capital (USD)"><Num value={spec.capitalUsd} onChange={(v) => set({ capitalUsd: v })} step={100} /></Field>
            <Field label="Description"><input value={String(spec.description ?? "")} onChange={(e) => set({ description: e.target.value })} className={inputCls} /></Field>
          </section>
          <section className="panel space-y-2 p-3">
            <Field label="Signal"><select value={String(sig.type)} onChange={(e) => set({ signal: DEFAULT_SIGNALS[e.target.value] })} className={inputCls}>{Object.keys(DEFAULT_SIGNALS).map((k) => <option key={k} value={k}>{SIGNAL_LABEL[k]}</option>)}</select></Field>
            <div className="grid gap-2 sm:grid-cols-3">
              {Object.entries(sig).filter(([k]) => k !== "type").map(([k, v]) => (
                <Field key={k} label={k}>
                  {typeof v === "number" ? <Num value={v} onChange={(n) => setIn("signal", k, n)} step={Number.isInteger(v) ? 1 : 0.1} />
                    : typeof v === "boolean" ? <select value={String(v)} onChange={(e) => setIn("signal", k, e.target.value === "true")} className={inputCls}><option value="true">yes</option><option value="false">no</option></select>
                    : typeof v === "object" ? <input value={Object.entries(v as Record<string, number>).map(([s, w]) => `${s}:${w}`).join(", ")} onChange={(e) => setIn("signal", k, Object.fromEntries(e.target.value.split(",").map((p) => p.split(":")).filter((p) => p.length === 2 && p[0].trim()).map(([s, w]) => [s.trim().toUpperCase(), Number(w)])))} className={inputCls} placeholder="VTI:0.6, BND:0.4" />
                    : <input value={String(v)} onChange={(e) => setIn("signal", k, k === "producer" || k === "key" || k === "indicator" || k === "kind" || k === "requireCointegration" ? e.target.value : e.target.value.toUpperCase())} className={inputCls} />}
                </Field>
              ))}
            </div>
          </section>
          <section className="panel grid gap-2 p-3 sm:grid-cols-4">
            <Field label="Sizing"><select value={String(sizing.method ?? "equal")} onChange={(e) => setIn("sizing", "method", e.target.value)} className={inputCls}><option value="equal">Equal</option><option value="inverseVol">Inverse volatility</option><option value="volTarget">Volatility target</option></select></Field>
            <Field label="Target volatility (%)"><Num pct value={sizing.targetVol} onChange={(v) => setIn("sizing", "targetVol", v)} /></Field>
            <Field label="Max weight (%)"><Num pct value={sizing.maxWeight} onChange={(v) => setIn("sizing", "maxWeight", v)} /></Field>
            <Field label="Decides"><select value={String(reb.every ?? "weekly")} onChange={(e) => setIn("rebalance", "every", e.target.value)} className={inputCls}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="intraday">Intraday (Pro)</option></select></Field>
            <Field label="At"><select value={String(reb.at ?? "close")} onChange={(e) => setIn("rebalance", "at", e.target.value)} className={inputCls}><option value="close">Near the close</option><option value="open">After the open</option></select></Field>
            <Field label="Drift band (%)"><Num pct value={reb.drift} onChange={(v) => setIn("rebalance", "drift", v)} /></Field>
            <Field label="Orders"><select value={String(exe.orderType ?? "Limit")} onChange={(e) => setIn("execution", "orderType", e.target.value)} className={inputCls}><option value="Limit">Limit (band)</option><option value="Market">Market</option></select></Field>
            <Field label="Limit band (bp)"><Num value={exe.limitBandBps} onChange={(v) => setIn("execution", "limitBandBps", v)} /></Field>
            <Field label="TWAP above (USD)"><Num value={exe.twapThresholdUsd} onChange={(v) => setIn("execution", "twapThresholdUsd", v)} step={500} /></Field>
            <Field label="TWAP slices"><Num value={exe.slices} onChange={(v) => setIn("execution", "slices", v)} /></Field>
            <Field label="TWAP minutes"><Num value={exe.minutes} onChange={(v) => setIn("execution", "minutes", v)} /></Field>
          </section>
          <section className="panel p-3">
            <h4 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-fg"><Icon name="Shield" className="h-3.5 w-3.5 text-accent" />Risk limits (enforced on the server before every order)</h4>
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="Per order (USD)"><Num value={riskOf("maxOrderUsd")} onChange={(v) => setIn("risk", "maxOrderUsd", v)} step={100} /></Field>
              <Field label="Per day (USD)"><Num value={riskOf("maxDayUsd")} onChange={(v) => setIn("risk", "maxDayUsd", v)} step={100} /></Field>
              <Field label="Max position (%)"><Num pct value={riskOf("maxPositionPct")} onChange={(v) => setIn("risk", "maxPositionPct", v)} /></Field>
              <Field label="Max gross (%)"><Num pct value={riskOf("maxGross")} onChange={(v) => setIn("risk", "maxGross", v)} /></Field>
              <Field label="Max net (%)"><Num pct value={riskOf("maxNet")} onChange={(v) => setIn("risk", "maxNet", v)} /></Field>
              <Field label="Daily loss stop (%)"><Num pct value={riskOf("dailyLossPct")} onChange={(v) => setIn("risk", "dailyLossPct", v)} /></Field>
              <Field label="Drawdown kill switch (%)"><Num pct value={riskOf("maxDrawdownPct")} onChange={(v) => setIn("risk", "maxDrawdownPct", v)} /></Field>
              <Field label="Fat-finger band (%)"><Num pct value={riskOf("fatFingerPct")} onChange={(v) => setIn("risk", "fatFingerPct", v)} /></Field>
              <Field label="Orders per minute"><Num value={riskOf("maxOrdersPerMinute")} onChange={(v) => setIn("risk", "maxOrdersPerMinute", v)} /></Field>
              <Field label="Orders per day"><Num value={riskOf("maxOrdersPerDay")} onChange={(v) => setIn("risk", "maxOrdersPerDay", v)} /></Field>
              <Field label="Day trades" hint="FINRA dropped the pattern-day-trader designation from June 2026 (phased in to October 2027); brokers that have not moved yet still apply it."><select value={String(riskOf("pdtMode") ?? "legacy")} onChange={(e) => setIn("risk", "pdtMode", e.target.value)} className={inputCls}><option value="legacy">Legacy PDT rule</option><option value="intraday">Intraday margin (warn)</option><option value="off">Off (cash account)</option></select></Field>
              <Field label="Extended hours"><select value={String(riskOf("allowExtendedHours") ?? false)} onChange={(e) => setIn("risk", "allowExtendedHours", e.target.value === "true")} className={inputCls}><option value="false">No</option><option value="true">Yes (limit orders)</option></select></Field>
            </div>
          </section>
        </div>
      )}
      {mode === "form" && !local.ok && <ul className="rounded-md border border-neg/40 bg-neg/10 p-2.5 text-[12px] text-neg">{local.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <label className="flex items-start gap-2 text-[12px] text-fg"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-0.5" />I reviewed every risk limit above. (Live trading needs this; changing a limit later asks again.)</label>
      {error && <p className="rounded-md border border-neg/40 bg-neg/10 p-2.5 text-[12px] text-neg">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button onClick={onCancel} className="ctl border border-line px-3 py-2 text-[12.5px] text-muted hover:text-fg">Cancel</button>
        <button onClick={save} disabled={busy || (mode === "form" && !local.ok)} className="ctl bg-accent px-4 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50">{busy ? "Saving…" : strategyId ? "Save changes" : "Create on paper"}</button>
      </div>
    </div>
  );
}
