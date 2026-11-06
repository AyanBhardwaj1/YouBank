import { resourceMetadata } from "@/lib/mcp/oauth";
import { json, originOf, preflight } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

/** RFC 9728 Protected Resource Metadata for the MCP server (/api/mcp): where to sign in. */
export function GET(req: Request) {
  return json(resourceMetadata(originOf(req.headers, req.url)));
}
export const OPTIONS = preflight;
