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
 * - any message with SQL, a URL, a stack frame, a secret's name or runaway length.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { after } from "next/server";
import { aiUser } from "@/lib/ai/context";

export const OUR_SIDE = "Something went wrong on our side";
export const TOO_SLOW = "A data source took too long to answer. Try again in a moment.";

const INTERNAL: RegExp[] = [
  // Drizzle: "Failed query: <SQL>\nparams: <values>".
  /^Failed query:/i,
  // Postgres and its drivers.
  /relation "[^"]*" does not exist|column "[^"]*" does not exist|violates [\w-]+ constraint|duplicate key value|syntax error at or near|invalid input syntax for|value too long for type|null value in column|current transaction is aborted|canceling statement|terminating connection|too many connections|NeonDbError|DrizzleQueryError|PostgresError/i,
  // Network and runtime failures, and programming errors.
  /\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EPIPE|EHOSTUNREACH|UND_ERR_\w+)\b|fetch failed|socket hang up/i,
  /Cannot read propert|is not a function|is not defined|undefined \(reading|Unexpected token|JSON at position|is not valid JSON/i,
  // URLs (endpoints, keys in query strings), secrets' names, stack frames, dumped JSON.
  /https?:\/\//i,
  /\b[A-Z][A-Z0-9_]*_(KEY|SECRET|TOKEN|URL|PASSWORD|DSN)\b/,
  /\n\s+at\s|\bat\s+\S+\s+\(\S+:\d+:\d+\)/,
  /^\s*[[{]/,
];

/** Whether a message is unsafe to show as written. Pure, for tests. */
export function looksInternal(message: string, name = ""): boolean {
  if (!message.trim() || message.length > 400) return true;
  if (/DrizzleQueryError|NeonDbError|PostgresError/.test(name)) return true;
  return INTERNAL.some((r) => r.test(message));
}

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
  const status = statusOf(e) ?? (isTimeout(e) ? 504 : internal ? 500 : fallbackStatus);
  const ref = status >= 500 || internal ? logError(e, { status, where }) : undefined;
  return { status, message: publicMessage(e, ref), ...(ref ? { ref } : {}) };
}

/** The JSON response for an error (see describeFailure). */
export function errorResponse(e: unknown, fallbackStatus = 500, extra: Record<string, unknown> = {}): Response {
  const f = describeFailure(e, fallbackStatus);
  return Response.json({ error: f.message, ...(f.ref ? { ref: f.ref } : {}), ...extra }, { status: f.status });
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
