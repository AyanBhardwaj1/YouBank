/**
 * Account recovery that needs nothing configured: no mail sender, no Google. Each person gets a recovery key
 * (shown once when the account is made, and again whenever they make a new one in Settings). "Forgot your
 * password?" takes the email and the key, sets a new password, signs every other device out, and replaces
 * the key with a fresh one, shown once. When a mail sender is configured (src/lib/auth/mail.ts) an emailed
 * reset link works too; the key works either way.
 *
 * The key is kept only as an HMAC under BETTER_AUTH_SECRET, compared in constant time, and attempts are
 * limited per email and per address, so a wrong guess teaches nothing and a list cannot be ground through.
 * Server only; tested in scripts/test-recovery.ts.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { withinRate } from "@/lib/locks";
import { auth } from "./server";

/** Letters and digits that cannot be misread for one another (no 0/O, 1/I/L, U/V). */
const ALPHABET = "ABCDEFGHJKMNPQRSTWXYZ23456789";
export const KEY_GROUPS = 5, GROUP = 4;

/** A new key: 20 characters in five groups of four (about 97 bits). */
export function newRecoveryKey(bytes: Buffer = randomBytes(KEY_GROUPS * GROUP)): string {
  const chars = [...bytes.subarray(0, KEY_GROUPS * GROUP)].map((b) => ALPHABET[b % ALPHABET.length]);
  return Array.from({ length: KEY_GROUPS }, (_, i) => chars.slice(i * GROUP, (i + 1) * GROUP).join("")).join("-");
}

/** A key as typed, cleaned: case, spaces and dashes ignored. Pure. */
export const normalizeKey = (key: string) => key.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The stored form: an HMAC, so a copy of the table alone recovers no key. */
export function hashKey(key: string, secret = process.env.BETTER_AUTH_SECRET ?? ""): string {
  if (!secret) throw new Error("BETTER_AUTH_SECRET must be set");
  return createHmac("sha256", secret).update(`youbank:recovery:${normalizeKey(key)}`).digest("hex");
}

/** Constant-time comparison of two stored hashes. Pure. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Make (or replace) a person's key; the plain key is returned once and never stored. */
export async function issueRecoveryKey(userId: string): Promise<string> {
  const key = newRecoveryKey();
  const keyHash = hashKey(key);
  await requireDb().insert(schema.authRecovery).values({ userId, keyHash, createdAt: new Date(), usedAt: null })
    .onConflictDoUpdate({ target: schema.authRecovery.userId, set: { keyHash, createdAt: new Date(), usedAt: null } });
  return key;
}

export async function recoveryStatus(userId: string): Promise<{ has: boolean; createdAt: string | null }> {
  const [row] = await requireDb().select({ createdAt: schema.authRecovery.createdAt }).from(schema.authRecovery).where(eq(schema.authRecovery.userId, userId)).limit(1);
  return { has: !!row, createdAt: row?.createdAt?.toISOString() ?? null };
}

export const PASSWORD_MIN = 10, PASSWORD_MAX = 128;
const NO_MATCH = "That email and recovery key do not match. Check the key, including every group.";

export type ResetResult = { ok: true; newKey: string } | { ok: false; error: string; status: number };

/**
 * Set a new password with the recovery key. The same answer for an unknown email and a wrong key, and the
 * same work for both, so the form says nothing about who has an account.
 */
export async function resetWithRecoveryKey(input: { email: string; key: string; password: string; ip: string }): Promise<ResetResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !normalizeKey(input.key)) return { ok: false, error: "Enter your email and your recovery key.", status: 400 };
  if (input.password.length < PASSWORD_MIN || input.password.length > PASSWORD_MAX) return { ok: false, error: `Choose a password of ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`, status: 400 };
  // Five tries per email and twenty per address in fifteen minutes.
  const [byEmail, byIp] = await Promise.all([withinRate(`recover:email:${email}`, 5, 15 * 60_000), withinRate(`recover:ip:${input.ip}`, 20, 15 * 60_000)]);
  if (!byEmail || !byIp) return { ok: false, error: "Too many tries. Wait fifteen minutes and try again.", status: 429 };

  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(email);
  const [row] = found ? await requireDb().select().from(schema.authRecovery).where(eq(schema.authRecovery.userId, found.user.id)).limit(1) : [];
  const given = hashKey(input.key);
  // Compare against a stand-in when there is no row, so both paths take the same time.
  const match = sameHash(row?.keyHash ?? "0".repeat(64), given) && !!row;
  if (!found || !match) return { ok: false, error: NO_MATCH, status: 400 };

  const userId = found.user.id;
  const hash = await ctx.password.hash(input.password);
  const accounts = await ctx.internalAdapter.findAccounts(userId);
  if (accounts.some((a) => a.providerId === "credential")) await ctx.internalAdapter.updatePassword(userId, hash);
  // An account that only ever used Google gets a password too.
  else await ctx.internalAdapter.linkAccount({ userId, providerId: "credential", accountId: userId, password: hash });
  // Whoever had the old password is signed out everywhere.
  await ctx.internalAdapter.deleteUserSessions(userId);
  // The key is spent: a new one replaces it, shown once.
  const newKey = await issueRecoveryKey(userId);
  return { ok: true, newKey };
}
