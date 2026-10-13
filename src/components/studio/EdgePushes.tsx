"use client";

/**
 * Edge results waiting to go into this model: what each would add (new sheets and slides, never edits
 * to existing cells), with Accept (added as one run, undone from History like the agent's) and Dismiss.
 * Shown only while something is waiting.
 */
import { Check, Loader2, Radar, X } from "lucide-react";
import { useState } from "react";
import { post, useApi } from "@/components/news/client";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { errorMessage } from "@/lib/client/errors";

type Pending = { id: number; title: string; kind: string; source: string; createdAt: string; mine: boolean; text: string; sheets: string[]; slides: string[] };

export function EdgePushes({ docId, onAccepted }: { docId: number; onAccepted?: (label: string) => void }) {
  // People with the Edge beta check every minute; teammates without it see what is waiting when they open the model.
  const { edge } = useWorkspace();
  const { data, reload } = useApi<{ pushes: Pending[] }>(`/api/edge/pushes?doc=${docId}`, edge ? 60_000 : 0);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data?.pushes.length) return null;
  const decide = async (id: number, action: "accept" | "dismiss") => {
    setBusy(id); setError(null);
    try {
      const r = await post<{ status: string; label?: string }>(`/api/edge/pushes/${id}`, { action });
      if (r.status === "accepted") onAccepted?.(r.label ?? "Added from Edge");
      reload();
    } catch (e) { setError(errorMessage(e)); reload(); } finally { setBusy(null); }
  };
  return (
    <div className="border-b border-line bg-accent-soft/20 px-3 py-2 text-[11.5px]">
      <p className="flex items-center gap-1.5 font-semibold"><Radar className="h-3.5 w-3.5 text-accent" />From Edge, waiting for you</p>
      <ul className="mt-1.5 space-y-1.5">
        {data.pushes.map((p) => (
          <li key={p.id} className="ctl border border-line bg-bg/60 p-2">
            <p className="font-medium">{p.title}</p>
            <p className="mt-0.5 text-[10.5px] text-muted">Adds {[p.sheets.length ? `sheet${p.sheets.length === 1 ? "" : "s"} ${p.sheets.join(", ")}` : "", p.slides.length ? `${p.slides.length} slide${p.slides.length === 1 ? "" : "s"}${p.slides[0] ? ` (${p.slides.slice(0, 2).join("; ")}${p.slides.length > 2 ? "…" : ""})` : ""}` : ""].filter(Boolean).join(" and ") || p.text || "nothing new"}. Your own cells are not touched.</p>
            <div className="mt-1.5 flex gap-2">
              <button type="button" disabled={busy !== null} onClick={() => void decide(p.id, "accept")} className="ctl flex items-center gap-1 bg-accent px-2 py-0.5 font-semibold text-bg disabled:opacity-50">{busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}Accept</button>
              <button type="button" disabled={busy !== null} onClick={() => void decide(p.id, "dismiss")} className="ctl flex items-center gap-1 border border-line px-2 py-0.5 text-muted hover:text-fg disabled:opacity-50"><X className="h-3 w-3" />Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="mt-1 text-neg">{error}</p>}
    </div>
  );
}
