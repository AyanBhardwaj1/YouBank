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
/** A feature whose tables are not created yet on this server (a migration still to be applied). */
export const SETTING_UP = "This feature is still being set up";

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
  // A provider's billing limit, which tells our users to upgrade a plan that is ours ("Your account or
  // project has exceeded the quota. Upgrade your plan to increase limits." from Neon, via Neon Auth too).
  /\bexceeded (the|its|your) ([\w-]+ ){0,3}quota\b|\bUpgrade your plan to increase limits\b/i,
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

/**
 * A refusal's own words: the message of an error that carries a status below 500 and reads as written
 * for people ("Your broker said: insufficient buying power"), else `fallback`. For text kept where a
 * failure otherwise gets a generic line (an order row, an agent's step log).
 */
export function refusalMessage(e: unknown, fallback: string): string {
  const s = (e as { status?: unknown } | null)?.status;
  const message = e instanceof Error ? e.message.trim() : "";
  return typeof s === "number" && s >= 400 && s < 500 && message && !looksInternal(message, e instanceof Error ? e.name : "") ? message : fallback;
}

/** The parts of a validation issue (Zod's) a sentence is built from. */
export type FieldIssue = {
  path: readonly PropertyKey[]; code: string; message: string;
  origin?: string; minimum?: unknown; maximum?: unknown; inclusive?: boolean; expected?: string; values?: readonly unknown[]; format?: string;
};

/** A field's name as people read it: a label when one is given (by full path or last key), else "maxOrderUsd" as "Max order ($)". */
export function fieldLabel(path: readonly PropertyKey[], labels: Record<string, string> = {}): string {
  const keys = path.filter((k): k is string => typeof k === "string");
  const full = keys.join(".");
  const last = keys[keys.length - 1] ?? "";
  const named = labels[full] ?? labels[last];
  if (named) return named;
  if (!last) return "This value";
  const words = last.replace(/Usd$/, "($)").replace(/Bps$/, "(bps)").replace(/Pct$/, "(%)").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const bound = (v: unknown) => (typeof v === "number" || typeof v === "bigint" ? Number(v).toLocaleString("en-US") : String(v));

/**
 * One validation issue as a plain sentence about its field ("Limit band (bps) must be at most 500."),
 * instead of the validator's own wording ("execution.limitBandBps: Too big: expected number to be <=500").
 * A custom check's message is ours and is kept as written. Pure, for tests and the browser.
 */
export function issueSentence(i: FieldIssue, labels: Record<string, string> = {}): string {
  const label = fieldLabel(i.path, labels);
  const received = /received undefined|received null/i.test(i.message);
  switch (i.code) {
    case "custom":
      return i.message && !looksInternal(i.message) ? i.message : `${label} is not valid.`;
    case "too_small":
      if (i.origin === "string") return Number(i.minimum) <= 1 ? `${label} is required.` : `${label} must be at least ${bound(i.minimum)} characters.`;
      if (i.origin === "array" || i.origin === "set") return `${label} needs at least ${bound(i.minimum)} ${Number(i.minimum) === 1 ? "entry" : "entries"}.`;
      return `${label} must be ${i.inclusive === false ? "more than" : "at least"} ${bound(i.minimum)}.`;
    case "too_big":
      if (i.origin === "string") return `${label} must be at most ${bound(i.maximum)} characters.`;
      if (i.origin === "array" || i.origin === "set") return `${label} can have at most ${bound(i.maximum)} entries.`;
      return `${label} must be ${i.inclusive === false ? "less than" : "at most"} ${bound(i.maximum)}.`;
    case "invalid_type":
      if (received) return `${label} is required.`;
      if (i.expected === "int") return `${label} must be a whole number.`;
      return i.expected === "number" ? `${label} must be a number.` : i.expected === "boolean" ? `${label} must be on or off.` : i.expected === "array" ? `${label} must be a list.` : `${label} is not valid.`;
    case "invalid_value":
    case "invalid_enum_value": {
      const options = (i.values ?? []).filter((v) => typeof v === "string" || typeof v === "number").map(String);
      return options.length && options.length <= 8 ? `${label} must be one of: ${options.join(", ")}.` : `${label} is not one of the allowed values.`;
    }
    case "invalid_format":
    case "invalid_string":
      return i.format === "email" ? `${label} must be an email address.` : `${label} is not in the expected format.`;
    case "not_multiple_of":
      return `${label} must be a whole number.`;
    default:
      return `${label} is not valid.`;
  }
}
