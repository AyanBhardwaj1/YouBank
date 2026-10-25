"use client";

/**
 * Settings → Data sources: per dataset, the person's order of eligible sources (up/down buttons, so
 * reordering works from the keyboard), each with its licence badge, freshness and "needs key"; a Test
 * that runs the dataset's sample through their order and says which source answered and how fast; and
 * their own keys (add with the plan type, test, remove; only the last four characters are ever shown).
 */
import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/client/errors";
import { loadDataSources, onDataSources, removeKey, saveKey, saveOrder, testChain, testSavedKey } from "@/lib/client/data-sources";
import type { ChainTest, DatasetView, KeyView, SettingsView, SourceRow } from "@/lib/market/byo/settings";
import { PLAN_TYPES, type KeyProvider, type Licence, type PlanType } from "@/lib/market/sources-meta";

const BADGE: Record<Licence, string> = {
  public: "border-pos/40 bg-pos/10 text-pos", attribution: "border-info/40 bg-info/10 text-fg/90", "owner-licensed": "border-line bg-elevated text-muted",
  "user-key": "border-accent/40 bg-accent-soft text-accent", unverified: "border-chart-emphasis/40 bg-chart-emphasis/10 text-fg/90",
};
const btn = "ctl border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-fg disabled:opacity-40";

export function DataSourcesSettings() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const off = onDataSources(setView);
    loadDataSources(true).then(setView, (e) => setError(errorMessage(e)));
    return off;
  }, []);
  return (
    <section className="mt-5 rise space-y-5" aria-labelledby="ds-title">
      <div className="max-w-[80ch]">
        <h2 id="ds-title" className="text-[14px] font-semibold">Data sources</h2>
        <p className="mt-1 text-[12px] text-muted">Where each screen&apos;s numbers come from, in the order you choose. Public sources (SEC, the Treasury, BLS, BEA, the EIA, the ECB) are free to use and credited on screen. Your own keys add sources only you see: their data is never cached for anyone else, never used in background jobs and never put in exports or shared views. Type <span className="num text-fg">AAPL GP @tiingo</span> in the terminal to use a source for one view.</p>
      </div>
      {error && <p className="text-[12px] text-neg" role="alert">{error}</p>}
      {!view && !error && <div className="shimmer h-48 ctl" aria-busy="true" />}
      {view?.setupPending && <p role="note" className="ctl max-w-[80ch] border border-line bg-elevated px-3 py-2 text-[12px] text-muted">Saving your own order and keys is not switched on for this site yet. Below is the order every screen uses now, and Test shows which source answers.</p>}
      {view && !view.setupPending && <KeysPanel view={view} />}
      {view && <OrderPanel view={view} />}
    </section>
  );
}

/* ---------------- Keys ---------------- */

function KeysPanel({ view }: { view: SettingsView }) {
  return (
    <div className="panel p-4">
      <h3 className="text-[13px] font-semibold">Your own keys</h3>
      <p className="mt-1 max-w-[80ch] text-[11.5px] text-muted">Keys are encrypted on our side and used only for your own screens. Only the last four characters are shown after saving. Removing a key also deletes everything fetched with it.</p>
      {view.keys.length > 0 && <ul className="mt-3 divide-y divide-line">{view.keys.map((k) => <KeyRow key={k.provider} k={k} />)}</ul>}
      <AddKey view={view} />
    </div>
  );
}

function KeyRow({ k }: { k: KeyView }) {
  const [state, setState] = useState<{ busy?: boolean; note?: string; bad?: boolean }>({});
  const test = async () => {
    setState({ busy: true });
    try { const r = await testSavedKey(k.provider); setState({ note: r.ok ? `Works · ${r.ms} ms` : r.message ?? "Did not work", bad: !r.ok }); } catch (e) { setState({ note: errorMessage(e), bad: true }); }
  };
  const remove = async () => { setState({ busy: true }); try { await removeKey(k.provider); } catch (e) { setState({ note: errorMessage(e), bad: true }); } };
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[12px]">
      <span className="font-semibold">{k.label}</span>
      <span className="num text-muted" aria-label={`Key ending ${k.last4}`}>••••{k.last4}</span>
      <span className="rounded border border-line px-1.5 text-[10.5px] text-muted">{k.plan === "business" ? "Business plan" : "Individual plan"}</span>
      {k.lastTest && <span className={`text-[11px] ${k.lastTest.ok ? "text-pos" : "text-neg"}`}>{k.lastTest.ok ? "Last test passed" : "Last test failed"}</span>}
      <span className="ml-auto flex gap-1.5">
        <button type="button" className={btn} disabled={state.busy} onClick={() => void test()}>Test</button>
        <button type="button" className={btn} disabled={state.busy} onClick={() => void remove()} aria-label={`Remove your ${k.label} key`}>Remove</button>
      </span>
      {state.note && <span role="status" className={`w-full text-[11px] ${state.bad ? "text-neg" : "text-pos"}`}>{state.note}</span>}
      {k.warning && <p className="w-full text-[11px] text-chart-emphasis" role="note">{k.warning}</p>}
    </li>
  );
}

function AddKey({ view }: { view: SettingsView }) {
  const [provider, setProvider] = useState<KeyProvider>(view.providers[0]?.id ?? "tiingo");
  const [key, setKey] = useState("");
  const [plan, setPlan] = useState<PlanType>("individual");
  const [state, setState] = useState<{ busy?: boolean; ok?: string; error?: string }>({});
  const info = view.providers.find((p) => p.id === provider);
  const save = async () => {
    setState({ busy: true });
    try { const r = await saveKey(provider, key.trim(), plan); setKey(""); setState({ ok: `Saved and tested · ${r.test.ms} ms` }); } catch (e) { setState({ error: errorMessage(e) }); }
  };
  return (
    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (key.trim()) void save(); }}>
      <label className="flex flex-col text-[11px] text-muted">Provider
        <select value={provider} onChange={(e) => setProvider(e.target.value as KeyProvider)} className="ctl mt-0.5 border border-line bg-bg px-2 py-1.5 text-[12px] text-fg">{view.providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
      </label>
      <label className="flex min-w-[240px] flex-1 flex-col text-[11px] text-muted">API key
        <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key" className="ctl mt-0.5 border border-line bg-bg px-2 py-1.5 font-mono text-[12px] text-fg outline-none focus:border-accent/60" />
      </label>
      <fieldset className="flex items-center gap-2 text-[11.5px]"><legend className="sr-only">Plan type</legend>
        {PLAN_TYPES.map((p) => <label key={p} className="flex items-center gap-1"><input type="radio" name="plan" value={p} checked={plan === p} onChange={() => setPlan(p)} />{p === "business" ? "Business plan" : "Individual plan"}</label>)}
      </fieldset>
      <button type="submit" disabled={!key.trim() || state.busy} className="ctl bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-40">{state.busy ? "Testing…" : "Test and save"}</button>
      {info && <a href={info.signup} target="_blank" rel="noreferrer noopener" className="text-[11px] text-accent hover:underline">Get a {info.label} key</a>}
      {view.inTeam && info?.individualIsPersonalOnly && plan === "individual" && <p className="w-full text-[11px] text-chart-emphasis" role="note">{info.label}&apos;s individual plans are for personal use. You belong to a team: for firm work, its terms ask for a business plan.</p>}
      {state.ok && <p role="status" className="w-full text-[11.5px] text-pos">{state.ok}</p>}
      {state.error && <p role="alert" className="w-full text-[11.5px] text-neg">{state.error}</p>}
    </form>
  );
}

/* ---------------- Order per dataset ---------------- */

function OrderPanel({ view }: { view: SettingsView }) {
  const [open, setOpen] = useState<string | null>("daily-bars");
  const configurable = view.datasets.filter((d) => d.configurable), fixed = view.datasets.filter((d) => !d.configurable);
  return (
    <div className="panel p-4">
      <h3 className="text-[13px] font-semibold">Order per dataset</h3>
      <p className="mt-1 max-w-[80ch] text-[11.5px] text-muted">The first source that can answer does; when it leaves a field empty, the next one that has it fills it, and the screen says which. A source that cannot answer for you (no key, switched off) is skipped, with the reason.</p>
      <div className="mt-3 space-y-2">{configurable.map((d) => <DatasetOrder key={d.id} d={d} readOnly={!!view.setupPending} open={open === d.id} onToggle={() => setOpen(open === d.id ? null : d.id)} />)}</div>
      <details className="mt-4"><summary className="cursor-pointer text-[12px] text-muted">Fixed sources ({fixed.length})</summary>
        <ul className="mt-2 space-y-1.5 text-[11.5px]">{fixed.map((d) => <li key={d.id}><span className="font-semibold">{d.label}</span>: {d.sources.map((s) => s.label).join(" → ") || "none"}{d.noFreeSource ? <span className="block text-muted">{d.noFreeSource}</span> : null}</li>)}</ul>
      </details>
    </div>
  );
}

function DatasetOrder({ d, open, onToggle, readOnly = false }: { d: DatasetView; open: boolean; onToggle: () => void; readOnly?: boolean }) {
  // The order being edited; the saved one (d.sources) until the person moves something.
  const [draft, setDraft] = useState<SourceRow[] | null>(null);
  const rows = draft ?? d.sources;
  const [state, setState] = useState<{ busy?: boolean; error?: string; saved?: boolean; test?: ChainTest }>({});
  const move = (i: number, by: -1 | 1) => { const j = i + by; if (j < 0 || j >= rows.length) return; const n = [...rows]; [n[i], n[j]] = [n[j], n[i]]; setDraft(n); };
  const persist = async (ids: string[]) => {
    setState({ busy: true });
    try { await saveOrder({ [d.id]: ids }); setDraft(null); setState({ saved: true }); } catch (e) { setState({ error: errorMessage(e) }); }
  };
  const test = async () => { setState({ busy: true }); try { setState({ test: await testChain(d.id) }); } catch (e) { setState({ error: errorMessage(e) }); } };
  const dirty = rows.map((r) => r.id).join() !== d.sources.map((r) => r.id).join();
  return (
    <div className="rounded-md border border-line">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center justify-between px-3 py-2 text-left text-[12.5px]">
        <span><span className="font-semibold">{d.label}</span> <span className="text-muted">· {d.commands.join(" ")}</span>{d.customized && <span className="ml-2 text-[10.5px] text-accent">Your order</span>}</span>
        <span className="text-muted" aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="border-t border-line px-3 py-2">
        {d.noFreeSource && <p className="mb-2 text-[11px] text-muted">{d.noFreeSource}</p>}
        <ol className="space-y-1">{rows.map((s, i) => <SourceItem key={s.id} s={s} i={i} last={i === rows.length - 1} onMove={move} readOnly={readOnly} />)}</ol>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!readOnly && <button type="button" className={btn} disabled={!dirty || state.busy} onClick={() => void persist(rows.map((r) => r.id))}>Save order</button>}
          {!readOnly && <button type="button" className={btn} disabled={state.busy || !d.customized} onClick={() => void persist([])}>Reset to default</button>}
          <button type="button" className={btn} disabled={state.busy} onClick={() => void test()}>Test</button>
          {state.saved && <span role="status" className="text-[11px] text-pos">Saved</span>}
          {state.error && <span role="alert" className="text-[11px] text-neg">{state.error}</span>}
        </div>
        {state.test && <TestResult t={state.test} />}
      </div>}
    </div>
  );
}

function SourceItem({ s, i, last, onMove, readOnly = false }: { s: SourceRow; i: number; last: boolean; onMove: (i: number, by: -1 | 1) => void; readOnly?: boolean }) {
  return (
    <li className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded px-1.5 py-1 text-[12px] ${s.eligible ? "" : "opacity-60"}`}>
      <span className="num w-4 text-right text-faint">{i + 1}</span>
      <span className="font-medium">{s.label}</span>
      <span className={`rounded border px-1.5 text-[10px] ${BADGE[s.licence]}`} title={s.attribution}>{s.licenceLabel}</span>
      <span className="text-[10.5px] text-muted">{s.freshness}</span>
      {!s.eligible && <span className="rounded border border-line px-1.5 text-[10px] text-muted" title={s.reason}>{s.needsKey ? "Needs key" : "Unavailable"}</span>}
      {!readOnly && <span className="ml-auto flex gap-1">
        {/* aria-disabled, not disabled: a button that becomes disabled under the keyboard drops focus to the page. */}
        <button type="button" className={`${btn} aria-disabled:opacity-40`} aria-disabled={i === 0} onClick={() => onMove(i, -1)} aria-label={`Move ${s.label} up`}>↑</button>
        <button type="button" className={`${btn} aria-disabled:opacity-40`} aria-disabled={last} onClick={() => onMove(i, 1)} aria-label={`Move ${s.label} down`}>↓</button>
      </span>}
      {!s.eligible && s.reason && <span className="w-full pl-6 text-[10.5px] text-muted">{s.reason}</span>}
    </li>
  );
}

function TestResult({ t }: { t: ChainTest }) {
  return (
    <div role="status" className="mt-2 rounded border border-line bg-elevated/50 px-2.5 py-1.5 text-[11.5px]">
      {t.ok ? <span>Answered by <span className="font-semibold">{t.answeredBy?.label}</span>{t.answeredBy?.yourKey ? " (your key)" : ""} in <span className="num">{t.ms} ms</span></span> : <span className="text-neg">{t.message ?? "No source answered"} · {t.ms} ms</span>}
      {t.header?.skipped?.map((k) => <div key={k.id} className="text-muted">{k.label} skipped: {k.reason}</div>)}
      {t.header?.attributions?.map((a) => <div key={a} className="text-faint">{a}</div>)}
    </div>
  );
}
