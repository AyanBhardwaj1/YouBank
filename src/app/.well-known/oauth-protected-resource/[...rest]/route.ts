import { resourceMetadata } from "@/lib/mcp/oauth";
import { json, originOf, preflight } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

/** The same metadata at the path-suffixed address (/.well-known/oauth-protected-resource/api/mcp), as RFC 9728 forms it. */
export async function GET(req: Request, { params }: { params: Promise<{ rest: string[] }> }) {
  const path = `/${(await params).rest.join("/")}`;
  if (path !== "/api/mcp") return json({ error: "not_found" }, 404);
  return json(resourceMetadata(originOf(req.headers, req.url)));
}
export const OPTIONS = preflight;
