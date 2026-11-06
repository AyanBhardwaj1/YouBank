/**
 * Sign-in for YouBank's MCP server with OAuth 2.1, as the MCP authorization spec asks, so an AI app that
 * only takes a URL (Claude and ChatGPT custom connectors) can connect: the app discovers the server
 * (Protected Resource Metadata, RFC 9728, and Authorization Server Metadata, RFC 8414), identifies itself
 * (a Client ID Metadata Document, its client_id an https URL, or Dynamic Client Registration, RFC 7591),
 * sends the person to YouBank to approve it (authorization code with PKCE S256 only), and exchanges the code
 * for a token. The token is an MCP key (src/lib/mcp/keys.ts) named for the app: it shows in Settings →
 * Connect AI apps beside hand-made keys and is revoked the same way. Public clients only (no client
 * secrets); redirect URIs must be https, or http on localhost. Pure; tested in scripts/test-mcp.ts.
 */
import { createHash } from "node:crypto";

export const MCP_PATH = "/api/mcp";
export const CODE_TTL_MS = 10 * 60_000;

export const resourceOf = (origin: string) => `${origin}${MCP_PATH}`;

/** RFC 9728: where the MCP server says its authorization server is. */
export function resourceMetadata(origin: string) {
  return { resource: resourceOf(origin), authorization_servers: [origin], bearer_methods_supported: ["header"], scopes_supported: ["mcp"], resource_name: "YouBank research", resource_documentation: `${origin}/app/settings?tab=connect` };
}

/** RFC 8414: the authorization server's endpoints and what it supports. */
export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/app/connect/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
    client_id_metadata_document_supported: true,
    service_documentation: `${origin}/app/settings?tab=connect`,
  };
}

/** A redirect a code may be sent to: https anywhere, or http on the person's own machine; no fragment. */
export function redirectOk(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 500) return false;
  try {
    const u = new URL(uri);
    if (u.hash || u.username || u.password) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
  } catch { return false; }
}

export type OAuthClient = { client_id: string; client_name: string; redirect_uris: string[]; client_uri?: string };

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\p{Cc}/gu, "").trim().slice(0, n) : "");

/**
 * A client from a registration request or a metadata document: redirect URIs required and valid, public
 * (no secret), the authorization-code grant. Null with a reason when it cannot be accepted.
 */
export function clientFrom(raw: unknown, clientId: string): { client: OAuthClient } | { error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const uris = Array.isArray(r.redirect_uris) ? r.redirect_uris : [];
  if (!uris.length || uris.length > 10 || !uris.every(redirectOk)) return { error: "redirect_uris must list 1 to 10 https (or localhost) addresses" };
  if (r.token_endpoint_auth_method !== undefined && r.token_endpoint_auth_method !== "none") return { error: "Only public clients are supported: token_endpoint_auth_method must be \"none\"" };
  if (Array.isArray(r.grant_types) && !r.grant_types.includes("authorization_code")) return { error: "grant_types must include authorization_code" };
  if (Array.isArray(r.response_types) && !r.response_types.includes("code")) return { error: "response_types must include code" };
  const client_uri = typeof r.client_uri === "string" && /^https:\/\//.test(r.client_uri) ? r.client_uri.slice(0, 300) : undefined;
  return { client: { client_id: clientId, client_name: clip(r.client_name, 80) || "An AI app", redirect_uris: uris as string[], ...(client_uri ? { client_uri } : {}) } };
}

/** A client_id that is a Client ID Metadata Document URL: https, with a path. */
export const isMetadataClientId = (id: string) => { try { const u = new URL(id); return u.protocol === "https:" && u.pathname.length > 1 && !u.hash; } catch { return false; } };

export type AuthorizeRequest = { client_id: string; redirect_uri: string; state: string; code_challenge: string; resource: string; scope: string };

/** The authorization request's parameters, checked. A redirect URI is checked against the client by the caller. */
export function parseAuthorize(q: Record<string, string | undefined>, origin: string): { req: AuthorizeRequest } | { error: string } {
  if (q.response_type !== "code") return { error: "response_type must be code" };
  if (!q.client_id || q.client_id.length > 500) return { error: "client_id is missing" };
  if (!redirectOk(q.redirect_uri)) return { error: "redirect_uri is missing or not allowed" };
  if (q.code_challenge_method !== "S256") return { error: "PKCE with code_challenge_method S256 is required" };
  if (!q.code_challenge || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge)) return { error: "code_challenge must be a base64url SHA-256" };
  const resource = q.resource ?? resourceOf(origin);
  if (resource.replace(/\/$/, "") !== resourceOf(origin)) return { error: `resource must be ${resourceOf(origin)}` };
  return { req: { client_id: q.client_id, redirect_uri: q.redirect_uri!, state: (q.state ?? "").slice(0, 500), code_challenge: q.code_challenge, resource: resourceOf(origin), scope: "mcp" } };
}

/** PKCE (RFC 7636, S256): the verifier hashes to the challenge. */
export function pkceOk(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

/** Where the person is sent back: the redirect URI with the code (or the error), the state and the issuer. */
export function redirectWith(uri: string, params: Record<string, string>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}
