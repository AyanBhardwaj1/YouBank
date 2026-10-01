"use client";

/**
 * Send Edge results to a Studio model, for review there: pick one of the person's models (or a new one)
 * and the results wait in its side panel until someone accepts them. Nothing is written to the model
 * until then.
 */
import { ArrowRight, FileSpreadsheet, Loader2 } from "lucide-react";
import { useState } from "react";
import { Select } from "@/components/ui/Select";
import { post, useApi } from "./client";

type Docs = { docs: { id: number; title: string; mine: boolean }[] };

export function SendToStudio({ title, source, items }: { title: string; source: string; items: { label: string; value: unknown }[] }) {
  const [open, setOpen] = useState(false);
  const docs = useApi<Docs>(open ? "/api/studio" : null);
  const [target, setTarget] = useState("new");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await post<{ url: string }>("/api/edge/pushes", { docId: target === "new" ? null : Number(target), title, source, items });
      setDone(r.url); setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  if (done) return <a href={done} className="inline-flex items-center gap-1 text-[11.5px] text-accent hover:underline">Waiting for review in Studio <ArrowRight className="h-3 w-3" /></a>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="ctl inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted hover:border-accent/50 hover:text-fg"><FileSpreadsheet className="h-3.5 w-3.5" />Send to Studio</button>;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
      <Select value={target} onChange={setTarget} aria-label="Studio model" className="ctl max-w-[260px] border border-line bg-bg px-2 py-1 text-left">
        <option value="new">A new model</option>
        {(docs.data?.docs ?? []).slice(0, 40).map((d) => <option key={d.id} value={String(d.id)}>{d.title}</option>)}
      </Select>
      <button type="button" disabled={busy} onClick={() => void send()} className="ctl flex items-center gap-1 bg-accent px-2.5 py-1 font-semibold text-accent-fg disabled:opacity-50">{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSpreadsheet className="h-3 w-3" />}Send for review</button>
      <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-fg">Cancel</button>
      {error && <span className="text-neg">{error}</span>}
    </div>
  );
}
