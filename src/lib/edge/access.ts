/**
 * Who can use Edge and how they like it. Edge is an opt-in beta ("Try Edge beta" in Settings), free
 * during the beta and bounded by the AI caps and the beta limits below. Each person's switch, when they
 * turned it on and how they rank their feed live in profiles.extra.edge.
 */
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { defaultNavPrefs } from "@/lib/nav";
import type { RoleId } from "@/lib/roles";

export const WATCH_LIMIT = 5;
export const MONITOR_LIMIT = 3;

/** How the feed weighs its four signals, each 0 to 1. */
export type Blend = { relevance: number; size: number; novelty: number; confidence: number };
export type EdgePrefs = { beta: boolean; since: string | null; blend: Blend; seeded: boolean; poolContacts: boolean };

/** Each role's starting balance: markets people want what is not in the news yet; bankers want their names. */
const ROLE_BLEND: Partial<Record<RoleId, Blend>> = {
  markets: { relevance: 0.3, size: 0.2, novelty: 0.35, confidence: 0.15 },
  pe: { relevance: 0.4, size: 0.25, novelty: 0.15, confidence: 0.2 },
  vc: { relevance: 0.35, size: 0.15, novelty: 0.3, confidence: 0.2 },
  student: { relevance: 0.3, size: 0.3, novelty: 0.2, confidence: 0.2 },
};
export const defaultBlend = (role: RoleId): Blend => ROLE_BLEND[role] ?? { relevance: 0.45, size: 0.2, novelty: 0.15, confidence: 0.2 };

const unit = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

/** profiles.extra.edge, cleaned. Pure, for tests. */
export function edgePrefs(extra: unknown, role: RoleId): EdgePrefs {
  const e = ((extra as Record<string, unknown> | null)?.edge ?? {}) as Record<string, unknown>;
  const d = defaultBlend(role);
  const b = (e.blend ?? {}) as Record<string, unknown>;
  return {
    beta: e.beta === true,
    since: typeof e.since === "string" ? e.since : null,
    seeded: e.seeded === true,
    poolContacts: e.poolContacts === true,
    blend: { relevance: unit(b.relevance, d.relevance), size: unit(b.size, d.size), novelty: unit(b.novelty, d.novelty), confidence: unit(b.confidence, d.confidence) },
  };
}

export type EdgeProfile = { role: RoleId; firmTicker: string; sectors: string[]; specialty: string; extra: Record<string, unknown>; prefs: EdgePrefs };

export async function edgeProfile(userId: string): Promise<EdgeProfile | null> {
  const [p] = await requireDb().select({ role: schema.profiles.role, firmTicker: schema.profiles.firmTicker, sectors: schema.profiles.sectors, specialty: schema.profiles.specialty, extra: schema.profiles.extra })
    .from(schema.profiles).where(eq(schema.profiles.userId, userId));
  if (!p) return null;
  const role = p.role as RoleId;
  return { role, firmTicker: p.firmTicker, sectors: p.sectors, specialty: p.specialty, extra: p.extra ?? {}, prefs: edgePrefs(p.extra, role) };
}

export const NOT_IN_BETA = "Edge is in beta. Turn it on in Settings, under Labs, to use it.";

/** The person's Edge profile, or a 403 that tells them where the switch is. */
export async function requireEdge(userId: string): Promise<EdgeProfile> {
  const p = await edgeProfile(userId);
  if (!p?.prefs.beta) throw Object.assign(new Error(NOT_IN_BETA), { status: 403 });
  return p;
}

/** Save changes to profiles.extra.edge (and, when turning the beta on, pin the tab). */
export async function saveEdge(userId: string, patch: Partial<Omit<EdgePrefs, "blend">> & { blend?: Partial<Blend> }, opts: { pin?: boolean } = {}): Promise<EdgePrefs> {
  const p = await edgeProfile(userId);
  if (!p) throw Object.assign(new Error("Finish setting up your profile first."), { status: 400 });
  const cur = (p.extra.edge ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...cur };
  if (patch.beta !== undefined) { next.beta = patch.beta; if (patch.beta && !cur.since) next.since = new Date().toISOString(); }
  if (patch.seeded !== undefined) next.seeded = patch.seeded;
  if (patch.poolContacts !== undefined) next.poolContacts = patch.poolContacts;
  if (patch.blend) {
    const b = patch.blend, cur = p.prefs.blend;
    next.blend = { relevance: unit(b.relevance, cur.relevance), size: unit(b.size, cur.size), novelty: unit(b.novelty, cur.novelty), confidence: unit(b.confidence, cur.confidence) };
  }
  const extra: Record<string, unknown> = { ...p.extra, edge: next };
  if (opts.pin) {
    const saved = p.extra.nav as { pinned?: unknown } | undefined;
    const nav = saved && Array.isArray(saved.pinned) ? saved as { pinned: unknown[] } : defaultNavPrefs(p.role);
    if (!nav.pinned.includes("edge")) extra.nav = { ...nav, pinned: [...nav.pinned, "edge"] };
  }
  await requireDb().update(schema.profiles).set({ extra, updatedAt: new Date() }).where(eq(schema.profiles.userId, userId));
  return edgePrefs(extra, p.role);
}
