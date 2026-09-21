"use client";

import Link from "next/link";
import { toolById } from "@/lib/workflows/registry";
import { ToolRunner } from "@/components/workflows/ToolRunner";

export function ToolPageClient({ id, runId, ticker }: { id: string; runId?: number; ticker?: string }) {
  const tool = toolById(id);
  if (!tool) return <div className="p-6 text-muted">Unknown tool.</div>;
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1280px] px-4 py-4">
        <div className="mb-3 text-[11px] text-muted"><Link href="/app/tools" className="hover:text-fg">← All tools</Link></div>
        <ToolRunner key={`${id}-${runId ?? ""}`} tool={tool} runId={runId} ticker={ticker} />
      </div>
    </div>
  );
}
