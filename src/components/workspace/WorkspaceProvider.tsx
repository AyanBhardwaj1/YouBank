"use client";

import { createContext, useContext, useMemo } from "react";
import { workspaceFor, type Profile, type WorkspaceConfig } from "@/lib/roles";

const Ctx = createContext<{ profile: Profile; config: WorkspaceConfig } | null>(null);

export function WorkspaceProvider({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const value = useMemo(() => ({ profile, config: workspaceFor(profile) }), [profile]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const FALLBACK: Profile = { role: "banker", specialty: "Technology M&A", seniority: "", firmType: "", firmName: "", firmTicker: "", sectors: [], goals: "" };

/** Workspace config for the signed-in user's role. Falls back to a tech banker when used outside the provider. */
export function useWorkspace(): { profile: Profile; config: WorkspaceConfig } {
  const v = useContext(Ctx);
  return v ?? { profile: FALLBACK, config: workspaceFor(FALLBACK) };
}
