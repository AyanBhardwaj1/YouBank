/**
 * The tool catalog: what a page needs to list, search and link to tools (id, pack, card fields),
 * generated from the packs by scripts/gen-catalog.ts. The full definitions (prompts, calculator
 * code) load per pack when a tool is opened; see load.ts.
 */
import type { Profile, RoleId } from "@/lib/roles";
import type { ToolCategory } from "./categories";
import { TOOL_CATALOG } from "./catalog.gen";
import { toolApplies } from "./types";

export type PackId = "core" | "banker" | "pe" | "vc" | "markets" | "corpfin" | "consultant" | "accountant" | "student" | "inference";

export type ToolMeta = {
  id: string;
  kind: "ai" | "calc";
  pack: PackId;
  title: string;
  tagline: string;
  roles: RoleId[] | "all";
  specialties?: string[];
  category: ToolCategory;
  icon: string;
  tags?: string[];
  savesMinutes?: number;
};

export { TOOL_CATALOG };

export const metaById = (id: string): ToolMeta | undefined => TOOL_CATALOG.find((t) => t.id === id);

/** Tools for a profile: specialty matches first, then role matches, then shared tools (as the registry orders them). */
export function catalogFor(profile: Pick<Profile, "role" | "specialty">): ToolMeta[] {
  const score = (t: ToolMeta) => (t.roles !== "all" && t.specialties?.includes(profile.specialty) ? 0 : t.roles !== "all" ? 1 : 2);
  return TOOL_CATALOG.filter((t) => toolApplies(t, profile.role, profile.specialty)).sort((a, b) => score(a) - score(b) || a.title.localeCompare(b.title));
}

export const catalogCount = () => ({ total: TOOL_CATALOG.length, ai: TOOL_CATALOG.filter((t) => t.kind === "ai").length, calc: TOOL_CATALOG.filter((t) => t.kind === "calc").length });

export function catalogForRole(role: RoleId): ToolMeta[] {
  return TOOL_CATALOG.filter((t) => t.roles === "all" || t.roles.includes(role));
}
