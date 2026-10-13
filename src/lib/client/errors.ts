/**
 * Failed requests as a person should read them, in the browser.
 *
 * Our API answers failures as JSON `{ error, ref? }`, already screened on the server (lib/errors). This
 * is the second screen, for everything that is not: an HTML page from a proxy or the platform, an
 * empty 500 from a route that threw, a body cut off mid-stream, the browser's own "Failed to fetch".
 * The rule is the server's (lib/error-text); what fails it becomes a plain line chosen by HTTP status,
 * with the reference kept so support can find the log line.
 *
 * Pure apart from `navigator.onLine` (guarded), so scripts/test-errors.ts runs it under Node.
 */
import { looksInternal, OUR_SIDE, TOO_SLOW } from "@/lib/error-text";

export const OFFLINE = "You seem to be offline, or YouBank could not be reached. Check your connection and try again.";

/** The line for a status when the response carried nothing safe to show. Pure, for tests. */
export function statusMessage(status: number): string {
  if (status === 401) return "Your session has ended. Sign in again to continue.";
  if (status === 402) return "This needs a plan that includes it. See Settings for plans.";
  if (status === 403) return "You do not have access to this.";
  if (status === 404) return "We could not find that. It may have been moved or deleted.";
  if (status === 408 || status === 504) return TOO_SLOW;
  if (status === 409) return "This changed while you were working on it. Reload and try again.";
  if (status === 413) return "That is too large to send. Try something smaller.";
  if (status === 429) return "You have reached a usage limit for now. Wait a little and try again.";
  if (status >= 500) return `${OUR_SIDE}. Try again in a moment.`;
  if (status >= 400) return "That request could not be completed. Check what you entered and try again.";
  return `${OUR_SIDE}. Try again in a moment.`;
}

/** A failed API call: a safe `message`, the status, the server's log reference and the parsed body. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly ref?: string, readonly body: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
  }
}

const withRef = (message: string, ref?: string) => (ref && !message.includes(ref) ? `${message} (ref ${ref})` : message);
const REF = /^[a-z0-9-]{4,40}$/i;

/**
 * The message for a failed response's parsed body. Pure, for tests: `body` is whatever the response
 * held (parsed JSON, raw text, or nothing).
 */
export function messageFor(status: number, body: unknown): { message: string; ref?: string } {
  const j = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const ref = typeof j.ref === "string" && REF.test(j.ref) ? j.ref : undefined;
  // Our routes say `error`; a few older ones and some providers say `message`.
  const said = [j.error, j.message].find((v): v is string => typeof v === "string" && v.trim().length > 0);
  if (said && !looksInternal(said)) return { message: withRef(said.trim(), ref), ref };
  return { message: withRef(statusMessage(status), ref), ref };
}

/** Read a failed response into an ApiError. Never throws; never returns HTML or stack text. */
export async function apiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    const text = await res.text();
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  } catch { /* the body could not be read: the status decides */ }
  const { message, ref } = messageFor(res.status, body);
  return new ApiError(message, res.status, ref, body && typeof body === "object" ? (body as Record<string, unknown>) : {});
}

/** The message for a failed response (for code that wants a string, not an error). */
export async function readError(res: Response): Promise<string> {
  return (await apiError(res)).message;
}

const offline = () => { try { return typeof navigator !== "undefined" && navigator.onLine === false; } catch { return false; } };

/**
 * What to show for anything caught: an ApiError's own message; the browser's network failures as
 * "offline"; a timeout as such; our own thrown messages ("Enter a ticker") as written; anything else
 * (a JSON parse error from an HTML body, a TypeError from a bug) as the plain "our side" line.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  const name = (e as { name?: unknown } | null)?.name;
  const message = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (name === "TimeoutError") return TOO_SLOW;
  if (name === "AbortError") return "Stopped.";
  if (offline() || (name === "TypeError" && /failed to fetch|networkerror|load failed|network request failed|network connection was lost/i.test(message))) return OFFLINE;
  if (message && !looksInternal(message, typeof name === "string" && name !== "Error" ? name : "")) return message;
  return `${OUR_SIDE}. Try again in a moment.`;
}

/** Whether a caught error is the request being cancelled (a closed panel, a newer search). */
export const isAbort = (e: unknown) => (e as { name?: unknown } | null)?.name === "AbortError";

/**
 * fetch, then JSON, with failures as ApiError: the one call most components need. A network failure
 * rejects with the browser's TypeError (errorMessage turns it into "offline").
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw await apiError(res);
  try { return (await res.json()) as T; } catch { throw new ApiError(`${OUR_SIDE}. Try again in a moment.`, res.status); }
}

/**
 * A message that arrived inside a stream (an `error` event) or a stored row (a run's status), shown
 * as written when it reads as meant for people, else the plain "our side" line. Pure, for tests.
 */
export function safeText(text: unknown, fallback = `${OUR_SIDE}. Try again in a moment.`): string {
  return typeof text === "string" && text.trim() && !looksInternal(text) ? text : fallback;
}
