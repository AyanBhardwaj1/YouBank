/**
 * A small per-instance memo with single flight: callers asking for a key while it loads share that one
 * load, and the value is reused for `ttlMs`. Meant for data that is the same for everyone for a minute
 * or two (the Newsroom's candidate stories, deals, facets) and for a person's own slow-changing data
 * (their network). Values are shared objects, so callers must not mutate them. Failures are not kept.
 */
const values = new Map<string, { exp: number; value: unknown }>();
const loading = new Map<string, Promise<unknown>>();
const MAX_KEYS = 2_000;

export function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = values.get(key);
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.value as T);
  const pending = loading.get(key);
  if (pending) return pending as Promise<T>;
  const p = load().then((value) => {
    if (values.size >= MAX_KEYS) evict();
    values.set(key, { exp: Date.now() + ttlMs, value });
    return value;
  }).finally(() => loading.delete(key));
  loading.set(key, p);
  return p;
}

/** Drop expired entries; if that frees nothing, the oldest tenth (a Map keeps insertion order). */
function evict() {
  const now = Date.now();
  for (const [k, v] of values) if (v.exp <= now) values.delete(k);
  if (values.size < MAX_KEYS) return;
  let n = Math.ceil(MAX_KEYS / 10);
  for (const k of values.keys()) { if (n-- <= 0) break; values.delete(k); }
}
