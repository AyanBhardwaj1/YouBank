/**
 * YouBank for Excel and PowerPoint signs in with a device code, not cookies: Office runs add-ins in an
 * embedded frame where a site's cookies are often blocked. The add-in shows a short code; the person
 * approves it while signed in to YouBank; the add-in, holding a private poll secret, then collects a
 * device token once. Only hashes of the poll secret and the token are stored, and a device can be
 * revoked at any time.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { newCode, normalizeCode } from "./codes";
import { runAsUser } from "@/lib/ai/usage";
import { currentUser, type CurrentUser } from "@/lib/auth/user";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const PAIRING_MS = 10 * 60_000;

/** The add-in asks to connect: it gets a code to show and a secret to poll with. */
export async function startPairing(host: string) {
  const db = requireDb();
  // Anyone can ask for a code, so keep the table small and the endpoint unattractive to hammer.
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.officePairings).where(sql`${schema.officePairings.createdAt} > now() - interval '1 minute'`);
  if (n > 60) throw Object.assign(new Error("Too many connection attempts. Try again in a minute."), { status: 429 });
  if (Math.random() < 0.05) await db.delete(schema.officePairings).where(sql`${schema.officePairings.expiresAt} < now() - interval '1 day'`);
  const poll = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + PAIRING_MS);
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    try {
      await db.insert(schema.officePairings).values({ code, pollHash: sha(poll), host: host.slice(0, 20), expiresAt });
      return { code, poll, expiresAt: expiresAt.toISOString() };
    } catch (e) {
      if (i === 4) throw e; // a code collision; try another
    }
  }
  throw new Error("Could not start pairing");
}

/** The signed-in person approves the code the add-in is showing. */
export async function approvePairing(user: CurrentUser, rawCode: string): Promise<{ host: string }> {
  const code = normalizeCode(rawCode);
  if (!code) throw Object.assign(new Error("That is not a pairing code. It looks like ABCD-2345."), { status: 400 });
  const [row] = await requireDb().update(schema.officePairings).set({ userId: user.id, approvedAt: new Date() })
    .where(and(eq(schema.officePairings.code, code), isNull(schema.officePairings.approvedAt), sql`${schema.officePairings.expiresAt} > now()`))
    .returning({ host: schema.officePairings.host });
  if (!row) throw Object.assign(new Error("That code has expired or was already used. Open the add-in again for a new one."), { status: 404 });
  return row;
}

/**
 * The add-in checks whether its code was approved. The first check after approval mints the device
 * token and returns it; the pairing is then spent, so the token can never be collected twice.
 */
export async function pollPairing(poll: string): Promise<{ status: "pending" } | { status: "expired" } | { status: "approved"; token: string; user: { name: string; email: string } }> {
  const db = requireDb();
  const [p] = await db.select().from(schema.officePairings).where(eq(schema.officePairings.pollHash, sha(poll)));
  if (!p) return { status: "expired" };
  if (!p.approvedAt || !p.userId) return p.expiresAt.getTime() < Date.now() ? { status: "expired" } : { status: "pending" };
  const [claimed] = await db.update(schema.officePairings).set({ token: "collected" })
    .where(and(eq(schema.officePairings.id, p.id), isNull(schema.officePairings.token))).returning({ id: schema.officePairings.id });
  if (!claimed) return { status: "expired" };
  const token = `ybo_${randomBytes(32).toString("base64url")}`;
  await db.insert(schema.officeDevices).values({ userId: p.userId, tokenHash: sha(token), host: p.host, name: p.host ? `${p.host} add-in` : "Office add-in" });
  const [profile] = await db.select({ name: schema.profiles.name, email: schema.profiles.email }).from(schema.profiles).where(eq(schema.profiles.userId, p.userId));
  return { status: "approved", token, user: { name: profile?.name ?? "", email: profile?.email ?? "" } };
}

/** The person behind an add-in request, from its bearer token. */
export async function officeUser(req: Request): Promise<CurrentUser | null> {
  const m = /^Bearer\s+(ybo_[A-Za-z0-9_-]{20,})$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return null;
  const db = requireDb();
  const [d] = await db.select().from(schema.officeDevices).where(and(eq(schema.officeDevices.tokenHash, sha(m[1])), isNull(schema.officeDevices.revokedAt)));
  if (!d) return null;
  if (!d.lastUsedAt || Date.now() - d.lastUsedAt.getTime() > 5 * 60_000) {
    await db.update(schema.officeDevices).set({ lastUsedAt: new Date() }).where(eq(schema.officeDevices.id, d.id));
  }
  const [profile] = await db.select({ name: schema.profiles.name, email: schema.profiles.email }).from(schema.profiles).where(eq(schema.profiles.userId, d.userId));
  return { id: d.userId, email: profile?.email ?? "", name: profile?.name ?? "" };
}

export async function listDevices(userId: string) {
  return requireDb().select({ id: schema.officeDevices.id, name: schema.officeDevices.name, host: schema.officeDevices.host, createdAt: schema.officeDevices.createdAt, lastUsedAt: schema.officeDevices.lastUsedAt })
    .from(schema.officeDevices).where(and(eq(schema.officeDevices.userId, userId), isNull(schema.officeDevices.revokedAt))).orderBy(desc(schema.officeDevices.createdAt));
}

export async function revokeDevice(userId: string, id: number) {
  await requireDb().update(schema.officeDevices).set({ revokedAt: new Date() }).where(and(eq(schema.officeDevices.id, id), eq(schema.officeDevices.userId, userId)));
}

/** The person behind a request: the add-in's device token when it sends one, otherwise the browser session. */
export async function requestUser(req: Request): Promise<CurrentUser | null> {
  if (/^Bearer\s+ybo_/.test(req.headers.get("authorization") ?? "")) return officeUser(req).catch(() => null);
  return currentUser();
}

/** guarded() for routes that Excel and PowerPoint call as well as the browser. Errors carry their status. */
export async function guardedFor(req: Request, fn: (user: CurrentUser) => Promise<Response>): Promise<Response> {
  const user = await requestUser(req);
  if (!user) return Response.json({ error: "Sign in required. In Excel or PowerPoint, connect the add-in to YouBank again." }, { status: 401 });
  try { return await runAsUser(user.id, () => fn(user)); }
  catch (e) {
    const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : 500;
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
