/**
 * One value per server process, however many copies of a module the build made.
 *
 * Next.js compiles route handlers, server components and server-side rendering as separate layers, and a
 * module used by more than one gets a copy (and its own module state) in each. A database pool or a
 * cache kept at module level would then exist two or three times per instance: two or three times the
 * connections, and caches that miss where another layer already holds the value (or that billing clears
 * in one layer while another keeps serving the old plan). Values kept here live on `globalThis` under a
 * key, so every copy shares one.
 */
const KEY = Symbol.for("youbank.shared");
type Store = Map<string, unknown>;

function store(): Store {
  const g = globalThis as { [KEY]?: Store };
  return (g[KEY] ??= new Map());
}

/** The process-wide value under `key`, made on first use. */
export function shared<T>(key: string, make: () => T): T {
  const s = store();
  if (!s.has(key)) s.set(key, make());
  return s.get(key) as T;
}

/** A process-wide Map under `key` (the usual shape for a cache). */
export const sharedMap = <K, V>(key: string): Map<K, V> => shared(key, () => new Map<K, V>());
