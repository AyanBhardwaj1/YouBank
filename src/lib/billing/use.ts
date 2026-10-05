/**
 * Premium work that happens because a person asked for it. Server only.
 *
 * Some upgrades apply on their own inside work a person started (a paid reranker under a question they
 * asked); others are switched on per request (a stronger answer model, deep research). Both reach code
 * far below the route, so the route opens a premium scope, carried in async context like the AI
 * ledger's user: the features this person may use and wants for this one action. Code that could spend
 * asks `premiumOn(id)`. Outside a scope (a cron, an Inngest pass, a prefetch, a monitor's run) the
 * answer is always no, so background work keeps to the free methods without each job having to say so.
 *
 * - `auto` features are used when the plan includes them, silently skipped otherwise (the free method runs);
 * - `require` features were asked for by the person: a plan without them is a 402 with a plain message.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { entitlements, PremiumRequiredError, type Entitlements } from "./entitlements";
import { featureById } from "./features";

type Scope = { features: ReadonlySet<string> };
const store = new AsyncLocalStorage<Scope>();

type Person = Pick<CurrentUser, "id" | "email">;
export type PremiumWants = { auto?: string[]; require?: string[] };

/** Whether this premium feature may spend now: inside a scope that holds it. Always false in background work. */
export function premiumOn(featureId: string): boolean {
  return store.getStore()?.features.has(featureId) ?? false;
}

/** The features of the scope in force (for tests and the audit line of a run). */
export const premiumInScope = (): string[] => [...(store.getStore()?.features ?? [])];

/** Run `fn` with exactly these features on. Synchronous, for tests and for callers that already checked the plan. */
export function withFeatures<T>(features: Iterable<string>, fn: () => T): T {
  return store.run({ features: new Set(features) }, fn);
}

/**
 * Which of the wanted features this plan allows: every `auto` one it includes; every `require` one, or
 * a PremiumRequiredError (402) naming the first it does not. Pure, for tests.
 */
export function allowedOf(e: Pick<Entitlements, "features">, want: PremiumWants): string[] {
  const has = new Set(e.features);
  for (const id of want.require ?? []) {
    const f = featureById(id);
    if (!f) throw new Error(`Unknown premium feature: ${id}`);
    if (!has.has(id)) throw new PremiumRequiredError(id, f.minPlan);
  }
  return [...new Set([...(want.require ?? []), ...(want.auto ?? []).filter((id) => has.has(id))])];
}

/** Run `fn` in a premium scope for this person: see the file comment. Throws a 402 before `fn` runs when a required feature is locked. */
export async function premiumScope<T>(user: Person, want: PremiumWants, fn: () => Promise<T>): Promise<T> {
  const allowed = allowedOf(await entitlements(user), want);
  return withFeatures(allowed, fn);
}

/**
 * A person's entitlements from their id alone, for work that continues in the background after they
 * asked (an upload read by Inngest, a canvas run they pressed Run on): their email comes from their
 * profile, which also decides the administrator bypass. Without a profile they count as Free.
 */
export async function entitlementsById(userId: string): Promise<Entitlements> {
  let email = "";
  if (db) {
    const [p] = await db.select({ email: schema.profiles.email }).from(schema.profiles).where(eq(schema.profiles.userId, userId)).catch(() => []);
    email = p?.email ?? "";
  }
  return entitlements({ id: userId, email });
}

/** Whether a person (by id) may use a feature, for background re-checks before paid work they asked for earlier. */
export async function canUseById(userId: string, featureId: string): Promise<boolean> {
  return (await entitlementsById(userId)).features.includes(featureId);
}

/** `premiumScope` for background work a person started, by their id (see entitlementsById). Never throws for `auto`. */
export async function premiumScopeById<T>(userId: string, want: PremiumWants, fn: () => Promise<T>): Promise<T> {
  return withFeatures(allowedOf(await entitlementsById(userId), want), fn);
}
