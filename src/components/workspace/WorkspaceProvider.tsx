"use client";

import { createContext, useContext, useMemo } from "react";
import { workspaceFor, type Profile, type WorkspaceConfig } from "@/lib/roles";

type Workspace = { profile: Profile; config: WorkspaceConfig; /** Whether the person has the Edge beta on. */ edge: boolean };
const Ctx = createContext<Workspace | null>(null);

export function WorkspaceProvider({ profile, edge = false, children }: { profile: Profile; edge?: boolean; children: React.ReactNode }) {
  const value = useMemo(() => ({ profile, config: workspaceFor(profile), edge }), [profile, edge]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const FALLBACK: Profile = { role: "banker", specialty: "Technology M&A", seniority: "", firmType: "", firmName: "", firmTicker: "", sectors: [], goals: "" };

/** Workspace config for the signed-in user's role. Falls back to a tech banker when used outside the provider. */
export function useWorkspace(): Workspace {
  const v = useContext(Ctx);
  return v ?? { profile: FALLBACK, config: workspaceFor(FALLBACK), edge: false };
}
