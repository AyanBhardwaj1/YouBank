/**
 * Which error text is safe to show a person, shared by the server (lib/errors) and the browser
 * (lib/client/errors). Pure and dependency-free, so client bundles and the test scripts can import it
 * without pulling in node:crypto or next/server.
 *
 * The rule is a deny-list on shape, not an allow-list of phrases: our own messages ("This draft was
 * already sent", "Many questions this hour") pass, and anything that looks like it came from a driver,
 * an SDK, a stack, an HTML error page or a config file is withheld.
 */

export const OUR_SIDE = "Something went wrong on our side";
export const TOO_SLOW = "A data source took too long to answer. Try again in a moment.";

const INTERNAL: RegExp[] = [
  // Drizzle: "Failed query: <SQL>\nparams: <values>".
  /^Failed query:/i,
  // Postgres and its drivers.
  /relation "[^"]*" does not exist|column "[^"]*" does not exist|violates [\w-]+ constraint|duplicate key value|syntax error at or near|invalid input syntax for|value too long for type|null value in column|current transaction is aborted|canceling statement|terminating connection|too many connections|NeonDbError|DrizzleQueryError|PostgresError/i,
  // Raw SQL that reached a message some other way (quoted identifiers or placeholders, so "Select a
  // company from the list" is not mistaken for a query).
  /\b(select|insert\s+into|update|delete\s+from)\b[^\n]{0,300}\b(from|into|set|where|values)\s+("\w+"|\(|\$\d)/i,
  // Network and runtime failures, and programming errors.
  /\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EPIPE|EHOSTUNREACH|UND_ERR_\w+)\b|fetch failed|socket hang up/i,
  /Cannot read propert|is not a function|is not defined|undefined \(reading|Unexpected token|JSON at position|is not valid JSON|Unexpected end of JSON/i,
  // URLs of any scheme (endpoints, keys in query strings, postgres:// with its password), secrets'
  // names, stack frames, dumped JSON.
  /\b[a-z][a-z0-9+.-]{1,15}:\/\//i,
  /\b[A-Z][A-Z0-9_]*_(KEY|SECRET|TOKEN|URL|PASSWORD|DSN)\b/,
  /\n\s+at\s|\bat\s+\S+\s+\(\S+:\d+:\d+\)|\bat\s+(async\s+)?\S+\s+\((node:|file:|webpack|\/)/,
  /^\s*[[{]/,
  // A library's complaint about its own setup ("Missing required config: cookies.secret…").
  /\b(missing|invalid) (required )?(config|configuration|option|env(ironment)? var(iable)?)\b|\bconfig object\b|\bis not configured\b/i,
  // Bearer tokens and provider key shapes (sk-..., sk_live_..., pk_..., xoxb-...).
  /\bBearer\s+[\w.-]{8,}|\b(sk|pk|rk)[-_](live_|test_|proj-|ant-)?[A-Za-z0-9_-]{12,}|\bxox[abp]-/,
  // An HTML or XML error page (a proxy's 502, Next's own 500, a provider's outage page, S3/R2's XML).
  /<\s*(!doctype|html|head|body|title|pre|script|h1)\b|<\?xml/i,
  // An upstream's response body quoted after its status ("The ML service answered 500: Traceback…"):
  // the status alone ("Sentinel-2 search answered 502") is fine to show; the body is for the log.
  /\b(answered|returned|responded( with)?|said) \d{3}\s*:\s*\S/i,
  // Python and Node tracebacks quoted by a service.
  /Traceback \(most recent call last\)|File "[^"]+", line \d+/,
  // Provider errors quoted as written: "OpenAI API error 500: …", "Anthropic API error …", "Stripe…".
  /\b(OpenAI|Anthropic|Stripe|Resend|Twilio) API error\b|\bStripe\w*Error\b/i,
];

/**
 * Error classes whose message is a provider's or driver's own text: the database, Stripe, and the
 * OpenAI and Anthropic SDKs (which share these names). Our own classes (Forbidden, AiLimitError,
 * PremiumRequiredError…) are written for people and are not listed.
 */
const INTERNAL_NAMES = /^(DrizzleQueryError|NeonDbError|PostgresError|Stripe\w*Error|APIError|APIConnectionError|APIConnectionTimeoutError|APIUserAbortError|BadRequestError|InternalServerError|UnprocessableEntityError|PermissionDeniedError|ConflictError|AuthenticationError|SyntaxError|TypeError|ReferenceError|RangeError)$/;

/** Whether a message is unsafe to show as written. Pure, for tests. */
export function looksInternal(message: string, name = ""): boolean {
  if (!message.trim() || message.length > 400) return true;
  if (/DrizzleQueryError|NeonDbError|PostgresError/.test(name) || INTERNAL_NAMES.test(name)) return true;
  return INTERNAL.some((r) => r.test(message));
}
