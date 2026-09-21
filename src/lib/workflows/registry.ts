import type { Profile, RoleId } from "@/lib/roles";
import { toolApplies, type CalculatorDef, type ToolDef, type WorkflowDef } from "./types";
import { CORE_PACK } from "./packs/core";
import { BANKER_PACK } from "./packs/banker";
import { PE_PACK } from "./packs/pe";
import { VC_PACK } from "./packs/vc";
import { MARKETS_PACK } from "./packs/markets";
import { CORPFIN_PACK } from "./packs/corpfin";
import { CONSULTANT_PACK } from "./packs/consultant";
import { ACCOUNTANT_PACK } from "./packs/accountant";
import { STUDENT_PACK } from "./packs/student";

/** Every tool, de-duplicated by id (first definition wins). A pack that fails to load is skipped, not fatal. */
export const ALL_TOOL_DEFS: ToolDef[] = (() => {
  const packs: unknown[] = [CORE_PACK, BANKER_PACK, PE_PACK, VC_PACK, MARKETS_PACK, CORPFIN_PACK, CONSULTANT_PACK, ACCOUNTANT_PACK, STUDENT_PACK];
  const seen = new Set<string>();
  const out: ToolDef[] = [];
  for (const pack of packs) {
    if (!Array.isArray(pack)) continue;
    for (const t of pack as ToolDef[]) {
      if (!t?.id || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
})();

export const toolById = (id: string): ToolDef | undefined => ALL_TOOL_DEFS.find((t) => t.id === id);
export const isWorkflow = (t: ToolDef): t is WorkflowDef => t.kind === "ai";
export const isCalculator = (t: ToolDef): t is CalculatorDef => t.kind === "calc";

/** Tools for a profile: specialty matches first, then role matches, then shared tools. */
export function toolsFor(profile: Pick<Profile, "role" | "specialty">): ToolDef[] {
  const score = (t: ToolDef) => (t.roles !== "all" && t.specialties?.includes(profile.specialty) ? 0 : t.roles !== "all" ? 1 : 2);
  return ALL_TOOL_DEFS.filter((t) => toolApplies(t, profile.role, profile.specialty)).sort((a, b) => score(a) - score(b) || a.title.localeCompare(b.title));
}

export function toolsForRole(role: RoleId): ToolDef[] {
  return ALL_TOOL_DEFS.filter((t) => t.roles === "all" || t.roles.includes(role));
}

export const toolCount = () => ({ total: ALL_TOOL_DEFS.length, ai: ALL_TOOL_DEFS.filter(isWorkflow).length, calc: ALL_TOOL_DEFS.filter(isCalculator).length });
