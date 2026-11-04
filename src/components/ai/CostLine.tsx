"use client";

import { useEffect, useState } from "react";
import { costLine, type Estimate } from "@/lib/ai/cost-preview";

/**
 * What a run like this usually costs, before it starts (src/lib/ai/cost-preview.ts): one quiet line, or
 * nothing when there is no history yet or the estimate could not be read.
 */
export function CostLine({ feature, what, className = "" }: { feature: string; what?: string; className?: string }) {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/ai/estimate?feature=${encodeURIComponent(feature)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Estimate>) : null))
      .then((e) => { if (live && e) setLine(costLine(e, what)); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [feature, what]);
  return line ? <p className={`text-[10.5px] text-muted ${className}`}>{line}</p> : null;
}
