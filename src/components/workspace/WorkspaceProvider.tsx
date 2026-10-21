"use client";

import { createContext, useContext, useMemo } from "react";
import { workspaceFor, type Profile, type WorkspaceConfig } from "@/lib/roles";
import type { ToolMeta } from "@/lib/workflows/catalog";

type Workspace = {
  profile: Profile; config: WorkspaceConfig; /** Whether the person has the Edge beta on. */ edge: boolean;
  /**
   * The tools for this person (catalogFor(profile)), worked out on the server by the workspace layout, so the
   * full catalog of every role stays out of the JavaScript every signed-in page loads.
   */
  tools: ToolMeta[];
};
const Ctx = createContext<Workspace | null>(null);

const NO_TOOLS: ToolMeta[] = [];

export function WorkspaceProvider({ profile, edge = false, tools = NO_TOOLS, children }: { profile: Profile; edge?: boolean; tools?: ToolMeta[]; children: React.ReactNode }) {
  const value = useMemo(() => ({ profile, config: workspaceFor(profile), edge, tools }), [profile, edge, tools]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const FALLBACK: Profile = { role: "banker", specialty: "Technology M&A", seniority: "", firmType: "", firmName: "", firmTicker: "", sectors: [], goals: "" };

/** Workspace config for the signed-in user's role. Falls back to a tech banker when used outside the provider. */
export function useWorkspace(): Workspace {
  const v = useContext(Ctx);
  return v ?? { profile: FALLBACK, config: workspaceFor(FALLBACK), edge: false, tools: [] };
}
