"use client";

import { metaById } from "@/lib/workflows/catalog";
import { useTool } from "@/components/workflows/useTool";
import { ToolRunner } from "@/components/workflows/ToolRunner";
import type { Inputs } from "@/lib/workflows/types";

/**
 * The runner for a shared session. It loads the tool in the browser from its id, as the Tools page
 * does: a tool definition holds functions (a calculator's compute), which cannot be sent from a server
 * component to a client one.
 */
export function SessionRunner({ toolId, initialInputs, sessionId, me }: { toolId: string; initialInputs: Inputs; sessionId: number; me: { id: string; name: string } }) {
  const tool = useTool(toolId);
  if (!metaById(toolId) || tool === null) return <p className="text-[12px] text-muted">This session points at a tool that no longer exists ({toolId}).</p>;
  if (!tool) return <div className="h-24 animate-pulse rounded bg-elevated/60" />;
  return <ToolRunner tool={tool} initialInputs={initialInputs} sessionId={sessionId} me={me} />;
}
