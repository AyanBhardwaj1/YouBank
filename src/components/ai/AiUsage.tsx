"use client";

import { useEffect, useState } from "react";

type Row = { calls: number; cost: number; input: number; cached: number; output: number; feature?: string; model?: string };
type Usage = { total: Row; byFeature: Row[]; byModel: Row[] };

const usd = (v: number) => (v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`);
const tokens = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v));
const FEATURES: Record<string, string> = {
  "terminal-ai": "Terminal assistant", studio: "Studio agent", email_triage: "Email triage", email_draft: "Email drafts", lead_qualification: "Lead qualification",
  nurture_decision: "Nurture", campaign_step: "Campaign steps", compose_email: "New emails", edit_lessons: "Lessons from edits", writing_voice: "Writing voice",
  playbook_entry: "Playbook answers", markup: "Markup reading", data_room_tables: "Data-room extraction", chat: "Assistant",
};
const label = (f?: string) => (f ? FEATURES[f] ?? (f.startsWith("tool:") ? `Tool: ${f.slice(5)}` : f) : "");

/** Cost of AI over the last 30 days, and the switch that sends background work to smaller models. */
export function AiUsage({ routing, onRouting }: { routing: boolean; onRouting: (v: boolean) => void }) {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => { fetch("/api/ai/usage").then((r) => r.json()).then((d) => { if (d?.total) setU(d); }).catch(() => undefined); }, []);
  const cachedShare = u && u.total.input ? u.total.cached / u.total.input : 0;
  return (
    <div className="mt-6 space-y-3">
      <label className="flex max-w-[75ch] items-start gap-2 text-[12px]">
        <input type="checkbox" className="mt-0.5" checked={routing} onChange={(e) => onRouting(e.target.checked)} />
        <span><span className="font-semibold">Save on background work.</span> <span className="text-muted">Email triage, lead qualification and lessons run on a small model at low effort, and drafts on a mid-size one. Chat, tools and Studio always use the model above. Background work usually costs a small fraction of what it would on the flagship.</span></span>
      </label>
      <div className="ctl border border-line bg-panel p-3">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <h3 className="text-[13px] font-semibold">AI usage, last 30 days</h3>
          {u && <span className="num text-[12px]">{usd(u.total.cost)} · {u.total.calls} calls · {tokens(u.total.input)} in / {tokens(u.total.output)} out · {(cachedShare * 100).toFixed(0)}% of input from the prompt cache</span>}
        </div>
        <p className="mt-1 text-[11px] text-muted">At list prices. Cached input costs a tenth of fresh input, which is why prompts are arranged so the stable part comes first.</p>
        {!u ? <p className="mt-2 text-[11.5px] text-muted">Loading…</p> : u.total.calls === 0 ? <p className="mt-2 text-[11.5px] text-muted">No AI calls yet.</p> : (
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <div className="table-scroll"><table className="w-full text-[11.5px]">
              <thead className="text-[10px] uppercase tracking-wider text-muted"><tr><th className="py-1 text-left font-normal">Feature</th><th className="py-1 text-right font-normal">Calls</th><th className="py-1 text-right font-normal">Cost</th></tr></thead>
              <tbody>{u.byFeature.map((r) => <tr key={r.feature} className="border-t border-line"><td className="py-1">{label(r.feature)}</td><td className="num py-1 text-right">{r.calls}</td><td className="num py-1 text-right">{usd(r.cost)}</td></tr>)}</tbody>
            </table></div>
            <div className="table-scroll"><table className="w-full text-[11.5px]">
              <thead className="text-[10px] uppercase tracking-wider text-muted"><tr><th className="py-1 text-left font-normal">Model</th><th className="py-1 text-right font-normal">Calls</th><th className="py-1 text-right font-normal">Cached</th><th className="py-1 text-right font-normal">Cost</th></tr></thead>
              <tbody>{u.byModel.map((r) => <tr key={r.model} className="border-t border-line"><td className="py-1">{r.model}</td><td className="num py-1 text-right">{r.calls}</td><td className="num py-1 text-right">{r.input ? `${((r.cached / r.input) * 100).toFixed(0)}%` : "n/a"}</td><td className="num py-1 text-right">{usd(r.cost)}</td></tr>)}</tbody>
            </table></div>
          </div>
        )}
      </div>
    </div>
  );
}
