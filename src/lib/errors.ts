/**
 * What an error may tell the person who hit it, and one log line for us.
 *
 * Messages written for people pass through as they are: errors that carry an HTTP status below 500
 * (permission, not found, limits, bad input) and our own plain-language errors ("This draft was
 * already sent"). Anything that could expose internals becomes "Something went wrong on our side
 * (ref …)", and the real error is logged as one JSON line under that reference (and sent to Sentry
 * when SENTRY_DSN is set):
 * - database driver errors: Drizzle puts the SQL and its parameter values in the message;
 * - network and SDK failures;
 * - any message with SQL, a URL, a stack frame, a secret's name, an HTML page or runaway length
 *   (the patterns are in lib/error-text, shared with the browser).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { after } from "next/server";
import { aiUser } from "@/lib/ai/context";
import { looksInternal, OUR_SIDE, TOO_SLOW } from "@/lib/error-text";

// The patterns live in a dependency-free module so the browser applies the same rule (lib/client/errors).
export { looksInternal, OUR_SIDE, TOO_SLOW };

const statusOf = (e: unknown): number | null => {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === "number" && s >= 400 && s <= 599 ? s : null;
};

/** Our own fetch timeouts (AbortSignal.timeout) and aborted upstream calls. */
export const isTimeout = (e: unknown) => ["TimeoutError", "AbortError"].includes((e as { name?: string } | null)?.name ?? "");

/** The message a person may see. `ref` points at the log line when the real message was withheld. */
export function publicMessage(e: unknown, ref?: string): string {
  if (isTimeout(e)) return TOO_SLOW;
  const message = e instanceof Error ? e.message : String(e ?? "");
  const name = e instanceof Error ? e.name : "";
  if (!looksInternal(message, name)) return message;
  return `${OUR_SIDE}${ref ? ` (ref ${ref})` : ""}. Try again, and if it keeps happening, quote the reference.`;
}

const userTag = (id: string | null) => (id ? createHash("sha256").update(id).digest("hex").slice(0, 12) : null);

/** Log an unexpected error as one JSON line (and to Sentry when configured). Returns its reference. */
export function logError(e: unknown, ctx: { status?: number; where?: string } = {}): string {
  const ref = randomBytes(4).toString("hex");
  const err = e instanceof Error ? e : new Error(String(e));
  const cause = (err as { cause?: unknown }).cause;
  console.error(JSON.stringify({
    level: "error", ref, status: ctx.status ?? null, where: ctx.where ?? null, user: userTag(aiUser()),
    // Next's digest is what an error page shows as its reference, so a person's report finds this line.
    digest: (e as { digest?: unknown } | null)?.digest ?? null,
    name: err.name, message: err.message.slice(0, 2_000), code: (e as { code?: unknown })?.code ?? null,
    cause: cause instanceof Error ? cause.message.slice(0, 500) : cause ? String(cause).slice(0, 500) : null,
    stack: err.stack?.split("\n").slice(1, 7).map((l) => l.trim()).join(" | ") ?? null,
  }));
  toSentry(err, ref, ctx);
  return ref;
}

/**
 * An error as a person should get it. A message meant for people keeps its own status, or
 * `fallbackStatus` (a route's usual 400 or 502). Anything internal becomes a 500 (504 for a timeout)
 * whose message carries the log reference; every 5xx is logged.
 */
export function describeFailure(e: unknown, fallbackStatus = 500, where?: string): { status: number; message: string; ref?: string } {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const internal = looksInternal(raw, e instanceof Error ? e.name : "");
  // An upstream's own 4xx (a provider's 401 for a bad key, 400 for a bad request) is our failure, not
  // the person's: answering 401 would read as "your session ended" and 400 as "you sent something wrong".
  const own = statusOf(e);
  const status = internal ? (own !== null && own >= 500 ? own : isTimeout(e) ? 504 : 500) : own ?? (isTimeout(e) ? 504 : fallbackStatus);
  const ref = status >= 500 || internal ? logError(e, { status, where }) : undefined;
  return { status, message: publicMessage(e, ref), ...(ref ? { ref } : {}) };
}

/**
 * The text to store or stream for a failure a person will see later (a run's status, a document's
 * error, an event in a stream): their own message when it is safe, else the "our side" line with a
 * reference whose details are logged here.
 */
export function failureMessage(e: unknown, where: string): string {
  return describeFailure(e, 500, where).message;
}

/**
 * Text already stored (by older code, or an upstream we quote) as it may be shown now: kept when it
 * reads as written for people, else replaced by `fallback`. For rows written before failureMessage.
 */
export function storedMessage(text: string | null | undefined, fallback = `${OUR_SIDE}. Try again.`): string {
  if (!text) return "";
  return looksInternal(text) ? fallback : text;
}

/**
 * Whether a database error says a table is missing (migrations not yet applied). Drizzle wraps the
 * driver's error as "Failed query: …" and keeps Postgres's own text and code (42P01) on `cause`, so the
 * message alone never matches.
 */
export function isMissingTable(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    if ((x as { code?: unknown }).code === "42P01") return true;
    const m = x instanceof Error ? x.message : typeof x === "string" ? x : "";
    if (/relation "?[^"\s]*"? does not exist|undefined_table/i.test(m)) return true;
  }
  return false;
}

/** The JSON response for an error (see describeFailure). */
export function errorResponse(e: unknown, fallbackStatus = 500, extra: Record<string, unknown> = {}): Response {
  const f = describeFailure(e, fallbackStatus);
  return Response.json({ error: f.message, ...(f.ref ? { ref: f.ref } : {}), ...extra }, { status: f.status });
}

/**
 * A route body with no guarded() around it (cron, streams, public endpoints): anything it throws is
 * answered as errorResponse, never as the platform's bare 500.
 */
export async function handled(fn: () => Promise<Response>, fallbackStatus = 500): Promise<Response> {
  try { return await fn(); } catch (e) { return errorResponse(e, fallbackStatus); }
}

/** A minimal Sentry client (the envelope endpoint, no SDK): only when SENTRY_DSN is set, sent after the response. */
function toSentry(err: Error, ref: string, ctx: { status?: number; where?: string }) {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  let url: URL;
  try { url = new URL(dsn); } catch { return; }
  const project = url.pathname.replace(/\//g, "");
  if (!url.username || !project) return;
  const eventId = randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId, timestamp: Date.now() / 1000, platform: "node", level: "error", logger: "youbank",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    ...(process.env.VERCEL_GIT_COMMIT_SHA ? { release: process.env.VERCEL_GIT_COMMIT_SHA } : {}),
    tags: { ref, status: String(ctx.status ?? ""), where: ctx.where ?? "" },
    user: { id: userTag(aiUser()) ?? "anonymous" },
    exception: { values: [{ type: err.name, value: err.message.slice(0, 1_000) }] },
    extra: { stack: err.stack?.slice(0, 4_000) ?? "" },
  };
  const body = [JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
  const send = () => fetch(`${url.protocol}//${url.host}/api/${project}/envelope/`, {
    method: "POST", body, signal: AbortSignal.timeout(5_000),
    headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${url.username}, sentry_client=youbank/1.0` },
  }).then(() => undefined, () => undefined);
  try { after(send); } catch { void send(); }
}
