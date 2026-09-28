"use client";

import Link from "next/link";
import { metaById } from "@/lib/workflows/catalog";
import { useTool } from "@/components/workflows/useTool";
import { ToolRunner } from "@/components/workflows/ToolRunner";

export function ToolPageClient({ id, runId, ticker }: { id: string; runId?: number; ticker?: string }) {
  const meta = metaById(id);
  const tool = useTool(id);
  if (!meta || tool === null) return <div className="p-6 text-muted">Unknown tool.</div>;
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1280px] px-4 py-4">
        <div className="mb-3 text-[11px] text-muted"><Link href="/app/tools" className="hover:text-fg">← All tools</Link></div>
        {tool
          ? <ToolRunner key={`${id}-${runId ?? ""}`} tool={tool} runId={runId} ticker={ticker} />
          : <div className="ctl border border-line bg-panel p-4 text-[12px] text-muted"><span className="font-semibold text-fg">{meta.title}</span> · {meta.tagline}<div className="mt-2 h-24 animate-pulse rounded bg-elevated/60" /></div>}
      </div>
    </div>
  );
}
