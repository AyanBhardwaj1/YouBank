/**
 * Day one on Edge: after the beta turns on and three watches are seeded, a first canvas is built from
 * the person's role (deal people get the buyer finder once the deal model has trained; everyone else
 * the asset watch with a deal pro-forma) with their companies, and run at once, so the feed and a
 * finished canvas are waiting when they arrive.
 */
import type { CurrentUser } from "@/lib/auth/user";
import { logError } from "@/lib/errors";
import type { RoleId } from "@/lib/roles";
import { TEMPLATE } from "./canvas/catalog";
import { startRun } from "./canvas/engine";
import { createCanvas } from "./canvas/store";
import { latestModels } from "./graph/train";
import { availableTypes } from "./runtime";

const ROLE_TEMPLATE: Partial<Record<RoleId, string>> = { banker: "buyer-finder", pe: "buyer-finder", corpfin: "buyer-finder", markets: "supply-shock", vc: "supply-shock" };

/** The starter template for a role, falling back to the asset watch when its blocks are not ready. Pure. */
export function starterTemplate(role: RoleId, modelReady: boolean, available: Set<string>): string {
  const want = ROLE_TEMPLATE[role] ?? "asset-watch";
  const id = want === "buyer-finder" && !modelReady ? "asset-watch" : want;
  const t = TEMPLATE[id];
  return t && t.build({ tickers: ["ET", "KMI"] }).nodes.every((n) => available.has(n.type)) ? id : "asset-watch";
}

/** Build and run the first canvas; returns its id and the run's, or null when it could not be made. */
export async function starterCanvas(user: CurrentUser | { id: string; email: string; name: string }, role: RoleId, tickers: string[]): Promise<{ canvasId: number; runId: number } | null> {
  try {
    const [model] = await latestModels();
    const id = starterTemplate(role, !!model, availableTypes());
    const t = TEMPLATE[id];
    const graph = t.build({ tickers: tickers.length ? tickers.slice(0, 3) : ["ET", "KMI"] });
    const canvas = await createCanvas(user as CurrentUser, { title: `Your first canvas: ${t.title}`, graph, template: t.id, teamId: null });
    const runId = await startRun(user, canvas.id, "onboarding");
    return { canvasId: canvas.id, runId };
  } catch (e) {
    logError(e, { where: "edge-onboard" });
    return null;
  }
}
