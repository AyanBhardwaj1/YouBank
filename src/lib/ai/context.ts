/**
 * Who an AI call runs for, carried in async context so no call site has to pass it: the usage ledger
 * attributes cost to this person and the spend limits check their budget.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ userId: string; admin: boolean }>();

/** Run `fn` with AI calls attributed to this person; administrators (ADMIN_EMAILS) have no personal AI cap. */
export function runAsUser<T>(userId: string, fn: () => T, opts?: { admin?: boolean }): T {
  return store.run({ userId, admin: !!opts?.admin }, fn);
}

export const aiUser = () => store.getStore()?.userId ?? null;
export const aiAdmin = () => store.getStore()?.admin ?? false;
