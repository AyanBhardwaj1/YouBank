import { callerIp } from "@/lib/desktop/auth";
import { withinRate } from "@/lib/locks";
import { json, oauthError, preflight } from "@/lib/mcp/http";
import { registerClient } from "@/lib/mcp/oauth-store";

export const dynamic = "force-dynamic";

/** RFC 7591 Dynamic Client Registration for MCP clients: public or confidential (a secret, shown once), redirect URIs checked. */
export async function POST(req: Request) {
  if (!(await withinRate(`oauth-register:${callerIp(req)}`, 30, 3_600_000).catch(() => true))) return oauthError("invalid_request", "Too many registrations from this address. Try again later.", 429);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return oauthError("invalid_client_metadata", "Send the client metadata as JSON.");
  const r = await registerClient(body);
  if ("error" in r) return oauthError(r.error.startsWith("redirect_uris") ? "invalid_redirect_uri" : "invalid_client_metadata", r.error);
  const c = r.client;
  return json({ client_id: c.client_id, client_name: c.client_name, redirect_uris: c.redirect_uris, ...(c.client_uri ? { client_uri: c.client_uri } : {}), client_id_issued_at: Math.floor(Date.now() / 1000), token_endpoint_auth_method: c.auth_method ?? "none", ...(r.secret ? { client_secret: r.secret, client_secret_expires_at: 0 } : {}), grant_types: ["authorization_code"], response_types: ["code"] }, 201);
}
export const OPTIONS = preflight;
