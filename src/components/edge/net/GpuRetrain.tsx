"use client";

/**
 * "Retrain on a GPU": one retraining of the deal model with a wider network and more passes (premium:
 * edge.graph-gpu). Shown only when YouBank has the GPU task set up; a plan without it gets the plan
 * message in line. The weekly retraining stays on CPU and never comes here.
 */
import { useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { PlanNotice } from "@/components/billing/PlanNotice";
import { Icon } from "@/components/ui/Icon";
import { post } from "@/components/news/client";

export function GpuRetrain({ onStarted }: { onStarted: () => void }) {
  const [state, setState] = useState<{ busy: boolean; done: boolean; error: unknown }>({ busy: false, done: false, error: null });
  const start = () => {
    setState({ busy: true, done: false, error: null });
    post("/api/edge/graph/train-gpu", {}).then(() => { setState({ busy: false, done: true, error: null }); onStarted(); }, (error) => setState({ busy: false, done: false, error }));
  };
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {state.done ? <span className="text-muted">Retraining on a GPU; the scorecard updates when it finishes (about 15 minutes).</span> : (
        <button type="button" disabled={state.busy} onClick={start} title="Retrain the deal model on a GPU with a wider network and more passes" className="ctl flex items-center gap-1 border border-line px-2 py-0.5 hover:border-accent/50 disabled:opacity-50">
          <Icon name="Cpu" className="h-3 w-3" />{state.busy ? "Starting…" : "Retrain on a GPU"} <PremiumBadge feature="edge.graph-gpu" />
        </button>
      )}
      {!!state.error && <PlanNotice error={state.error} className="w-full" />}
    </span>
  );
}
