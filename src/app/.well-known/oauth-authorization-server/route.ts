import { authServerMetadata } from "@/lib/mcp/oauth";
import { json, originOf, preflight } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

/** RFC 8414 Authorization Server Metadata for MCP sign-in (src/lib/mcp/oauth.ts). */
export function GET(req: Request) {
  return json(authServerMetadata(originOf(req.headers, req.url)));
}
export const OPTIONS = preflight;
