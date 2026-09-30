/**
 * Who an AI call runs for, carried in async context so no call site has to pass it: the usage ledger
 * attributes cost to this person and the spend limits check their budget.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ userId: string }>();

/** Run `fn` with AI calls attributed to this person. */
export function runAsUser<T>(userId: string, fn: () => T): T {
  return store.run({ userId }, fn);
}

export const aiUser = () => store.getStore()?.userId ?? null;
