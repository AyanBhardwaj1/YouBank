"use client";

import { useEffect, useState } from "react";
import { loadTool } from "@/lib/workflows/load";
import type { ToolDef } from "@/lib/workflows/types";

/** A tool's full definition, loaded on demand: undefined while loading, null if there is no such tool. */
export function useTool(id: string): ToolDef | null | undefined {
  const [state, setState] = useState<{ id: string; tool: ToolDef | null } | null>(null);
  useEffect(() => {
    let live = true;
    loadTool(id).then((tool) => { if (live) setState({ id, tool: tool ?? null }); }).catch(() => { if (live) setState({ id, tool: null }); });
    return () => { live = false; };
  }, [id]);
  return state && state.id === id ? state.tool : undefined;
}
