"use client";

/**
 * The "Source ▾" chip on a terminal screen's source badge: which source this panel uses for its main
 * dataset. "Your order" follows Settings → Data sources; picking a source applies to this panel only
 * (like typing `AAPL GP @tiingo`), and "Make default" moves it first in your order. Sources that cannot
 * answer for you (no key, switched off) are listed, disabled, with the reason. A native select, so it
 * works from the keyboard and with screen readers.
 */
import { createContext, useContext, useId, useState } from "react";
import { errorMessage } from "@/lib/client/errors";
import { loadDataSources, saveOrder } from "@/lib/client/data-sources";
import type { DatasetView } from "@/lib/market/byo/settings";
import type { DatasetName } from "@/lib/market/sources-meta";

/**
 * The data source a terminal panel asked for (`AAPL GP @tiingo`, or this chip): every request the
 * panel's screen makes carries it as `src`, and the server applies it to that screen's main dataset.
 */
export type PanelSource = { source?: string; setSource: (id: string | undefined) => void };
export const PanelSourceContext = createContext<PanelSource | undefined>(undefined);

const ORDER = "";

export function SourceChip({ dataset, answered }: { dataset: DatasetName; answered?: string }) {
  const panel = useContext(PanelSourceContext);
  // One id per chip: two panels can show the same dataset's chip at once.
  const selectId = useId();
  const [list, setList] = useState<DatasetView | null>(null);
  const [state, setState] = useState<{ open?: boolean; busy?: boolean; note?: string }>({});
  if (!panel) return null;
  const open = async () => {
    setState({ open: true, busy: true });
    try { const v = await loadDataSources(); setList(v.datasets.find((d) => d.id === dataset) ?? null); setState({ open: true }); } catch (e) { setState({ open: true, note: errorMessage(e) }); }
  };
  const makeDefault = async () => {
    if (!panel.source || !list) return;
    setState({ open: true, busy: true });
    try { await saveOrder({ [dataset]: [panel.source, ...list.sources.map((s) => s.id).filter((id) => id !== panel.source)] }); setState({ open: true, note: "Saved as your default" }); } catch (e) { setState({ open: true, note: errorMessage(e) }); }
  };
  if (!state.open) {
    return <button type="button" onClick={() => void open()} aria-haspopup="listbox" className="ml-auto rounded border border-line bg-elevated px-1.5 py-px text-[10px] text-muted hover:border-accent/50 hover:text-fg" title="Choose this panel's data source">Source: {panel.source ? list?.sources.find((s) => s.id === panel.source)?.label ?? panel.source : answered ?? "your order"} ▾</button>;
  }
  return (
    <span className="ml-auto flex items-center gap-1">
      <label className="sr-only" htmlFor={selectId}>Data source for this panel</label>
      <select id={selectId} autoFocus disabled={state.busy || !list} value={panel.source ?? ORDER} onChange={(e) => panel.setSource(e.target.value || undefined)} onKeyDown={(e) => { if (e.key === "Escape") setState({}); }} className="ctl border border-line bg-bg px-1 py-px text-[10.5px] text-fg">
        <option value={ORDER}>Your order (Settings)</option>
        {list?.sources.map((s) => <option key={s.id} value={s.id} disabled={!s.eligible} title={s.reason}>{s.label} · {s.licenceLabel}{s.eligible ? "" : ` · ${s.needsKey ? "needs key" : "unavailable"}`}</option>)}
      </select>
      {panel.source && <button type="button" disabled={state.busy} onClick={() => void makeDefault()} className="rounded border border-line px-1 text-[10px] text-muted hover:text-fg">Make default</button>}
      <button type="button" onClick={() => setState({})} aria-label="Close source picker" className="px-1 text-[11px] text-muted hover:text-fg">×</button>
      {state.note && <span role="status" className="text-[10px] text-muted">{state.note}</span>}
    </span>
  );
}
