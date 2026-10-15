/**
 * Who may do what in Quant, the one consent, request checks and server-side caps. Server only.
 *
 * - Everything that analyses a person's own inputs or stores something about them needs the Quant consent
 *   (quant.terms), given once at first use of the hub; a route answers 428 until it is given and the page
 *   asks for it. Impersonal reads (signals, factor returns, broker scorecards) and "check a claim" do not.
 * - Premium layers check the plan with requireFeature before they run (docs/premium.md); administrators
 *   (ADMIN_EMAILS) may always use them.
 * - Routes that change state take a JSON body from YouBank's own pages (same-site check, as copy trading).
 * - Compute a click can repeat has a daily cap per person (rateLimit), even where it is cheap.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { QUANT_TERMS, quantTermsText } from "./words";

export { CROSS_SITE, requestMeta, sameSiteJson } from "@/lib/copytrade/access";

type Person = Pick<CurrentUser, "id" | "email">;

/** An error a person may read, with its HTTP status. */
export const refuse = (message: string, status = 400) => Object.assign(new Error(message), { status });

export const termsHash = () => createHash("sha256").update(quantTermsText()).digest("hex").slice(0, 32);

export async function hasQuantConsent(userId: string): Promise<boolean> {
  const [row] = await requireDb().select({ v: schema.quantConsents.version }).from(schema.quantConsents)
    .where(and(eq(schema.quantConsents.userId, userId), eq(schema.quantConsents.kind, "terms"), eq(schema.quantConsents.version, QUANT_TERMS.version)));
  return !!row;
}

/** 428 until the person has accepted the current terms; the page shows them and retries. */
export async function requireQuantConsent(userId: string): Promise<void> {
  if (!(await hasQuantConsent(userId))) throw Object.assign(refuse("Read and accept how Quant works first.", 428), { consent: "quant.terms" });
}

export async function giveQuantConsent(user: Person, ctx: { ip: string | null; userAgent: string | null }): Promise<void> {
  await requireDb().insert(schema.quantConsents).values({ userId: user.id, kind: "terms", version: QUANT_TERMS.version, textHash: termsHash(), ip: ctx.ip, userAgent: ctx.userAgent }).onConflictDoNothing();
}

/** Server-side daily caps for repeatable compute (docs/premium.md: spend outside the AI ledger is capped). */
export const CAPS = {
  integrityPro: 60, // PBO on trial matrices up to 500, the Reality Check and placebo runs
  riskPro: 60, // 10,000-path stress runs and reverse stress
  factorPro: 120,
  trialsPerDay: 2_000,
  fillsImportsPerDay: 30,
  insiderReadsPerDay: 20, // Item 4 readings on the small model (AI allowance; also capped here)
} as const;

export async function capDaily(user: Person, what: keyof typeof CAPS, message: string): Promise<void> {
  await rateLimit(`quant-${what}:${user.id}`, CAPS[what], 86_400_000, message);
}

/** Parse a JSON body, or answer 400. */
export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) throw refuse("Send a JSON object.");
  return b as Record<string, unknown>;
}
