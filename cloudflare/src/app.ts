/**
 * Calls from the Worker back into YouBank, where the data, models and tools live (src/app/api/cf/* there),
 * with the shared secret, a time limit, and an error that says which call failed and with what status (never
 * the body, which could carry someone's data into the logs).
 */
import type { Env } from "./env";

export class AppError extends Error {
  constructor(public path: string, public status: number) { super(`YouBank answered ${status} for ${path}`); }
  /** 4xx (except 408 and 429) will not get better by trying again. */
  get permanent() { return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429; }
}

export async function callApp<T>(env: Env, path: string, body: unknown, timeoutMs = 60_000): Promise<T> {
  const res = await fetch(`${env.APP_URL.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.APP_SECRET}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) { await res.body?.cancel(); throw new AppError(path, res.status); }
  return (await res.json()) as T;
}

/** Constant-time comparison of a request's bearer token with the shared secret. */
export function authorized(req: Request, env: Env): boolean {
  const want = `Bearer ${env.APP_SECRET ?? ""}`;
  const got = req.headers.get("authorization") ?? "";
  if (!env.APP_SECRET || env.APP_SECRET.length < 32 || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
