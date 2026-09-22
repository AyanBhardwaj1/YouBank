import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Encryption for mailbox tokens at rest.
 *
 * A refresh token is a standing key to someone's email, so it is never written to the database in
 * the clear. AES-256-GCM, with the key derived from EMAIL_TOKEN_SECRET; a database dump on its own
 * reveals nothing.
 */

const SALT = "youbank.email-tokens.v1";
let cached: Buffer | null = null;

function key(): Buffer {
  const secret = process.env.EMAIL_TOKEN_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("EMAIL_TOKEN_SECRET is not set (needs at least 16 characters). Generate one with: openssl rand -base64 32");
  }
  cached ??= scryptSync(secret, SALT, 32);
  return cached;
}

/** True when tokens can be stored, so callers can fail early with a clear message. */
export function encryptionReady(): boolean {
  const secret = process.env.EMAIL_TOKEN_SECRET;
  return !!secret && secret.length >= 16;
}

/** "v1.<iv>.<tag>.<ciphertext>", all base64url. */
export function encryptToken(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const out = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), out.toString("base64url")].join(".");
}

export function decryptToken(blob: string): string {
  if (!blob) return "";
  const [version, iv, tag, payload] = blob.split(".");
  if (version !== "v1" || !iv || !tag || !payload) throw new Error("Stored token is not in a recognised format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(payload, "base64url")), d.final()]).toString("utf8");
}

/** Constant-time compare, for webhook and cron secrets. */
export function secretsMatch(a: string, b: string): boolean {
  const x = Buffer.from(a ?? "", "utf8");
  const y = Buffer.from(b ?? "", "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}
