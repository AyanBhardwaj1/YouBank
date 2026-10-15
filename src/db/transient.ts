/**
 * Which database failures are worth one more try, and which queries may be repeated. Pure (no driver
 * import), so scripts/test-prod.ts checks the rules without a database.
 *
 * On Neon a connection can fail in ways that pass: the compute scaling to zero closes idle connections
 * (57P01), a waking compute refuses for a moment (57P03), the pooler or the network drops a socket, a
 * DNS lookup hiccups. Two kinds:
 * - the query never left (we could not connect): safe to try again whatever it was;
 * - the connection broke while the query was out: we cannot know whether it ran, so only a plain read
 *   is tried again.
 */

/** Connecting failed: the query was never sent. */
const NOT_SENT = new Set(["CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "57P03", "08001", "08004"]);
/** The connection broke, possibly with the query out. */
const BROKEN = new Set(["CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "ECONNRESET", "EPIPE", "ETIMEDOUT", "57P01", "57P02", "08000", "08003", "08006"]);

function codes(e: unknown): string[] {
  const out: string[] = [];
  for (let x: unknown = e, i = 0; x && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    const c = (x as { code?: unknown }).code;
    if (typeof c === "string") out.push(c);
  }
  return out;
}

/** The query certainly did not reach the server. Pure. */
export const neverSent = (e: unknown) => codes(e).some((c) => NOT_SENT.has(c));

/** A failure of the connection, not of the query (no syntax error, constraint or timeout). Pure. */
export const isTransientDbError = (e: unknown) => codes(e).some((c) => NOT_SENT.has(c) || BROKEN.has(c));

/**
 * A statement that only reads, so running it twice is harmless: a SELECT with no locking clause and
 * no call that could write (sequences, advisory locks, settings, notifications, cron or vault). Pure.
 */
export function isPlainRead(text: string): boolean {
  const s = text.replace(/--[^\n]*\n?/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim().toLowerCase();
  if (!s.startsWith("select")) return false;
  return !/\b(for\s+(update|share|no\s+key\s+update|key\s+share)\b|nextval|setval|pg_advisory\w*|set_config|pg_notify|pg_terminate\w*|pg_cancel\w*|into\s+\w|insert\b|update\b|delete\b|merge\b|cron\.|vault\.|net\.http)/.test(s);
}

/** Whether a failed statement may be sent again. Pure. */
export const mayRetry = (text: string, e: unknown) => neverSent(e) || (isTransientDbError(e) && isPlainRead(text));
