"use client";

import { useEffect, useId, useState } from "react";
import type { Field, Inputs } from "@/lib/workflows/types";
import type { TickerRow } from "@/lib/types";

const ctl = "ctl w-full border border-line bg-bg px-2.5 py-1.5 text-[12.5px] text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20";

function TickerInput({ value, onChange, placeholder, multiple = false }: { value: string; onChange: (v: string) => void; placeholder?: string; multiple?: boolean }) {
  const [rows, setRows] = useState<TickerRow[]>([]);
  const id = useId();
  const last = multiple ? value.split(/[\s,]+/).pop() ?? "" : value;
  useEffect(() => {
    if (!last) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => fetch(`/api/search?q=${encodeURIComponent(last)}`, { signal: ctrl.signal }).then((r) => r.json()).then((r: TickerRow[]) => setRows(Array.isArray(r) ? r : [])).catch(() => {}), 140);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [last]);
  return (
    <>
      <input list={id} value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} placeholder={placeholder} spellCheck={false} autoComplete="off" className={`${ctl} num uppercase`} />
      <datalist id={id}>{(last ? rows : []).map((r) => <option key={r.ticker} value={multiple ? value.replace(/[^\s,]*$/, r.ticker) : r.ticker}>{r.name}</option>)}</datalist>
    </>
  );
}

function CsvInput({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const lines = value ? value.split("\n").filter((l) => l.trim()).length : 0;
  const onFile = (f: File | undefined) => { if (!f) return; const r = new FileReader(); r.onload = () => onChange(String(r.result ?? "")); r.readAsText(f); };
  return (
    <div>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={6} placeholder={field.placeholder ?? (field.columns ? `Paste CSV with columns: ${field.columns}` : "Paste CSV or TSV data")} spellCheck={false}
        className={`${ctl} num resize-y`} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }} onDragOver={(e) => e.preventDefault()} />
      <div className="mt-1 flex items-center gap-2 text-[10.5px] text-muted">
        <label className="cursor-pointer rounded border border-line px-2 py-0.5 hover:border-accent/50 hover:text-fg">Upload file<input type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        <span>{lines ? `${lines} lines` : "or drag a file here"}</span>
        {field.columns && <span className="truncate">· columns: {field.columns}</span>}
      </div>
    </div>
  );
}

export function FieldsForm({ fields, values, onChange, columns = 2 }: { fields: Field[]; values: Inputs; onChange: (next: Inputs) => void; columns?: 1 | 2 | 3 }) {
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  return (
    <div className={`grid gap-3 ${columns === 3 ? "md:grid-cols-3" : columns === 2 ? "md:grid-cols-2" : ""}`}>
      {fields.map((f) => {
        const v = values[f.key];
        const wide = f.type === "csv" || f.type === "textarea" || f.type === "multiselect";
        return (
          <label key={f.key} className={`block ${wide ? "md:col-span-full" : ""}`}>
            <span className="mb-1 flex items-baseline justify-between text-[10.5px] uppercase tracking-wider text-muted">
              <span>{f.label}{f.required && <span className="text-accent"> *</span>}</span>
              {f.unit && <span className="num normal-case tracking-normal text-faint">{f.unit}</span>}
            </span>
            {f.type === "ticker" && <TickerInput value={String(v ?? "")} onChange={(x) => set(f.key, x)} placeholder={f.placeholder ?? "Ticker"} />}
            {f.type === "tickers" && <TickerInput multiple value={Array.isArray(v) ? v.join(" ") : String(v ?? "")} onChange={(x) => set(f.key, x)} placeholder={f.placeholder ?? "Tickers, space separated"} />}
            {f.type === "text" && <input value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} className={ctl} />}
            {f.type === "date" && <input type="date" value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} className={`${ctl} num`} />}
            {f.type === "number" && (
              <input type="number" value={v === undefined || v === null ? "" : String(v)} onChange={(e) => set(f.key, e.target.value === "" ? undefined : Number(e.target.value))} placeholder={f.placeholder} min={f.min} max={f.max} step={f.step ?? "any"} className={`${ctl} num`} />
            )}
            {f.type === "textarea" && <textarea value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} rows={5} placeholder={f.placeholder} className={`${ctl} resize-y`} />}
            {f.type === "csv" && <CsvInput field={f} value={String(v ?? "")} onChange={(x) => set(f.key, x)} />}
            {f.type === "select" && (
              <select value={String(v ?? f.options?.[0] ?? "")} onChange={(e) => set(f.key, e.target.value)} className={ctl}>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {f.type === "multiselect" && (
              <div className="flex flex-wrap gap-1.5">
                {(f.options ?? []).map((o) => {
                  const sel = Array.isArray(v) && (v as string[]).includes(o);
                  return <button key={o} type="button" onClick={() => set(f.key, sel ? (v as string[]).filter((x) => x !== o) : [...((v as string[]) ?? []), o])} className={`rounded-full border px-2.5 py-1 text-[11.5px] transition ${sel ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-accent/50 hover:text-fg"}`}>{o}</button>;
                })}
              </div>
            )}
            {f.type === "toggle" && (
              <button type="button" onClick={() => set(f.key, !v)} className={`flex h-8 items-center gap-2 text-[12px] ${v ? "text-fg" : "text-muted"}`}>
                <span className={`relative h-4 w-7 rounded-full transition ${v ? "bg-accent" : "bg-line-strong"}`}><span className={`absolute top-0.5 h-3 w-3 rounded-full bg-bg transition ${v ? "left-3.5" : "left-0.5"}`} /></span>{v ? "Yes" : "No"}
              </button>
            )}
            {f.help && <span className="mt-1 block text-[10.5px] text-muted">{f.help}</span>}
          </label>
        );
      })}
    </div>
  );
}

/** Fill defaults for a field list. */
export function defaultInputs(fields: Field[], base: Inputs = {}): Inputs {
  const out: Inputs = { ...base };
  for (const f of fields) if (out[f.key] === undefined && f.default !== undefined) out[f.key] = f.default;
  return out;
}
