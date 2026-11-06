import { callerIp } from "@/lib/desktop/auth";
import { withinRate } from "@/lib/locks";
import { createKey } from "@/lib/mcp/store";
import { json, oauthError, originOf, preflight } from "@/lib/mcp/http";
import { pkceOk, resourceOf, secretFrom, secretMatches } from "@/lib/mcp/oauth";
import { confirmClient, getClient, takeCode } from "@/lib/mcp/oauth-store";

export const dynamic = "force-dynamic";

/**
 * Token endpoint: an authorization code (with its PKCE verifier) for an access token. The token is an MCP
 * key named for the app, so it is listed and revoked in Settings → Connect AI apps. Codes are single-use
 * and expire in ten minutes; everything about the request must match what was approved.
 */
export async function POST(req: Request) {
  if (!(await withinRate(`oauth-token:${callerIp(req)}`, 60, 600_000).catch(() => true))) return oauthError("invalid_request", "Too many token requests. Try again later.", 429);
  const ct = req.headers.get("content-type") ?? "";
  const raw = ct.includes("application/json") ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : Object.fromEntries(new URLSearchParams(await req.text().catch(() => "")));
  const p = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : "");
  if (p("grant_type") !== "authorization_code") return oauthError("unsupported_grant_type", "Only authorization_code is supported.");
  const code = await takeCode(p("code"));
  if (!code) return oauthError("invalid_grant", "The code is unknown, used or expired.");
  const cred = secretFrom(raw as Record<string, string>, req.headers.get("authorization"));
  if ((cred.id ?? p("client_id")) !== code.client_id) return oauthError("invalid_grant", "client_id is required and must be the client the code was issued to.");
  const client = await getClient(code.client_id);
  if (!client) return oauthError("invalid_client", "The client is no longer registered.", 401);
  if (!secretMatches(cred.secret, client.secret_hash)) return oauthError("invalid_client", "The client secret is missing or wrong.", 401);
  if (p("redirect_uri") !== code.redirect_uri) return oauthError("invalid_grant", "redirect_uri does not match the authorization request.");
  if (!pkceOk(p("code_verifier"), code.code_challenge)) return oauthError("invalid_grant", "The PKCE code_verifier does not match.");
  const origin = originOf(req.headers, req.url);
  if (p("resource") && p("resource").replace(/\/$/, "") !== resourceOf(origin)) return oauthError("invalid_target", `resource must be ${resourceOf(origin)}`);
  try {
    const { key } = await createKey(code.userId, `${code.clientName} (connected)`, code.client_id);
    await confirmClient(code.client_id).catch(() => undefined);
    return json({ access_token: key, token_type: "Bearer", scope: "mcp" });
  } catch (e) {
    return oauthError("invalid_request", e instanceof Error && (e as { status?: number }).status === 400 ? e.message : "The token could not be issued. Try again.");
  }
}
export const OPTIONS = preflight;
