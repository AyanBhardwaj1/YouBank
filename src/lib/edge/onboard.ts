/**
 * Day one on Edge: the first time a person opens it, the tab is pinned, three watches are seeded from
 * their desk and checked, and a first canvas is built from
 * the person's role (deal people get the buyer finder once the deal model has trained; everyone else
 * the asset watch with a deal pro-forma) with their companies, and run at once, so the feed and a
 * finished canvas are waiting when they arrive.
 */
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { logError } from "@/lib/errors";
import type { Profile, RoleId } from "@/lib/roles";
import { claimEdgeSeed, saveEdge } from "./access";
import { TEMPLATE } from "./canvas/catalog";
import { startRun } from "./canvas/engine";
import { createCanvas } from "./canvas/store";
import { latestModels } from "./graph/train";
import { availableTypes } from "./runtime";
import { checkWatch, seedWatches } from "./watches";

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

/**
 * First-visit setup, once per person: pins the tab and seeds three watches now, and returns the slower
 * part (the first canvas and the watches' first checks) for the caller to run after the response, or
 * null when this person was already set up.
 */
export async function onboardEdge(user: CurrentUser): Promise<(() => Promise<void>) | null> {
  if (!(await claimEdgeSeed(user.id))) return null;
  const [row] = await requireDb().select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  if (!row) return null;
  const profile: Profile = { role: row.role as RoleId, specialty: row.specialty, seniority: row.seniority, firmType: row.firmType, firmName: row.firmName, firmTicker: row.firmTicker, sectors: row.sectors, goals: row.goals, name: user.name };
  await saveEdge(user.id, {}, { pin: true });
  const seeded = await seedWatches(user.id, profile);
  const tickers = seeded.filter((w) => w.kind === "company" && w.target.ticker).map((w) => w.target.ticker!);
  return async () => {
    const deadline = Date.now() + 50_000;
    // A first canvas, built for their role and run, then the watches' first checks.
    await starterCanvas(user, profile.role, tickers);
    for (const w of seeded) await checkWatch(w, deadline, 2);
  };
}
