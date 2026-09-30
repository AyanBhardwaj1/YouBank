/**
 * Run work over a list a few at a time: at most `size` items in flight, and no new item started after
 * `stopAt` (a cron's time budget). Results come back in input order, without the items never started.
 */
export async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>, stopAt = Infinity): Promise<R[]> {
  const out: (R | undefined)[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(0, Math.min(size, items.length)) }, async () => {
    while (next < items.length && Date.now() < stopAt) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out.filter((r): r is R => r !== undefined);
}

/** A pool size from the environment (e.g. AUTOPILOT_POOL=6), within 1 to 20. */
export const poolSize = (value: string | undefined, fallback: number) => Math.min(Math.max(Math.round(Number(value)) || fallback, 1), 20);
