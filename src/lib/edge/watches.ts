/**
 * What people follow in Edge: companies (and the assets under them) and places. Each person has up to
 * five during the beta; their team's watches show in their feed too. Turning Edge on seeds three from
 * the person's desk (their firm and watchlist names with mapped assets, and the Permian) and checks them
 * straight away, so the feed has something on day one.
 */
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { EdgeWatchTarget } from "@/db/schema";
import { logError } from "@/lib/errors";
import { workspaceFor, type Profile } from "@/lib/roles";
import { myTeamIds } from "@/lib/teams/db";
import { WATCH_LIMIT } from "./access";
import { COVERED, ensureMaps } from "./assets";
import { MAPPED_COMPANIES } from "./companies";
import { checkTarget } from "./detect";
import { PLACES, type Bbox } from "./sources/eia";

export { COVERED };

export type WatchKind = "company" | "place";
export type Watch = { id: number; kind: WatchKind; label: string; target: EdgeWatchTarget; mine: boolean; teamId: number | null; createdAt: string; lastCheckedAt: string | null };

/** Profiles (joined as schema.profiles) that have the Edge beta on. */
export const BETA_ON = sql`${schema.profiles.extra}->'edge'->>'beta' = 'true'`;

const toWatch = (r: typeof schema.edgeWatches.$inferSelect, userId: string): Watch => ({
  id: r.id, kind: r.kind as WatchKind, label: r.label, target: r.target, mine: r.userId === userId, teamId: r.teamId,
  createdAt: r.createdAt.toISOString(), lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
});

/** The person's own watches and their teams' shared ones. */
export async function listWatches(userId: string): Promise<Watch[]> {
  const teams = await myTeamIds(userId);
  const rows = await requireDb().select().from(schema.edgeWatches)
    .where(teams.length ? or(eq(schema.edgeWatches.userId, userId), inArray(schema.edgeWatches.teamId, teams)) : eq(schema.edgeWatches.userId, userId))
    .orderBy(asc(schema.edgeWatches.createdAt)).limit(200);
  return rows.map((r) => toWatch(r, userId));
}

export type WatchInput = { kind?: unknown; ticker?: unknown; place?: unknown; bbox?: unknown; label?: unknown; teamId?: unknown };

const isBbox = (v: unknown): v is Bbox => Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && Number.isFinite(n)) && v[0] < v[2] && v[1] < v[3] && v[0] >= -180 && v[2] <= 180 && v[1] >= -90 && v[3] <= 90;

/** A request's watch as a stored target, or a message saying what is wrong. Pure, for tests. */
export function parseWatch(input: WatchInput): { kind: WatchKind; label: string; target: EdgeWatchTarget } | string {
  if (input.kind === "company") {
    const t = typeof input.ticker === "string" ? input.ticker.trim().toUpperCase() : "";
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)) return "Pick a company by its ticker.";
    const known = MAPPED_COMPANIES.find((c) => c.ticker === t);
    return { kind: "company", label: known?.company ?? t, target: { ticker: t, company: known?.company ?? "" } };
  }
  if (input.kind === "place") {
    if (typeof input.place === "string" && PLACES[input.place]) return { kind: "place", label: PLACES[input.place].name, target: { place: input.place, bbox: PLACES[input.place].bbox } };
    if (isBbox(input.bbox)) {
      const [x0, y0, x1, y1] = input.bbox;
      if ((x1 - x0) * (y1 - y0) > 25) return "That area is too big to watch; draw one under about 500 km across.";
      const label = typeof input.label === "string" && input.label.trim() ? input.label.trim().slice(0, 80) : "Drawn area";
      return { kind: "place", label, target: { bbox: [x0, y0, x1, y1].map((v) => Math.round(v * 1e5) / 1e5) as Bbox, name: label } };
    }
    return "Pick a place or draw one on the map.";
  }
  return "Watch a company or a place.";
}

export async function addWatch(userId: string, input: WatchInput): Promise<Watch> {
  const parsed = parseWatch(input);
  if (typeof parsed === "string") throw Object.assign(new Error(parsed), { status: 400 });
  const db = requireDb();
  const mine = await db.select({ id: schema.edgeWatches.id, target: schema.edgeWatches.target, kind: schema.edgeWatches.kind }).from(schema.edgeWatches).where(eq(schema.edgeWatches.userId, userId));
  const same = mine.find((w) => w.kind === parsed.kind && JSON.stringify(w.target) === JSON.stringify(parsed.target));
  if (same) throw Object.assign(new Error("You already watch that."), { status: 409 });
  if (mine.length >= WATCH_LIMIT) throw Object.assign(new Error(`The beta allows ${WATCH_LIMIT} watches each. Remove one to add another.`), { status: 429 });
  let teamId: number | null = null;
  if (typeof input.teamId === "number") {
    if (!(await myTeamIds(userId)).includes(input.teamId)) throw Object.assign(new Error("You are not on that team."), { status: 403 });
    teamId = input.teamId;
  }
  const [row] = await db.insert(schema.edgeWatches).values({ userId, teamId, kind: parsed.kind, label: parsed.label, target: parsed.target }).returning();
  return toWatch(row, userId);
}

export async function removeWatch(userId: string, id: number): Promise<boolean> {
  const rows = await requireDb().delete(schema.edgeWatches).where(and(eq(schema.edgeWatches.id, id), eq(schema.edgeWatches.userId, userId))).returning({ id: schema.edgeWatches.id });
  return rows.length > 0;
}

/** Three starting watches from the person's desk: their firm and watchlist names Edge has maps for, and the Permian. */
export function starterWatches(profile: Pick<Profile, "firmTicker"> & { watchlist: string[] }): WatchInput[] {
  const mapped = new Set(MAPPED_COMPANIES.map((c) => c.ticker));
  const names = [...new Set([profile.firmTicker.toUpperCase(), ...profile.watchlist.map((t) => t.toUpperCase())])].filter((t) => mapped.has(t));
  for (const fallback of ["ET", "KMI", "TRGP"]) if (!names.includes(fallback)) names.push(fallback);
  return [{ kind: "place", place: "permian" }, ...names.slice(0, 2).map((ticker) => ({ kind: "company", ticker }))];
}

export async function seedWatches(userId: string, profile: Profile): Promise<Watch[]> {
  const out: Watch[] = [];
  for (const w of starterWatches({ firmTicker: profile.firmTicker, watchlist: workspaceFor(profile).watchlist })) {
    try { out.push(await addWatch(userId, w)); } catch { /* already watched or at the limit */ }
  }
  return out;
}

/** Where a watch looks: a company's assets inside the covered regions, or the place itself. */
export function targetOf(w: Pick<Watch, "kind" | "target">): { ticker?: string; bbox?: Bbox } {
  if (w.kind === "company" && w.target.ticker) return { ticker: w.target.ticker };
  return w.target.bbox ? { bbox: w.target.bbox } : {};
}

/** Make sure the maps are loaded, then look at a watch's sites now; records when it was checked. */
export async function checkWatch(w: Pick<Watch, "id" | "kind" | "target">, deadline: number, maxSites = 3): Promise<number[]> {
  try {
    await ensureMaps();
    const { found } = await checkTarget(targetOf(w), deadline, maxSites);
    await requireDb().update(schema.edgeWatches).set({ lastCheckedAt: new Date() }).where(eq(schema.edgeWatches.id, w.id));
    return found;
  } catch (e) {
    logError(e, { where: "edge-check-watch" });
    return [];
  }
}

/**
 * The scheduled pass: every distinct watch target of people with the beta on, least recently checked
 * first, until the deadline. Many people watch the same companies; each target is looked at once and
 * every watch on it is stamped.
 */
export async function checkDue(deadline: number, maxSites = 3): Promise<{ targets: number; checked: number; found: number[] }> {
  const db = requireDb();
  await ensureMaps();
  const rows = await db.select({ id: schema.edgeWatches.id, kind: schema.edgeWatches.kind, target: schema.edgeWatches.target, last: schema.edgeWatches.lastCheckedAt })
    .from(schema.edgeWatches).innerJoin(schema.profiles, eq(schema.profiles.userId, schema.edgeWatches.userId))
    .where(and(BETA_ON, or(isNull(schema.edgeWatches.lastCheckedAt), sql`${schema.edgeWatches.lastCheckedAt} < now() - interval '20 hours'`)))
    .orderBy(sql`${schema.edgeWatches.lastCheckedAt} asc nulls first`).limit(2000);
  const byTarget = new Map<string, { kind: WatchKind; target: EdgeWatchTarget; ids: number[] }>();
  for (const r of rows) {
    const t = targetOf({ kind: r.kind as WatchKind, target: r.target });
    const key = JSON.stringify(t);
    const cur = byTarget.get(key) ?? { kind: r.kind as WatchKind, target: r.target, ids: [] };
    cur.ids.push(r.id);
    byTarget.set(key, cur);
  }
  const found: number[] = [];
  let checked = 0;
  for (const t of byTarget.values()) {
    if (Date.now() > deadline) break;
    try {
      const r = await checkTarget(targetOf(t), deadline, maxSites);
      found.push(...r.found);
      await db.update(schema.edgeWatches).set({ lastCheckedAt: new Date() }).where(inArray(schema.edgeWatches.id, t.ids));
      checked++;
    } catch (e) {
      logError(e, { where: "edge-check-due" });
    }
  }
  return { targets: byTarget.size, checked, found };
}
