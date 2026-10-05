/**
 * Checks that no raw error reaches a person: the shared rule (lib/error-text), the server's handling
 * (lib/errors) and the browser's (lib/client/errors), against a corpus of the nastiest messages the app
 * can meet (SQL, URLs with keys, stack traces, HTML error pages, provider and parser errors) and of the
 * plain ones it must still let through. No network, no database.
 *   pnpm exec tsx scripts/test-errors.ts
 */
import { looksInternal, OUR_SIDE, TOO_SLOW } from "@/lib/error-text";
import { describeFailure, failureMessage, isMissingTable, publicMessage, storedMessage } from "@/lib/errors";
import { ApiError, apiError, errorMessage, messageFor, OFFLINE, safeText, statusMessage } from "@/lib/client/errors";
import { isStaleBuild } from "@/components/ui/ErrorScreen";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};

/** Messages that must never be shown as written: [label, message, error name?]. */
const NASTY: [string, string, string?][] = [
  ["Drizzle failed query", 'Failed query: select "id", "email" from "profiles" where "user_id" = $1\nparams: dev-test'],
  ["raw SQL in a message", 'could not run insert into "edge_docs" ("owner_id", "title") values ($1, $2)'],
  ["an update statement", 'update "crm_drafts" set "status" = $1 where "id" = $2'],
  ["missing relation", 'relation "news_items" does not exist'],
  ["unique violation", 'duplicate key value violates unique constraint "profiles_pkey"'],
  ["Neon driver error by name", "Error connecting to database: fetch failed", "NeonDbError"],
  ["a query timeout", "canceling statement due to statement timeout"],
  ["a connection URL with a password", "connect to postgres://neondb_owner:npg_s3cret@ep-cool-123.us-east-2.aws.neon.tech/neondb failed"],
  ["a URL with an API key", "FMP 429 for https://financialmodelingprep.com/stable/profile?symbol=AAPL&apikey=abcd1234"],
  ["a secret's name", "Set OPENAI_API_KEY in the environment"],
  ["a DSN's name", "SENTRY_DSN is malformed"],
  ["an OpenAI key", "Incorrect API key provided: sk-proj-AbCdEfGhIjKlMnOpQrStUv"],
  ["a Stripe live key", "Invalid API Key provided: sk_live_51HxyzABCDEFGHIJKLMN"],
  ["a bearer token", "Request rejected: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"],
  ["a Slack token", "token xoxb-1234-5678 is invalid"],
  ["a Node stack trace", "TypeError: x is undefined\n    at render (/var/task/.next/server/chunks/123.js:4:17)\n    at async Promise.all (index 0)"],
  ["a one-line stack frame", "boom at handler (/var/task/src/app/api/edge/route.ts:12:5)"],
  ["a browser stack frame", "render@https://youbank.app/_next/static/chunks/app-123.js:1:2345"],
  ["a Python traceback", 'Traceback (most recent call last):\n  File "/app/main.py", line 12, in run\nKeyError: "pages"'],
  ["a programming error", "Cannot read properties of undefined (reading 'map')"],
  ["a missing function", "e.rows.map is not a function"],
  ["a JSON parse error on HTML", `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`],
  ["a JSON parse error at a position", "Unexpected token u in JSON at position 0"],
  ["a cut-off JSON body", "Unexpected end of JSON input"],
  ["an HTML error page", "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><h1>502</h1></body></html>"],
  ["an nginx page", "<html>\r\n<head><title>504 Gateway Time-out</title></head>"],
  ["an XML error from storage", '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code></Error>'],
  ["dumped JSON", '{"error":{"message":"Invalid request","type":"invalid_request_error"}}'],
  ["a dumped array", '[{"code":"invalid_type","expected":"string","path":["title"]}]'],
  ["a quoted upstream body", "The ML service answered 500: worker crashed while parsing pages"],
  ["a rerank body", "cohere rerank answered 401: invalid api token"],
  ["an OpenAI API error", "OpenAI API error 400: Invalid value for 'input[3].content'"],
  ["an Anthropic API error", "Anthropic API error 500: Internal server error"],
  ["a Stripe error by name", "No such customer: 'cus_123'", "StripeInvalidRequestError"],
  ["an SDK bad request by name", "400 Invalid 'tools[0].name'", "BadRequestError"],
  ["an SDK connection error by name", "Connection error.", "APIConnectionError"],
  ["a library's setup error", "Missing required config: cookies.secret. You must provide the cookie secret in the config object."],
  ["an unconfigured service", "Neon Auth is not configured"],
  ["a network failure", "fetch failed"],
  ["a refused connection", "connect ECONNREFUSED 127.0.0.1:5432"],
  ["DNS failure", "getaddrinfo ENOTFOUND api.example.internal"],
  ["an undici error", "UND_ERR_CONNECT_TIMEOUT"],
  ["a socket hang up", "socket hang up"],
  ["a syntax error by name", "Unexpected identifier 'foo'", "SyntaxError"],
  ["a runaway message", "x".repeat(401)],
  ["an empty message", "   "],
];

/** Messages written for people, which must pass unchanged. */
const PLAIN = [
  "This draft was already sent",
  "Many questions this hour; try again in a few minutes.",
  "Select a company from the list",
  "Update your settings from the Settings page",
  "Delete from your library? This cannot be undone.",
  "Sentinel-2 search answered 502",
  "Unknown ticker ZZZZ",
  "Sign in required",
  "That model is private to the person who made it",
  "IMAP sign-in was refused. Use an app password, not your normal password, and check the address. For Gmail: 2-Step Verification must be on, then create one at myaccount.google.com/apppasswords.",
  `${OUR_SIDE} (ref 1a2b3c4d). Try again, and if it keeps happening, quote the reference.`,
  "The agent is already working on this document. Wait for it to finish, or stop it first.",
  "That message is too long (over 40,000 characters). Shorten it, or open the document in Studio and ask there.",
  "Two of your runs are still going; wait for one to finish.",
];

const quiet = console.error;

async function main() {
  console.log("the shared rule withholds");
  for (const [label, message, name] of NASTY) check(label, looksInternal(message, name ?? ""), message.slice(0, 80));

  console.log("the shared rule lets through");
  for (const message of PLAIN) check(message.slice(0, 60), !looksInternal(message), message);

  console.error = () => undefined;

  console.log("the server");
  const drizzle = Object.assign(new Error(NASTY[0][1]), { name: "DrizzleQueryError", cause: Object.assign(new Error('relation "profiles" does not exist'), { code: "42P01" }) });
  const f = describeFailure(drizzle, 400);
  check("a database error is a 500 with a reference", f.status === 500 && !!f.ref && f.message.includes(f.ref) && !/profiles|select/i.test(f.message), f);
  check("a missing table is recognised through Drizzle's wrapper", isMissingTable(drizzle));
  check("…and by its Postgres code alone", isMissingTable(Object.assign(new Error("x"), { cause: { code: "42P01" } })));
  check("…but not from an unrelated error", !isMissingTable(new Error("Unknown ticker")) && !isMissingTable(null));
  const providerAuth = Object.assign(new Error("401 Incorrect API key provided: sk-proj-AbCdEfGhIjKl"), { name: "AuthenticationError", status: 401 });
  const p = describeFailure(providerAuth);
  check("a provider's 401 is not answered as the person's 401", p.status === 500 && p.message.startsWith(OUR_SIDE), p);
  const provider5xx = Object.assign(new Error("Anthropic API error 529: Overloaded"), { status: 529 });
  check("a provider's own 5xx keeps its status, not its words", describeFailure(provider5xx).status === 529 && describeFailure(provider5xx).message.startsWith(OUR_SIDE));
  const forbidden = Object.assign(new Error("You are not on that team"), { status: 403 });
  check("a permission message keeps its status and words", describeFailure(forbidden).status === 403 && describeFailure(forbidden).message === "You are not on that team");
  check("a timeout reads as one", publicMessage(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })) === TOO_SLOW);
  const fm = failureMessage(new Error("connect ECONNREFUSED 10.0.0.1:5432"), "test");
  check("failureMessage withholds and carries a reference", fm.startsWith(OUR_SIDE) && /\(ref [0-9a-f]{8}\)/.test(fm), fm);
  check("failureMessage keeps a plain message", failureMessage(new Error("No speech found in the recording."), "test") === "No speech found in the recording.");
  check("a stored raw error is replaced", storedMessage("Failed query: select 1", "Reading failed") === "Reading failed");
  check("a stored plain error is kept", storedMessage("No text found in the file.") === "No text found in the file.");
  check("an empty stored error stays empty", storedMessage("") === "");

  console.log("the browser: by status");
  check("401 asks to sign in", /sign in/i.test(statusMessage(401)));
  check("402 points at plans", /plan/i.test(statusMessage(402)));
  check("403 says no access", /access/i.test(statusMessage(403)));
  check("404 says not found", /could not find/i.test(statusMessage(404)));
  check("429 says limit", /limit/i.test(statusMessage(429)));
  check("504 says too slow", statusMessage(504) === TOO_SLOW);
  check("500 and 502 are our side", statusMessage(500).startsWith(OUR_SIDE) && statusMessage(502).startsWith(OUR_SIDE));
  check("other 4xx are plain", /could not be completed/.test(statusMessage(422)));

  console.log("the browser: response bodies");
  check("our own error passes", messageFor(409, { error: "This draft was already sent" }).message === "This draft was already sent");
  const withRef = messageFor(500, { error: `${OUR_SIDE} (ref deadbeef). Try again.`, ref: "deadbeef" });
  check("a reference already in the message is not repeated", withRef.message.split("deadbeef").length === 2 && withRef.ref === "deadbeef", withRef);
  check("a reference outside the message is appended", messageFor(500, { error: "Plain words", ref: "cafe1234" }).message === "Plain words (ref cafe1234)");
  check("an internal error in JSON falls back by status", messageFor(500, { error: NASTY[0][1] }).message === statusMessage(500));
  check("a provider's message field is screened too", messageFor(400, { message: "OpenAI API error 400: Invalid value" }).message === statusMessage(400));
  check("an HTML body (a string, not JSON) falls back by status", messageFor(502, NASTY[24][1]).message === statusMessage(502));
  check("an empty body falls back by status", messageFor(401, null).message === statusMessage(401));
  check("a bogus ref is ignored", messageFor(500, { error: "Plain words", ref: "<script>alert(1)</script>" }).message === "Plain words");

  const html = await apiError(new Response("<!DOCTYPE html><html><body><pre>Error: boom\n    at x (/var/task/a.js:1:1)</pre></body></html>", { status: 500, headers: { "content-type": "text/html" } }));
  check("an HTML 500 becomes our-side text", html instanceof ApiError && html.status === 500 && html.message === statusMessage(500) && !/DOCTYPE|boom/.test(html.message), html.message);
  const json = await apiError(Response.json({ error: "Many questions this hour; try again in a few minutes.", planLimited: true }, { status: 429 }));
  check("a JSON 429 keeps our words and its body", json.message.startsWith("Many questions") && json.status === 429 && json.body.planLimited === true, json);
  const empty = await apiError(new Response(null, { status: 503 }));
  check("an empty 503 is our side", empty.message === statusMessage(503));

  console.log("the browser: caught errors");
  check("the browser's network failure reads as offline", errorMessage(new TypeError("Failed to fetch")) === OFFLINE);
  check("Safari's network failure reads as offline", errorMessage(new TypeError("Load failed")) === OFFLINE);
  check("Firefox's network failure reads as offline", errorMessage(new TypeError("NetworkError when attempting to fetch resource.")) === OFFLINE);
  check("a JSON parse error is our side", errorMessage(new SyntaxError(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`)).startsWith(OUR_SIDE));
  check("a bug's TypeError is our side", errorMessage(new TypeError("Cannot read properties of undefined (reading 'map')")).startsWith(OUR_SIDE));
  check("an ApiError keeps its message", errorMessage(new ApiError("You are not on that team", 403)) === "You are not on that team");
  check("our own thrown message passes", errorMessage(new Error("Enter a ticker for trading comps.")) === "Enter a ticker for trading comps.");
  check("a thrown string is screened", errorMessage("connect ECONNREFUSED 1.2.3.4:443").startsWith(OUR_SIDE) && errorMessage("Pick a file first") === "Pick a file first");
  check("a timeout says so", errorMessage(Object.assign(new Error("signal timed out"), { name: "TimeoutError" })) === TOO_SLOW);
  check("nothing at all is our side", errorMessage(undefined).startsWith(OUR_SIDE) && errorMessage({}).startsWith(OUR_SIDE));
  check("a streamed error event is screened", safeText(NASTY[15][1]).startsWith(OUR_SIDE) && safeText("The model declined this request.") === "The model declined this request." && safeText(42).startsWith(OUR_SIDE));

  console.log("the error page");
  check("a missing chunk after a deploy asks for a reload", isStaleBuild({ name: "ChunkLoadError", message: "Loading chunk 123 failed." }) && isStaleBuild({ message: "Failed to fetch dynamically imported module: https://x/_next/a.js" }));
  check("an ordinary crash is not a stale build", !isStaleBuild(new TypeError("Cannot read properties of undefined")));

  console.log("every nasty message, through every door");
  for (const [label, message, name] of NASTY) {
    const e = Object.assign(new Error(message), name ? { name } : {});
    // Text alone (a response body, a stream event) has lost the error's class, so the name-only cases
    // are checked through the doors that still see the error object.
    const outs = [publicMessage(e), describeFailure(e).message, errorMessage(e), ...(name ? [] : [messageFor(500, { error: message }).message, safeText(message)])];
    const leaked = outs.find((o) => o.includes(message.trim().slice(0, 24)) && message.trim().length > 0);
    check(`withheld everywhere: ${label}`, !leaked, leaked);
  }

  console.error = quiet;
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error = quiet; console.error(e); process.exit(1); });
