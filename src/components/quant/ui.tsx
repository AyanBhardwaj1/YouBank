"use client";

/**
 * Shared pieces of the Quant screens: formatting, the consent step (the Quant terms, asked once on a 428),
 * the grade badge, disclosures, a holdings box and small layout helpers. Used by the /app/quant hub and the
 * terminal's quant functions alike.
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/copy/Consent";
import { ApiError, errorMessage, fetchJson } from "@/lib/client/errors";
import type { IntegrityReport } from "@/lib/quant/contracts";
import { QUANT_TERMS } from "@/lib/quant/words";

export const pct = (v: number | null | undefined, dp = 1, sign = false) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : `${sign && v > 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`);
export const num = (v: number | null | undefined, dp = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: Math.min(dp, 2) > 0 && Math.abs(v) < 10 ? Math.min(dp, 2) : 0 }));
export const bps = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : `${v.toFixed(1)} bp`);
export const usd = (v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0);
  return `${v < 0 ? "−" : ""}$${s}`;
};
export const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/* ---------------- Consent ---------------- */

type Ask = () => Promise<boolean>;
const ConsentCtx = createContext<Ask>(async () => false);

/** Wraps a Quant screen: any call answered 428 opens the terms once, then retries. */
export function QuantConsent({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const ask = useCallback<Ask>(() => new Promise((resolve) => { resolver.current = resolve; setError(null); setOpen(true); }), []);
  const close = (ok: boolean) => { resolver.current?.(ok); resolver.current = null; setOpen(false); };
  const accept = async () => {
    setBusy(true); setError(null);
    try { await fetchJson("/api/quant/consent", json("POST", { accept: true })); close(true); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <ConsentCtx.Provider value={ask}>
      {children}
      {open && (
        <Modal title={QUANT_TERMS.title} onClose={() => close(false)}>
          <ul className="space-y-2 text-[12.5px] leading-relaxed text-fg">
            {QUANT_TERMS.points.map((p) => <li key={p} className="flex gap-2"><Icon name="Shield" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />{p}</li>)}
          </ul>
          <p className="mt-3 text-[11px] text-muted">Version {QUANT_TERMS.version}. We keep a record that you accepted this text, and when.</p>
          {error && <p className="mt-2 text-[12px] text-neg">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => close(false)} className="ctl border border-line px-3 py-2 text-[12.5px] text-muted hover:text-fg">Not now</button>
            <button onClick={accept} disabled={busy} className="ctl bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-60">{busy ? "Saving…" : "I understand"}</button>
          </div>
        </Modal>
      )}
    </ConsentCtx.Provider>
  );
}

/** fetchJson that asks for the Quant terms on a 428 and retries once. */
export function useQuantCall() {
  const ask = useContext(ConsentCtx);
  return useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    try { return await fetchJson<T>(url, init); }
    catch (e) {
      if (e instanceof ApiError && e.status === 428 && (await ask())) return fetchJson<T>(url, init);
      throw e;
    }
  }, [ask]);
}

/** A request's state: run(fn) sets busy, error (never a raw message) and the result. */
export function useRun<T>() {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<T>) => {
    setBusy(true); setError(null);
    try { const r = await fn(); setData(r); return r; }
    catch (e) { setError(errorMessage(e)); return null; }
    finally { setBusy(false); }
  }, []);
  return { data, setData, busy, error, setError, run };
}

/* ---------------- Pieces ---------------- */

const GRADE_STYLE: Record<IntegrityReport["grade"], string> = {
  A: "bg-pos/15 text-pos border-pos/40", B: "bg-pos/10 text-pos border-pos/30", C: "bg-elevated text-fg border-line-strong",
  D: "bg-neg/10 text-neg border-neg/30", F: "bg-neg/15 text-neg border-neg/50",
};

/** The integrity grade as a badge, with the report's key numbers in its title. */
export function GradeBadge({ report, label = "Integrity", large }: { report: Pick<IntegrityReport, "grade" | "dsr" | "trials" | "effectiveTrials" | "sharpe">; label?: string; large?: boolean }) {
  const title = `Sharpe ${report.sharpe.toFixed(2)} · deflated Sharpe ${report.dsr === null ? "–" : report.dsr.toFixed(2)} · ${report.trials} trials (${report.effectiveTrials.toFixed(1)} effective)`;
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 rounded-md border font-semibold ${GRADE_STYLE[report.grade]} ${large ? "px-3 py-1.5 text-[15px]" : "px-1.5 py-0.5 text-[11px]"}`}>
      <span className="font-normal opacity-80">{label}</span>{report.grade}
    </span>
  );
}

export function Card({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel p-3 ${className}`}>
      {(title || right) && <div className="mb-2 flex flex-wrap items-center justify-between gap-2">{title && <h3 className="text-[13px] font-semibold text-fg">{title}</h3>}{right}</div>}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "pos" | "neg" }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-elevated px-2.5 py-2">
      <div className="truncate text-[10.5px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-0.5 text-[16px] font-semibold tabular-nums ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-fg"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}

export function Disclosures({ items }: { items: readonly string[] | undefined }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3 space-y-1 rounded-md border border-line bg-elevated p-2.5 text-[11px] leading-relaxed text-muted">
      {[...new Set(items)].map((d) => <p key={d} className="flex gap-1.5"><Icon name="Info" className="mt-0.5 h-3 w-3 shrink-0" />{d}</p>)}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <p className="mt-2 rounded-md border border-neg/40 bg-neg/10 p-2.5 text-[12px] text-neg">{error}</p> : null;
}

export function Button({ children, onClick, busy, disabled, kind = "primary", type = "button" }: { children: ReactNode; onClick?: () => void; busy?: boolean; disabled?: boolean; kind?: "primary" | "ghost"; type?: "button" | "submit" }) {
  return (
    <button type={type} onClick={onClick} disabled={busy || disabled} className={`ctl px-3 py-2 text-[12.5px] disabled:opacity-60 ${kind === "primary" ? "bg-accent font-semibold text-accent-fg" : "border border-line text-muted hover:text-fg"}`}>
      {busy ? "Working…" : children}
    </button>
  );
}

export const inputCls = "ctl w-full border border-line bg-panel px-2.5 py-2 text-[13px] text-fg outline-none focus:border-accent";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[10.5px] text-muted">{hint}</span>}
    </label>
  );
}

/** Holdings typed as "AAPL 25, MSFT 20" or one per line; weights in percent or fractions, rescaled to 100%. */
export function parseHoldings(text: string): { symbol: string; weight: number }[] {
  const out = new Map<string, number>();
  for (const part of text.split(/[\n,;]+/)) {
    const m = part.trim().match(/^([A-Za-z][A-Za-z0-9.\-]{0,9})\s*[:=\s]\s*\$?(-?[\d.]+)\s*%?$/) ?? part.trim().match(/^([A-Za-z][A-Za-z0-9.\-]{0,9})$/);
    if (!m) continue;
    const w = m[2] === undefined ? 1 : Number(m[2]);
    if (Number.isFinite(w) && w > 0) out.set(m[1].toUpperCase(), (out.get(m[1].toUpperCase()) ?? 0) + w);
  }
  const total = [...out.values()].reduce((s, v) => s + v, 0);
  return total > 0 ? [...out].map(([symbol, w]) => ({ symbol, weight: w / total })) : [];
}

export function HoldingsBox({ value, onChange, max }: { value: string; onChange: (v: string) => void; max: number }) {
  const parsed = parseHoldings(value);
  return (
    <Field label="Holdings" hint={`Ticker and weight, e.g. "AAPL 25, MSFT 20, SPY 55". ${parsed.length} read; up to ${max} on your plan.`}>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={`${inputCls} font-mono text-[12px]`} placeholder="AAPL 25, MSFT 20, SPY 55" />
    </Field>
  );
}

/** A small table that scrolls sideways on phones instead of the page. */
export function Table({ head, rows, minWidth = 420 }: { head: ReactNode[]; rows: ReactNode[][]; minWidth?: number }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-[11.5px]" style={{ minWidth }}>
        <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted">{head.map((h, i) => <th key={i} className={`px-1 py-1 font-medium ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className={`px-1 py-1.5 ${j ? "text-right tabular-nums text-muted" : "text-fg"}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
