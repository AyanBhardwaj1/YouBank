/**
 * YouBank for desktop signs in the way the Office add-in does: with a device code, not cookies. The
 * app's own screens and its background work (alerts, scheduled tasks, local files) run outside the
 * web page, where the site's session cookie is out of reach, and the app should keep working after
 * the browser session ends. The app shows a short code; the person approves it while signed in
 * (usually in the app's own window, where they already are); the app, holding a private poll secret,
 * collects a device token once and keeps it in the operating system's keychain.
 *
 * Desktop tokens (`ybd_`) are separate from Office tokens (`ybo_`) and only work on /api/desktop/**,
 * so a desktop token cannot drive the Office routes and the other way round. Only hashes of the poll
 * secret and the token are stored; a device can be disconnected at any time, from Settings or the app.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { runAsUser } from "@/lib/ai/usage";
import { isAdmin } from "@/lib/auth/admin";
import { currentUser, type CurrentUser } from "@/lib/auth/user";
import { errorResponse } from "@/lib/errors";
import { newCode, normalizeCode } from "@/lib/office/codes";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const PAIRING_MS = 10 * 60_000;
const status = (message: string, code: number) => Object.assign(new Error(message), { status: code });

export type DesktopDevice = typeof schema.desktopDevices.$inferSelect;
export type DesktopPlatform = "windows" | "macos" | "linux" | "";

export const cleanPlatform = (p: unknown): DesktopPlatform => (p === "windows" || p === "macos" || p === "linux" ? p : "");
/** A device name as the app reports it (the computer's name), without control characters. Pure. */
export const cleanName = (n: unknown): string => (typeof n === "string" ? n.replace(/\p{Cc}/gu, "").trim().slice(0, 60) : "");

/** The app asks to connect: it gets a code to show and a secret to poll with. */
export async function startDesktopPairing(platform: DesktopPlatform, name: string) {
  const db = requireDb();
  // Anyone can ask for a code, so keep the table small and the endpoint unattractive to hammer
  // (each caller is also limited per minute by the route).
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.desktopPairings).where(sql`${schema.desktopPairings.createdAt} > now() - interval '1 minute'`);
  if (n > 300) throw status("Too many connection attempts. Try again in a minute.", 429);
  if (Math.random() < 0.05) await db.delete(schema.desktopPairings).where(sql`${schema.desktopPairings.expiresAt} < now() - interval '1 day'`);
  const poll = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + PAIRING_MS);
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    try {
      await db.insert(schema.desktopPairings).values({ code, pollHash: sha(poll), platform, name, expiresAt });
      return { code, poll, expiresAt: expiresAt.toISOString() };
    } catch (e) {
      if (i === 4) throw e; // a code collision; try another
    }
  }
  throw new Error("Could not start pairing");
}

/** What a code would connect, for the approval page to show before the person says yes. */
export async function describePairing(rawCode: string): Promise<{ name: string; platform: string } | null> {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const [row] = await requireDb().select({ name: schema.desktopPairings.name, platform: schema.desktopPairings.platform }).from(schema.desktopPairings)
    .where(and(eq(schema.desktopPairings.code, code), isNull(schema.desktopPairings.approvedAt), sql`${schema.desktopPairings.expiresAt} > now()`));
  return row ?? null;
}

/** The signed-in person approves the code their desktop app shows. */
export async function approveDesktopPairing(user: CurrentUser, rawCode: string): Promise<{ name: string; platform: string }> {
  const code = normalizeCode(rawCode);
  if (!code) throw status("That is not a connection code. It looks like ABCD-2345.", 400);
  const [row] = await requireDb().update(schema.desktopPairings).set({ userId: user.id, approvedAt: new Date() })
    .where(and(eq(schema.desktopPairings.code, code), isNull(schema.desktopPairings.approvedAt), sql`${schema.desktopPairings.expiresAt} > now()`))
    .returning({ name: schema.desktopPairings.name, platform: schema.desktopPairings.platform });
  if (!row) throw status("That code has expired or was already used. Choose Connect again in the desktop app for a new one.", 404);
  return row;
}

/**
 * The app checks whether its code was approved. The first check after approval mints the device token
 * and returns it; the pairing is then spent, so the token can never be collected twice.
 */
export async function pollDesktopPairing(poll: string, appVersion: string): Promise<{ status: "pending" } | { status: "expired" } | { status: "approved"; token: string; user: { name: string; email: string } }> {
  const db = requireDb();
  const [p] = await db.select().from(schema.desktopPairings).where(eq(schema.desktopPairings.pollHash, sha(poll)));
  if (!p) return { status: "expired" };
  if (!p.approvedAt || !p.userId) return p.expiresAt.getTime() < Date.now() ? { status: "expired" } : { status: "pending" };
  const [claimed] = await db.update(schema.desktopPairings).set({ token: "collected" })
    .where(and(eq(schema.desktopPairings.id, p.id), isNull(schema.desktopPairings.token))).returning({ id: schema.desktopPairings.id });
  if (!claimed) return { status: "expired" };
  const token = `ybd_${randomBytes(32).toString("base64url")}`;
  await db.insert(schema.desktopDevices).values({ userId: p.userId, tokenHash: sha(token), platform: p.platform, name: p.name || "Desktop app", appVersion: appVersion.slice(0, 20) });
  const [profile] = await db.select({ name: schema.profiles.name, email: schema.profiles.email }).from(schema.profiles).where(eq(schema.profiles.userId, p.userId));
  return { status: "approved", token, user: { name: profile?.name ?? "", email: profile?.email ?? "" } };
}

const TOKEN = /^Bearer\s+(ybd_[A-Za-z0-9_-]{20,})$/;

/** The device and person behind a desktop app's request, from its bearer token. */
export async function desktopDevice(req: Request): Promise<{ user: CurrentUser; device: DesktopDevice } | null> {
  const m = TOKEN.exec(req.headers.get("authorization") ?? "");
  if (!m) return null;
  const db = requireDb();
  const [d] = await db.select().from(schema.desktopDevices).where(and(eq(schema.desktopDevices.tokenHash, sha(m[1])), isNull(schema.desktopDevices.revokedAt)));
  if (!d) return null;
  const version = (req.headers.get("x-youbank-desktop") ?? "").slice(0, 20);
  if (!d.lastUsedAt || Date.now() - d.lastUsedAt.getTime() > 5 * 60_000 || (version && version !== d.appVersion)) {
    await db.update(schema.desktopDevices).set({ lastUsedAt: new Date(), ...(version ? { appVersion: version } : {}) }).where(eq(schema.desktopDevices.id, d.id));
  }
  const [profile] = await db.select({ name: schema.profiles.name, email: schema.profiles.email }).from(schema.profiles).where(eq(schema.profiles.userId, d.userId));
  return { user: { id: d.userId, email: profile?.email ?? "", name: profile?.name ?? "" }, device: d };
}

export async function listDesktopDevices(userId: string) {
  return requireDb().select({
    id: schema.desktopDevices.id, name: schema.desktopDevices.name, platform: schema.desktopDevices.platform, appVersion: schema.desktopDevices.appVersion,
    settings: schema.desktopDevices.settings, createdAt: schema.desktopDevices.createdAt, lastUsedAt: schema.desktopDevices.lastUsedAt,
  }).from(schema.desktopDevices).where(and(eq(schema.desktopDevices.userId, userId), isNull(schema.desktopDevices.revokedAt))).orderBy(desc(schema.desktopDevices.createdAt));
}

export async function revokeDesktopDevice(userId: string, id: number) {
  await requireDb().update(schema.desktopDevices).set({ revokedAt: new Date() }).where(and(eq(schema.desktopDevices.id, id), eq(schema.desktopDevices.userId, userId)));
}

/** Save which scheduled tasks are on for this computer. Unknown task names are dropped. */
export async function saveDeviceTasks(device: DesktopDevice, tasks: Record<string, unknown>, known: readonly string[]): Promise<Record<string, boolean>> {
  const next: Record<string, boolean> = {};
  for (const k of known) next[k] = tasks[k] === true;
  await requireDb().update(schema.desktopDevices).set({ settings: { ...device.settings, tasks: next } }).where(eq(schema.desktopDevices.id, device.id));
  return next;
}

export const SIGN_IN_AGAIN = "This computer is not connected to YouBank. Open the desktop app and connect it again.";

/**
 * guarded() for the desktop routes. The app sends its device token; a browser session also works for
 * the routes that allow it (`device: "optional"`), so the web page inside the app can share them. With
 * `device: "required"` only the app itself may call (scheduled tasks act for a specific computer).
 */
export async function guardedDesktop(
  req: Request,
  fn: (user: CurrentUser, device: DesktopDevice | null) => Promise<Response>,
  opts: { device?: "required" | "optional" } = {},
): Promise<Response> {
  let found: { user: CurrentUser; device: DesktopDevice | null } | null = null;
  try {
    if (/^Bearer\s+ybd_/.test(req.headers.get("authorization") ?? "")) found = await desktopDevice(req);
    else if (opts.device !== "required") { const u = await currentUser(); found = u ? { user: u, device: null } : null; }
  } catch (e) {
    return errorResponse(e);
  }
  if (!found) return Response.json({ error: SIGN_IN_AGAIN }, { status: 401 });
  const { user, device } = found;
  try { return await runAsUser(user.id, () => fn(user, device), { admin: isAdmin(user) }); }
  catch (e) { return errorResponse(e); }
}

/** The caller's address, for per-caller limits on the routes anyone can reach. */
export const callerIp = (req: Request) => req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
