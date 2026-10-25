/**
 * Whose data request this is, for the data layer (registry.ts): the person's source order per dataset,
 * which providers they have keys for (never the keys themselves), this view's one-off source override
 * (`AAPL GP @tiingo`, the "Source ▾" chip), and a way to read a key at fetch time. Set by the routes a
 * person waits on (`withDataUser`), never by jobs.
 *
 * Rules for a person's own keys (docs/data-layer.md, "Free sources & your own keys"):
 * - used only inside `withDataUser` AND on an interactive request (budgets.ts): never in background
 *   jobs, crons or Inngest, which run without a person;
 * - never inside `publicOnly(…)`: anything that fills a shared cache (the company record, R2 bars, news
 *   sparks) or feeds an export or a shared view runs public-only, so it sees the default order and no keys;
 * - the key is read from the database and decrypted only when a keyed adapter fetches (byo/store.ts).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { currentMode } from "./budgets";
import { KEY_PROVIDER_INFO, type DatasetName, type KeyProvider, type SourceId } from "./sources-meta";

export type DataUser = {
  userId: string;
  /** The person's order of source ids, per dataset (what Settings → Data sources saved). */
  order: Partial<Record<DatasetName, SourceId[]>>;
  /** Providers the person has a saved key for. */
  keyed: ReadonlySet<KeyProvider>;
  /** The decrypted key, read when a keyed adapter fetches (server only). */
  key: (p: KeyProvider) => Promise<string | null>;
  /** Whether the key is still saved, read now: an answer fetched while the key was being removed is not cached. */
  held?: (p: KeyProvider) => Promise<boolean>;
  /** This view's source for its main dataset (`AAPL GP @tiingo`, the "Source ▾" chip), tried first. */
  override?: { dataset: DatasetName; id: SourceId };
};

const users = new AsyncLocalStorage<DataUser>();
const shared = new AsyncLocalStorage<true>();
const model = new AsyncLocalStorage<true>();

/** Run `fn` as `u`'s request: their order and keys apply to the data layer inside it. */
export const withDataUser = <T>(u: DataUser, fn: () => Promise<T>): Promise<T> => users.run(u, fn);

/** Run `fn` for shared data: default order, public and owner-licensed sources only, no one's keys. */
export const publicOnly = <T>(fn: () => Promise<T>): Promise<T> => shared.run(true, fn);

/**
 * Run `fn` for a model (AI tools, the terminal's AI read): public-only, and without the sources whose terms
 * bar AI use (FRED, and the Fed's H.15 and H.10 read through FRED; their adapters say `noAi`).
 */
export const forModel = <T>(fn: () => Promise<T>): Promise<T> => model.run(true, () => publicOnly(fn));

/** Whether the current code runs for a model (forModel). */
export const inForModel = (): boolean => model.getStore() === true;

export const NOT_FOR_AI = "FRED's terms keep its data away from AI, so it is not used here.";

/** Whether the current code runs for shared data (publicOnly). */
export const inPublicOnly = (): boolean => shared.getStore() === true;

/** The person this request is for, or undefined in shared code, jobs and scripts. */
export const dataUser = (): DataUser | undefined => (inPublicOnly() ? undefined : users.getStore());

export const NOT_IN_BACKGROUND = "Your own keys are used only on screens you open, never in background jobs.";
export const NOT_FOR_SHARED = "Your own keys are never used for shared data (company records, exports, shared views).";
export const needsYourKey = (p: KeyProvider) => `Needs your ${KEY_PROVIDER_INFO[p].label} key (Settings → Data sources).`;

/** Whether a source that needs `p`'s key may answer here, and if not, why (in words people read). */
export function keyedEligibility(p: KeyProvider): { ok: true } | { ok: false; reason: string } {
  if (inPublicOnly()) return { ok: false, reason: NOT_FOR_SHARED };
  const u = users.getStore();
  if (!u) return { ok: false, reason: needsYourKey(p) };
  if (currentMode() !== "interactive") return { ok: false, reason: NOT_IN_BACKGROUND };
  return u.keyed.has(p) ? { ok: true } : { ok: false, reason: needsYourKey(p) };
}

/** The current person's key for `p`, only where it may be used (keyedEligibility); else null. Server only. */
export async function keyFor(p: KeyProvider): Promise<{ userId: string; key: string; held: () => Promise<boolean> } | null> {
  if (!keyedEligibility(p).ok) return null;
  const u = users.getStore()!;
  const key = await u.key(p);
  return key ? { userId: u.userId, key, held: () => (u.held ? u.held(p) : Promise.resolve(true)) } : null;
}
