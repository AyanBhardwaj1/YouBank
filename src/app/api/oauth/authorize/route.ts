import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/user";
import { originOf } from "@/lib/mcp/http";
import { parseAuthorize, redirectWith } from "@/lib/mcp/oauth";
import { getClient, issueCode } from "@/lib/mcp/oauth-store";

export const dynamic = "force-dynamic";

/**
 * The consent form's answer (/app/connect/authorize): approve issues a code and sends the person back to
 * the app; deny sends back access_denied. Everything is checked again here, not taken from the form: the
 * request, the client and that its redirect URI is one it registered. Same-origin posts only.
 */
export async function POST(req: Request) {
  const origin = originOf(req.headers, req.url);
  const from = req.headers.get("origin");
  if (from && from !== origin) return new NextResponse("Cross-site request refused.", { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", origin), 303);
  const form = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
  const parsed = parseAuthorize(form, origin);
  if ("error" in parsed) return new NextResponse(parsed.error, { status: 400 });
  const client = await getClient(parsed.req.client_id);
  if (!client || !client.redirect_uris.includes(parsed.req.redirect_uri)) return new NextResponse("Unknown client or redirect address.", { status: 400 });
  if (form.decision !== "approve") return NextResponse.redirect(redirectWith(parsed.req.redirect_uri, { error: "access_denied", state: parsed.req.state, iss: origin }), 303);
  const code = await issueCode(user.id, parsed.req, client.client_name);
  return NextResponse.redirect(redirectWith(parsed.req.redirect_uri, { code, state: parsed.req.state, iss: origin }), 303);
}
