/**
 * Full tool definitions, loaded one pack at a time when a tool is opened. Each pack is its own
 * chunk, so listing tools never downloads prompts or calculator code.
 */
import { metaById, type PackId } from "./catalog";
import type { ToolDef } from "./types";

const PACKS: Record<PackId, () => Promise<unknown>> = {
  core: () => import("./packs/core").then((m) => m.CORE_PACK),
  banker: () => import("./packs/banker").then((m) => m.BANKER_PACK),
  pe: () => import("./packs/pe").then((m) => m.PE_PACK),
  vc: () => import("./packs/vc").then((m) => m.VC_PACK),
  markets: () => import("./packs/markets").then((m) => m.MARKETS_PACK),
  corpfin: () => import("./packs/corpfin").then((m) => m.CORPFIN_PACK),
  consultant: () => import("./packs/consultant").then((m) => m.CONSULTANT_PACK),
  accountant: () => import("./packs/accountant").then((m) => m.ACCOUNTANT_PACK),
  student: () => import("./packs/student").then((m) => m.STUDENT_PACK),
  inference: () => import("./packs/inference").then((m) => m.INFERENCE_PACK),
};

const loaded = new Map<PackId, Promise<ToolDef[]>>();

export async function loadTool(id: string): Promise<ToolDef | undefined> {
  const meta = metaById(id);
  if (!meta) return undefined;
  if (!loaded.has(meta.pack)) loaded.set(meta.pack, PACKS[meta.pack]().then((p) => (Array.isArray(p) ? (p as ToolDef[]) : [])));
  return (await loaded.get(meta.pack)!).find((t) => t.id === id);
}
