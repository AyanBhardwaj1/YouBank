/**
 * HTTP helpers for the MCP server's OAuth endpoints: the origin a request came to (the issuer and resource
 * are this, so production, previews and localhost each describe themselves), CORS for browser-based MCP
 * clients, and OAuth's error shape.
 */
import { NextResponse } from "next/server";

export function originOf(h: Headers, url?: string): string {
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host && /^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) {
    const proto = h.get("x-forwarded-proto") ?? (url ? new URL(url).protocol.replace(":", "") : "https");
    return `${proto === "http" ? "http" : "https"}://${host}`;
  }
  return url ? new URL(url).origin : "https://localhost";
}

export const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version", "Access-Control-Max-Age": "86400" };

export const preflight = () => new Response(null, { status: 204, headers: CORS });

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store" } });

/** RFC 6749 §5.2 error. */
export const oauthError = (error: string, description: string, status = 400) => json({ error, error_description: description }, status);
