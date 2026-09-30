/**
 * Canvases on the server: who may see and change one (the owner, and their team by role: viewers look,
 * editors change), saving with a version check so two editors never overwrite each other silently, the
 * change log that co-editors stream, named checkpoints, and branches (a fork that points at its parent).
 */
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { touch } from "@/lib/realtime/feed";
import { membership, myTeamIds, Forbidden } from "@/lib/teams/db";
import { can } from "@/lib/teams/roles";
import { type Graph, NODE } from "./catalog";

export type Role = "owner" | "editor" | "viewer";
export type CanvasRow = typeof schema.edgeCanvases.$inferSelect;

export const canvasFeed = (id: number) => `edge-canvas:${id}`;

const status = (message: string, code: number) => Object.assign(new Error(message), { status: code });

/** The person's role on a canvas, or a 403/404. */
export async function canvasAccess(user: CurrentUser, id: number, mode: "view" | "edit" = "view"): Promise<{ row: CanvasRow; role: Role }> {
  const [row] = await requireDb().select().from(schema.edgeCanvases).where(and(eq(schema.edgeCanvases.id, id), isNull(schema.edgeCanvases.deletedAt)));
  if (!row) throw status("That canvas does not exist.", 404);
  if (row.ownerId === user.id) return { row, role: "owner" };
  if (row.teamId) {
    const m = await membership(row.teamId, user.id);
    if (m && can(m.role, "edit")) return { row, role: "editor" };
    if (m && can(m.role, "view")) {
      if (mode === "edit") throw new Forbidden("Viewers can look at this canvas but not change it.");
      return { row, role: "viewer" };
    }
  }
  throw new Forbidden("That canvas is not shared with you.");
}

/** A graph from a request, cleaned: known node types only, positions as numbers, configs as plain objects, wires between existing nodes. Pure. */
export function cleanGraph(raw: unknown): Graph {
  const g = (raw && typeof raw === "object" ? raw : {}) as { nodes?: unknown; edges?: unknown; viewport?: unknown };
  const nodes = (Array.isArray(g.nodes) ? g.nodes : []).slice(0, 60).flatMap((n) => {
    const x = n as { id?: unknown; type?: unknown; position?: { x?: unknown; y?: unknown }; data?: { title?: unknown; config?: unknown; expanded?: unknown } };
    if (typeof x.id !== "string" || !x.id || x.id.length > 64 || typeof x.type !== "string" || !NODE[x.type]) return [];
    const config = x.data?.config && typeof x.data.config === "object" && !Array.isArray(x.data.config) ? JSON.parse(JSON.stringify(x.data.config).slice(0, 20_000) || "{}") : {};
    return [{
      id: x.id, type: x.type,
      position: { x: Number(x.position?.x) || 0, y: Number(x.position?.y) || 0 },
      data: { config, ...(typeof x.data?.title === "string" ? { title: x.data.title.slice(0, 80) } : {}), ...(x.data?.expanded === true ? { expanded: true } : {}) },
    }];
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(g.edges) ? g.edges : []).slice(0, 200).flatMap((e) => {
    const x = e as { id?: unknown; source?: unknown; target?: unknown; sourceHandle?: unknown; targetHandle?: unknown };
    if (typeof x.source !== "string" || typeof x.target !== "string" || !ids.has(x.source) || !ids.has(x.target) || x.source === x.target) return [];
    const sourceHandle = typeof x.sourceHandle === "string" ? x.sourceHandle : "", targetHandle = typeof x.targetHandle === "string" ? x.targetHandle : "";
    return [{ id: typeof x.id === "string" ? x.id.slice(0, 160) : `e-${x.source}-${sourceHandle}-${x.target}-${targetHandle}`, source: x.source, sourceHandle, target: x.target, targetHandle }];
  });
  const vp = g.viewport as { x?: unknown; y?: unknown; zoom?: unknown } | undefined;
  return { nodes, edges, ...(vp && Number.isFinite(Number(vp.zoom)) ? { viewport: { x: Number(vp.x) || 0, y: Number(vp.y) || 0, zoom: Number(vp.zoom) } } : {}) };
}

export type CanvasSummary = { id: number; title: string; description: string; template: string; teamId: number | null; parentId: number | null; branch: string; mine: boolean; updatedAt: string; nodeTypes: string[]; lastRun: { id: number; status: string; at: string } | null; monitor: { schedule: string; active: boolean } | null };

export async function listCanvases(userId: string): Promise<CanvasSummary[]> {
  const db = requireDb();
  const teams = await myTeamIds(userId);
  const rows = await db.select().from(schema.edgeCanvases)
    .where(and(isNull(schema.edgeCanvases.deletedAt), teams.length ? or(eq(schema.edgeCanvases.ownerId, userId), inArray(schema.edgeCanvases.teamId, teams)) : eq(schema.edgeCanvases.ownerId, userId)))
    .orderBy(desc(schema.edgeCanvases.updatedAt)).limit(100);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [runs, monitors] = await Promise.all([
    db.execute(sql`select distinct on (canvas_id) canvas_id, id, status, created_at from edge_runs where canvas_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) order by canvas_id, created_at desc`),
    db.select().from(schema.edgeMonitors).where(inArray(schema.edgeMonitors.canvasId, ids)),
  ]);
  const lastRun = new Map((runs.rows as { canvas_id: number; id: number; status: string; created_at: string }[]).map((r) => [r.canvas_id, { id: r.id, status: r.status, at: new Date(r.created_at).toISOString() }]));
  const monitor = new Map(monitors.map((m) => [m.canvasId, { schedule: m.schedule, active: m.active }]));
  return rows.map((r) => ({
    id: r.id, title: r.title, description: r.description, template: r.template, teamId: r.teamId, parentId: r.parentId, branch: r.branch, mine: r.ownerId === userId,
    updatedAt: r.updatedAt.toISOString(), nodeTypes: [...new Set(((r.graph as Graph).nodes ?? []).map((n) => n.type))],
    lastRun: lastRun.get(r.id) ?? null, monitor: monitor.get(r.id) ?? null,
  }));
}

export async function createCanvas(user: CurrentUser, input: { title: string; description?: string; graph: Graph; template?: string; teamId?: number | null; parentId?: number | null; branch?: string }): Promise<CanvasRow> {
  if (input.teamId) {
    const m = await membership(input.teamId, user.id);
    if (!m || !can(m.role, "edit")) throw new Forbidden("You cannot add canvases to that team.");
  }
  const [row] = await requireDb().insert(schema.edgeCanvases).values({
    ownerId: user.id, teamId: input.teamId ?? null, title: input.title.slice(0, 120) || "Untitled canvas", description: (input.description ?? "").slice(0, 500),
    graph: input.graph, template: input.template ?? "", parentId: input.parentId ?? null, branch: (input.branch ?? "").slice(0, 60),
  }).returning();
  return row;
}

/** Save a canvas if nobody else saved since `baseVersion`; otherwise a 409 carrying the newer version. */
export async function saveCanvas(user: CurrentUser, id: number, patch: { graph?: Graph; title?: string; description?: string; teamId?: number | null }, baseVersion: number): Promise<CanvasRow> {
  const { row } = await canvasAccess(user, id, "edit");
  if (patch.teamId !== undefined && patch.teamId !== row.teamId) {
    if (row.ownerId !== user.id) throw new Forbidden("Only the owner can share or unshare a canvas.");
    if (patch.teamId) { const m = await membership(patch.teamId, user.id); if (!m || !can(m.role, "edit")) throw new Forbidden("You cannot share with that team."); }
  }
  const set: Partial<typeof schema.edgeCanvases.$inferInsert> = { updatedAt: new Date(), version: sql`${schema.edgeCanvases.version} + 1` as unknown as number };
  if (patch.graph) set.graph = patch.graph;
  if (patch.title !== undefined) set.title = patch.title.slice(0, 120) || "Untitled canvas";
  if (patch.description !== undefined) set.description = patch.description.slice(0, 500);
  if (patch.teamId !== undefined) set.teamId = patch.teamId;
  const [saved] = await requireDb().update(schema.edgeCanvases).set(set)
    .where(and(eq(schema.edgeCanvases.id, id), eq(schema.edgeCanvases.version, baseVersion))).returning();
  if (!saved) {
    const [latest] = await requireDb().select().from(schema.edgeCanvases).where(eq(schema.edgeCanvases.id, id));
    throw Object.assign(new Error("Someone else changed this canvas; their version is loaded."), { status: 409, latest });
  }
  await requireDb().insert(schema.edgeCanvasEvents).values({
    canvasId: id, userId: user.id, kind: "patch", version: saved.version, label: user.name || user.email,
    payload: { graph: patch.graph ? saved.graph : undefined, title: patch.title !== undefined ? saved.title : undefined },
  });
  touch(canvasFeed(id));
  return saved;
}

/** Changes after `cursor`, for co-editors' streams. */
export async function canvasChanges(id: number, cursor: number, limit = 50) {
  return requireDb().select().from(schema.edgeCanvasEvents)
    .where(and(eq(schema.edgeCanvasEvents.canvasId, id), gt(schema.edgeCanvasEvents.id, cursor))).orderBy(schema.edgeCanvasEvents.id).limit(limit);
}

export async function checkpoint(user: CurrentUser, id: number, label: string) {
  const { row } = await canvasAccess(user, id, "edit");
  const [ev] = await requireDb().insert(schema.edgeCanvasEvents).values({ canvasId: id, userId: user.id, kind: "checkpoint", version: row.version, label: label.slice(0, 80) || "Checkpoint", payload: { graph: row.graph, title: row.title } }).returning();
  return ev;
}

export async function checkpoints(id: number) {
  return requireDb().select({ id: schema.edgeCanvasEvents.id, label: schema.edgeCanvasEvents.label, version: schema.edgeCanvasEvents.version, createdAt: schema.edgeCanvasEvents.createdAt, userId: schema.edgeCanvasEvents.userId })
    .from(schema.edgeCanvasEvents).where(and(eq(schema.edgeCanvasEvents.canvasId, id), eq(schema.edgeCanvasEvents.kind, "checkpoint"))).orderBy(desc(schema.edgeCanvasEvents.id)).limit(50);
}

export async function restore(user: CurrentUser, id: number, checkpointId: number): Promise<CanvasRow> {
  const { row } = await canvasAccess(user, id, "edit");
  const [cp] = await requireDb().select().from(schema.edgeCanvasEvents)
    .where(and(eq(schema.edgeCanvasEvents.id, checkpointId), eq(schema.edgeCanvasEvents.canvasId, id), eq(schema.edgeCanvasEvents.kind, "checkpoint")));
  if (!cp) throw status("That checkpoint does not exist.", 404);
  return saveCanvas(user, id, { graph: (cp.payload as { graph: Graph }).graph }, row.version);
}

export async function branchCanvas(user: CurrentUser, id: number, label: string): Promise<CanvasRow> {
  const { row } = await canvasAccess(user, id, "view");
  const name = label.trim().slice(0, 40) || "variant";
  return createCanvas(user, { title: `${row.title} · ${name}`, description: row.description, graph: row.graph as Graph, template: row.template, teamId: row.teamId, parentId: row.id, branch: name });
}

export async function deleteCanvas(user: CurrentUser, id: number) {
  const { row } = await canvasAccess(user, id, "edit");
  if (row.ownerId !== user.id) throw new Forbidden("Only the owner can delete a canvas.");
  await requireDb().update(schema.edgeCanvases).set({ deletedAt: new Date() }).where(eq(schema.edgeCanvases.id, id));
  await requireDb().update(schema.edgeMonitors).set({ active: false }).where(eq(schema.edgeMonitors.canvasId, id));
}

/** Branches of a canvas (and its parent), for the side-by-side comparison. */
export async function family(id: number): Promise<{ id: number; title: string; branch: string; parentId: number | null }[]> {
  const [row] = await requireDb().select({ parentId: schema.edgeCanvases.parentId }).from(schema.edgeCanvases).where(eq(schema.edgeCanvases.id, id));
  const root = row?.parentId ?? id;
  return requireDb().select({ id: schema.edgeCanvases.id, title: schema.edgeCanvases.title, branch: schema.edgeCanvases.branch, parentId: schema.edgeCanvases.parentId })
    .from(schema.edgeCanvases).where(and(isNull(schema.edgeCanvases.deletedAt), or(eq(schema.edgeCanvases.id, root), eq(schema.edgeCanvases.parentId, root)))).orderBy(schema.edgeCanvases.id);
}
