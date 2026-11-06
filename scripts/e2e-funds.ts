/**
 * End-to-end check of the features for funds, through the HTTP API of a running server: the Book (sample
 * book, import, checks with headroom), the MCP server (keys, initialize, tools, prompts, check_thesis),
 * proposals from AI apps, risk, the pre-trade what-if, the calendar and team risk, MCP sign-in with OAuth (discovery, registration, consent, PKCE token exchange, replay
 * refused, a confidential client's secret) and the research ledger (recording an MCP call, the chain check, the
 * export, the governance report).
 *
 * Run against a local server signed in as a development user whose profile exists (finish onboarding once,
 * or seed auth_users and profiles), with company data reachable or cached. Never against production:
 *
 *   YOUBANK_DEV_USER=e2e DATABASE_URL=postgres://… pnpm dev --port 3100
 *   pnpm exec tsx scripts/e2e-funds.ts [--base http://localhost:3100]
 *
 * It adds the sample book and a few imported names to that user's Book, turns their research ledger on,
 * and revokes the keys it made. Exits 1 if any check failed.
 */
import { createHash, randomBytes } from "node:crypto";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const BASE = (arg("base") ?? "http://localhost:3100").replace(/\/$/, "");
const ORIGIN = { Origin: BASE };
let failed = 0, passed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${label}`); return; }
  failed++; console.log(`  FAIL ${label}${detail === undefined ? "" : `\n       ${JSON.stringify(detail).slice(0, 400)}`}`);
};
const j = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...ORIGIN, ...(init.headers ?? {}) } });
  const text = await res.text();
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
};
const rpc = (key: string, method: string, params?: unknown, id: number | null = 1) =>
  j("/api/mcp", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) }) });

async function main() {
  const made: string[] = [];
  console.log(`e2e for funds against ${BASE}`);

  console.log("the Book");
  const sample = await j("/api/book/import", { method: "POST", body: JSON.stringify({ sample: true }) });
  check("the sample book loads (or its names are already there)", sample.status === 200 && (sample.body.added.length > 0 || sample.body.skipped.length > 0), sample.body);
  const imp = await j("/api/book/import", { method: "POST", body: JSON.stringify({ text: "Ticker\tSide\tWeight\tEntry\nMSFT\tLong\t4%\t$400\nnot a ticker line", template: "auto" }) });
  check("a pasted sheet imports, and a line without a ticker is reported", imp.status === 200 && imp.body.problems.length >= 1, imp.body);
  const book = await j("/api/book");
  check("the book is checked: verdicts, exposure and history", book.status === 200 && book.body.evaluations.length > 0 && typeof book.body.summary.gross === "number" && typeof book.body.history === "object", book.body?.summary);
  const checked = (book.body.evaluations as { checks: { headroom: unknown; evidence: unknown }[] }[]).flatMap((e) => e.checks).filter((c) => c.evidence);
  check("every checked criterion carries its source and headroom", checked.length === 0 || checked.every((c) => c.headroom), checked[0]);

  console.log("the MCP server");
  const key = await j("/api/settings/mcp-keys", { method: "POST", body: JSON.stringify({ name: "e2e" }) });
  check("a key is made and shown once", key.status === 200 && /^ybm_/.test(key.body.key), key.body);
  const K = key.body.key as string;
  made.push(key.body.view?.id);
  const noKey = await j("/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  check("no key: 401 naming where to sign in", noKey.status === 401 && /resource_metadata=/.test(noKey.headers.get("www-authenticate") ?? ""), noKey.headers.get("www-authenticate"));
  const init = await rpc(K, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  check("initialize: tools and prompts", init.body.result?.protocolVersion === "2025-11-25" && !!init.body.result?.capabilities?.prompts, init.body);
  check("a notification is accepted with 202", (await rpc(K, "notifications/initialized", undefined, null)).status === 202);
  const tools = await rpc(K, "tools/list");
  const names = (tools.body.result?.tools ?? []).map((t: { name: string }) => t.name);
  check("tools include the Book, its risk and check_thesis", names.includes("book_status") && names.includes("book_risk") && names.includes("check_thesis"), names);
  const prompts = await rpc(K, "prompts/list");
  check("five prompts", (prompts.body.result?.prompts ?? []).length === 5, prompts.body);
  const ct = await rpc(K, "tools/call", { name: "check_thesis", arguments: { ticker: "MSFT", criteria: [{ metric: "gross_margin", op: ">=", value: 50 }] } });
  check("check_thesis answers with a verdict and sources", !!ct.body.result && ["intact", "watch", "broken", "unknown"].includes(ct.body.result.structuredContent?.result?.verdict), ct.body);
  const listedTools = (tools.body.result?.tools ?? []) as { name: string; annotations?: { readOnlyHint?: boolean } }[];
  check("only propose_position is marked as writing", listedTools.filter((t) => t.annotations?.readOnlyHint === false).map((t) => t.name).join() === "propose_position", listedTools.map((t) => [t.name, t.annotations?.readOnlyHint]));
  const prop = await rpc(K, "tools/call", { name: "propose_position", arguments: { ticker: "MSFT", direction: "long", thesis: "e2e: Azure growth holds above 30%.", kill_criteria: [{ metric: "revenue_growth", op: ">=", value: 10 }], rationale: "e2e" } });
  const propId = prop.body.result?.structuredContent?.result?.id as string | undefined;
  const afterProp = await j("/api/book");
  check("a proposal waits in the Book and adds nothing", !!propId && afterProp.body.proposals?.some((x: { id: string }) => x.id === propId) && !afterProp.body.positions.some((x: { thesis: string }) => x.thesis.startsWith("e2e: Azure")), prop.body);
  const dis = await j(`/api/book/proposals?id=${propId}`, { method: "DELETE" });
  check("dismissing it clears it", dis.status === 200 && !(await j("/api/book")).body.proposals?.some((x: { id: string }) => x.id === propId));

  console.log("MCP sign-in (OAuth)");
  const prm = await j("/.well-known/oauth-protected-resource/api/mcp");
  const asm = await j("/.well-known/oauth-authorization-server");
  check("discovery: the resource names this server; S256 and registration offered", prm.body.authorization_servers?.[0] === asm.body.issuer && asm.body.code_challenge_methods_supported?.includes("S256") && !!asm.body.registration_endpoint, { prm: prm.body, asm: asm.body });
  const redirect = "http://localhost:8765/callback";
  const reg = await j("/api/oauth/register", { method: "POST", body: JSON.stringify({ client_name: "e2e client", redirect_uris: [redirect] }) });
  check("registration", reg.status === 201 && /^ybc_/.test(reg.body.client_id), reg.body);
  check("a non-https, non-local redirect is refused", (await j("/api/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) })).status === 400);
  const verifier = randomBytes(32).toString("base64url");
  const q = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id, redirect_uri: redirect, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: "e2e-state", resource: `${BASE}/api/mcp` });
  const consent = await fetch(`${BASE}/app/connect/authorize?${q}`);
  check("the consent page renders", consent.status === 200 && (await consent.text()).includes("e2e client"));
  const cross = await fetch(`${BASE}/api/oauth/authorize`, { method: "POST", body: new URLSearchParams({ ...Object.fromEntries(q), decision: "approve" }), redirect: "manual", headers: { Origin: "https://evil.example" } });
  check("a cross-site approval is refused", cross.status === 403);
  const approve = await fetch(`${BASE}/api/oauth/authorize`, { method: "POST", body: new URLSearchParams({ ...Object.fromEntries(q), decision: "approve" }), redirect: "manual", headers: ORIGIN });
  const back = new URL(approve.headers.get("location") ?? "http://x/");
  check("approval sends the code back with the state", approve.status === 303 && back.searchParams.get("state") === "e2e-state" && !!back.searchParams.get("code"), approve.headers.get("location"));
  const tokenBody = new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code") ?? "", redirect_uri: redirect, client_id: reg.body.client_id, code_verifier: verifier, resource: `${BASE}/api/mcp` });
  const tok = await fetch(`${BASE}/api/oauth/token`, { method: "POST", body: tokenBody, headers: { "Content-Type": "application/x-www-form-urlencoded" } }).then((r) => r.json());
  check("the code is exchanged for a key", tok.token_type === "Bearer" && /^ybm_/.test(tok.access_token), tok);
  check("the signed-in key works", (await rpc(tok.access_token, "ping")).body.result !== undefined);
  const replay = await fetch(`${BASE}/api/oauth/token`, { method: "POST", body: tokenBody, headers: { "Content-Type": "application/x-www-form-urlencoded" } }).then((r) => r.json());
  check("a used code is refused", replay.error === "invalid_grant", replay);

  // A confidential client (registers for a secret): the secret is checked on top of PKCE.
  const creg = await j("/api/oauth/register", { method: "POST", body: JSON.stringify({ client_name: "e2e confidential", redirect_uris: [redirect], token_endpoint_auth_method: "client_secret_basic" }) });
  check("a confidential client gets a secret once", creg.status === 201 && typeof creg.body.client_secret === "string" && creg.body.token_endpoint_auth_method === "client_secret_basic", creg.body);
  const v2 = randomBytes(32).toString("base64url");
  const q2 = new URLSearchParams({ response_type: "code", client_id: creg.body.client_id, redirect_uri: redirect, code_challenge: createHash("sha256").update(v2).digest("base64url"), code_challenge_method: "S256", state: "s2" });
  const code2 = async () => new URL((await fetch(`${BASE}/api/oauth/authorize`, { method: "POST", body: new URLSearchParams({ ...Object.fromEntries(q2), decision: "approve" }), redirect: "manual", headers: ORIGIN })).headers.get("location") ?? "http://x/").searchParams.get("code") ?? "";
  const basic = (secret: string) => `Basic ${Buffer.from(`${encodeURIComponent(creg.body.client_id)}:${encodeURIComponent(secret)}`).toString("base64")}`;
  const bad = await fetch(`${BASE}/api/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: await code2(), redirect_uri: redirect, code_verifier: v2 }), headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic("wrong") } });
  check("a wrong client secret is refused", bad.status === 401);
  const good = await fetch(`${BASE}/api/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: await code2(), redirect_uri: redirect, code_verifier: v2 }), headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic(creg.body.client_secret) } }).then((r) => r.json());
  check("the right secret with HTTP Basic gets a key", /^ybm_/.test(good.access_token ?? ""), good);

  console.log("risk, the what-if and the calendar");
  const risk = await j("/api/book/risk");
  check("the book's risk answers with five stress replays (figures need prices; without them it says what is left out)", risk.status === 200 && Array.isArray(risk.body.scenarios) && risk.body.scenarios.length === 5 && Array.isArray(risk.body.excluded), risk.body?.excluded);
  const wi = await j("/api/book/risk?add=MSFT&side=long&weight=3");
  check("a pre-trade what-if answers with before and after, or why it cannot", wi.status === 200 && !!wi.body.before && !!wi.body.after && (typeof wi.body.note === "string"), wi.body);
  check("a what-if without a valid weight is refused", (await j("/api/book/risk?add=MSFT&weight=0")).status === 400);
  const cal = await fetch(`${BASE}/api/book/calendar`, { headers: ORIGIN });
  const ics = await cal.text();
  check("the calendar is an iCalendar file", cal.status === 200 && (cal.headers.get("content-type") ?? "").startsWith("text/calendar") && ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.trimEnd().endsWith("END:VCALENDAR"), ics.slice(0, 120));
  const teams = await j("/api/book/team");
  if (teams.body?.teams?.length) {
    const tr = await j(`/api/book/team?team=${teams.body.teams[0].id}&risk=1`);
    check("a team's per-member risk answers", tr.status === 200 && typeof tr.body.risk === "object", tr.body);
  }

  console.log("the research ledger");
  const on = await j("/api/ledger", { method: "POST", body: JSON.stringify({ on: true }) });
  check("recording on", on.status === 200 && on.body.settings.on === true, on.body);
  const page0 = await j("/api/ledger");
  if (page0.body.available === false) {
    check("the ledger table exists (apply drizzle/0033_research_ledger.sql)", false);
  } else {
    await rpc(K, "tools/call", { name: "calc", arguments: { script: "1 + 1" } });
    const page = await j("/api/ledger");
    check("the MCP call is recorded", page.body.entries.some((e: { kind: string; subject: string }) => e.kind === "mcp" && e.subject.startsWith("calc")), page.body.entries?.slice(0, 3));
    const v = await j("/api/ledger/verify");
    check("the chain verifies", v.body.ok === true, v.body);
    const exp = await fetch(`${BASE}/api/ledger/export`).then((r) => r.text());
    check("the export has a header and the entries", exp.trim().split("\n").length >= 2 && exp.startsWith("{\"youbank_research_ledger\":1"));
    const gov = await fetch(`${BASE}/report/ledger`).then(async (r) => ({ status: r.status, text: await r.text() }));
    check("the governance report renders with the chain's state", gov.status === 200 && gov.text.includes("AI governance report") && /The chain (checks|does not check)/.test(gov.text));
  }

  const keys = await j("/api/settings/mcp-keys");
  for (const k of (keys.body.keys ?? []) as { id: string; name: string }[]) if (k.name === "e2e" || k.name === "e2e client (connected)" || k.name === "e2e confidential (connected)") await j(`/api/settings/mcp-keys?id=${k.id}`, { method: "DELETE" });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
